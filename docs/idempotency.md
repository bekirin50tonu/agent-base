---
language: "Idempotency & Retry Safety"
tag: "idempotency"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub for HTTP idempotency-key rules — key scoping, in-flight tracking, fingerprint mismatch, structured-header parsing, and the published policy."
---

# Documentation Hub: Idempotency & Retry Safety

> **Agent Directive (Phase 4)**: Evaluate this hub for any project that accepts `Idempotency-Key`,
> builds a client retry helper, or implements a request-deduplication cache. Its central claim is
> that **idempotency has three outcomes, not two** — first-time, completed-retry, and
> *concurrent*-retry — and the third exists only if the key is claimed **before** the work begins.
> An implementation that stores results after processing cannot represent it at all, and its
> absence is the one defect on this page that produces a **successful-looking duplicate write**
> rather than an error.
>
> **Triggers**: `Idempotency-Key` in a request header or middleware; a payment, order, or
> submission endpoint; a retry helper in an SDK or HTTP client; a replay/idempotency cache
> (Redis `SET NX`, a request-dedup table); a `409`/`422` retry decision in client code.
>
> **Status**: six rules and one decision matrix. One establishes ownership of the key (001); the
> five synthesized here cover the mechanisms whose failure is invisible — the missing in-flight
> state, the key-only store that cannot answer a fingerprint mismatch, the quote handling that
> splits the store in two, the unvalidated cache lookup, and the unpublished retention window.
> The matrix is the five-way branch those rules implement.
>
> Anchored on **`draft-ietf-httpapi-idempotency-key-header-07`** (Expired Internet-Draft, httpapi
> WG; last updated 2026-04-18, latest revision 2025-10-15 — not an RFC; say "de-facto", not "per
> RFC"), **RFC 9110** §15.5.21 for `422`, **RFC 7807** for the problem bodies, and **RFC 8941** for
> the structured field. This hub routes `rules/idempotency/*` and `shared/idempotency/*`; the
> broker-redelivery half of the same problem lives in `docs/messaging.md` and `docs/kafka.md`,
> where the duplicate is created by the broker and the store belongs to the consumer.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/idempotency/idempotency-keys-are-client-generated-and-scoped.md`
  - **Why**: The ownership rule everything else depends on. A server-minted key cannot survive a
    lost response — the client has nothing to retry with, so the next request is a fresh write.
    And a lookup keyed on the bare client value is a cross-tenant read primitive, because nothing
    in the keyspace is unguessable. Two further traps it names that no header spec prevents: a TTL
    window is not exactly-once (two requests outside the window are two writes), and a key
    reserved before validation is still resident after a failed attempt, so the client's
    *corrective* retry returns the same error forever.
  - **When**: Target project accepts a client-supplied idempotency key, mints keys server-side, or
    looks a key up without a tenant or account scope.
  - **Target Location**: `docs/rules/idempotency/idempotency-keys-are-client-generated-and-scoped.md`

- **Path**: `rules/idempotency/concurrent-duplicate-needs-in-flight-tracking.md`
  - **Why**: The third outcome. The draft distinguishes a retry arriving *after* the original
    completed (replay the stored result) from one arriving *while it is still running* — and only
    the second gets `409`. An implementation that reserves the key after doing the work has no
    state to represent "in flight", so the concurrent duplicate is answered by running the write
    again and the client receives two `201`s. It is the only row on this page whose absence looks
    like success.
  - **When**: Target project reserves or writes the idempotency record after processing, or has a
    duplicate-write incident where both attempts returned success.
  - **Target Location**: `docs/rules/idempotency/concurrent-duplicate-needs-in-flight-tracking.md`

- **Path**: `rules/idempotency/reuse-with-different-payload-is-422-not-a-dedup-hit.md`
  - **Why**: The specification splits ownership — the fingerprint is computed by the **resource**,
    key uniqueness by the **clients** — and names the status explicitly: `422 Unprocessable
    Content`, citing RFC 9110 §15.5.21. A store keyed on the key alone cannot express the
    distinction, so it answers a *different request that reused the key* by replaying the first
    one's success, and the client holds a `2xx` for a payload that was never processed. Confusing
    it with `409` (the in-flight case) hides a client bug behind a retryable-looking conflict.
  - **When**: Target project caches responses by key with no payload comparison, or its client
    retry logic treats `422` and `409` as the same class.
  - **Target Location**: `docs/rules/idempotency/reuse-with-different-payload-is-422-not-a-dedup-hit.md`

- **Path**: `rules/idempotency/idempotency-key-is-a-structured-header-string.md`
  - **Why**: The value is an RFC 8941 Item Structured Header whose value MUST be a String — so a
    conforming sender *includes the quotes*, in both of the draft's own examples. A server storing
    the raw wire value and a client stripping quotes store two different keys, deduplication stops
    working, and the symptom is the exact bug the header exists to prevent. The failure appears
    *after* a correctness fix rather than before one, because `.strip('"')` gets the common case
    right by accident and breaks on a value containing a space or an escaped quote.
  - **When**: Target project reads the header directly, trims quotes by hand, or reports that
    deduplication works with one SDK and not another.
  - **Target Location**: `docs/rules/idempotency/idempotency-key-is-a-structured-header-string.md`

- **Path**: `rules/idempotency/validate-the-key-before-the-cache-lookup.md`
  - **Why**: The dangerous operation is not storing the key, it is the **lookup** that runs first —
    on unvalidated input, in a hot path. The draft names both attacks this enables: injection,
    because a key used in a query you did not validate is a header value becoming an operation on
    the datastore; and data leaks, because low-entropy keys let attackers enumerate other clients'
    cache entries. The draft's remedy is structural rather than statistical — a unique **composite
    key** combining the header with "attributes known only to the resource", which holds regardless
    of entropy. That is what makes high-entropy UUIDs necessary but not sufficient.
  - **When**: Target project looks an idempotency key up in SQL, Redis, or the filesystem, uses it
    in a pattern match or path, or scopes the keyspace by header value alone.
  - **Target Location**: `docs/rules/idempotency/validate-the-key-before-the-cache-lookup.md`

- **Path**: `rules/idempotency/servers-are-must-publish-their-idempotency-policy.md`
  - **Why**: *"Resources MUST publish a idempotency related specification"* — including expiration
    policy. An undocumented retention window is indistinguishable from an unbounded one, so the
    client eventually re-keys and creates a second write while believing it was deduplicating.
    The same burden shows up on the client side: *"a general client cannot assume the server will
    respect this request"*, which makes the header an unverified assumption until the policy is
    published. It must also be discoverable over the wire — a missing header on a covered
    operation returns `400` with a problem body linking it.
  - **When**: Target project accepts the header, or a client retry helper needs to know the
    retention window and which statuses require correction.
  - **Target Location**: `docs/rules/idempotency/servers-are-must-publish-their-idempotency-policy.md`

## 2. Skills (`skills/`)

_Empty — the rules here are per-mechanism and decompose cleanly without a workflow._

## 3. Agents (`agents/`)

_Empty — the guidance is a lookup table keyed on two facts, not a persona._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/idempotency/idempotency-outcome-decision-matrix.md`
  - **Why**: The six rules are one lookup implemented as a five-way branch, decided by two
    independent facts — has the key been seen, and does the payload match. The matrix states the
    branch, the required outcome, and the *direction* each wrong branch fails in; names the
    ordering that catches the most (claim the key before the work, because that is what makes `409`
    reachable); and carries the client-side reading of the same table, where `409` is the one
    status requiring no correction before a retry. It also draws the line to the broker half:
    same branch, different owner — there the duplicate is the system's own redelivery.
  - **When**: Target project is designing an idempotency store, writing a client retry helper, or
    reconstructing a duplicate-write incident and needs to know which branch produced it.
  - **Target Location**: `docs/idempotency/idempotency-outcome-decision-matrix.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must commit the file in the
same push that updates this hub — otherwise consumers get a 404. Run `node scripts/check-manifests.mjs`.
