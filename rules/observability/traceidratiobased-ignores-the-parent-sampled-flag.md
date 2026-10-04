---
title: "`TraceIdRatioBased` ignores the parent's sampled flag by design"
rule_id: "RULE-TELEMETRY-003"
category: "correctness"
scope: "backend"
applies_to: "OpenTelemetry sampler, TraceIdRatioBased, ParentBased, ProbabilitySampler, SampledFlag, tail sampling, partial traces"
last_updated: "2026-10-04"
source: "https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md"
---

# `TraceIdRatioBased` ignores the parent's sampled flag by design

Sampling configuration has a trap that produces coherent-looking traces with missing halves: a
ratio-based sampler set at the *root* discards the upstream decision. The specification mandates
this behaviour, and the fix is composition — which is exactly what a team under cost pressure does
not add.

## Why

> The default sampler is `ParentBased(root=AlwaysOn)`.
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

> The `TraceIdRatioBased` MUST ignore the parent `SampledFlag`. To respect the parent `SampledFlag`,
> the `TraceIdRatioBased` should be used as a delegate of the `ParentBased` sampler specified below.
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

So a service configured with `TraceIdRatioBased{0.01}` as its root sampler ignores the upstream
service's decision entirely. Two consequences follow, and both are silent:

1. If the upstream service sampled the trace, this service samples it anyway — at 1%. The trace
   exists with a missing middle, which reads downstream as "that service had no traffic" or "that
   service was fast."
2. If the upstream service deliberately dropped the trace, this service samples it — so the
   sampled set is not the set that was designed upstream.

Neither produces an error, a counter, or a log line. The traces that arrive are individually
well-formed; it is the coverage of the trace *set* that is wrong.

The specification is also mid-deprecation, which matters for version pinning:

> OpenTelemetry SDK implementors SHALL NOT remove or modify the behavior of the original
> `TraceIdRatioBased` sampler until at least January 1, 2027. At that time, SDK implementors are
> encouraged to silently replace TraceIdRatioBased configuration with an equally-configured
> `ProbabilitySampler`.
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

"silently replace" is the specification's own word. A config file written today keeps working after
the SDK upgrade while meaning something subtly different, and the migration produces no log line.

## Do

- Compose the ratio sampler as a *delegate* of `ParentBased`, never as the root sampler directly,
  when traces cross service boundaries.
- Keep the default `ParentBased(root=AlwaysOn)` at the edge and do sampling where you can see the
  whole trace — that is the point of tail-based sampling.
- Read the sampler's description string, which the spec requires to state its form. That is a
  cheaper check than reasoning about a config file.
- If you must sample early, sample *everything* downstream and let a backend discard — head
  sampling makes the sampled set a biased sample of its own traces.
- Pin the SDK version while `TraceIdRatioBased` is in play, or migrate deliberately to
  `ProbabilitySampler`.

## Don't

- Don't set `TraceIdRatioBased` as the root sampler on a service that receives propagated context.
- Don't read a partial trace as evidence about the unsampled hops. It is evidence about the ones
  that happened to be sampled.
- Don't conclude the sampler is safe because traces arrive and look complete. The failure is a
  statistical hole, not a gap in one trace.
- Don't upgrade an SDK mid-deployment and assume sampling behaviour is unchanged.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Traces with a missing middle service | Ratio sampler used as root | Compose under `ParentBased` |
| Upstream drop overridden downstream | Parent flag ignored by design | Delegate inside `ParentBased` |
| Sample set differs from design | Head sampling biases which traces exist | Tail-sample at the backend |
| Behaviour shifts after an upgrade | Silent `ProbabilitySampler` replacement | Pin version; migrate deliberately |
| Sampler looks configured but is not | Config read, effective sampler not | Read the description string |

## Verifying

```bash
# 1. How is the sampler constructed? A bare ratio sampler as root is the finding.
grep -rniE 'TraceIdRatioBased|ParentBased|AlwaysOn|AlwaysOff|ProbabilitySampler|sampler' \
  --include=*.ts --include=*.js --include=*.py --include=*.go \
  --include=*.java --include=*.yaml --include=*.yml --include=*.json . | head -20

# 2. Read the effective sampler's description string at runtime. The spec
#    requires a form like "ParentBased{root=TraceIdRatioBased{0.010000}}";
#    a bare "TraceIdRatioBased{...}" is the misconfiguration, stated plainly.
#
# 3. Observational: send a trace that upstream sampled, confirm this service
#    records it at the configured ratio rather than always.
```

What this check cannot see: no configuration file reveals the *composed* sampler, because the
composition happens in code and several SDKs assemble it from environment variables that are not
printed anywhere by default. The description string is the closest thing to ground truth the
specification provides, and it must be read from the running provider. Statistical coverage claims
are worse: "we saw traces from that service" is not a test, because the whole failure mode is that
you see traces and miss the ones you did not.