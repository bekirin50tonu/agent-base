---
title: "Correlation Ids Are Just Trace Ids Plus Propagated Fields"
rule_id: "RULE-CORRELATION-001"
category: "architecture"
scope: "backend"
applies_to: "Any service that fans a request out across processes, queues, or databases and needs to join the logs again"
last_updated: "2026-09-30"
source: "https://www.w3.org/TR/trace-context/, https://www.w3.org/TR/baggage/"
---

# Correlation Ids Are Just Trace Ids Plus Propagated Fields

Do not invent a `X-Correlation-Id` and thread it through every call site as a bespoke lambda parameter. W3C Trace Context is the standard carrier — `traceparent` for the identity, `tracestate` (and W3C `Baggage`) for the business fields that need to ride along. Adopt the standard and the collector/distributed-tracing tooling already in your stack joins the logs for you.

## Why

A bespoke correlation id solves logging and creates two follow-on costs: every framework middleware between your ingress and your datastore has to be taught to propagate it (miss one and the trail breaks silently at that hop), and the log-joining query becomes a per-project custom join on a column nobody else has. W3C Trace Context exists precisely to end this: the wire format is standardised (`traceparent`/`tracestate` on HTTP headers, propagators on gRPC/Kafka/message metadata), and every observability vendor ingests it.

The subtlety worth keeping: **`tracestate` is not free-form baggage.** It is for vendor-defined state (sampling flags, scoring), size-boxed to 512 bytes, with strict character restrictions. Business identifiers — `order_id`, `customer_tier`, `tenant` — belong in W3C `Baggage`, which has no such box and is expressly for cross-cutting business fields.

## Do

- Emit `traceparent: 00-{trace-id}-{parent-id}-{flags}` as a 32-hex-trace-id / 16-hex-span-id pair with hex-lowercase (only lowercase is accepted). Consume and re-emit it on outbound hops **unchanged**.
- Propagate the header through the full fan-out: HTTP client → gRPC → queue publish → consumer. Every hop is where the trail can silently break.
- Put business identifiers in **W3C `Baggage`** (`Baggage: order.id=42,tenant=acme`) and let the exporter lift them into `LogRecord.attributes` / `Span.attributes`. Do not stuff them into `tracestate`.
- Sample decision on `traceparent` `flags` (`sampled`, bit 1). Unsampling after you propagated it means dropping the correlation too.
- Set `X-Request-Id` as a *return* identifier (per-hop unique) if you need one for support tickets, but that is a per-request handle — **not** a substitute for `traceparent`.

```http
GET /orders HTTP/1.1
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate: congo=t61rcWkgMzE
Baggage: order.id=42,customer.tier=gold
```

## Don't

- **Don't re-invent `X-Correlation-Id`.** The label is unstandardised; the tooling you are about to install speaks `traceparent`.
- **Don't put multi-hop identifiers in `tracestate`.** 512-byte box, restricted grammar, reserved for vendor state.
- **Don't let the trace context die at a queue boundary.** Publish `traceparent` in the message metadata and reconstruct the *same* `trace-id` in the consumer with a child span. A fresh trace per consumer loses the causal chain.
- **Don't derive `traceparent` from a hash.** Random 16-byte trace-id per request. Collision across unrelated requests in a sampled corpus poisons your joins.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Logs join by trace, but the async hop has its own trace | Queue publish/consume not carrying `traceparent` | Copy `traceparent` into message headers; reconstruct as child span |
| Downstream rejects `traceparent` | Uppercase hex emitted | Emit hex-lowercase only |
| Trail breaks at one internal service | Missing HTTP/gRPC interceptor | Teach every client and server middleware to propagate |
| Business id missing from log lines | Id stuffed in `tracestate` and size-capped | Move it to W3C `Baggage` |
| Can't find "who caused this 4 hours ago" | No unique-per-support-handle | Set `X-Request-Id` alongside; return it in responses and error pages |

## Verifying

1. `curl -H "traceparent: 00-$TID-$SID-01" http://localhost/orders` and assert the log line contains `trace_id=$TID` (lowercase, preserved verbatim).
2. Trigger one async work item and assert the consumer's span shares `$TID` with the ingress span.
3. `grep -RIn "X-Correlation-Id" <target>` — every hit should justify *not* using `traceparent`.
4. `grep -RIn "tracestate:" <target>` — inspect each for size violations (>512 bytes) or multi-value stuffing.

## Caveats on confidence

- W3C Trace Context's `traceparent`/`tracestate` semantics and size limits (`tracestate` ≤ 512 bytes) are verified against the W3C Recommendation current as of 2026-09-30. Anything beyond the two fields (`tracestate` reserved-byte grammar details, span-id exclusion of all-zero) was not exercised against an implementation here — consult the spec text directly for interop work.
- W3C `Baggage` has looser semantics than `tracestate` and vendors vary on how aggressively they ingest it into logs/spans. Confirm *your* collector lifts `Baggage` into `Span.attributes` before relying on that lift.
- "Traceparent loss at queue boundaries" is a real-world failure mode consistent with the spec's transport model; the concrete break (per-worker-log dead-end) is industry consensus and not directly quoted from a primary source.