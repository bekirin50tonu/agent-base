---
title: "An Unsupported Version Is a Per-Request Rejection, Not a Failed Handshake"
rule_id: "RULE-MCP-004"
category: "protocol"
scope: "all"
applies_to: "MCP clients and servers, protocol version negotiation, era detection over stdio and Streamable HTTP, error handling for -32022"
last_updated: "2026-10-04"
source: "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning"
---

# An Unsupported Version Is a Per-Request Rejection, Not a Failed Handshake

Revision `2026-07-28` removed the negotiation handshake. Version, identity, and capabilities are
now per-request metadata, and every request is accepted or rejected *independently*. Client code
written for the handshake era fails here in a specific way: it treats a recoverable per-request
condition as a fatal session fault.

## Why

> Every request declares the protocol version it is using in its _meta field. On HTTP, this is
> also carried in the
> MCP-Protocol-Version header.
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

> If the server does not implement the requested version (whether the version
> is unknown to the server, or is a known version the server has chosen not to
> support), it MUST respond with an
> UnsupportedProtocolVersionError
> listing the versions it does support
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

The error carries both sides, so the client never has to guess:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32022,
    "message": "Unsupported protocol version",
    "data": { "supported": ["2026-07-28", "2025-11-25"], "requested": "1900-01-01" }
  }
}
```

Three consequences follow, and each is a distinct bug:

**The rejection is scoped to one request.** The server accepted the connection and answered. An
implementation that marks the peer unusable, or that caches "this server rejected us" for the
session, breaks every subsequent request that would have succeeded at a different version — and
there is no error on those later requests to explain why.

**Era detection keys on the error code, not the HTTP status.** The spec is explicit:

> In both cases, a recognized modern JSON-RPC error (such as
> UnsupportedProtocolVersionError)
> identifies a modern server: the client retries with a supported version
> rather than falling back. Anything else identifies a legacy server.
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

A client branching on `status == 400` misclassifies, and one branching on "any error" treats an
unrelated failure as a legacy server and falls back — dropping to `initialize` against a server that
never wanted one.

**Era is a property of the server and is cacheable, but the cache is advisory.**

> The era determination is a property of the server, not of an individual
> request. Clients SHOULD cache the result for the lifetime of the server
> process (stdio) or origin (HTTP), and MAY persist it across restarts of the
> same server configuration, re-probing if the cached assumption later
> fails.
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

Persisting the era across restarts is permitted. Persisting it *without* honouring the re-probe
condition is not, because the sentence that grants permission also states the invalidation rule.

The compatibility matrix names the asymmetry that makes this unfixable from the legacy side:

> Legacy clients have no fall-forward mechanism.
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

And it obliges a modern-only server to compensate:

> A server that supports only modern versions SHOULD name
> the protocol versions it supports in any error it returns to an initialize
> request, on any transport: legacy clients have no fall-forward mechanism, and
> this message may be the only diagnostic they can surface to users.
> ([Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))

## Do

- Read `error.data.supported` and retry with a mutually supported version. Never hardcode a version
  list.
- Scope the rejection to the request that produced it. Leave the connection, session, and any
  client-side health state untouched.
- Detect era by recognising modern JSON-RPC error codes, never by HTTP status or "any error".
- Cache era per `(transport, process-or-origin)`, and invalidate on the first modern error — the
  re-probe condition the spec names.
- On the server, include the supported version list in *any* error returned to an `initialize`
  request, even from a modern-only server. It is the only diagnostic a legacy client can show.
- Set `MCP-Protocol-Version` on HTTP in addition to `_meta`. The spec says the version is carried in
  both, and a proxy that reads only headers will see a missing version.

## Don't

- Don't treat `UnsupportedProtocolVersionError` as fatal, or mark the server unusable. It is
  recoverable and carries its own remedy.
- Don't cache a version rejection for the session or the connection.
- Don't branch era detection on HTTP status. The discriminator is the recognised error code.
- Don't fall back to `initialize` on an unrecognised error. The spec says the opposite: a
  recognised modern error means stay modern; anything else means legacy.
- Don't assume a legacy client will recover. It cannot — which is why the server's error text
  matters more than it looks.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Every call fails after one version error | Rejection cached as a session fault | Scope to the request |
| Client falls back to `initialize` against a modern server | Era detected on "any error" | Recognise modern error codes |
| stdio client hangs against a legacy server | `server/discover` not sent first | Probe, then fall back |
| Legacy client shows only "unsupported method" | Modern-only server returned a bare error | Name supported versions in any `initialize` error |
| Proxy drops the version | Header not set alongside `_meta` | Set `MCP-Protocol-Version` |
| Persisted era wrong after a server upgrade | Re-probe condition not implemented | Invalidate on the first modern error |

## Verifying

```bash
# 1. How is -32022 handled? Fatal, retried, or cached as peer state?
grep -rniE '32022|UnsupportedProtocolVersion|supportedVersions|MCP-Protocol-Version' \
  --include=*.ts --include=*.js --include=*.py --include=*.go . | head -20

# 2. Era detection: grep for the branch. Anything testing a status code, or
#    catching a bare error type, is the defect the spec's wording forbids.

# 3. Behavioural: send one request at an unsupported version, then the same
#    request at a supported one. The second must succeed — if the first
#    poisoned session state, it will not.
```

What this check cannot see: the stdio fallback path is timing-dependent and rarely runs in a test —
a probe that falls back "on any error that is not a recognized modern error" also falls back on a
timeout, so a slow server and a legacy server are indistinguishable from the client's side. Only a
real stdio peer with a deliberately slow first response separates them, which is why the stdio
fallback is the least-tested and most fragile part of a dual-era client.
