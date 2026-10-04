---
title: "A duplicate while the original is in flight needs a third state, not a cache miss"
rule_id: "RULE-IDEMPOTENCY-002"
category: "correctness"
scope: "backend"
applies_to: "Any endpoint accepting Idempotency-Key where a retry can arrive before the original request has completed; Stripe-style idempotency, payment and order APIs, request replay"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# A duplicate while the original is in flight needs a third state, not a cache miss

An idempotency store that holds only completed responses has two states, and the specification
requires three. The missing one is the concurrent duplicate, and it fails as a **successful-looking
duplicate write** rather than as an error — the one outcome the whole mechanism exists to prevent.

## Why

The specification separates the duplicate case by whether the original finished:

> *  Duplicate request (idempotency key and fingerprint has been seen)
>
>    Retry
>
>    The request was retried after the original request completed.  The
>    resource SHOULD respond with the result of the previously completed
>    operation, success or an error.  See Error Scenarios for details on
>    errors.
>
>    Concurrent Request
>
>    The request was retried before the original request completed.  The
>    resource SHOULD respond with a resource conflict error.  See Error
>    Scenarios for details.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

and the status code for it is fixed:

> If the request is retried, while the original request is still being
> processed, the resource SHOULD reply with an HTTP 409 status code with
> body containing problem description.
>
>     HTTP/1.1 409 Conflict
>     Content-Type: application/problem+json
>     Content-Language: en
>     {
>       "type": "https://developer.example.com/idempotency",
>       "title": "A request is outstanding for this Idempotency-Key",
>       "detail": "A request with the same Idempotency-Key for the
>        same operation is being processed or is outstanding.",
>     }
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

A cache of *completed results* cannot produce that `409`, because the state it would have to return
— key present, result not yet written — is not representable in it. The lookup misses, the handler
runs, and the write happens twice. The client receives two `201 Created` responses for one logical
operation.

`409` is also the one status the client is told *not* to correct before retrying:

> Clients MUST correct the requests (with the exception of 409 where no
> correction is required) before performing a retry operation, or the
> resource MUST fail the request and return one of the above errors.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

That exemption is what makes it safe to return: a client treating `409` like `400` would have
nothing to change and would either spin or give up.

## Do

- Claim the key **before** the work begins, not after. That ordering is the whole rule: a store
  updated after the operation is only a completed-result cache by construction.
- Model the claim with an explicit state (`in_flight` / `completed`) so the concurrent branch is
  reachable rather than impossible.
- Replay the stored response **with its original status code** on a completed hit.
- Clear or complete the claim on failure too — an `in_flight` marker left behind is a key that
  returns `409` forever.
- Bound how long a claim may stay `in_flight`, so a crashed worker's key does not wedge the client
  permanently.

## Don't

- Don't look the key up and only then decide whether to process. The lookup and the claim must be
  the same atomic step, or two concurrent requests both see "absent".
- Don't treat an absent result as "first time" when the key itself is present.
- Don't return `409` without a problem body. The specification's shape carries the `type` link that
  tells the client where the policy lives.
- Don't reuse `409` as a generic lock error. It is a contract with clients: no correction needed,
  retry is the correct response.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Two `201`s for one operation | No in-flight state; duplicate processed | Claim before the work; return `409` |
| Retry hits a wedged key forever | `in_flight` never cleared on failure | Complete or expire the claim |
| Stored `422` replayed as `200` | Response body stored without its status | Store and replay the status code |
| Client retries `409` in a loop | Client treats it as a correctable error | Document that `409` needs no correction |
| Duplicate processed under load only | Claim written after the work | Move the claim ahead of the handler |

## Verifying

```bash
# 1. Where is the key claimed, and is it before or after the operation?
#    A store written after the handler has no in-flight state.
grep -rniE 'idempotency[_-]?key|idempotent|Idempotency-Key' \
  --include=*.ts --include=*.js --include=*.py --include=*.go \
  --include=*.java --include=*.rb --include=*.sql . | head -20

# 2. Does the store have a state/in-flight column, or is it a bare
#    key -> response cache? The latter cannot produce 409.

# 3. Behavioural, and this is the one that counts: fire the same request
#    twice concurrently and assert exactly one 2xx and one 409. A store
#    with no in-flight state returns two 2xx here.
```

What this check cannot see: whether the `409` body matches the documented policy is invisible from
source — it is a wire contract. Nor can a static check tell whether the claim survives a crash, so
the expiry bound on `in_flight` is a design decision this grep cannot verify. The concurrency test
is the only check that separates a three-state store from a two-state one.