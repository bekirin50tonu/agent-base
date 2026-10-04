---
title: "PKCE is a client-side obligation the server cannot enforce for you"
rule_id: "RULE-AUTH-007"
category: "security"
scope: "all"
applies_to: "PKCE, code_verifier, code_challenge, S256, RFC 7636, token endpoint, authorization code, downgrade defence"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html, https://www.rfc-editor.org/rfc/rfc7636.html"
---

# PKCE is a client-side obligation the server cannot enforce for you

The enforcement asymmetry is the operational trap. RFC 7636 obliges the *server* to validate a
verifier — and nothing obliges the *client* to generate one. A server can be fully conformant,
pass every configuration audit, and have every client connecting to it unprotected.

## Why

The server half is specified and mandatory:

> [RFC7636] already mandates that an authorization server that supports PKCE MUST check whether a
> code challenge is contained in the authorization request and bind this information to the code
> that is issued
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The client half is not the same kind of requirement:

> If the client supports PKCE, clients SHOULD use PKCE code challenge methods that do not expose
> the PKCE verifier in the authorization request.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

A `MUST` on the server and a `SHOULD` on the client describes a system that is secure only if
every client independently decides to be. The server's check is conditional on a challenge being
present — an authorization request with no `code_challenge` is a perfectly valid request that
triggers no verification at all.

What the check does, once a challenge exists, is specified precisely enough to implement:

> Upon receipt of the request at the token endpoint, the server verifies it by calculating the code
> challenge from the received "code_verifier" and comparing it with the previously associated
> "code_challenge", after first transforming it according to the "code_challenge_method" method
> specified by the client.
> ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html))

> BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) == code_challenge
> ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html))

What makes the gap silently dangerous is the failure mode of the server's own downgrade defence.
RFC 9700's mitigation is to notice a `code_verifier` arriving at the token endpoint when the
authorization request carried no `code_challenge`. If no client ever sends a challenge, that
defence never activates — and a server-side audit of its own configuration shows every control
correctly enabled.

## Do

- Classify every client as public or confidential and require PKCE for the public ones, as its
  own rule states.
- Generate a fresh verifier per transaction, and hold it only where the token exchange runs.
- Use `S256`. Implement the transform exactly as the formula above, or use a library that does.
- Server side: reject a token request that carries a `code_verifier` when no `code_challenge` was
  bound to that code. That rejection is the downgrade defence, and it is the only thing that
  activates it.
- Audit the client as well as the server. A conformant AS is not evidence that any particular
  client used PKCE.

## Don't

- Don't infer client-side PKCE coverage from a server-side audit. They are different properties.
- Don't send the verifier in the authorization request, query string, or any browser-visible
  context. The challenge is safe on the front channel only because it is a hash.
- Don't reuse a `code_verifier` across transactions. The challenge is required to be
  transaction-specific.
- Don't accept a token request with no `code_verifier` as merely "plain PKCE" — there is no such
  thing. Without a challenge at the authorization endpoint, the verifier has nothing to match.
- Don't treat a library's PKCE support as adoption. Support is a capability; the call site is
  the decision.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| No client sends a challenge | PKCE never a client requirement | Require it per client type |
| AS audit shows PKCE enabled, clients unprotected | Server capability read as client coverage | Audit client call sites separately |
| Verifier visible in the authorization URL | Debug convenience | Keep the verifier at the token endpoint only |
| Same verifier across flows | Reused for convenience | Generate per transaction |
| `code_verifier` for a code with no challenge | Downgrade attempt | Reject at the token endpoint |
| Plain challenge accepted | `S256` not enforced | Force `code_challenge_method=S256` |

## Verifying

```bash
# 1. Is a verifier actually generated and passed to the token call?
grep -rniE 'code_verifier|code_challenge|generateVerifier|createVerifier|S256' \
  --include=*.ts --include=*.js --include=*.java --include=*.kt \
  --include=*.go --include=*.py . | head -20

# 2. The authorization URL must carry code_challenge and never code_verifier.
#    Inspect the URL the client actually builds; a code_verifier in the
#    query string is a direct finding.

# 3. Server side: does the token endpoint reject a code_verifier presented
#    for a code whose authorization request had no challenge?
#    That rejection is the downgrade defence; grep for it explicitly.
```

What this check cannot see: grep finds the plumbing, not the wiring. A library can construct a
correct authorization URL while the application never carries the verifier through to the token
exchange, and both halves can read as present in a source review. The server half is likewise
only settled behaviourally: a throwaway exchange without the verifier settles whether the AS
enforces PKCE, and a throwaway exchange *with* a verifier for an unchallenged code settles
whether the downgrade defence is active. Both must be run against the environment being audited —
and neither can be concluded from the other's configuration.
