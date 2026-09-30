---
name: migrate-to-stateless-transport
description: "Migrate an MCP server or client from the session-based protocol (2025-06-18 and earlier) to the stateless protocol (2026-07-28). Use when upgrading an MCP implementation across the 2026-07-28 boundary, when implementing server/discover, or when Multi Round-Trip Requests must replace server-initiated requests."
version: "1.0.0"
tags:
  - mcp
  - migration
  - protocol
---

# Migrate to the Stateless MCP Protocol (2026-07-28)

The 2026-07-28 revision is not an additive change. It removes sessions, removes the
handshake, and replaces server-initiated requests outright. An implementation written against
2025-06-18 does not degrade gracefully against it — the handshake it depends on is gone, and
the request flow it is built around no longer exists. Treat this as a migration with ordered
steps, each gated on a test.

## Why

The single most dangerous detail of this migration is that the *older* specification still
loads and still looks authoritative. Fetching `modelcontextprotocol.io/specification/2025-06-18`
returns a complete, well-formed spec — and the site flags it only in a banner reading "You are
viewing an older version of the specification." Writing against that page produces an
implementation that is wrong on every structural axis: stateful where the protocol is now
stateless, handshaked where the handshake is gone, and dependent on server-initiated requests
that the spec now says are unsupported.

So: before any other step, confirm which revision you are reading.

## Step 0 — Confirm the target revision, not the one you found

Open the MCP specification index and read the version banner on the page you are using.
Record the revision string in the migration commit message. Everything downstream depends on
this being 2026-07-28 or a later revision.

**Exit criterion:** the revision string is written down, and the page you read shows no
older-version alert.

## Step 1 — Inventory what depends on the session lifecycle

Sessions and the handshake are the load-bearing removal. Find every site before deleting
anything:

```bash
grep -rn "Mcp-Session-Id\|initialize\|notifications/initialized\|SSE\|Last-Event-ID" src/
```

Also list the endpoints that varied per connection. Under the new protocol, list endpoints do
not vary per connection — they return the same thing regardless of who asks.

**Exit criterion:** every hit is classified as "to be deleted" or "to be rewritten", with the
call site noted. Any hit you cannot classify blocks the migration.

## Step 2 — Remove the handshake and move negotiation into `_meta`

`initialize` and `notifications/initialized` are gone. Each request now carries the protocol
version and client capabilities in `_meta`:

- `io.modelcontextprotocol/protocolVersion`
- `io.modelcontextprotocol/clientCapabilities`
- `io.modelcontextprotocol/clientInfo` (clients SHOULD send it)
- servers SHOULD answer with `io.modelcontextprotocol/serverInfo` in each result's `_meta`

Delete the handshake handler. Add `_meta` parsing to the single request-dispatch point, so
every method inherits it rather than each handler re-reading it. A version mismatch must
produce `UnsupportedProtocolVersionError` (error code `-32022`).

**Exit criterion:** no `initialize` handler remains; a request carrying a mismatched version
is rejected with `UnsupportedProtocolVersionError`; a request with no handshake first succeeds.

## Step 3 — Implement `server/discover` on the server

Servers **must** implement `server/discover`; clients **may** call it first. It returns
`supportedVersions`, `capabilities`, `_meta`, and — since SEP-2549 — `ttlMs` and `cacheScope`.

Note that `ttlMs` and `cacheScope` are now **required** on `tools/list`, `prompts/list`,
`resources/list`, `resources/read`, and `resources/templates/list`, through the new
`CacheableResult` shape. If your list endpoints do not return them, clients are reading
responses the spec no longer describes.

**Exit criterion:** `server/discover` returns the required fields; every list endpoint returns
`ttlMs` and `cacheScope`.

## Step 4 — Replace HTTP GET and subscriptions with `subscriptions/listen`

The HTTP GET endpoint and `resources/subscribe` / `resources/unsubscribe` are replaced by a
single long-lived stream: `subscriptions/listen`, opened with POST and held on the response.
Subscription types are opt-in and named: `toolsListChanged`, `promptsListChanged`,
`resourcesListChanged`, `resourceSubscriptions`.

`notifications/progress` and `notifications/message` still travel on the *originating
request's own* response stream — not on this one. Wiring them onto `subscriptions/listen`
changes their delivery semantics.

**Exit criterion:** the GET endpoint is gone; a client can receive a `toolsListChanged`
notification over `subscriptions/listen`.

## Step 5 — Replace server-initiated requests with Multi Round-Trip Requests

This is the largest change and it is not a rename. Delete every server-initiated call —
`roots/list`, `sampling/createMessage`, `elicitation/create` — and replace the control flow.

Where a handler previously suspended to ask the user something, it now returns:

```json
{
  "resultType": "input_required",
  "inputRequests": { "confirm": { /* ElicitRequest | CreateMessageRequest | ListRootsRequest */ } }
}
```

The client collects answers and **retries the original request** with `inputResponses`, a
different JSON-RPC `id`, and the `requestState` echoed back byte-for-byte.

Constraints that are easy to get wrong:

- `InputRequiredResult` is allowed only on `prompts/get`, `resources/read`, and `tools/call`.
- At least one of `inputRequests` or `requestState` must be present.
- `requestState` is attacker-controlled — see `rules/mcp/request-state-is-attacker-controlled.md`.
- Never ask for a capability the client did not declare. As of this revision the client
  capability set is Elicitation only; Roots and Sampling are deprecated.
- Make handlers idempotent across the original call and its retry.

**Exit criterion:** a tool that needs confirmation returns `input_required` and completes on
retry; no server-initiated request code remains.

## Step 6 — Add `resultType` to every result

Every result carries a required `resultType` — `"complete"` or `"input_required"`. Clients
treat a result missing it as `"complete"`, for backward compatibility. That fallback is why a
missing `resultType` is silent: the client reports success on a result that is actually asking
for input.

**Exit criterion:** every result your server emits has an explicit `resultType`; a test asserts
it on each method.

## Step 7 — Handle broken streams as lost requests

SSE resumability, `Last-Event-ID`, and stream redelivery are removed. A broken stream loses the
in-flight request, and the client must re-issue it with a **new** request id. There is no
resume, no replay, and no redelivery guarantee.

If your client has retry logic built on stream resumption, it has to be rebuilt on re-issue.
Server-side, this means a request interrupted mid-flight may be silently re-executed by a
retrying client — which is an idempotency requirement on every tool, not an edge case.

**Exit criterion:** client retry logic re-issues with a new id; every non-idempotent tool has
an idempotency key.

## Step 8 — Audit the deprecations before they are removals

As of 2026-07-28, with earliest removal the first revision on or after 2027-07-28:

| Deprecated | SEP | Migration |
|---|---|---|
| Roots | SEP-2577 | Pass directories/files via tool params, resource URIs, or server config |
| Sampling | SEP-2577 | Integrate directly with LLM provider APIs |
| Logging | SEP-2577 | Log to stderr for stdio; use OpenTelemetry |
| Dynamic Client Registration | PR #2858 | Client ID Metadata Documents |

None of these have been *removed* yet — the registry's Removed section is empty. They are on a
twelve-month minimum deprecation window, so this step is preparation, not a deadline.

**Exit criterion:** each deprecated feature in use has either been migrated or has a dated plan
to be.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Client hangs before the first request | The old handshake still gates the flow, and the client no longer waits for it | Delete the handshake; move negotiation into per-request `_meta` |
| Every request fails with `UnsupportedProtocolVersionError` | The version string is read from a stale page | Re-check the spec index banner and update the string |
| A tool returns `input_required` and the client reports success | `resultType` missing — clients default it to `complete` | Emit `resultType` on every result |
| A tool performs its side effect twice after a retry | Handler is not idempotent across the original call and the retry | Add an idempotency key and make the retry a no-op |
| Streams resume on reconnect | Assumes `Last-Event-ID` redelivery, which no longer exists | Rebuild retry on re-issue with a new request id |
| List responses are rejected by a new client | `ttlMs` / `cacheScope` missing — required since SEP-2549 | Return both on all cacheable results |
| Interactivity works locally and hangs against another client | The code sends an undeclared capability the other client lacks | Request only declared capabilities; Elicitation is the only one left |

## Verifying

- `grep -rn "Mcp-Session-Id\|notifications/initialized\|Last-Event-ID" src/` returns nothing.
- `grep -rn "sampling/createMessage\|roots/list" src/` returns nothing outside client code.
- Every result carries `resultType`.
- `server/discover` responds with `supportedVersions`, `capabilities`, `ttlMs`, `cacheScope`.
- A tool requiring confirmation completes end-to-end through one `input_required` round trip.
- Re-running the test suite produces no duplicate side effects.

## When to stop and escalate

- The implementation depends on Roots or Sampling and the migration path cannot be scoped
  before their 2027-07-28 earliest removal — that is a design change, not a protocol change.
- The target client's MCP implementation predates 2026-07-28 and cannot be upgraded. The
  revision boundary is not negotiable by negotiation; find a client on the current revision.
- `_meta` must carry a capability the client does not support, and there is no equivalent path
  under the new protocol.

## Limits of this skill

- Written against MCP specification 2026-07-28. Later revisions may move these boundaries;
  confirm the revision before trusting any step.
- Covers the server and client protocol surface only. SDK-specific upgrade paths are out of
  scope — check each SDK's own migration guide, since support for this revision arrived at
  different times per language.
- Does not cover the extension mechanism (`io.modelcontextprotocol/tasks`, MCP Apps, Skills
  over MCP), which is opt-in and disabled by default. Extensions follow their own compatibility
  rules.
- Says nothing about authentication beyond the `iss` validation change (SEP-2468, RFC 9207) and
  the credential-binding change (SEP-2352). Those belong to an authorization asset.