---
title: "Key reuse across different payloads is a 422, and a key-only store cannot express it"
rule_id: "RULE-IDEMPOTENCY-003"
category: "correctness"
scope: "backend"
applies_to: "Any endpoint deduplicating on Idempotency-Key; stores keyed on the key alone, Stripe-style replay caches, payment and order submission endpoints"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# Key reuse across different payloads is a 422, and a key-only store cannot express it

An idempotency store keyed on the key alone cannot tell a *retry* from a *different request that
reused the key* — and it answers the second one by replaying the first one's success. The client
ends up holding a `2xx` for a payload that was never processed.

## Why

The specification splits ownership: the fingerprint is computed by the **resource**, while key
uniqueness belongs to the **clients**:

> An idempotency fingerprint MAY be used in conjunction with an
> idempotency key to determine the uniqueness of a request.  Such a
> fingerprint is generated from request payload data by the resource.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

> The idempotency key MUST be unique and MUST NOT be reused with
> another request with a different request payload.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

The required response names a distinct status code:

> If there is an attempt to reuse an idempotency key with a different
> request payload, the resource SHOULD reply with a HTTP 422 status
> code with body containing a link pointing to relevant documentation.
> The status code 422 is defined in Section 15.5.21 of [RFC9110].
>
>     HTTP/1.1 422 Unprocessable Content
>     Content-Type: application/problem+json
>     Content-Language: en
>     {
>       "type": "https://developer.example.com/idempotency",
>       "title": "Idempotency-Key is already used",
>       "detail": "This operation is idempotent and it requires
>        correct usage of Idempotency Key. Idempotency Key MUST not be
>        reused across different payloads of this operation.",
>     }
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

A key-only lookup finds the entry and replays the original response. If the first attempt happened
to fail validation, the client gets the old `422` for a new, valid payload. If it succeeded, the
client gets a `201` for an order it never placed. Both look like the server working.

The fingerprint does not have to be a full-body digest — the specification lists the options,
cheapest first:

> *  Checksum of the entire request payload.
>
> *  Checksum of selected element(s) in the request payload.
>
> *  Field value match for each field in the request payload.
>
> *  Field value match for selected element(s) in the request payload.
>
> *  Request digest/signature.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

The fourth suits an API whose body is an object: match the fields that define the write, ignore the
rest. But the choice must be deliberate — a constant or empty fingerprint is the same as no
fingerprint, and it fails in the same silent direction.

## Do

- Store the fingerprint next to the key, and compare it on every hit.
- Treat a fingerprint mismatch as a **different request**, never as a replay.
- Choose the narrowest fingerprint that still distinguishes distinct writes; a field-by-field match
  over the meaningful fields beats a whole-body checksum that changes on a timestamp.
- Include the normalised body in the fingerprint, not the raw bytes, so a client re-serialising the
  same object is not told its key is invalid.
- Document that reusing a key across payloads is a client error, so `422` is not read as a server
  fault.

## Don't

- Don't replay a stored response when the payload differs. That is the bug.
- Don't compute the fingerprint over fields the client controls and that do not define the write
  (`client_timestamp`, `request_id`, `locale`) — every retry then looks like a new request.
- Don't use the key's own value as part of the fingerprint; it is the lookup key already.
- Don't treat `422` as a transient error in client retry logic. It is permanent until the client
  generates a new key.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| New payload gets the old `2xx` | Replayed without a fingerprint check | Compare fingerprint; return `422` |
| Valid retry rejected as `422` | Fingerprint covers volatile fields | Fingerprint the fields defining the write |
| Client re-serialises, key "invalid" | Fingerprint over raw bytes | Normalise before fingerprinting |
| Constant fingerprint in config | Placeholder never replaced | Derive it from the payload |
| Duplicate keys across tenants | Keyspace not scoped | Composite key (see the cache-lookup rule) |

## Verifying

```bash
# 1. Is there a fingerprint column, and is it compared on a hit?
#    A key -> response cache with no payload check cannot produce 422.
grep -rniE 'fingerprint|payload_hash|body_hash|request_hash|Idempotency-Key' \
  --include=*.ts --include=*.js --include=*.py --include=*.go \
  --include=*.java --include=*.sql . | head -20

# 2. Does the fingerprint derive from something that changes with the
#    payload? A literal constant or an empty string is a placeholder.

# 3. Behavioural: replay the same key with a different body and assert 422.
#    Any 2xx here is the defect — and it is invisible to steps 1 and 2.
```

What this check cannot see: whether the fingerprint covers the *right* fields is a judgement call
no grep settles — a hash over the full body is syntactically present and semantically wrong in the
other direction (every re-serialisation becomes a new request). The mismatch test catches only the
case where the check is absent entirely, not the case where it is present and over-broad.