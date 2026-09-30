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
> **Status**: two rules, one per direction of the token's life. The storage rule is anchored on
> **RFC 10017** (OAuth 2.0 for Browser-Based Applications, published 2026), which supersedes the
> older browser-app guidance. The verifier rule is anchored on **RFC 8725** (February 2020) and is
> the current BCP for JWT implementation — see its caveats section before citing it in a design doc.

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

## 2. Skills (`skills/`)

_Empty — no authentication workflows synthesized yet._

## 3. Agents (`agents/`)

_Empty — auth guidance is delivered as rules; a persona would duplicate the language hubs._

## 4. Shared Assets (`shared/`)

_Empty._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must commit the file in the
same push that updates this hub — otherwise consumers get a 404. Run `node scripts/check-manifests.mjs`.
