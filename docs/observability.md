---
language: "Observability & Telemetry"
tag: "observability"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub for OpenTelemetry instrumentation, sampling, attribute limits, and W3C trace propagation rules."
---

# Documentation Hub: Observability & Telemetry

> **Agent Directive (Phase 4)**: Evaluate this hub for any project that installs an
> OpenTelemetry SDK, ships traces or metrics to a collector, or propagates `traceparent`.
> Its central claim is that **telemetry fails silently by specification** — every rule here
> describes a mechanism that is permitted to succeed while recording nothing — so the default
> evidence offered by a project ("instrumentation is configured") is not evidence.
>
> **Triggers**: `@opentelemetry/*` or `opentelemetry-sdk`, `opentelemetry-*` in `pom.xml` /
> `go.mod` / `pyproject.toml` / `requirements.txt`; an OTLP or `otel-collector` config; a
> `TracerProvider` / `MeterProvider` construction; a `traceparent` / `tracestate` read or write;
> `jaeger-client`, `zipkin`, `datadog-trace`, `sentry-sdk` with tracing enabled.
>
> **Status**: six rules and one decision matrix. One establishes the carrier (W3C trace context
> and `Baggage`); five cover the mechanisms whose failure is invisible: the no-op SDK that
> satisfies every call, the `AttributeValueLengthLimit` default of `Infinity`, a ratio sampler
> that discards the upstream decision, a missing shutdown that loses the last batch, and a
> malformed header that receivers are required to ignore. The matrix orders the seven checks by
> what they actually catch, because row 1 gates the rest.
>
> Anchored on the **OpenTelemetry specification** (trace SDK, metrics no-op, performance
> guidelines) and **W3C Trace Context**. This hub routes `rules/observability/*` and
> `shared/observability/*`; the correlation rule is also routed by `docs/backend-architecture.md`,
> which reaches it from the architecture side rather than the telemetry side.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/observability/correlation-ids-are-just-trace-ids-plus-propagated-fields.md`
  - **Why**: A bespoke `X-Correlation-Id` solves logging and creates two costs — every
    middleware between ingress and datastore has to be taught to propagate it (miss one and the
    trail breaks silently at that hop), and the log-joining query becomes a per-project custom
    join. W3C Trace Context exists to end this, and every tracing vendor already ingests it. The
    subtlety it keeps: `tracestate` is vendor state in a 512-byte box, while business identifiers
    belong in W3C `Baggage`.
  - **When**: Target project invents, threads, or re-parses a correlation/request id of its own, or
    a trace stops at a queue boundary because the consumer starts a fresh one.
  - **Target Location**: `docs/rules/observability/correlation-ids-are-just-trace-ids-plus-propagated-fields.md`

- **Path**: `rules/observability/noop-sdk-satisfies-every-call-silently.md`
  - **Why**: The API specification *requires* a no-op implementation, and requires it to hold no
    configuration or operational state — so it cannot report that it is a no-op, because reporting
    is state. `Counter.add()` returns, the program continues, and no metric exists. This also
    breaks the obvious audit: an empty provider configuration is exactly what a missing SDK
    produces, so config review verifies nothing. The performance guidelines make the trade
    explicit — dropping tasks is permitted so telemetry can never degrade the app.
  - **When**: Target project has instrumentation in source and no positive check that it emits, or
    a review cites provider configuration as proof that telemetry is live.
  - **Target Location**: `docs/rules/observability/noop-sdk-satisfies-every-call-silently.md`

- **Path**: `rules/observability/attribute-value-length-limit-defaults-to-infinity.md`
  - **Why**: The three span attribute limits have defaults that do not match most people's
    assumption — `AttributeCountLimit` is 128, `AttributeValueDepthLimit` is 64, and
    `AttributeValueLengthLimit` is **`Infinity`**. Only the first is bounded by default, so an
    unbounded string attribute is a memory finding, not a truncation. Resource attributes are
    supposed to be exempt, and dropped-attribute counts must be visible to exporters — which is
    the only signal that a limit fired.
  - **When**: Target project sets attribute limits at all, puts user-controlled or serialized data
    into span attributes, or reports that attribute limits are configured without naming a value.
  - **Target Location**: `docs/rules/observability/attribute-value-length-limit-defaults-to-infinity.md`

- **Path**: `rules/observability/traceidratiobased-ignores-the-parent-sampled-flag.md`
  - **Why**: `TraceIdRatioBased` MUST ignore the parent `SampledFlag` and is meant as a delegate
    of `ParentBased`, whose root defaults to `AlwaysOn`. Set as the root sampler, it discards the
    upstream decision in both directions: sampled traces get a missing middle, upstream drops get
    re-sampled. Nothing errors — the traces that arrive are well-formed, and the error is in the
    coverage of the *set*. The spec is also mid-deprecation, instructing SDKs to *silently*
    replace the sampler with `ProbabilitySampler` after 2027-01-01.
  - **When**: Target project configures head sampling on a service that receives propagated
    context, or reads a partial trace as evidence about the hops that are absent from it.
  - **Target Location**: `docs/rules/observability/traceidratiobased-ignores-the-parent-sampled-flag.md`

- **Path**: `rules/observability/shutdown-must-be-called-exactly-once.md`
  - **Why**: `Shutdown` MUST be called only once per provider, and post-shutdown `Tracer` fetches
    return a no-op rather than an error — so code holding a tracer obtained afterwards accepts
    every call and produces no span. Whether shutdown *succeeded* is only `SHOULD`-reported, so
    an uninspected return leaves failure and success indistinguishable. `ForceFlush` is only
    `SHOULD`-bounded by a timeout; a blocking flush in a SIGTERM handler hangs past the grace
    period, gets SIGKILLed, and loses the batch with an exit status that looks unrelated.
  - **When**: Target project has no SIGTERM handler, or has a flush with no timeout, or fetches
    tracers lazily after startup.
  - **Target Location**: `docs/rules/observability/shutdown-must-be-called-exactly-once.md`

- **Path**: `rules/observability/trace-flags-are-the-only-cross-vendor-channel.md`
  - **Why**: W3C Trace Context is the only interop contract in the stack, and it is narrow by
    design. An all-zero `trace-id` is forbidden and version `ff` is invalid; in both cases the
    required receiver behaviour is to *ignore* the whole header, so a malformed write propagates as
    "no traces" and never as a parse error at the sender. Only one bit of the two-hex-digit
    trace-flags byte is defined — it is the entire cross-vendor sampling channel, and custom flags
    added there are not interop.
  - **When**: Target project builds or transforms a `traceparent` by hand, or traces disappear at
    exactly one hop.
  - **Target Location**: `docs/rules/observability/trace-flags-are-the-only-cross-vendor-channel.md`

## 2. Skills (`skills/`)

_Empty — no observability workflows synthesized yet._

## 3. Agents (`agents/`)

_Empty — the guidance here is per-mechanism and does not warrant a persona._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/observability/instrumentation-coverage-decision-matrix.md`
  - **Why**: The five rules above are one question asked per signal — how do I know this
    instrumentation is running, and what happens when it is not. The matrix turns that into
    seven rows (provider, attribute limits, sampler composition, shutdown and flush, header
    propagation across hops, metrics provider, logs↔traces) with the check that settles each, and
    states the ordering: **row 1 gates every other row**, because a config check run against a
    no-op provider has verified nothing. It also names the boundary the application cannot
    cross — whether the collector dropped the data.
  - **When**: Target project is adding or reviewing telemetry, or an incident involves a signal
    that vanished with no accompanying error.
  - **Target Location**: `docs/observability/instrumentation-coverage-decision-matrix.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must commit the file in the
same push that updates this hub — otherwise consumers get a 404. Run `node scripts/check-manifests.mjs`.