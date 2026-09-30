---
title: "Servers Cannot Initiate Requests"
rule_id: "RULE-MCP-002"
category: "protocol"
scope: "all"
applies_to: "Model Context Protocol 2026-07-28 servers and clients"
last_updated: "2026-09-30"
source: "https://modelcontextprotocol.io/specification/2026-07-28/basic/multi-round-trip-requests"
---

# Servers Cannot Initiate Requests

In MCP 2026-07-28, Multi Round-Trip Requests (MRTR) replace every server-initiated request. A server can no longer call out to the client mid-request — it cannot send `roots/list`, `sampling/createMessage`, or `elicitation/create` and wait. If it needs input, it must *return* an `InputRequiredResult` and let the client retry.

## Why

The spec states it plainly: *"The previous pattern of server-initiated requests is no longer supported. This is a breaking change."*

The mechanism changes the control flow of every tool that needs user input. Under the old protocol, a server could suspend itself, ask the user something, and resume. Under MRTR, `tools/call` **returns** with `resultType: "input_required"`; the client collects the answers and issues a **new** request — a retry of the original — carrying the same arguments plus `inputResponses`. The in-flight call is over. The workflow continues because the client came back, not because the server held a turn.

This breaks implementations in a specific way: code that assumes a tool call can make a nested round-trip and continue on the same stack frame will not compile against the new protocol, and code that quietly relies on a server-issued `sampling/createMessage` will find the capability gone from the "clients may offer" list — as of 2026-07-28 that list is **Elicitation only**. Roots and Sampling are deprecated, with earliest removal the first revision on or after 2027-07-28.

## Do

- Return an `InputRequiredResult` (`resultType: "input_required"`) with an `inputRequests` map, and handle the retry as a fresh request.
- Allow `InputRequiredResult` only on `prompts/get`, `resources/read`, and `tools/call`. The spec says: *"Servers MUST NOT send InputRequiredResult responses on any other client requests."*
- Include at least one of `inputRequests` or `requestState` in the result — the server must supply one.
- Make the handler idempotent across the original call and its retry. The retry is a new request that may arrive after a crash, a timeout, or a client restart.
- Use a different JSON-RPC `id` for the retry than for the original request. The spec requires it.
- Ask only for capabilities the client actually declared. A server must not issue `inputRequests` for `elicitation/create` against a client that never advertised `elicitation`.
- Handle the case where the client never retries: do not assume it will. Re-prompting with a fresh `InputRequiredResult` is permitted.

## Don't

- Do not send a server-initiated request in response to a client request. There is no longer a channel for it.
- Do not assume the client will retry. The spec permits re-prompting, and says that when required information is missing a server SHOULD return a new `InputRequiredResult` rather than an error.
- Do not apply `inputRequests` or `requestState` to a parallel request. They bind only to the one retry.
- Do not reuse `inputRequests` keys across requests within a request. Keys are server-assigned and must be unique per request.
- Do not send an `InputRequiredResult` without `resultType`. Every result carries a required `resultType`; clients treat a result missing it as `"complete"` for backward compatibility, which means a malformed `input_required` is silently read as a finished result.
- Do not keep Roots or Sampling call sites "working" via a compatibility shim. Both are deprecated as of 2026-07-28.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Client receives `input_required` but never progresses | Server assumed the client would retry unconditionally | Make retries idempotent and re-prompt with a fresh `InputRequiredResult` when the retry does not arrive |
| Duplicate side effects after a retry | Handler is not idempotent across the original call and the retry | Make the operation keyed so a replayed retry is a no-op |
| Server hangs waiting for input that never comes | Old server-initiated-request model still in the code path | Return `InputRequiredResult` and end the call; the client owns the next turn |
| Client treats a result as finished | `resultType` omitted from the result object | Include `resultType` on every result |
| Server asks a capability the client never declared | `inputRequests` populated without checking declared capabilities | Check the client's advertised capabilities before requesting |
| Concurrent retries collide on request keys | Keys generated globally instead of per request | Generate `inputRequests` keys per request, unique within it |

## Verifying

1. `grep -rn "sampling/createMessage\|roots/list\|elicitation/create" src/` — no server-side invocation should remain outside a client implementation.
2. Every `tools/call` handler that needs input returns `resultType: "input_required"` rather than blocking.
3. Run a handler twice with the same arguments and confirm the second run is a no-op.
4. Confirm each result object carries a `resultType`.
5. Confirm the retry uses a different JSON-RPC `id` than the original.

*Written against MCP specification 2026-07-28.* Deprecations recorded there: Roots (SEP-2577), Sampling (SEP-2577), and Logging (SEP-2577) are deprecated as of 2026-07-28 with earliest removal the first revision on or after 2027-07-28; the migration paths are directories via tool params or resource URIs, direct LLM provider API integration, and stderr/OpenTelemetry respectively.