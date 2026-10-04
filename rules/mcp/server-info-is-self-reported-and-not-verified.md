---
title: "serverInfo Is Self-Reported — Do Not Cache It Into a Trust Decision"
rule_id: "RULE-MCP-003"
category: "security"
scope: "all"
applies_to: "MCP clients calling server/discover; per-server configuration, allowlists, capability gating, tool-result attribution"
last_updated: "2026-10-04"
source: "https://modelcontextprotocol.io/specification/2026-07-28/server/discover"
---

# serverInfo Is Self-Reported — Do Not Cache It Into a Trust Decision

`server/discover` is the one request every server MUST implement, and its response carries the
server's identity and capabilities. The specification then says in its own words that none of it is
verified — and invites the client to cache it. Those two facts together are the whole rule.

## Why

> serverInfo is self-reported by the server and is not verified by the
> protocol. It is intended for display, logging, and debugging. Clients SHOULD
> NOT use it to change their behavior, and SHOULD NOT rely on it for
> security decisions.
> ([server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover))

> This operation supports caching.
> ([server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover))

Note what the response also carries:

```json
{
  "resultType": "complete",
  "supportedVersions": ["2026-07-28"],
  "capabilities": { "tools": {}, "resources": {} },
  "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "ExampleServer", "version": "1.0.0" } },
  "instructions": "This server provides weather and resource utilities.",
  "ttlMs": 3600000,
  "cacheScope": "public"
}
```

`ttlMs` and `cacheScope` are the trap. A client that caches the result for an hour and then branches
on `capabilities` is caching an unverified claim and acting on it — precisely the combination the
first quote forbids. Nothing errors: the capability really is advertised, the branch really does
change behaviour, and every assertion in the code passes.

The sharpest form is the *negative* claim. A server that omits a capability will never be asked for
it, so a client that gated on it degrades to a reduced feature set for the whole `ttlMs` and emits
no error at all. This is the same shape as the OTel no-op provider: absence is permitted, and
absence is not an error.

`serverInfo.name` is the more obvious trap, because it is the natural key for per-server config,
allowlists, log routing, and "which server produced this tool result" attribution. Each of those
treats a self-reported string as an identity. The spec permits exactly these uses — display,
logging, debugging — and forbids the one that turns a string into authority.

## Do

- Bind configuration and trust to something the transport establishes: mTLS peer identity, an
  authenticated origin, a pinned server id issued at deployment. Not to `serverInfo`.
- Use `serverInfo.name` for display, log correlation, and debugging only — the three uses the
  specification names.
- Treat `capabilities` as a hint for *optimising* calls (skip a probe you already know the answer
  to), never as a gate that removes a capability you would otherwise attempt.
- Re-probe on failure rather than trusting a cached negative for the full `ttlMs`.
- Log `serverInfo` next to the transport identity when a tool result needs attribution, so a
  mismatch between them is visible.

## Don't

- Don't key an allowlist, a rate limit, or a permission decision on `serverInfo.name`. It is a
  self-reported string, and the spec forbids exactly this use.
- Don't branch on a cached `capabilities` map to *disable* a code path for the duration of `ttlMs`.
- Don't trust `instructions` — free-text guidance for LLMs — as anything but model input. It is
  untrusted content from the server, delivered in a field a client might treat as configuration.
- Don't assume a successful `server/discover` means the server is trustworthy. It means the server
  answered.
- Don't treat `supportedVersions` as authenticated; it is the same self-report, and a client that
  acts on it is trusting the party it is trying to verify.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Client silently stops calling a tool | Cached `capabilities` omitted it | Gate optimistically, not negatively |
| Config keyed on `serverInfo.name` matches the wrong server | Self-reported string used as identity | Bind to transport identity |
| One server's limits applied to another | Per-server config keyed on name | Authenticated origin or pinned id |
| Prompt-injection via `instructions` | Untrusted free text treated as config | Model input only, never a control path |
| Trust decision survives a server swap | Cached discovery for `ttlMs` | Re-probe on failure |

## Verifying

```bash
# 1. Find every use of serverInfo. Classify each: display/log/debug (allowed)
#    or a decision input (forbidden by the spec).
grep -rniE 'serverInfo|server/discover' --include=*.ts --include=*.js \
  --include=*.py --include=*.go --include=*.rs . | head -20

# 2. Any allowlist, permission, or rate-limit lookup keyed on that name is
#    the finding. So is any `if (capabilities.x) { skip }` that removes a path.

# 3. Behavioural: point the client at a server that reports a different
#    name, and assert nothing changes except the display string.
```

What this check cannot see: nothing static establishes *where* a self-reported string entered a
decision — it will have been copied into a config file or a lookup table long before. The
observational check is the impersonation one: run a server that reports another server's `name`
and confirm the client changes nothing but its label. If a permission, a rate limit, or a tool
allowlist moves, that is the defect.
