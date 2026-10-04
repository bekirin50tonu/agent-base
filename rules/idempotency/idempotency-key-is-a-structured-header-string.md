---
title: "The key is a Structured Field String — the quotes are part of the value's syntax"
rule_id: "RULE-IDEMPOTENCY-004"
category: "protocol"
scope: "all"
applies_to: "Idempotency-Key header parsing, RFC 8941 structured fields, HTTP client retry helpers, proxy and framework header handling"
last_updated: "2026-10-04"
source: "https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html"
---

# The key is a Structured Field String — the quotes are part of the value's syntax

The header's value is defined as an RFC 8941 Structured Field, which means a conforming sender
*includes the quotes*. A server that stores the raw header value and a client that strips quotes
store two different keys, deduplication silently stops working, and the symptom is the exact bug
the header was added to prevent.

## Why

> Idempotency-Key is an Item Structured Header [RFC8941].  Its value
> MUST be a String (Section 3.3.3 of [RFC8941]).
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

Both of the specification's own examples are quoted, without exception:

> The following example shows an idempotency key whose value is a UUID
> [RFC4122]:
>
>     Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

> Second example shows an idempotency-key header field with key value
> using a random string generator:
>
>     Idempotency-Key: "clkyoesmbgybucifusbbtdsbohtyuuwz"
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

So the wire value is the 38-character token `"8e03978e-..."`, and a spec-compliant server
unquotes it to a 36-character UUID before storing. Hand-rolled `.strip('"')` gets this right only
by accident, and it is the accident that breaks when a value legitimately contains a quote or a
space — both legal in a Structured Field String, neither legal in a bare token.

The failure has a characteristic signature: it appears *after* a correctness fix, not before one.
A team that finds a key with stray quotes stored and "cleans" it by trimming on write, while the
client sends quotes on retry, produces a mismatch on every single retry. Deduplication is then
strictly worse than absent, because the key is present in the store and the lookup still misses.

The specification's own mitigation is to validate against a *published* format rather than to
accept whatever parses:

> *  Establish a fixed format for the idempotency key and publish the
>    key's specification.
>
> *  Always validate the key as per its published specification before
>    processing any request.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

> The resource MAY require time based idempotency keys to be able to
> purge or delete a key upon its expiry.  The resource SHOULD define
> such expiration policy and publish it in the documentation.
> ([The Idempotency-Key HTTP Header Field](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html))

## Do

- Parse the value with an RFC 8941 Structured Fields parser and unquote there. Both sides of the
  retry then agree, because both sides follow the same rule.
- Publish the accepted format (UUIDv4 is the specification's recommendation) and reject everything
  else with a problem body — a value you cannot deduplicate on is not worth storing.
- Reject rather than coerce. Trimming quotes to "make it work" moves the mismatch to the other
  client.
- Compare the *parsed* value on both write and lookup; normalising at only one end reintroduces
  the split.

## Don't

- Don't store the raw header value. That is the mismatch, and it is silent.
- Don't hand-roll unquoting with `.strip('"')` — a Structured Field String may contain spaces,
  commas, and escaped quotes, and stripping is not unescaping.
- Don't accept a bare UUID as equivalent to a quoted one "for robustness". Both keys then live in
  the store and neither matches the other.
- Don't skip format validation on the grounds that the store will simply miss. That converts a
  clear `400` into a silent duplicate write.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Every retry duplicates | Server stores quotes, client omits | Parse and unquote per RFC 8941 |
| Works with one SDK, fails with another | Sender sends a bare token | Require and validate the format |
| Keys stored with stray quotes | Raw header value persisted | Parse before storing |
| Malformed key accepted, later collides | No format validation | Publish and enforce a format |
| Retry rejected after a "cleanup" fix | Trimmed on write only | Normalise at both ends |

## Verifying

```bash
# 1. How is the header read? A raw header access stores the wire value,
#    quotes included. Look for manual trimming too.
grep -rniE 'idempotency[-_]?key' \
  --include=*.ts --include=*.js --include=*.py --include=*.go \
  --include=*.java --include=*.rb . | head -20

# 2. Does anything strip quotes by hand? strip('"'), trim('"'),
#    replace(/"/g,...) -- all of these are the bug in disguise.

# 3. Send the same key twice, once quoted and once bare, and assert the
#    server's behaviour is identical. Divergence here is the defect, and
#    it is invisible to steps 1 and 2.
```

What this check cannot see: whether the *client* on the other end is conforming is outside the
repository, and the failure only appears when sender and server disagree. That is why the
round-trip test matters more than the grep: a server that accepts both forms without normalising
them looks correct in every static check and fails only against a strictly conforming client.