---
language: "Authentication & Tokens"
tag: "security"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub for token verification and browser token storage rules."
---

# Documentation Hub: Authentication & Tokens

> **Agent Directive (Phase 4)**: This hub is **cross-cutting** — it is not resolved from a
> dependency file. Evaluate it for any project that issues or verifies bearer tokens, and
> separately for any project with a browser login. A backend-only service gets the verifier
> rule; a browser application gets both.
>
> **Triggers**: `jwt`, `jose`, `paseto`, `PyJWT`, `python-jose`, `golang-jwt`, `System.IdentityModel.Tokens.Jwt`,
> `jsonwebtoken`, `jose` or `jwe` in any manifest file; a `jwks.json` / `.well-known/openid-configuration`
> file in the tree; an OAuth/OIDC callback route; a `login`/`auth`/`session` route module.
>
> The **flow** rules additionally trigger on: an authorization-code or implicit flow in any OAuth
> library; a `redirect_uri` / `callback` / `reply` registration in config; `code_challenge` or
> `code_verifier` anywhere; a mobile or SPA client; `useImplicitFlow`, `PKCE`, `allowOfflineAccess`,
> or a refresh-token endpoint.
>
> **Status**: seven rules. Two cover the token's life (verification and storage), five cover the
> OAuth flow itself — PKCE by client type, `state` as a separate control, refresh-token rotation
> and sender-constraining, exact redirect-URI matching, and the client/server PKCE enforcement
> asymmetry — plus one decision matrix that routes a project to the right combination. The flow
> rules are anchored on **RFC 9700** (OAuth 2.0 Security BCP) and **RFC 7636**/**RFC 9126**. The
> storage rule is anchored on **RFC 10017** (OAuth 2.0 for Browser-Based Applications, published
> 2026), which supersedes the older browser-app guidance. The verifier rule is anchored on
> **RFC 8725** (February 2020) and is the current BCP for JWT implementation — see its caveats
> section before citing it in a design doc.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/auth/pin-the-expected-jwt-algorithm-and-key-set.md`
  - **Why**: The damaging JWT failures are not cryptographic breaks — they are verifiers that read
    the token's own `alg` header and dispatch on it, which yields `alg: none` acceptance and
    RS256→HS256 algorithm confusion. The same header-driven trust extends to `kid` (interpolated
    into a key lookup, so SQL/LDAP injection) and `jku`/`x5u` (an attacker-chosen URL fetched
    server-side, so SSRF). It also pins the claim checks — `iss`, `aud`, `exp`/`nbf` with explicit
    clock tolerance, `sub` — and the requirement that different kinds of JWT have mutually
    exclusive validation rules, so a refresh token cannot be spent as an access token.
  - **When**: Target project verifies a JWT anywhere in its stack — API gateway, resource server,
    auth middleware, MCP server. Triggers on a `jwt`/`jose` dependency, a JWKS endpoint, or a
    hand-rolled `jwt.decode` + signature check.
  - **Target Location**: `docs/rules/auth/pin-the-expected-jwt-algorithm-and-key-set.md`

- **Path**: `rules/auth/prefer-cookies-or-a-bff-over-js-reachable-token-storage.md`
  - **Why**: `localStorage`, `sessionStorage`, and IndexedDB are all readable by any script on the
    page, so one XSS is one token exfiltration — and a refresh token makes it permanent. RFC 10017
    states this directly and ranks three architectures in decreasing order of security: BFF,
    token-mediating backend, browser-based client. It also undercuts the common "wrap it in a
    closure" mitigation, since prototype poisoning can reach the token through the closure's own
    dependencies.
  - **When**: Target project has a browser login — an OAuth/OIDC flow, an SPA holding a bearer
    token, or a client that persists a token across reloads.
  - **Target Location**: `docs/rules/auth/prefer-cookies-or-a-bff-over-js-reachable-token-storage.md`

- **Path**: `rules/auth/pkce-is-must-for-public-clients.md`
  - **Why**: RFC 9700 splits PKCE by client type — MUST for public clients, RECOMMENDED for
    confidential ones — and treating both as "add PKCE" either gets the secure finding dismissed
    or lets an SPA through. The `code_challenge` is safe on the front channel only because it is a
    hash; sending the verifier there builds nothing.
  - **When**: Target project has any OAuth/OIDC client whose type was never written down, or a
    review asks "is PKCE covered" without naming the client.
  - **Target Location**: `docs/rules/auth/pkce-is-must-for-public-clients.md`

- **Path**: `rules/auth/pkce-does-not-replace-state.md`
  - **Why**: PKCE defends the token exchange against a stolen code; `state` defends the session
    against a forged authorization response. RFC 9700 documents the consequence of conflating them
    as a named PKCE downgrade attack, whose second prerequisite is a client that drops `state`
    because PKCE is present. The failure is silent — the flow completes and the CSRF property is
    simply absent.
  - **When**: Target project has an OAuth callback that checks `code_verifier` but no `state`, or
    has documented PKCE as its CSRF defence.
  - **Target Location**: `docs/rules/auth/pkce-does-not-replace-state.md`

- **Path**: `rules/auth/refresh-tokens-need-rotation-or-sender-constraint.md`
  - **Why**: RFC 9700 requires refresh tokens for public clients to be sender-constrained or
    rotated. The security property lives in the invalidation, not the issuance — a scheme where
    the old token keeps working is issuance with extra steps, and the audit shows a healthy
    rotation policy while attacker and client both remain able to refresh.
  - **When**: Target project issues refresh tokens to a public client, or a review asks "if this
    token is stolen, what happens?"
  - **Target Location**: `docs/rules/auth/refresh-tokens-need-rotation-or-sender-constraint.md`

- **Path**: `rules/auth/redirect-uris-need-exact-string-matching.md`
  - **Why**: The redirect URI is the one attacker-controllable value the AS matches against, and a
    prefix or wildcard match turns an open redirect into a code-interception primitive. The RFC's
    only exception is port numbers in localhost URIs of native apps — the case where the OS
    assigns the port — which does not generalise to wildcards on web clients. Includes RFC 9126
    PAR as the fix for front-channel parameter leakage.
  - **When**: Target project registers OAuth redirect URIs, or a review asks how strictly the AS
    compares them.
  - **Target Location**: `docs/rules/auth/redirect-uris-need-exact-string-matching.md`

- **Path**: `rules/auth/authorization-code-pkce-is-client-side.md`
  - **Why**: RFC 7636 makes the server's verifier check a MUST and the client's use of PKCE a
    SHOULD. A server can be fully conformant, pass every configuration audit, and have every
    client unprotected — and if no client sends a challenge, the RFC's own downgrade defence never
    activates, so the server audit still shows every control enabled.
  - **When**: Target project verifies PKCE on the server side, or a client audit is being closed
    out by an AS configuration review.
  - **Target Location**: `docs/rules/auth/authorization-code-pkce-is-client-side.md`

## 2. Skills (`skills/`)

_Empty — no authentication workflows synthesized yet._

## 3. Agents (`agents/`)

_Empty — auth guidance is delivered as rules; a persona would duplicate the language hubs._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/security/oauth-flow-preflight-decision-matrix.md`
  - **Why**: The five PKCE/`state`/redirect/refresh rules are one decision taken per client type,
    not per endpoint. A five-row matrix (SPA, native, confidential backend, machine-to-machine,
    browser-held tokens) with five preflight questions in the order that catches the most —
    `state` listed after PKCE deliberately, because it is the one most often dropped.
  - **When**: Target project is adding or reviewing an OAuth/OIDC flow, or a review says "we use
    PKCE" without establishing which client types that statement covers.
  - **Target Location**: `docs/security/oauth-flow-preflight-decision-matrix.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must commit the file in the
same push that updates this hub — otherwise consumers get a 404. Run `node scripts/check-manifests.mjs`.
