---
title: "`PKCE` is MUST for public clients, RECOMMENDED for confidential ones"
rule_id: "RULE-AUTH-003"
category: "security"
scope: "all"
applies_to: "PKCE, RFC 7636, RFC 9700, public client, confidential client, S256, code_challenge, code_verifier"
last_updated: "2026-10-04"
source: "https://www.rfc-editor.org/rfc/rfc9700.html"
---

# `PKCE` is MUST for public clients, RECOMMENDED for confidential ones

PKCE began as optional mitigation for a narrow attack. RFC 9700 made it normative, and split it by
client type: mandatory for public clients, recommended for confidential ones. The split is the part
that gets flattened in review, and the flat version is what lets a public client through.

## Why

RFC 9700 is explicit about the two levels:

> Public clients MUST use PKCE [RFC7636] to this end, as motivated in Section 4.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> For confidential clients, the use of PKCE [RFC7636] is RECOMMENDED, as it provides strong
> protection against misuse and injection of authorization codes as described in Section 4.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The distinction shapes the finding. A public client without PKCE is a specification violation —
the review says so in one line. A confidential client without it is a weaker-but-defensible choice
that earns a discussion, not a blocker. Collapsing both into "add PKCE" either gets the secure
finding dismissed as overreach or lets the insecure one slide as merely-recommended.

PKCE is also constrained about how it may be used:

> PKCE challenge or OpenID Connect nonce MUST be transaction-specific and securely bound to the
> client and the user agent in which the transaction was started.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

> If the client supports PKCE, clients SHOULD use PKCE code challenge methods that do not expose the
> PKCE verifier in the authorization request.
> ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html))

The second sentence is the point of the mechanism: the challenge can ride the front-channel only
because it is not the secret. Send the verifier itself in the authorization request and you have
built nothing.

## Do

- Classify the client as public or confidential *before* deciding PKCE exists — the classification
  is the requirement.
- Use `S256` as the code challenge method. Plain challenge is a downgrade the RFC discourages.
- Generate the verifier per transaction and hold it only where the token exchange runs.
- Verify the verifier is never placed in the authorization request, query string, or any URL the
  browser would carry.
- Treat the RFC 9700 split as part of the checklist: public → MUST, confidential → RECOMMENDED.

## Don't

- Don't skip PKCE for a public client because "the SPA is internal" or "the code only runs on our
  network". Network position is not client type.
- Don't accept a plain (non-hashed) challenge out of convenience. `S256` costs nothing.
- Don't put the verifier in a URL or a browser-visible context, in the name of "simpler debugging".
- Don't treat "PKCE is present in someone's flow" as coverage for the client being reviewed.
  PKCE is per-client.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Public client flow without `code_challenge` | Client type never classified | Implement PKCE; it is MUST |
| Code-interception attack succeeds | Verifier known to attacker | Bound verifier to the token exchange only |
| Challenge accepted without a method | `S256` not used; method defaulted | Force `S256` |
| Reviewer marked PKCE "done" but it is absent | Flat "add PKCE" across client types | State per-client type in the check |
| Token obtained with a missing verifier | Server did not enforce PKCE | Server must bind challenge to issued code |

## Verifying

```bash
# 1. Is PKCE set, and with the right method? Declared config first:
grep -rniE 'code_challenge|code_verifier|pkce|S256|s256' \
  --include=*.ts --include=*.js --include=*.java --include=*.kt \
  --include=*.go --include=*.py --include=*.json . | head -20

# 2. The front-channel request must carry code_challenge but never code_verifier:
#    Inspect the authorization URL actually built by the client.
#    A query string containing code_verifier is a direct violation.

# 3. Observational: does the token request ever succeed *without* the verifier?
#    Remove code_verifier in a throwaway exchange; a conformant server refuses.
```

What this check cannot see: grep finds declarations, not enforcement. A library may construct the
authorization URL correctly while the application logic never wires the verifier through to the
token exchange, and no source-file search reveals that the two halves are disconnected. The
observational test — a token request without the verifier — is the only check that settles whether
the *server* enforces PKCE, and a server that does not enforce it cannot be fixed from the client.
Combined, step 1 proves the client intends PKCE and step 3 proves the server requires it; a finding
usually lives in the gap between those two.