---
title: "Publishing the idempotency policy is a MUST, not documentation hygiene"
rule_id: "RULE-IDEMPOTENCY-006"
category: "api-design"
scope: "all"
applies_to: "Any API that accepts Idempotency-Key; client retry implementations, SDK retry helpers, API documentation, expiry/retention windows"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# Publishing the idempotency policy is a MUST, not documentation hygiene

An undocumented expiry window is indistinguishable from an unbounded one. A client that cannot
compute whether its retry is still covered will eventually re-key and create a second write — while
believing it was deduplicating. The specification puts that burden on the resource, as a `MUST`.

## Why

> Resources MUST publish a idempotency related specification.  This
> specification MUST include expiration related policy if applicable.
> A resource is responsible for managing the lifecycle of the
> idempotency key.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

> The resource MAY require time based idempotency keys to be able to
> purge or delete a key upon its expiry.  The resource SHOULD define
> such expiration policy and publish it in the documentation.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

The client's side of the same contract is why this matters — a client sending the header is
committing to a behaviour it cannot verify on its own:

> Clients MAY choose to send an Idempotency-Key field with any valid
> value to indicate the user's intent is to only perform this action
> once.  Without a priori knowledge, a general client cannot assume the
> server will respect this request.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

"a general client cannot assume the server will respect this request" makes the header an
unverified assumption — and the published policy is the only thing that makes it checkable. Without
one, `Idempotency-Key` is a hint; with one, it is a contract the client can implement.

That is also why the retention window is a *design* parameter rather than an implementation detail.
The corpus's existing key rule names the same trap from the other side — a TTL window is not
exactly-once, because two identical requests outside the window are two writes — but here the
question is not whether the guarantee is absolute. It is whether the client can *know* which
guarantee it has, which requires the window to be published.

The policy is discoverable over the wire, not only in prose, and that is deliberate: the error bodies
carry the policy URL in the RFC 7807 `type` field, which is how a client learns the operation is
idempotency-aware without having read the docs.

> If the Idempotency-Key request header is missing for a documented
> idempotent operation requiring this header, the resource SHOULD reply
> with an HTTP 400 status code with body containing a link pointing to
> relevant documentation.
>
>     HTTP/1.1 400 Bad Request
>     Content-Type: application/problem+json
>     Content-Language: en
>     {
>       "type": "https://developer.example.com/idempotency",
>       "title": "Idempotency-Key is missing",
>       "detail": "This operation is idempotent and it requires correct
>        usage of Idempotency Key.",
>     }
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

A resource that silently ignores a missing key gives the client no way to discover the contract
exists, so the header is never sent and the mechanism is never used.

## Do

- Publish the policy with the API, and make it the URL in every problem body's `type` field.
- Answer four questions explicitly: which methods and paths are covered, what key format is
  accepted, how long a key is retained, and which status codes mean *retry* versus *fix and retry*.
- Return `400` with a problem body when the header is required and absent. Silently processing the
  request is the failure this prevents.
- State that `409` requires no correction — it is the one retryable-by-construction status.
- Document that reusing a key across payloads is a `422`, and that it is permanent until the client
  generates a new key.

## Don't

- Don't document the header without publishing the retention window. That is the half that changes
  client behaviour.
- Don't purge keys on a schedule nobody published. The purge is correct and the client is still
  wrong to assume it was covered.
- Don't return `400` for a missing key without a body linking the policy — the client learns the
  contract exists from that link.
- Don't let a retry helper re-key automatically on a `422` it did not cause. A `422` means its own
  state is inconsistent, not that the server is temporarily unavailable.
- Don't treat `429`, `503`, or `504` as idempotency failures; the specification routes those to the
  client's own backoff policy.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Duplicate writes hours apart | Window unpublished; client re-keyed | Publish the retention policy |
| Header never sent by clients | Missing-key case ignored silently | `400` with a problem body |
| Client retries `422` forever | `422` treated as transient | Document it as permanent |
| Keys purged mid-retry storm | Window shorter than client retry budget | Publish, and size to the worst client |
| Retry helper generates a new key per attempt | Helper does not understand idempotency | One key per logical attempt |

## Verifying

```bash
# 1. Is the policy reachable, and does it state a retention window?
#    A page describing the header without naming a duration is the finding.
grep -rniE 'idempotency' --include=*.md --include=*.yaml --include=*.yml \
  --include=*.json . | grep -iE 'expir|retention|ttl|window|24 ?h|hours'

# 2. Do the problem bodies carry a type link to that policy?
grep -rniE 'problem\+json|"type":' --include=*.ts --include=*.js \
  --include=*.py --include=*.go --include=*.java . | head

# 3. Behavioural: send a covered operation with no Idempotency-Key and
#    assert a 400 with a policy link — not a 2xx.
```

What this check cannot see: whether the published window matches the *actual* purge job is a
deployment property, not a documentation property, and a policy that says 24 hours against a cron
running hourly is indistinguishable from a correct one until a retry lands in the gap. The only
check that settles it is temporal: exercise a retry at the window boundary and confirm it is
covered, then one just past it and confirm the behaviour changes to a fresh write.