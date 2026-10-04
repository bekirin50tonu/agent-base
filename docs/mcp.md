---
language: "Model Context Protocol"
tag: "mcp"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Model Context Protocol assets."
---

# Documentation Hub: Model Context Protocol

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies for an MCP SDK or
> configuration file. This hub is **cross-cutting** — it applies regardless of implementation
> language, so a project can match it alongside its language hub. Judge each entry separately.
>
> **Triggers**: `@modelcontextprotocol/sdk` in `package.json`, the `mcp` or `modelcontextprotocol`
> package in `pyproject.toml`/`requirements.txt`, `ModelContextProtocol` in a `.csproj`,
> `github.com/modelcontextprotocol/...` in `go.mod`, a Java MCP dependency, or a `.mcp.json`
> file in the repository root.
>
> **Version note**: these assets were written against MCP specification **2026-07-28**. That
> revision removed sessions and the initialization handshake, made requests stateless and
> self-contained, moved capability negotiation into per-request `_meta`, and replaced
> server-initiated requests with Multi Round-Trip Requests. Servers built against **2025-06-18
> or earlier** have a structurally different shape and are *not* a variant of what is
> documented here. Confirm the revision before applying any entry.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/mcp/request-state-is-attacker-controlled.md`
  - **Why**: The `requestState` field in an `InputRequiredResult` round-trips through the
    client, so the spec requires servers to treat it as attacker-controlled input and to protect
    its integrity with HMAC or AEAD whenever it influences authorization, resource access, or
    business logic. Unprotected, it is a bearer token for whatever it grants — a client can
    rewrite a role or tenant id between the two hops, or replay another user's state. The
    anti-replay bindings bound the window; they explicitly do not make the value single-use.
  - **When**: Target project implements an MCP server that returns `InputRequiredResult`, or
    reads `requestState` from a client request.
  - **Target Location**: `docs/rules/mcp/request-state-is-attacker-controlled.md`

- **Path**: `rules/mcp/no-server-initiated-requests.md`
  - **Why**: Multi Round-Trip Requests removed every server-initiated request — the spec calls
    it a breaking change. A server needing input must return `resultType: "input_required"` and
    let the client retry the original request, so control flow that used to suspend on the
    server now ends the call. Two silent failure modes follow: results missing `resultType` are
    read as `complete` by clients, and handlers that were never made idempotent double their
    side effects on retry.
  - **When**: Target project implements an MCP server whose tools request user input, or a
    client handling `input_required` results.
  - **Target Location**: `docs/rules/mcp/no-server-initiated-requests.md`

- **Path**: `rules/mcp/server-info-is-self-reported-and-not-verified.md`
  - **Why**: `server/discover` — the one request every server must implement — returns the
    server's identity and capabilities, and the spec says in its own words that none of it is
    verified: intended for display, logging, and debugging, and clients "SHOULD NOT rely on it
    for security decisions." The same response invites caching via `ttlMs` and `cacheScope`.
    Together those make the trap: a client that caches for an hour and then gates behaviour on
    `capabilities` is caching an unverified claim and acting on it. The sharpest form is the
    negative claim — a server that omits a capability is never asked, so the client degrades
    silently for the whole TTL and emits no error at all.
  - **When**: Target project implements an MCP client calling `server/discover`, or keys
    per-server config, allowlists, rate limits, or tool-result attribution on `serverInfo.name`.
  - **Target Location**: `docs/rules/mcp/server-info-is-self-reported-and-not-verified.md`

- **Path**: `rules/mcp/unsupported-version-is-per-request-not-a-handshake.md`
  - **Why**: Because the negotiation handshake was removed, an unsupported version is a
    *per-request* rejection (`UnsupportedProtocolVersionError`, code `-32022`, carrying both
    `supported` and `requested`), not a failed session. Three distinct bugs follow: treating the
    rejection as fatal poisons requests that would have succeeded; detecting era by HTTP status
    or "any error" rather than by recognising modern error codes drops a modern server to
    `initialize`; and caching era without honouring the spec's re-probe condition survives a
    server upgrade. The matrix also names the asymmetry that cannot be fixed from the legacy
    side: legacy clients have no fall-forward mechanism, so a modern-only server must name its
    versions in *any* error returned to an `initialize` request.
  - **When**: Target project implements an MCP client or server doing version negotiation, era
    detection, or stdio/Streamable-HTTP fallback.
  - **Target Location**: `docs/rules/mcp/unsupported-version-is-per-request-not-a-handshake.md`

- **Path**: `rules/mcp/url-mode-elicitation-is-a-phishing-vector.md`
  - **Why**: URL mode exists so credentials never transit the client or the LLM context, and the
    spec devotes a section to the attack the feature creates: a malicious user tricks a victim
    into completing *his* authorization URL, and the server binds the resulting tokens to the
    wrong session — an account takeover in which every step of the OAuth flow succeeds and the
    server's own logs show a clean callback. The mandated mitigation is identity equality, not a
    warning: the server MUST verify that the user who started the elicitation is the user who
    completed it, and the mechanism MUST be resilient to an attacker who can modify the URL.
    `state` alone does not satisfy this — it prevents CSRF, not user substitution.
  - **When**: Target project implements an MCP server using url-mode elicitation for OAuth or
    third-party authorization, or a client rendering a url-mode elicitation.
  - **Target Location**: `docs/rules/mcp/url-mode-elicitation-is-a-phishing-vector.md`

- **Path**: `rules/mcp/sampling-max-tokens-is-the-only-hard-budget.md`
  - **Why**: Sampling defines four tuning parameters and draws a hard line between them:
    "The client MUST respect the maxTokens parameter. The client MAY modify or ignore
    temperature, stopSequences and metadata." `maxTokens` is the only MUST and the only one that
    bounds spend, so a client honouring temperature while ignoring maxTokens is the shape the
    spec describes. Without it, `stopReason: "maxTokens"` is the only evidence the limit ever
    bound anything. The tool-result structure adds two MUSTs that are validation rules, not
    preferences: a tool-result message must contain *only* tool results, and every
    `ToolUseContent` must be matched before any other message — which is why a mixed array
    passes local checks and fails at the model provider with an opaque 400.
  - **When**: Target project implements sampling on either side, or a tool-use loop inside a
    sampling conversation.
  - **Target Location**: `docs/rules/mcp/sampling-max-tokens-is-the-only-hard-budget.md`

## 2. Skills (`skills/`)

- **Path**: `skills/mcp/migrate-to-stateless-transport/SKILL.md`
  - **Why**: Crossing the 2026-07-28 boundary is not an upgrade, it is a rewrite of the request
    path — sessions, the handshake, the HTTP GET endpoint, and server-initiated requests are all
    gone, and the failure mode is that the *old* spec still loads and still looks authoritative.
    The skill orders the work: confirm the revision first, then inventory session dependencies,
    move negotiation into `_meta`, implement `server/discover`, replace subscriptions, convert
    to MRTR, add `resultType`, treat broken streams as lost requests, and only then audit the
    deprecations that are not yet removals.
  - **When**: Target project implements MCP against 2025-06-18 or earlier and is moving to
    2026-07-28, or is implementing `server/discover` for the first time.
  - **Target Location**: `docs/skills/mcp/migrate-to-stateless-transport/SKILL.md`

## 3. Agents (`agents/`)

_Empty — MCP guidance is delivered as protocol rules and one migration workflow; a persona
would add nothing the rules do not already route._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/mcp/server-scaffold.md`
  - **Why**: The minimum conforming server shape for 2026-07-28 — per-request `_meta`
    negotiation, mandatory `server/discover`, `resultType` on every result, `ttlMs` and
    `cacheScope` on cacheable results, the `input_required` round trip, and `subscriptions/listen`.
    It also records the error-code relocation (`-32020..-32099` reserved for MCP) and the
    removed stream resumption, which are the two details that break existing integrations
    silently.
  - **When**: Target project implements an MCP server, or a client, against specification
    2026-07-28 or later.
  - **Target Location**: `docs/mcp/server-scaffold.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.