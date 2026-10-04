---
title: "Refresh tokens for public clients MUST be sender-constrained or rotated"
rule_id: "RULE-AUTH-005"
category: "security"
scope: "all"
applies_to: "refresh token, token rotation, sender-constrained, DPoP, mTLS, RFC 9700, RFC 9449, public client"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html, https://www.rfc-editor.org/rfc/rfc9449.html"
---

# Refresh tokens for public clients MUST be sender-constrained or rotated

A refresh token is a long-lived credential. The specification's answer to theft is not "make it
shorter" but "make reuse detectable": either bind it to a key the client holds, or issue a new one
on every refresh so that a replayed old token signals the compromise.

## Why

The requirement is one line, and the two paths out of it are not equivalent:

> Refresh tokens for public clients MUST be sender-constrained or use refresh token rotation as
> described in Section 4.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> Refresh token rotation: the authorization server issues a new refresh token with every access token
> refresh response.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The security property lives in the *invalidation*, not the issuance. A rotation scheme where the
old token keeps working is token issuance with extra steps: attacker and legitimate client both
refresh, nothing was gained, and the audit shows a healthy rotation policy.

Sender-constraining is the stronger option, and RFC 9449 defines what it buys:

> This document describes a mechanism for sender-constraining OAuth 2.0 tokens via a
> proof-of-possession mechanism on the application level. This mechanism allows for the detection of
> replay attacks with access and refresh tokens.
> ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html))

> Access tokens that are sender-constrained via DPoP thus stand in contrast to the typical bearer
> token, which can be used by any party in possession of such a token.
> ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html))

For OIDC the client-side binding obligation is `nonce`:

> PKCE challenge or OpenID Connect nonce MUST be transaction-specific and securely bound to the client
> and the user agent in which the transaction was started.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

## Do

- Ask "if this refresh token is stolen, what happens?" and require a change in behaviour, not a shrug.
- Public client: verify rotation with invalidation, or sender-constrained tokens (DPoP/mTLS), before
  the flow ships.
- Verify old refresh tokens stop working at rotation, or nothing is being rotated.
- Prefer sender-constraining where the stack supports it; it converts theft from "someone has your
  credential" to "someone has your credential and your key".
- Treat a long-lived bearer refresh token in a browser as a finding under
  `prefer-cookies-or-a-bff-over-js-reachable-token-storage.md`.

## Don't

- Don't assume rotation is on because the AS issues new tokens. Check the old ones die.
- Don't keep the strongest token in the most accessible place. Bearer refresh tokens in the browser
  are the worst corner of the matrix.
- Don't treat "the client also gets a new access token" as rotation. Only the refresh token
  rotating, with invalidation, is rotation.
- Don't skip the question because the token is "just a refresh token". It is the credential that
  mints access tokens, which makes it the most valuable thing the client holds.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Old refresh token still works after rotation | No invalidation, merely issuance | Server must invalidate on rotation |
| Stolen refresh token used for months | Bearer, no rotation or sender-constraint | Rotate or sender-constrain |
| Attacker and client both refreshing | Rotation without reuse detection | Alert on reuse of invalidated token |
| Reuse detected but token family survives | Reuse detected, family not revoked | Revoke the family on reuse detection |
| DPoP proof rejected | Key mismatch or clock skew in proof | Check key binding and time window |

## Verifying

```bash
# 1. Is rotation on, and does the old token die?
grep -rniE 'refresh.?token|rotat(e|ion)|sender.?constrain|dpop|mtls' \
  --include=*.ts --include=*.js --include=*.java --include=*.go --include=*.py . | head -20

# 2. The invalidation question is server-side; grep cannot answer it.
#    Exchange a refresh token twice; the second use of the old one must fail.

# 3. DPoP: does the client sign every request with the bound key?
#    A request without a valid DPoP proof must be rejected.
```

What this check cannot see: whether the old token actually stops working is a property of the
authorization server, not of anything greppable. The behavioural test — reusing a spent refresh
token — is the only check that proves invalidation, and it must be run against the environment
being audited. A single "rotation enabled" setting can be true in staging and false in production,
and no amount of source review finds that gap.