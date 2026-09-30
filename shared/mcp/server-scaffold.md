---
title: "Stateless MCP Server Scaffold"
category: "protocol"
applies_to: "Any project implementing an MCP server against specification 2026-07-28"
last_updated: "2026-09-30"
source: "https://modelcontextprotocol.io/specification/2026-07-28"
---

# Stateless MCP Server Scaffold

The minimum shape of an MCP server that conforms to specification 2026-07-28: no sessions, no
handshake, per-request capability negotiation, and a required `resultType` on every result.

## When to Use

- The target project implements an MCP server and is on, or moving to, the 2026-07-28 revision.
- A server's list endpoints are missing `ttlMs` / `cacheScope`, or results are missing
  `resultType`.
- A server needs user input mid-tool and currently blocks or returns an error instead of
  returning `input_required`.
- You need to check whether an existing server predates the stateless revision.

## Usage Example

### The request path

Every request carries negotiation in `_meta`. Parse it once, at dispatch, not per handler.

```
POST /
  {
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "tools/call",
    "params": { "name": "delete_file", "arguments": { "path": "…" } },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} },
      "io.modelcontextprotocol/clientInfo": { "name": "example-client", "version": "1.2.0" }
    }
  }
```

Dispatch responsibilities, in order:

1. Read `protocolVersion` from `_meta`. Mismatch → `UnsupportedProtocolVersionError` (`-32022`).
2. Read `clientCapabilities`. This is the authority on what you may ask for — not a cached
   handshake result, because there is no handshake.
3. Read `clientInfo` if present (clients SHOULD send it).
4. Dispatch. Write `serverInfo` into each result's `_meta`.

### Discovery

`server/discover` is mandatory for servers.

```json
{
  "jsonrpc": "2.0",
  "id": "req-0",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": { "tools": { "listChanged": true }, "elicitation": {} },
    "ttlMs": 3600000,
    "cacheScope": "public",
    "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "example-server", "version": "1.0.0" } }
  }
}
```

### Results always carry `resultType`

```json
{ "jsonrpc": "2.0", "id": "req-1", "result": { "resultType": "complete", "content": [ … ] } }
```

Clients treat a result *missing* `resultType` as `"complete"` — for backward compatibility with
older peers. That fallback is the trap: forget the field on an `input_required` result and the
client reports success on a call that is still waiting for input.

### Cacheable results

`tools/list`, `prompts/list`, `resources/list`, `resources/read`, and
`resources/templates/list` return `ttlMs` and `cacheScope` (SEP-2549). Both are required.

```json
{ "resultType": "complete", "tools": [ … ], "ttlMs": 300000, "cacheScope": "private" }
```

Return `tools/list` in a **deterministic order**. Clients cache the response and feed it into
LLM prompt caches; a list that reorders between identical calls invalidates those caches for no
benefit.

### Asking for input

Where a tool needs a decision, return rather than block:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "resultType": "input_required",
    "requestState": "<opaque, signed>",
    "inputRequests": {
      "confirm": {
        "method": "elicitation/create",
        "params": {
          "message": "Delete this file? It cannot be recovered.",
          "requestedSchema": { … }
        }
      }
    }
  }
}
```

The client retries the **original** request with a new `id`, the same arguments, `inputResponses`
keyed by the names above, and `requestState` echoed byte-for-byte. Make the handler idempotent —
the retry is a new request that may arrive after a crash.

### Subscriptions

One long-lived stream replaces the HTTP GET endpoint:

```
POST /  { "method": "subscriptions/listen", "params": { "subscriptions": ["toolsListChanged"] } }
```

Opt-in types: `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`,
`resourceSubscriptions`. `notifications/progress` and `notifications/message` ride the
*originating request's own* response stream, not this one.

### Tracing

OpenTelemetry trace context propagates through `_meta` under `traceparent`, `tracestate`, and
`baggage` (SEP-414). Read them at dispatch if you join traces across the MCP boundary.

## Caveats

- **This scaffold encodes 2026-07-28.** The preceding revision (2025-06-18) had sessions, a
  handshake, an HTTP GET endpoint, and no `resultType`. Code written against that revision is
  not a variant of this one — it is a different shape.
- **Extensions are off by default.** `io.modelcontextprotocol/tasks`, MCP Apps, and Skills over
  MCP are opt-in; a client advertises them under `_meta["io.modelcontextprotocol/clientCapabilities"]`
  and a server advertises them in the `server/discover` response. Do not assume either side has
  them.
- **`requestState` is attacker-controlled.** The field round-trips through an untrusted client.
  Sign it if it influences anything but a UI hint — see
  `rules/mcp/request-state-is-attacker-controlled.md`.
- **Error codes moved.** `-32000..-32019` is implementation-defined; `-32020..-32099` is reserved
  for MCP. `HeaderMismatch` is `-32020`, `MissingRequiredClientCapability` is `-32021`,
  `UnsupportedProtocolVersion` is `-32022`. Resource-not-found is `-32602`, not the older
  `-32002`.
- **There is no stream resumption.** No `Last-Event-ID`, no redelivery. A broken stream loses the
  in-flight request; clients re-issue with a new id, which means retries re-execute side effects.
- **No bare `"` inside frontmatter values** — the manifest parser rejects it.