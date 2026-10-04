---
title: "URL-Mode Elicitation Hands the Client a Phishing URL — Bind the Callback to the User Who Started It"
rule_id: "RULE-MCP-005"
category: "security"
scope: "all"
applies_to: "MCP servers using url-mode elicitation for OAuth or third-party authorization, MCP clients rendering url-mode elicitation, credential storage bound to an elicitation"
last_updated: "2026-10-04"
source: "https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation"
---

# URL-Mode Elicitation Hands the Client a Phishing URL — Bind the Callback to the User Who Started It

URL mode exists so credentials never transit the MCP client or the LLM context. The
specification devotes a section to the attack the feature creates, describes it in seven steps, and
mandates the mitigation. An implementation that stores the token and shows a consent screen looks
correct and is not.

## Why

The attack, in the specification's own words:

> A malicious user (Alice) connected to a benign server triggers an elicitation request
> The benign server generates an authorization URL, acting as an OAuth client of a third-party authorization server
> Alice's client displays the URL and asks for consent
> Instead of clicking on the link, Alice tricks a victim user (Bob) of the same benign server into clicking it
> Bob opens the link and completes the authorization, thinking they are authorizing their own connection to the benign server
> The benign server receives a callback/redirect from the third-party authorization server, and assumes it's Alice's request
> The tokens for the third-party server are bound to Alice's session and identity, instead of Bob's, resulting in an account takeover
> ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation))

Every step of the OAuth flow succeeds. The third-party provider issues tokens to whoever completed
the consent screen; the server records them against the elicitation's owner. The server's own logs
show a clean callback. The takeover surfaces only when the wrong person cannot see their own data.

The mandated mitigation is identity equality, not a warning:

> To prevent this attack, the server MUST ensure that the user who started
> the elicitation request (the end-user who is accessing the server via the
> MCP client) is the same user who completes the authorization flow.
> ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation))

> In all implementations, the server MUST ensure that the mechanism to
> determine the user's identity is resilient to attacks where an attacker can
> modify the elicitation URL.
> ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation))

The four credential rules that follow read like a list of things a careful implementer would avoid
anyway, which is exactly why they need stating — each one forecloses a plausible implementation:

> The third-party credentials MUST NOT transit through the MCP client: The client must never see third-party credentials to protect the security boundary
> The MCP server MUST NOT use the client's credentials for the third-party service: That would be token passthrough, which is forbidden
> The user MUST authorize the MCP server directly: The interaction happens outside the MCP protocol, without involving the MCP client
> The MCP server is responsible for tokens: The MCP server is responsible for storing and managing the third-party tokens obtained through the URL mode elicitation (in other words, the MCP server must be stateful).
> ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation))

A server that reuses the client's OAuth token for the third-party service has implemented token
passthrough, which the specification forbids by name. A server that returns the credential to the
client has broken the security boundary the feature was built to create.

The client half is equally normative, and the pre-fetch rule is the one that gets missed:

> Clients implementing URL mode elicitation MUST handle URLs carefully to prevent users from unknowingly clicking malicious links.
>
> MUST NOT automatically pre-fetch the URL or any of its metadata.
> MUST NOT open the URL without explicit consent from the user.
> MUST show the full URL to the user for examination before consent.
> MUST open the URL provided by the server in a secure manner that does not enable the client or LLM to inspect the content or user inputs.
> ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation))

Pre-fetching a title or a favicon substitutes the server's rendering for the URL's text, which
defeats the review the rule exists to enable.

## Do

- Send the user to **your own** connect URL, not the third-party authorization endpoint, and verify
  the session there before redirecting onward. The spec's own example does exactly this.
- Compare the authoritative subject (the `sub` claim from your authorization server) against the
  identity on the session cookie that opened the connect URL. Equality is the check.
- Make the identity mechanism tamper-resistant: bind the elicitation to a nonce, a session, and an
  expiry, so a modified URL fails even when the attacker is a legitimate user.
- Store third-party tokens server-side, bound to the verified user, and never return them to the
  client.
- On the client, render the full URL as text, require explicit consent per request, and never
  pre-fetch. Highlight the registrable domain so a subdomain-spoofed host is visible.
- Treat form mode and URL mode as different trust levels: form mode is in-band data collection,
  URL mode is out-of-band. Never accept sensitive information through form mode.

## Don't

- Don't send the third-party authorization URL directly. Route through a first-party connect page
  that verifies identity.
- Don't trust a `state` parameter alone as user binding. `state` prevents CSRF; it does not stop
  Bob from completing a legitimate flow for his own account.
- Don't reuse the client's MCP credentials for a third-party service. That is token passthrough.
- Don't return third-party credentials to the client "because it asked" or "for convenience".
- Don't pre-fetch the elicitation URL for a title, a preview, or a favicon.
- Don't let the LLM inspect the destination page. The spec requires a secure open that keeps the
  content outside the client's and the model's reach.
- Don't accept a client-asserted user identity without server verification — it is forgeable.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Account takeover, no failed logins | Callback bound to the elicitation, not the completer | Verify identity on the connect URL |
| Tokens issued to the wrong session | `state` used as the only binding | Compare `sub` to the session identity |
| Client credential reused for a third-party API | Token passthrough | Separate credentials, server-side only |
| Credential appears in a tool result | Third-party token returned to the client | Never return it |
| Link preview shows a friendly title | Client pre-fetched the URL | Show the full URL as text |
| Attack works by editing the URL | Identity from a client-supplied field | Server-derived identity, tamper-resistant |
| Password sent through form mode | Sensitive data in band | URL mode for sensitive data |

## Verifying

```bash
# 1. Where do url-mode elicitation URLs point? Directly at a provider, or at a
#    first-party connect page that verifies the session? Direct is the finding.
grep -rniE 'elicitation|mode.*url|authorization_url|connect' \
  --include=*.ts --include=*.js --include=*.py --include=*.go . | head -20

# 2. Any pre-fetch on the elicitation URL — a metadata scrape, a title, an
#    oEmbed call, an unfurl — violates a client MUST.

# 3. Any path returning a third-party token in a tool result or an MCP
#    response. The credential MUST NOT transit the client.

# 4. Behavioural: as user A, start an elicitation; as user B on the same
#    server, open the resulting URL and complete it. Assert A's stored token
#    does not change. Anything else is the account-takeover path.
```

What this check cannot see: nothing static proves the identity comparison is *correct* rather than
merely present — a check against a header the client controls, or against a value read from the
elicitation request itself, passes review and fails the attack. The cross-user test in step 4 is the
only one that separates them, and it is the test to insist on: a same-user test passes even when
the mechanism is entirely absent.
