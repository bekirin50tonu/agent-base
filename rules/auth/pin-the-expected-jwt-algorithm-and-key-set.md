---
title: "Pin the Expected JWT Algorithm and Key Set"
rule_id: "RULE-AUTH-002"
category: "security"
scope: "backend"
applies_to: "Any service that verifies a JWT: API gateway, resource server, MCP server, or auth middleware"
last_updated: "2026-09-30"
source: "https://www.rfc-editor.org/rfc/rfc8725.html, https://www.rfc-editor.org/rfc/rfc7519.html"
---

# Pin the Expected JWT Algorithm and Key Set

The most damaging JWT failures are not cryptographic breaks — they are a verifier that reads the attacker's choice of algorithm instead of its own. Pin the algorithm list server-side, bind each key to exactly one algorithm, and never follow a URL the token supplied.

## Why

RFC 8725 §3.1 makes this a MUST, and the reason is a family of real attacks: `alg: none` (unsigned token accepted as valid), and algorithm confusion — presenting an RSA public key as an HMAC secret so the verifier signs its own forgery with public data. Both succeed against a verifier that dispatches on the header. §3.1 is explicit that the library *"MUST ensure that the 'alg' or 'enc' header specifies the same algorithm that is used for the cryptographic operation. Moreover, each key MUST be used with exactly one algorithm, and this MUST be checked when the cryptographic operation is performed."*

Two more header-driven failures, both in §3.10: `kid` is interpolated into a key lookup, and *"Applications should ensure that this does not create SQL or LDAP injection vulnerabilities"*; and blindly following `jku`/`x5u` *"could result in server-side request forgery (SSRF) attacks"* — the RFC's remedy is a URL whitelist and no cookies on the fetch.

## Do

- **Pin the allowed algorithms in your code**, not in configuration a token can influence: `algorithms: ["RS256"]` (or `EdDSA`). The set is a constant in the verifier.
- Reject `alg: none` unconditionally. RFC 8725 §3.2 notes it *"can be perfectly acceptable"* only when the JWT is protected end-to-end by a current TLS layer — which is not the case for a token that travels inside a body, and never the case for a token stored in `localStorage`.
- Bind keys to algorithms: never verify an HS256 token with a key from your RSA set. Check the key type at verification time, not only at load time.
- Resolve `kid` against an **in-memory, pre-fetched** key set. Validate its format before use. If a `kid` is unknown, reject — do not iterate all keys and accept the first that verifies.
- Configure `jku`/`x5u` to a **static allowlist**, or ignore the headers entirely and configure the JWKS URI yourself. If you must fetch remotely: HTTPS only, allowlisted host, no cookies, and cache.
- Validate claims strictly and reject on absence, not on falsiness:
  - `iss` — MUST match your issuer; and per §3.8 the *"cryptographic keys used for the cryptographic operations in the JWT [must] belong to the issuer"*, or reject.
  - `aud` — MUST be present and include this service. §3.9: if *"the audience value is not present or not associated with the recipient, it MUST reject the JWT."*
  - `exp` / `nbf` — required for your own issued tokens. RFC 7519 allows *"some small leeway, usually no more than a few minutes, to account for clock skew"*; default to 60s and make it explicit.
  - `sub` — validate against a known subject; §3.8 requires the value to correspond to a valid subject at the application.
- **Use mutually exclusive validation rules per JWT kind.** §3.12: if more than one kind of JWT comes from one issuer, the rules *"MUST be written such that they are mutually exclusive, rejecting JWTs of the wrong kind."* Distinguish by `typ` at minimum. An access token accepted where a refresh token belongs is a privilege escalation.
- Enable cryptographic agility (§3.2) — the allowed set changes as algorithms are deprecated; hardcoding a single value with no migration path is a future outage.

```ts
// algorithm pinned by the verifier, never read from the token
jwt.verify(token, key, {
  algorithms: ["RS256"],          // not [token.header.alg]
  issuer: "https://auth.example.com",
  audience: "orders-api",
  clockTolerance: 60,
  complete: true,                 // so you can assert header.typ below
});
if (decoded.header.typ !== "at+jwt") throw new Forbidden("wrong token kind");
```

## Don't

- **Don't pass the token's `alg` into the verifier's options.** `algorithms: [jwt.decode(token).header.alg]` is the algorithm-confusion bug, written out.
- **Don't accept `alg: none`.** Some libraries historically required an explicit `"none"` in the allow-list to disable verification — check yours; it should not be reachable.
- **Don't iterate keys until one verifies.** It hides key-rotation bugs and turns a wrong `kid` into an oracle.
- **Don't follow `jku`/`x5u` from the token.** Attacker-chosen URL, server-side request, your infrastructure.
- **Don't skip `aud` validation** because "we only have one service." A token minted for the reporting service is valid at the admin service until you check.
- **Don't treat claims as trusted input.** §3.10: *"Do Not Trust Received Claims."* An unvalidated `role` claim is a role you granted by injection.
- **Don't compress encrypted input.** §3.6 — this is the JWE zip-bomb / CRIME-family vector.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Unsigned token accepted | `none` reachable in the allow-list | Remove; assert `typ` too |
| Public key used as HMAC secret | `alg` read from the token | Pin the list in code; bind key→algorithm |
| SQL error mentioning `kid` on login | `kid` interpolated into a query | Pre-fetch the key set; validate format |
| Server made a request to a public host | `jku`/`x5u` followed | Static allowlist or ignore the header |
| Token for service A works at service B | `aud` unchecked | Require and match `aud` |
| Refresh token accepted as an access token | Overlapping validation rules | Mutually exclusive rules per `typ` |
| Occasional "token expired" on valid tokens | Undeclared clock skew | Set `clockTolerance` explicitly (60s) |

## Verifying

1. Forge a token with `{"alg":"none"}` and an arbitrary payload; assert `401`.
2. Take a valid RS256 token, re-sign it as HS256 using the public key as the HMAC secret; assert `401`.
3. Send a token with a valid signature but `aud: "other-service"`; assert `401`.
4. Send a refresh token to the access-token endpoint; assert `401`.
5. Send `{"kid":"' OR 1=1--"}`; assert `401` and no database error in the logs.
6. Send a token with a `jku` pointing at an attacker host; assert `401` and no outbound request in the egress log.

## Caveats on confidence

- RFC 8725 is **February 2020** and has not been revised. It remains the current BCP for JWT implementation, but it predates the 2024+ threat landscape. Verify the sections you rely on against your JWT library's own current guidance, and check the datatracker for errata.
- The concrete `401`-vs-`403` choices and the `typ: "at+jwt"` example come from RFC 9068 (JWT access token profile) conventions and RFC 8725 §3.12's explicit-typing recommendation; §3.12 says to use distinct `typ` values but does not name `at+jwt` itself.
- Clock skew: RFC 7519 says *"usually no more than a few minutes."* The 60-second figure is our default, not a standard.
- We did not evaluate PASETO, DPoP, or opaque-token introspection. This rule is about hardening a JWT verifier, not about arguing that JWT is the right format — see `rules/auth/prefer-cookies-or-a-bff-over-js-reachable-token-storage.md`.