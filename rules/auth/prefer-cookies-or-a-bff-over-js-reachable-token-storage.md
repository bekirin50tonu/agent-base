---
title: "Prefer Cookies or a BFF to Storing Tokens in JavaScript Reachable Storage"
rule_id: "RULE-AUTH-001"
category: "security"
scope: "frontend"
applies_to: "Any browser application using OAuth 2.0 or OIDC, or holding a bearer token in a browser"
last_updated: "2026-09-30"
source: "https://www.rfc-editor.org/rfc/rfc10017.html, https://www.rfc-editor.org/rfc/rfc8725.html"
---

# Prefer Cookies or a BFF to Storing Tokens in JavaScript Reachable Storage

Every browser storage API — `localStorage`, `sessionStorage`, IndexedDB — is readable by any script running on the page. RFC 10017, the IETF Best Current Practice for browser-based OAuth 2.0 applications, says this in terms rather than innuendo: `localStorage` *"does not protect against unauthorized access from malicious JavaScript, as the attacker would be running code within the same origin."* The fix is not a shorter `exp`; it is to give the browser nothing worth stealing.

## Why

An XSS is not a hypothetical precondition. It arrives as a compromised CDN script, a markdown renderer that allowed raw HTML, or the dependency you did not audit. At that moment the attacker has the same origin as your app, so any token in JS-reachable storage is theirs — and, if it is a refresh token, theirs permanently.

RFC 10017 ranks three architectures *"in decreasing order of security"*:

1. **Backend for Frontend (BFF)** — the most secure. The BFF holds the access and refresh tokens against a cookie-based session and *"avoid[s] the direct exposure of any tokens to the browser-based application."*
2. **Token-mediating backend** — the BFF keeps tokens but the browser calls the resource server directly with the access token. The access token is exposed; the refresh token is not.
3. **Browser-based OAuth client** — everything in the browser. Acceptable only when the trade-off is deliberate.

The BFF is a component of your *frontend*, not a gateway. It is the OAuth client for your app.

## Do

- Default to the **BFF**: the browser gets an opaque, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie; tokens live server-side.
- If the browser must hold an access token, hold it **in memory only** (module scope or a closure), never in a persistent store. The RFC notes the downside plainly: *"not being able to persist tokens between page loads."* That is the cost, and it is the right trade.
- Keep the **refresh token out of JS entirely** — `HttpOnly` cookie or server-side. It is the long-lived credential.
- Pair the cookie with CSRF defences (double-submit token, or `SameSite` plus a `Sec-Fetch-Site` check) since cookies are sent ambiently.
- Set `__Host-` prefixed cookies (`__Host-name`) where the app is same-origin: the prefix makes the browser reject a cookie that is not `Secure`, not `Path=/`, and carries no `Domain` — it cannot be set by a subdomain.
- Make logout a **server-side revocation**, not a client-side delete of local state.

```nginx
# BFF: browser sees an opaque session cookie; tokens never leave the server
Set-Cookie: __Host-sid=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/
```

```js
// access token in memory only; refresh is a cookie the JS cannot read
let accessToken = null;                       // module scope — lost on reload, by design
export async function api(path, opts = {}) {
  accessToken ??= await refresh();             // GET /auth/refresh; browser attaches the HttpOnly cookie
  return fetch(path, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${accessToken}` } });
}
```

## Don't

- **Don't store an access or refresh token in `localStorage`, `sessionStorage`, or IndexedDB.** The RFC names all three as available persistent APIs and states plainly that *"none of these options can fully mitigate token exfiltration when the attacker can execute malicious code in the application's execution environment."*
- **Don't rely on closure-based in-memory storage as a security boundary.** The RFC flags it directly: closures *"are tricky to secure in a complex environment like the browser's execution environment"* — prototype poisoning can substitute `toString` or the networking APIs the closure depends on and read the token out of the arguments. In-memory storage limits *exposure*; it does not defeat an attacker who is already executing code.
- **Don't assume browser storage is encrypted at rest.** The RFC notes there is *"no guarantee that browser storage is encrypted at rest"* — and notes the consequence: malware that reads browser profiles gets the tokens.
- **Don't use the OAuth implicit grant.** RFC 10017 lists it under *Discouraged and Deprecated Architecture Patterns*.
- **Don't shorten the token TTL and call it the fix.** A 5-minute token in `localStorage` is still readable for those 5 minutes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Account takeover traceable to one XSS | Token in `localStorage`/IndexedDB | BFF, or memory-only access token + `HttpOnly` refresh cookie |
| Session still valid after "logout" | Client-side state cleared only | Revoke server-side; clear the session cookie |
| Subdomain can set a session cookie | No `__Host-` prefix | Use `__Host-` and refuse `Domain` |
| Silent auth loop on reload | Access token in memory, no bootstrap refresh | Fetch a fresh access token at boot via the cookie |
| CSRF despite cookies | Cookie sent ambiently with no defence | Double-submit token or `Sec-Fetch-Site` check |

## Verifying

1. `grep -RIn "localStorage\|sessionStorage\|indexedDB" <target/src>` and audit each hit for a token-shaped value. Any such hit is a finding, not a style note.
2. Log in, then in DevTools Console run `Object.keys(localStorage), document.cookie` — no access token, no refresh token in either output.
3. Application tab: the session cookie shows `HttpOnly`, `Secure`, `SameSite=Lax` (or stricter) all ticked.
4. Log out; replay a captured request with the old cookie and assert `401`.

## Caveats on confidence

- **RFC 10017 is the load-bearing source here and it is new** — published 2026, superseding the earlier OAuth 2.0 Security BCP (RFC 9700's browser-app guidance) for this topic. Re-check its datatracker status before citing the ranking in a design doc; a BCP can be revised.
- RFC 8725 (February 2020) is used here only for JWT *implementation* warnings, not for storage — see `rules/auth/pin-the-expected-jwt-algorithm-and-key-set.md`. It is the reference text for `alg` pinning, `kid`, and `jku`/`x5u`, and it has not been revised — so treat those sections as the current baseline but verify against your JWT library's own guidance.
- The in-memory + closure pattern is recommended by RFC 10017 with the prototype-poisoning caveat we quote. We did not verify whether any major JS engine has since hardened this; the RFC's warning stands as written.
- We did not evaluate PASETO, DPoP/mTLS sender-constraining, or opaque-token-plus-introspection (RFC 7662). This rule covers storage and architecture, not token format — do not read it as a recommendation *for* JWT over those alternatives.