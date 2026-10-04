---
title: "Redirect URIs require exact string matching, with one narrow exception"
rule_id: "RULE-AUTH-006"
category: "security"
scope: "all"
applies_to: "redirect URI, callback URL, exact string matching, PKCE downgrade, PAR, RFC 9700, RFC 9126, authorization server"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html, https://www.rfc-editor.org/rfc/rfc9126.html"
---

# Redirect URIs require exact string matching, with one narrow exception

The redirect URI is the one attacker-controllable value the authorization server matches against.
How loosely it is compared is the entire attack surface: a prefix or wildcard match turns an
open-redirect on any sibling path into a code-interception primitive.

## Why

RFC 9700 gives the matching rule, and the exception is narrower than implementations assume:

> exact string matching except for port numbers in localhost redirection URIs of native apps (see
> Section 4.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> exact redirection URI matching.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The exception exists for one reason: a native app listening on localhost gets a port from the OS
and cannot pre-register it. It does not generalise to wildcards, prefix matching, or subdomain
matching on web clients — the loose comparisons that actually appear in vulnerable
implementations. `https://app.example.com/callback` and `https://app.example.com/callback/` are
different strings, and must be.

The adjacent leak is the authorization request itself. It carries every parameter through the
user agent, which means browser history and proxy logs see the whole flow. RFC 9126 moves it to
a direct request:

> This document defines the pushed authorization request (PAR) endpoint, which allows clients to
> push the payload of an OAuth 2.0 authorization request to the authorization server via a direct
> request and provides them with a request URI that is used as reference to the data in a
> subsequent call to the authorization endpoint.
> ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html))

> PAR fosters OAuth security by providing clients a simple means for a confidential and
> integrity-protected authorization request.
> ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126.html))

PAR is not universally available, so it is an enhancement to check for rather than a requirement
— but a client whose server supports it and does not use it is leaking its authorization request
into every intermediary between the browser and the AS.

## Do

- Register every redirect URI as a complete, exact string — scheme, host, port, path, query.
- Treat a trailing-slash difference, a case difference in the host, and a `http`/`https`
  difference as different URIs, because the AS will.
- Allow the localhost-port exception only for native apps in development; document it if your AS
  configuration grants it anywhere else.
- Check whether the AS offers PAR (`pushed_authorization_request_endpoint` in its metadata) and
  use it where it does.
- Test the match: request a flow with a redirect URI that differs from the registered one by one
  character, and confirm the AS refuses.

## Don't

- Don't register a prefix, a wildcard, or a "base URL" and let the server match under it.
- Don't accept the localhost-port exception as cover for loose matching in production web
  clients. The exception is for native apps, whose port the OS assigns.
- Don't reuse one registered redirect URI across environments by varying the query string —
  some AS configurations ignore query on match, which is the loose comparison again.
- Don't treat PAR as optional hygiene when the authorization request carries PII or scopes worth
  protecting; the front channel is logged.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Code delivered to attacker's page | Prefix/wildcard redirect matching | Exact string match at the AS |
| Valid client rejected at callback | Trailing slash or case differs | Register the exact string |
| Authorization params in proxy logs | Front-channel request, no PAR | Use PAR where the AS supports it |
| Open redirect through sibling path | Redirect URI matched on host only | Match on the full string |
| Exception granted in production | Localhost-port exception over-generalised | Restrict to native dev flows |

## Verifying

```bash
# 1. What redirect URIs are registered, and do they look exact?
grep -rniE 'redirect(_uri|_uris)?\s*[:=]' \
  --include=*.ts --include=*.js --include=*.json \
  --include=*.py --include=*.go --include=*.java --include=*.yaml --include=*.yml . | head -20

# 2. A wildcard, a bare host, or a path ending in * anywhere in registration
#    is a finding. So is a config key that documents "matching: prefix".

# 3. Observational: mutate one character of the redirect URI in a throwaway
#    authorization request. A conformant AS rejects the request outright.
```

What this check cannot see: whether the *server* compares exact strings is a property of the AS
configuration, not of the client repo. A client can register a perfectly exact URI while the AS
matches on host, and no grep in the client finds that. The behavioural test — a one-character
mutation being rejected — is the check that proves it, and it must run against the environment
being audited. PAR support is likewise only visible in the AS metadata document, not in client
source.
