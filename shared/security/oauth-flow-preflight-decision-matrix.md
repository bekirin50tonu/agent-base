---
title: "OAuth Flow Preflight — Decision Matrix"
category: "security"
applies_to: "Any project choosing or reviewing an OAuth 2.0 / OIDC client: SPA, native app, confidential web backend, machine-to-machine, or a browser that holds tokens"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html, https://openid.net/specs/openid-connect-core-1_0.html"
---

# OAuth Flow Preflight — Decision Matrix

The five auth rules are one decision, and it is decided **per client type**, not per endpoint or
per environment. Pick a row, then answer the preflight questions in order.

## When to Use

- An OAuth or OIDC flow is being added, and the client type has not been written down.
- A review says "we use PKCE" and it is not established whether the SPA and the confidential
  backend were assessed against the same bar.
- A library is being chosen for a browser client, and the architecture question (BFF vs.
  token-mediating backend vs. browser-held tokens) has not been answered first.
- A security review asks "is the flow protected" and the answer differs by client.
- Any flow where the team is about to treat PKCE and CSRF protection as the same control.

## The matrix

| Client type | PKCE | `state` | Redirect URI | Refresh token |
|---|---|---|---|---|
| SPA (public) | **MUST** + `S256` | **MUST** — never as a PKCE substitute | exact, pre-registered | rotation with invalidation, or sender-constrained |
| Native/mobile (public) | **MUST** + `S256` | **MUST** | exact; port may vary for localhost | rotation with invalidation, or sender-constrained |
| Confidential web backend | RECOMMENDED | **MUST** | exact | rotation recommended |
| Machine-to-machine | not applicable | not applicable | n/a | n/a — use client credentials |
| Browser holding tokens | — | — | — | see `shared/architecture/backend-design-patterns.md` and the storage rule |

Rows 1–3 differ only in **strength**, never in shape. That distinction is the whole reason to
classify the client first:

- A confidential backend without PKCE has skipped a RECOMMENDED protection. That is a defensible
  choice and belongs in the design doc, not in a blocker.
- An SPA that treats PKCE as its CSRF defence has a vulnerability, because `state` or `nonce` is
  a separate MUST. The two protect different stages: PKCE defends the token exchange against a
  stolen code, CSRF defends the session against a forged authorization response.

## The preflight questions

In this order — the sequence is what catches the most:

1. **Is this client public or confidential?** No secret it can keep ⇒ public. This answer selects
   the row; nothing else can be decided until it is.
2. **If public: is `code_challenge` generated with `S256`, and does the verifier never reach the
   authorization endpoint?** The challenge rides the front channel only because it is a hash.
3. **Independently: is `state` generated per request and compared on callback?** Listed after PKCE
   deliberately — this is the one most often dropped, because dropping it feels like a
   simplification when PKCE is present.
4. **Is the redirect URI compared by exact string match?** No prefix, no wildcard, no host-only.
5. **Are refresh tokens rotated with old-token invalidation, or sender-constrained?** Issuance of a
   new token is not rotation; the old one must die.

Question 3 is the one that turns a row into a secure flow. Questions 2 and 4 can both be green
while the flow is still vulnerable to a forged authorization response.

## The OIDC third leg: `nonce`

For OIDC, `nonce` is the counterpart to `state`, with a precise definition:

> nonce String value used to associate a Client session with an ID Token, and to mitigate replay
> attacks.
> ([OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html))

> Claim Value is equal to the value of the nonce parameter sent in the Authentication Request.
> ([OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html))

Verification is a string equality against what the client sent. A `nonce` that is not echoed back,
or that is echoed but not checked, is the same class of omission as an unchecked `state` — the
flow succeeds and the replay protection is simply absent.

## Where each answer turns into a rule

| Question | Rule |
|---|---|
| 1 — client classification | `rules/auth/pkce-is-must-for-public-clients.md` |
| 2 — PKCE mechanism | `rules/auth/authorization-code-pkce-is-client-side.md` |
| 3 — `state` / CSRF | `rules/auth/pkce-does-not-replace-state.md` |
| 4 — redirect URI matching | `rules/auth/redirect-uris-need-exact-string-matching.md` |
| 5 — refresh tokens | `rules/auth/refresh-tokens-need-rotation-or-sender-constraint.md` |
| Browser row — storage | `rules/auth/prefer-cookies-or-a-bff-over-js-reachable-token-storage.md` |
| Token verification | `rules/auth/pin-the-expected-jwt-algorithm-and-key-set.md` |

## What the matrix cannot tell you

Whether the *authorization server* enforces what a row assumes — exact redirect matching, PKCE
on every flow, refresh-token invalidation — is a property of the AS configuration, and the AS's
own audit will not tell you whether any client used PKCE. The matrix is a checklist for the
client side. The server side is settled behaviourally, against the environment being deployed.