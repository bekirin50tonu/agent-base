---
title: "The cache lookup is the attack surface — validate the key before you query with it"
rule_id: "RULE-IDEMPOTENCY-005"
category: "security"
scope: "backend"
applies_to: "Any idempotency cache lookup; SQL, Redis, or filesystem keying of a client-supplied Idempotency-Key, multi-tenant keyspaces, low-entropy key generation"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# The cache lookup is the attack surface — validate the key before you query with it

The dangerous operation is not storing the client-supplied key; it is the **lookup** that happens
before anything else. That lookup runs on an unauthenticated-by-value input, before validation, in
a hot path — and it is where both attacks the specification names actually land.

## Why

> Resources that do not implement strong idempotency keys, such as
> UUIDs, or have appropriate controls to validate the idempotency keys,
> could be victim to various forms of security attacks from malicious
> clients:
>
> *  Injection attacks - When the resources does not validate the
>    idempotency key in the client request and performs a idempotent
>    cache lookup, there can be security attacks (primarily in the form
>    of injection), compromising the server.
>
> *  Data leaks-When an idempotency implementation allows low entropy
>    keys, attackers MAY determine other keys and use them to fetch
>    existing idempotent cache entries, belonging to other clients.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

Read the first bullet's subject carefully: "does not validate the idempotency key … **and performs
a idempotent cache lookup**." The vulnerability is the *composition* of unvalidated input and a
query built from it. A key concatenated into SQL, used as a glob in a cache namespace scan
(`KEYS idem:*<key>*`), or joined into a filesystem path is a header value becoming an operation on
the datastore. UUIDs do not fix this — the attacker chooses the value they send, formatted however
they like.

The second bullet is a **read primitive**, and the specification's remedy is structural rather than
statistical:

> *  On the resource, implement a unique composite key as the
>    idempotent cache lookup key.  For example, a composite key MAY be
>    implemented by combining the idempotency key sent by the client
>    with other client specific attributes known only to the resource.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

"Attributes known only to the resource" is the load-bearing phrase. The account id in the composite
key is not part of anything the attacker supplied, so a *correct* guess still cannot produce a hit.
That guarantee holds regardless of key entropy — which is what distinguishes it from "use UUIDs,"
and why a high-entropy key is necessary but not sufficient.

Key uniqueness itself is the client's obligation, which is why the server's published format is a
security control:

> Uniqueness of the key MUST be defined by the resource owner and MUST
> be implemented by the clients of the resource.  It is RECOMMENDED
> that a UUID [RFC4122] or a similar random identifier be used as an
> idempotency key.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

The resource *defines* the format; the client must implement it. A server that accepts any string
has delegated the entropy requirement to a party it does not control.

## Do

- Validate the key against the published format **before** the lookup, and return `400` otherwise.
  Ordering is the rule, not the presence of validation.
- Make the composite `(account_id, idem_key)` pair the actual lookup key, enforced as a unique
  constraint rather than applied as a filter after a broad `SELECT`.
- Namespace cache keys by account: `idem:{account_id}:{key}` — equality lookup, one namespace per
  tenant.
- Use bound parameters everywhere the key appears. The lookup is the query; do not concatenate it.
- Publish the accepted format so "high entropy" is enforceable rather than aspirational.

## Don't

- Don't look the key up first and validate afterwards. By then the query has already run.
- Don't use the key in a pattern match — `LIKE`, `KEYS`, `SCAN MATCH`, `find`, a glob — in any path
  that a client can influence. Even an escaped value changes the operation from equality to search.
- Don't derive a filesystem path or object-store key from the header value.
- Don't rely on UUID entropy alone as the tenant isolation control. It is one layer, and the one
  the attacker does not have to cooperate with.
- Don't return a distinguishable response for "key exists under a different account" — that is an
  oracle even when the body is generic. Scope the lookup so the row is simply not found.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| SQL error trace mentioning the key | Unparameterised lookup | Bound parameters; validate first |
| Keyspace scan under load | Pattern match in the hot path | Equality lookup on a composite key |
| One tenant sees another's replay body | Flat keyspace, no account scoping | `(account_id, key)` unique index |
| Successful-looking enumeration | Different response for "key taken" | Indistinguishable not-found |
| Cache key derived from header bytes | Raw value in a path or key | Parse, validate, then namespace |

## Verifying

```bash
# 1. Find the lookup, and check two things: is it parameterised, and does
#    it run before or after format validation?
grep -rniE 'idempotency[_-]?key' \
  --include=*.ts --include=*.js --include=*.py --include=*.go \
  --include=*.java --include=*.rb --include=*.sql . | head -20

# 2. Any pattern match, glob, or string-built cache key on that value is
#    a finding: LIKE, KEYS, SCAN MATCH, find(, path.join(key).

# 3. Confirm the lookup is scoped by an authenticated identity rather than
#    by a value from the header or the request body.
```

What this check cannot see: nothing static establishes that an account id in the composite key came
from the session rather than from a body field, and a leaked key is invisible to every grep. The
observational check is a cross-account probe: submit a request with tenant A's credentials and
tenant B's idempotency key, and assert the response is indistinguishable from any unused key. A
`422` or a replayed body there is the finding — and it is the one test that separates "scoped" from
"mentions the account column".