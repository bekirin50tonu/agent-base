---
title: "Only the trace-flags byte crosses vendors; anything malformed is dropped silently"
rule_id: "RULE-TELEMETRY-005"
category: "protocol"
scope: "all"
applies_to: "W3C Trace Context, traceparent header, trace-id, parent-id, trace-flags, version ff, proxy, log formatter"
last_updated: "2026-10-04"
source: "https://www.w3.org/TR/trace-context/"
---

# Only the trace-flags byte crosses vendors; anything malformed is dropped silently

W3C Trace Context is the only interop contract in the telemetry stack, and it is deliberately
narrow. A vendor receiving a `traceparent` it cannot fully parse must drop the header entirely
rather than guess — which means a format mistake propagates as "no traces," never as a parse error
at the sender.

## Why

> If the trace-id value is invalid (for example if it contains non-allowed characters or all
> zeros), vendors MUST ignore the traceparent. See considerations for trace-id field generation for
> recommendations on how to operate with trace-id.
> ([W3C Trace Context](https://www.w3.org/TR/trace-context/))

> The following version-format definition is used for version 00 . version-format = trace-id "-"
> parent-id "-" trace-flags trace-id = 32 HEXDIGLC ; 16 bytes array identifier. All zeroes
> forbidden parent-id = 16 HEXDIGLC ; 8 bytes array identifier. All zeroes forbidden trace-flags = 2
> HEXDIGLC ; 8 bit flags. Currently, only one bit is used.
> ([W3C Trace Context](https://www.w3.org/TR/trace-context/))

> Version ff is invalid. The current specification assumes the version is set to 00 .
> ([W3C Trace Context](https://www.w3.org/TR/trace-context/))

Three constraints, each of which fails by omission rather than by error:

- **An all-zero trace-id is forbidden.** A receiver MUST ignore the whole header. A code path that
  logs into an empty tracing context and emits an all-zero identifier produces traces nobody can
  query, and the sender sees a perfectly successful response.
- **Version `ff` is invalid**, and so is any forward version the parser does not recognise. The
  required response is to ignore — not to truncate-and-continue.
- **Two hex digits of trace-flags, one bit in use.** That single bit is the entire cross-vendor
  sampling channel. Custom flags a team adds to those two digits are not interop, and a peer that
  does not understand them is required to treat them per its own version rules.

The same header carries the context across a service boundary, through a queue, or over the wire to
a vendor. So a single malformed write disconnects the trace at that hop with no signal at either
end: a log formatter that truncates the header, a proxy that rewrites or drops it, or a queue
consumer that rebuilds it by hand rather than propagating it.

## Do

- Propagate `traceparent` verbatim. Copy it; never reconstruct it.
- Validate before you emit: 32 hex, not all zeroes; 16 hex, not all zeroes; version not `ff`.
- Assert the header crosses every hop you care about — service to service, and service to queue to
  consumer.
- Treat `tracestate` as optional and lossy in the interop direction; `traceparent` is the contract.
- Keep the sampled bit under the control of the sampler, not by hand-writing the header.

## Don't

- Don't build a `traceparent` string by concatenation from a stored trace id. Generating a valid
  new id is fine; fabricating one that looks valid from a zero value is how all-zero ids ship.
- Don't add your own flags to the trace-flags byte and expect a peer to honour them.
- Don't assume a receiving vendor tolerates a malformed header on your behalf. It is required to
  ignore it.
- Don't treat "the trace is missing downstream" as a backend indexing problem until the header
  itself has been checked at the hop where it disappears.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Traces absent at one hop only | Header dropped there | Propagate verbatim; validate shape |
| All-zero trace-id in a header | Id generated from an empty context | Never emit an all-zero id |
| Forward version ignored | Receiver on an older spec | Keep version at 00 |
| Custom flags ignored | Not interop; one bit defined | Use `tracestate` for vendor data |
| Header truncated by a formatter | Log/proxy rewriting | Copy the header unchanged |

## Verifying

```bash
# 1. Where is traceparent created, and where is it propagated?
grep -rniE 'traceparent|TraceParent|TRACEPARENT|tracestate|TraceContext' \
  --include=*.ts --include=*.js --include=*.java --include=*.go --include=*.py \
  --include=*.conf --include=*.yaml --include=*.yml . | head -20

# 2. Any construction by string concatenation rather than an SDK or the
#    W3C header library is a finding — that is where all-zero ids come from.

# 3. Observational: assert a syntactically valid header is present on the
#    request at each hop, and that its trace-id is not all zeroes.
```

What this check cannot see: the specification's requirement is that a receiver *ignore* an invalid
header, so an invalid header produces no receiver-side error to grep for — the absence is the
symptom. Propagation across infrastructure is likewise invisible from application source: a proxy
or log pipeline that drops or rewrites the header looks identical from inside the service. That
makes the per-hop assertion the only check that covers this rule, and it has to run against the
deployed topology rather than a unit test.