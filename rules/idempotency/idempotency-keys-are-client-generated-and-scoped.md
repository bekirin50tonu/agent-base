---
title: "Idempotency Keys Are Client-Generated and Account-Scoped"
rule_id: "RULE-IDEMPOTENCY-001"
category: "architecture"
scope: "backend"
applies_to: "Any HTTP API accepting POST or PATCH that the client is expected to retry"
last_updated: "2026-09-30"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html, https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/"
---

# Idempotency Keys Are Client-Generated and Account-Scoped

A retry is not a rare event — a client that does not know whether its `POST` landed must choose between duplicating the write and losing it. An idempotency key makes that retry safe, but only if the key is generated where the retry decision is made (the client), and only if the key is looked up inside a scope that a stranger cannot reach. Both halves are mandatory: a server-generated key cannot survive the response being lost, and an unscoped key is an object-reference oracle.

## Why

Three failures this rule prevents, each observable in production:

1. **Server-generated keys do not deduplicate.** If the server mints the key and returns it in the response, a client whose response was lost has no key to retry with. The next request gets a fresh key and a second charge. The key must exist *before* the request leaves the client.
2. **Unscoped keys leak across accounts.** `SELECT ... WHERE idempotency_key = ?` over a flat keyspace lets one tenant probe for another tenant's keys and read the cached response body. Low-entropy or predictable keys make this a brute-force exercise rather than a lucky guess.
3. **A TTL window is not exactly-once.** Deduplication is scoped to the retention window. Two identical requests 25 hours apart with a 24-hour window are two writes. Anything requiring permanence needs a natural key or a unique constraint in the datastore.

## Do

- Have the client generate the key **before sending**, as a UUIDv4 or equivalent high-entropy value, and reuse that exact value on every retry of the *same logical attempt*. A new key per retry is just a second request.
- Carry it in the `Idempotency-Key` request header. The field is a Structured Field String (`RFC 8941`) — quote it:
  ```http
  Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"
  ```
- Validate the key against a published format before touching any storage. Reject malformed input at the edge rather than after a lookup.
- Compose the lookup key from the idempotency key **plus an attribute only the server knows** — account id, API key id, route — so the keyspace is per-tenant and unguessable.
- Cache and **replay the original response verbatim** (status code and body) for a duplicate within the window. Returning a 200 where the original was 201 forces the client to handle two different shapes for one logical call.
- Make the key write and the response write atomic. `SET key placeholder NX EX ttl` reserves the slot; the caller must then fill it, and a concurrent second request must either wait for that fill or return `409 Conflict`.
- Publish the expiry policy. A resource that silently expires keys at an arbitrary TTL surprises every client that retried at hour 26.

```python
def handle(req):
    key = req.headers.get("Idempotency-Key")
    if key is None:
        return process(req)                    # client opted out of retries
    assert VALID_KEY_RE.fullmatch(key), 400
    # composite: unguessable without the account id
    slot = f"idem:{req.account_id}:{req.route}:{key}"
    if not redis.set(slot, "", nx=True, ex=WINDOW):
        return replay(slot)                    # verbatim original response
    try:
        resp = process(req)
        redis.set(slot, serialize(resp))       # fills the reserved slot
        return resp
    except Exception:
        redis.delete(slot)                     # free the key; nothing committed
        raise
```

## Don't

- **Don't mint the key server-side and return it.** If the response is lost the client has no key and the next retry is a fresh write. This defeats the entire mechanism.
- **Don't key the lookup on the raw client-supplied value.** `WHERE idempotency_key = :key` with no tenant scoping is a cross-tenant read primitive. Compose the key.
- **Don't accept low-entropy or client-controlled-format keys.** The draft's own security section names both injection (key value used in a lookup you did not validate) and enumeration ("attackers MAY determine other keys and use them to fetch existing idempotent cache entries") as live threats.
- **Don't reserve the key for failed requests.** A 400/422/409 validation failure never mutated anything — leaving the key resident makes the client's corrective retry return the error forever.
- **Don't claim exactly-once.** Idempotency gives *effectively-once within a window*. Operations with no natural upper bound on retry distance need a unique constraint on a business key.
- **Don't reuse one key for a different payload.** Detect it (compare a request fingerprint — checksum of the body) and return `422` or `409`. Silently returning the old response for a different request is worse than not deduplicating at all.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Duplicate charges despite sending an `Idempotency-Key` | Client generates a fresh key per retry | Generate once per logical attempt, hold it across retries |
| One account can read another's cached response | Lookup keyed on the bare client value | Compose `idem:{account_id}:{route}:{key}` |
| Retried 400 persists after the input was corrected | Key reserved before validation | Reserve only after validation passes and before the write |
| Retry 24h later produces a second write | Window shorter than the retry horizon | Lengthen the window, or add a unique constraint on a business key |
| Second concurrent request gets `200` for a half-written state | Key reservation and response write not atomic | Reserve with `SET NX`, fill after commit, replay only filled slots |
| Different body, same key, old response returned | No fingerprint comparison | Hash the body; on mismatch return `409` |
| Latency spike on every duplicate | Live re-execution instead of replay | Cache the serialized response at reserve time |

## Verifying

1. `curl -X POST "$API/charges" -H "Idempotency-Key: $K" -d '{"amount":1}'` twice; assert the second response body and status byte-match the first.
2. Repeat step 1 with a second account's bearer token and the *same* `$K`; assert it creates a new resource rather than replaying account one's response.
3. Change the request body while keeping `$K`; assert `409`/`422`, not a replay.
4. Send `$K` with `{"amount": 99999999}` (violates validation); assert the key is released — repeat the corrected call with the same `$K` and assert it succeeds.
5. `grep -rn "Idempotency-Key" <target>` and confirm the value is parsed and validated before any datastore call.

## Caveats on confidence

- `Idempotency-Key` is **not an RFC**. `draft-ietf-httpapi-idempotency-key-header-07` reached IESG evaluation and the datatracker records it as **Expired & archived** (last updated 2026-04-18; latest revision 2025-10-15). The header is a widely-used convention (Stripe and others), not a standard. Say "de-facto" in review notes, not "per RFC".
- `RFC 9110` defines *method-level* idempotency (§9.2.2) only — `OPTIONS`, `HEAD`, `GET`, `PUT`, `DELETE`. It deliberately does not cover `POST`. This rule is about the header convention, which fills exactly that gap. Quoted: *"Per [RFC9110], the methods OPTIONS, HEAD, GET, PUT and DELETE are idempotent while methods POST and PATCH are not."*
- The 409-on-fingerprint-mismatch choice is our judgement from the draft's §2.2 prohibition (*"MUST NOT be reused with another request with a different request payload"*); the draft does not name a status code.
- We did not verify the reservation/reservation-fill protocol against a specific production library; the shape above is derived from the draft's security recommendations and the atomicity requirement. Audit your own datastore's concurrency primitives before copying it.