---
title: "A no-op SDK satisfies every API contract while recording nothing"
rule_id: "RULE-TELEMETRY-002"
category: "correctness"
scope: "backend"
applies_to: "OpenTelemetry no-op implementation, TracerProvider, MeterProvider, missing SDK, uninstalled instrumentation, silent telemetry loss"
last_updated: "2026-10-04"
source: "https://opentelemetry.io/docs/specs/otel/metrics/noop/index.md, https://opentelemetry.io/docs/specs/otel/performance/index.md"
---

# A no-op SDK satisfies every API contract while recording nothing

This is the mechanism behind every "our traces disappeared" incident that has no incident. The API
specification *requires* that a no-op implementation be available. Every method is then required to
do nothing — successfully. Nothing throws, nothing warns, and the process exits 0.

## Why

> MUST provide a No-Op.
> ([OpenTelemetry Metrics No-op](https://opentelemetry.io/docs/specs/otel/metrics/noop/index.md))

> The No-Op MUST allow the creation of multiple MeterProviders. The MeterProviders created by the
> No-Op needs to hold as small a memory footprint as possible. Therefore, all MeterProviders
> created MUST NOT hold configuration or operational state. Since all MeterProviders hold the same
> empty state, a No-Op MAY provide the same MeterProvider instances to all creation requests.
> ([OpenTelemetry Metrics No-op](https://opentelemetry.io/docs/specs/otel/metrics/noop/index.md))

"MUST NOT hold configuration or operational state" is the sentence that matters operationally. A
no-op provider *cannot* report that it is a no-op, because reporting is state. So the failure state
is indistinguishable from the success state at the type level: `Counter.add(1)` returns, the
program continues, and no metric exists.

That also breaks the obvious audit. Reading back the provider's configuration in a health check
proves nothing — the specification requires that a no-op hold no configuration, so an empty
configuration is exactly what a missing SDK produces.

The performance contract explains the design is deliberate rather than an oversight:

> Incomplete asynchronous I/O tasks or background tasks may consume memory to preserve their state.
> In such a case, there is a trade-off between dropping some tasks to prevent memory starvation and
> keeping all tasks to prevent information loss.
> ([OpenTelemetry Performance](https://opentelemetry.io/docs/specs/otel/performance/index.md))

The standard is explicitly trading telemetry for application stability. The consequence for review:
"the instrumentation never degrades the app" is a design *goal*, so a total telemetry outage is a
behaviour the SDK is permitted to exhibit without any signal.

## Do

- Prove instrumentation is live with a canary: emit a span or increment a counter on a known code
  path and assert it is queryable in the backend.
- Assert the SDK package is actually a dependency of the deployed artifact, not only of the
  workspace. A dev dependency, or a package present in a base image the production build does not
  use, both produce a no-op.
- Put one canary check in CI or a startup assertion, so the failure surfaces at deploy time rather
  than during an incident.
- Check whether the language SDK swaps in a no-op when its exporter cannot be constructed — a
  misconfigured endpoint is a common path to the same silent state.

## Don't

- Don't verify telemetry by inspecting provider configuration. The no-op is required to have none.
- Don't treat "the instrumented code ran without error" as evidence that telemetry was recorded.
  Both states are exit 0.
- Don't assume an installed package means an active provider. The API works either way.
- Don't debug a missing-traces incident by reading application logs — by definition there is
  nothing in them.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| No traces, no errors, exit 0 | No-op provider in use | Canary check against the backend |
| Works locally, absent in prod | SDK is a dev dependency | Assert the runtime dependency |
| Health check reports empty config | No-op holds no config by spec | Check a canary, not config |
| Telemetry vanishes under load | Task dropping is permitted by design | Bound cardinality and buffer size |
| Metric increments "do nothing" | `Meter` from a no-op provider | Assert the counter is queryable |

## Verifying

```bash
# 1. Is the SDK a real runtime dependency of what ships?
#    Dev-only or test-only placement both yield a no-op at runtime.
grep -rnE '"(dependencies|require-dependencies)"' --include=package.json --include=pyproject.toml \
  --include=*.gemspec --include=pom.xml --include=go.mod . | head

# 2. Is a provider constructed at all, and is the SDK imported from the
#    runtime path rather than only from a helper or a test?
grep -rniE 'TracerProvider|MeterProvider|get_tracer|get_meter|NodeTracerProvider' \
  --include=*.ts --include=*.js --include=*.py --include=*.go --include=*.java . | head -20

# 3. Behavioural, and this is the one that counts: emit a canary span or
#    increment a canary counter, then query the backend for it.
#    A no-op provider passes every step above and fails this one.
```

What this check cannot see: nothing static can. A fully instrumented codebase that never constructs
a provider — or that constructs one after a failed exporter setup, where many SDKs fall back to the
no-op — looks identical to a working one under every source-level inspection. That is the property
the specification builds in, deliberately. The canary is not an optional extra for this rule; it
is the only check that distinguishes the two states, and it has to run against the deployed
artifact rather than a developer's machine.