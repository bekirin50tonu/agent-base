---
title: "Idempotency Outcome — Decision Matrix"
category: "api-design"
applies_to: "Any HTTP endpoint deduplicating on Idempotency-Key, where the status code is decided by two independent facts: whether the key has been seen, and whether the payload matches"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# Idempotency Outcome — Decision Matrix

The five rules above are one lookup implemented as a five-way branch. The branch is decided by two
independent facts — has the key been seen, does the payload match — and get either wrong and the
response is wrong in a direction that looks successful.

## When to Use

- An endpoint accepts `Idempotency-Key` and the response code for a repeat has to be settled.
- A payment, order, or submission endpoint is being reviewed and the replay path has not been
  tested against a changed payload.
- An idempotency store is being designed, and the shape of its claim is an open question.
- A client retry helper is being written and needs to know which statuses are retryable without
  correction.
- A duplicate-write incident is being reconstructed and the question is which branch produced it.

## The matrix

| Key seen | Fingerprint | State | Required outcome | Silent failure if the branch is wrong |
|---|---|---|---|---|
| No | — | — | Process normally; claim the key **before** the work | Claim written after the work — no in-flight state exists |
| Yes | Match | `in_flight` | `409 Conflict` — "A request is outstanding for this Idempotency-Key" | Treated as a miss → the write runs twice, client sees two `201`s |
| Yes | Match | `completed` | Replay the stored response, status code included | Replayed without the original status → a stored `422` becomes a `200` |
| Yes | **Mismatch** | any | `422 Unprocessable Content` — "Idempotency-Key is already used" | Replayed as a hit → client holds a success for a request that never ran |
| Absent header on a covered operation | — | — | `400 Bad Request` with an RFC 7807 body linking the policy | Header silently ignored → the client never learns the operation is idempotency-aware |

## The ordering that catches the most

Rows 2 and 3 share one precondition: **the claim must be written before the work begins.** An
implementation that stores results after processing cannot represent row 2 at all — the state it
would have to return does not exist in its store.

That single ordering fact is what makes `409` reachable, and `409` is the only row in this table
whose absence produces a **successful-looking duplicate write** rather than an error. Every other
mistake in the table yields a wrong status code, which something downstream can notice. This one
yields two correct-looking success codes and a client that has double-charged.

## Client-side reading of the same table

The matrix is also the contract a retry helper implements, because the correction requirement
differs per row:

| Status | Correct the request? | Why |
|---|---|---|
| `409` | No — retry is the correct response | The original is still running |
| `422` | Yes — the key itself is inconsistent with the payload | Permanent until a new key is generated |
| `400` | Yes — the header is missing or malformed | The policy link says which |
| `429` / `503` / `504` | No — back off per the resource's own policy | Not idempotency failures |

The `409` exemption is the specification's own wording, and it is the row most clients get wrong:
treating `409` like `422` means either retrying forever or abandoning a request that would have
succeeded a moment later.

## What the matrix cannot tell you

Whether the stored response is still the right response is a function of the retention window, not
of the branch. Every row assumes the claim exists; if the entry was purged, the lookup returns
*absent* and the client gets a fresh write — which is correct behaviour for an expired key and a
duplicate write for a client that believed its retry was covered. Only a published expiry policy
distinguishes those two.

It also cannot tell you whether the collector behind your cache is still answering. A replay that
times out is a replay you cannot distinguish from a first-time request, which is the one case where
retrying with the *same* key is the correct answer and a client that re-keys is wrong.

## Where it differs from the queue side

`rules/messaging/at-least-once-is-the-guarantee-you-get.md` and
`rules/messaging/message-ordering-and-exactly-once-semantics.md` cover the broker half, where the
duplicate is created by redelivery and the dedup store belongs to the consumer. Here the duplicate
is created by the *client*, the store belongs to the *server*, and the transport already guarantees
the retry will arrive.

The same five-way branch appears in both. What changes is who can be wrong about it: on the queue
side a redelivery is the system's own doing and needs no client cooperation; here the duplicate is
an explicit client decision, which is why the fingerprint — a resource-computed value — is the only
thing that can tell the two apart.