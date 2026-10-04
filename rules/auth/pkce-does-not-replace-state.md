---
title: "PKCE does not replace `state` — relying on it for CSRF enables a downgrade attack"
rule_id: "RULE-AUTH-004"
category: "security"
scope: "all"
applies_to: "PKCE downgrade, state, CSRF, authorization code injection, RFC 9700, OAuth callback"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html"
---

# PKCE does not replace `state` — relying on it for CSRF enables a downgrade attack

PKCE and `state` defend against different attacks, and the most common modern design collapses them
into one. RFC 9700 documents the consequence as a named attack: a client that drops `state` because
PKCE is present becomes the second prerequisite of a PKCE downgrade attack.

## Why

The two must coexist, and the RFC says so three ways:

> Clients MUST ensure that the authorization server supports PKCE before using PKCE for CSRF
> protection.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> PKCE, state or nonce MUST be used for CSRF protection.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The attack requires two conditions, and the second is the design mistake being reviewed:

> The second prerequisite for this attack is that the client is not using state at all (e.g., because
> the client relies on PKCE for CSRF prevention) or that the client is not checking state correctly.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> An authorization server that supports PKCE but does not make its use mandatory for all flows can be
> susceptible to a PKCE downgrade attack.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

Why the server cannot save the client here: PKCE defends the *token exchange* against a stolen
code, while CSRF defends the *session* against a forged authorization response. They protect
different stages of the flow. The server does have a guard — it can notice a code arriving with a
`code_verifier` when the original authorization request carried no `code_challenge`:

> Note that from the view of the authorization server, in the attack described above, a code_verifier
> parameter is received at the token endpoint although no code_challenge parameter was present in the
> authorization request for the OAuth flow in which the authorization code was issued. This fact can
> be used to mitigate this attack.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The RFC is candid about why it nevertheless makes the server responsible:

> However, practice has shown that many OAuth clients do not use or check state properly. Therefore,
> authorization servers MUST mitigate this attack.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

## Do

- Generate `state` per request and verify it on every callback, independently of PKCE.
- Treat PKCE and `state` as complementary checks in review: one is mine, that have different
  properties, and neither is a substitute for the other.
- Verify `state` by constant-time comparison to the value bound to the session.
- Include `state` in a list of independent checks, and assert its absence is always a finding even
  when PKCE is present.

## Don't

- Don't drop `state` because "PKCE covers CSRF". That is precisely the prerequisite of the
  downgrade attack.
- Don't rely on server-side mitigation as the plan. Some servers do not make PKCE mandatory for all
  flows, which is the other prerequisite.
- Don't log or persist `state` in a way that lets a second tab see it. It must stay bound to the
  initiating session.
- Don't check `state` with `==` on strings from two different sources if you can use a constant-time
  compare — this is the classic side channel.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Attacker binds victim's code to attacker session | `state` absent or unchecked | Set and verify `state` per callback |
| PKCE present, CSRF still succeeds | PKCE and `state` conflated | Keep both; they guard different stages |
| `code_verifier` sent for a code with no challenge | Downgrade attempt | Server: enforce PKCE for all flows |
| Review "fixed" by adding PKCE only | Flat "PKCE covers it" | Reopen; add independent `state` |
| Session borrowed across tabs | `state` not bound to initiating session | Bind `state` to the session that issued it |

## Verifying

```bash
# 1. Where is state generated and where is it checked? Both must exist.
grep -rniE '\bstate\b|oauth_state|csrf_state|state_param' \
  --include=*.ts --include=*.js --include=*.java --include=*.kt \
  --include=*.go --include=*.py . | head -20

# 2. Is there a code path where PKCE is present but state is skipped?
#    Grep the callback handler and look for a condition that gates the
#    state check on the presence of the PKCE challenge.

# 3. Observational: fire the callback twice with a stale/forged state.
#    A conformant client refuses; a client relying on PKCE alone accepts.
```

What this check cannot see: grep proves `state` is generated and compared, not that the comparison
is reached on the same code path that accepts a callback, nor that a forged `state` is rejected with
a constant-time compare. The behavioural test — presenting a valid PKCE challenge but a stale or
absent `state` — is the one that distinguishes "PKCE is present" from "CSRF is covered". The RFC's
own precondition is the useful prompt for that test: the attack needs a client that is *not* using
state at all, so the review should look for the branch that makes the state check conditional on
something attacker-observable.