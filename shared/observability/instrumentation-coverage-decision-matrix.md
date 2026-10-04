---
title: "Instrumentation Coverage — Decision Matrix"
category: "architecture"
applies_to: "Any service adding or reviewing OpenTelemetry instrumentation, where telemetry presence is inferred from absence of errors rather than from a positive signal"
last_updated: "2026-10-04"
source: "https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md, https://opentelemetry.io/docs/specs/otel/metrics/noop/index.md"
---

# Instrumentation Coverage — Decision Matrix

The five telemetry rules are one question asked per signal: **how do I know this instrumentation is
actually running, and what happens when it is not?** The default answer for every mechanism here is
silent absence — the instrumented path returns successfully and records nothing.

## When to Use

- OpenTelemetry (or any telemetry SDK) is being added to a service, and the design has no positive
  check that telemetry is live.
- A review says "traces are configured" and configuration is the only evidence offered.
- An incident is being investigated where a signal disappeared with no accompanying error — the
  shape most telemetry failures actually take.
- Instrumentation exists in the codebase but nobody can say whether it emits, and the question has
  never been settled with a test.
- A language SDK's fallback behaviour is unknown for the deployed artifact, as opposed to a
  developer's machine.

## The matrix

| Signal | What must be true | The silent failure | The check that settles it |
|---|---|---|---|
| Traces | A real (non-no-op) `TracerProvider` is installed | No-op provider; every span accepted and dropped | Canary span, asserted queryable in the backend |
| Traces | `AttributeValueLengthLimit` set to a finite number | Defaults to `Infinity`; unbounded attribute → OOM | Read the limit from the running SDK |
| Traces | Sampler composed under `ParentBased` | Ratio sampler as root discards the upstream decision | Read the effective sampler description |
| Traces | `ForceFlush` + `Shutdown` on SIGTERM, with a timeout | Last batch lost; flush hangs; exit code looks normal | SIGTERM, then compare created vs exported spans |
| Traces | `traceparent` propagated verbatim, per hop | All-zero id or unknown version → receiver MUST ignore | Assert a valid header at each hop |
| Metrics | A real `MeterProvider` | `Counter.add()` returns, nothing is recorded | Canary counter, asserted queryable |
| Logs ↔ Traces | `traceparent` crosses queue boundaries too | Reconstructed by hand; all-zero id at the consumer | Assert the header on the consumed message |

## Ordering

Rows are not independent. **Row 1 gates every other row.** A project that checks its attribute
limits or its sampler configuration on a no-op provider has verified nothing, because the
specification requires a no-op provider to hold no configuration or operational state — the
configuration it appears to display is not there.

The three highest-value checks, in the order that catches the most:

1. **Is it running?** (rows 1, 6) One canary span and one canary counter, asserted in the backend.
2. **Is it bounded?** (row 2) A finite attribute length limit, read from the running SDK.
3. **Does it survive the hop?** (rows 4, 5, 7) Shutdown behaviour and header propagation, checked
   against the deployed topology.

## What every row has in common

The same failure shape appears in all seven, and it is the reason this domain needs a matrix rather
than a config review:

> Every mechanism here fails silently and successfully. A no-op SDK satisfies every API contract
> while recording nothing; an unlimited attribute limit truncates nothing and reports nothing; a
> ratio sampler discards the upstream decision without a counter; a missed shutdown loses the last
> batch with a normal exit code; a malformed header is ignored by a receiver that is required to
> ignore it.

None of these raise, log, or change an exit code. Each is individually permitted by the
specification — the standard deliberately trades telemetry for application stability. The
consequence for a reviewer is that **configuration review cannot distinguish an instrumented
service from an uninstrumented one**, because in the uninstrumented case there is nothing to
review.

## What the matrix cannot tell you

Whether the *collector* or backend is dropping data is a property of the deployment, not of the
application. Every row above settles "the application emitted what it should"; none settles "the
data arrived." That boundary needs its own evidence — and the same canary mechanism that
establishes row 1 is what makes the collector-side drop visible, because a canary that stops
appearing with no application-side change points downstream rather than at the instrumented code.