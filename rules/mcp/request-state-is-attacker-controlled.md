---
title: "requestState Is Attacker-Controlled Input"
rule_id: "RULE-MCP-001"
category: "security"
scope: "all"
applies_to: "Model Context Protocol 2026-07-28 servers"
last_updated: "2026-09-30"
source: "https://modelcontextprotocol.io/specification/2026-07-28/basic/multi-round-trip-requests"
---

# requestState Is Attacker-Controlled Input

In MCP 2026-07-28, the `requestState` field returned with an `InputRequiredResult` is opaque to the client: it must echo the exact value back when retrying the original request. Because it round-trips through an untrusted party, the spec requires servers to treat it as attacker-controlled input — and to protect its integrity whenever it can influence anything that matters.

## Why

The spec is explicit: *"servers MUST treat `requestState` as an attacker-controlled input. If `requestState` influences authorization, resource access, or business logic, servers MUST protect its integrity (e.g. HMAC or AEAD) and MUST reject state that fails verification."*

The value travels client → server → client → server. Nothing stops the client from replacing a role, a tenant id, a user id, or a completed-approval flag between the two hops, and nothing stops a third party from replaying a state captured from another request entirely. An unsigned state is a bearer token for whatever it grants.

The escape hatch in the spec is narrow and worth quoting in full: integrity protection *"MAY be omitted only when tampering can cause nothing worse than request failure."* If the state carries anything beyond a UI hint — a resume cursor, a selected menu path — it must still be signed.

## Do

- Sign the state with HMAC (or encrypt it with AEAD) whenever it feeds authorization, resource access, or business logic.
- Bind the authenticated principal into the integrity-protected payload, and reject state whose principal does not match the current caller. This is what stops cross-user replay.
- Give the state a short TTL, so a captured value expires quickly.
- Bind the originating request into the payload — method name plus a digest of the salient parameters — and reject a retry whose state does not match the request being retried.
- Reject any state that fails verification rather than falling back to defaults.
- Treat `requestState` as opaque on the client side: do not parse it, modify it, or invent one if the server never sent one.

## Don't

- Do not put authorization decisions, roles, tenant ids, or user ids in an unsigned `requestState`.
- Do not treat the anti-replay bindings as a substitute for server-side single-use enforcement. The spec says so directly: they *"bound the replay window and prevent cross-user and cross-request reuse, but do not by themselves guarantee single-use."* A once-only invariant has to be enforced where the invariant lives — in your own state, not in the token.
- Do not assume the state is tied to a specific request. `inputRequests` and `requestState` apply only to that one retry, never to a parallel request.
- Do not accept a `requestState` value that arrives on a request the server never issued an `InputRequiredResult` for.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A client can read or approve data belonging to another user | State is unsigned, or carries no principal binding | Sign the state and bind the authenticated principal; reject on mismatch |
| A captured state value works indefinitely | No TTL on the integrity-protected payload | Add a short expiry and reject expired state |
| A state from a different `tools/call` is accepted on this one | No binding to the originating request | Bind method name plus a digest of salient parameters into the payload |
| The same approval state is replayed successfully twice | Anti-replay bindings treated as single-use enforcement | Enforce the once-only invariant server-side against your own store |
| A forged state is parsed and partially trusted | State treated as readable configuration | Treat it as opaque; only trust values your own code signed |

## Verifying

1. `grep -rn "requestState" ` across the server — every read of the value should be downstream of a verification step.
2. Tamper test: take a real state, flip a byte in it, retry the original request. The server must reject it.
3. Cross-principal test: capture a state from user A, retry as user B. The server must reject it.
4. Cross-request test: take a state from a `tools/call` on resource X and retry it against resource Y. The server must reject it.
5. Expiry test: replay a state after its TTL. The server must reject it.

*Written against MCP specification 2026-07-28.* The pre-2026-07-28 protocol had no `requestState` field and no Multi Round-Trip Requests, so this rule does not apply to implementations of the earlier, session-based handshake.