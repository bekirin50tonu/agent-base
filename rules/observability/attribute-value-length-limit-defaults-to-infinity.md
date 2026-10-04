---
title: "Attribute length defaults to unlimited; only the count is bounded"
rule_id: "RULE-TELEMETRY-001"
category: "performance"
scope: "backend"
applies_to: "OpenTelemetry SDK, span attributes, resource attributes, AttributeValueLengthLimit, AttributeCountLimit, cardinality, OOM"
last_updated: "2026-10-04"
source: "https://opentelemetry.io/docs/specs/otel/common/index.md, https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md"
---

# Attribute length defaults to unlimited; only the count is bounded

Attribute limits are the guardrail between "an instrumented service" and "a service that exhausts
memory under load." Two of the three ship with defaults. The third — the one bounding the *size* of
a single value rather than how many there are — defaults to `Infinity`, and that asymmetry is the
whole finding.

## Why

The specification states the failure mode first, then prescribes the remedy:

> Execution of erroneous code can result in unintended attributes. If there are no limits placed on
> attribute collections, they can quickly exhaust available memory, resulting in crashes that are
> difficult to recover from safely.
> ([OpenTelemetry Common](https://opentelemetry.io/docs/specs/otel/common/index.md))

> By default an SDK SHOULD apply truncation as per the list of configurable parameters below.
> ([OpenTelemetry Common](https://opentelemetry.io/docs/specs/otel/common/index.md))

But the configured defaults are not symmetric:

> `AttributeCountLimit` (Default=128) - Maximum allowed attribute count per record;
> `AttributeValueLengthLimit` (Default=Infinity) - Maximum allowed attribute value length (applies
> to string values and byte arrays); `AttributeValueDepthLimit` (Default=64) - Maximum allowed
> attribute value depth (applies to arrays and maps);
> ([OpenTelemetry Common](https://opentelemetry.io/docs/specs/otel/common/index.md))

So the shipped configuration truncates your 129th attribute and your 65th nesting level, and
passes an unbounded string straight through. A span attribute carrying a request body, a stack
trace, or a serialized object therefore produces no truncation event, no warning, and no
dropped-attribute counter until the process is killed.

The exemption compounds it, and is easy to misread as a loophole:

> Resource attributes SHOULD be exempt from the limits described above as resources are not
> susceptible to the scenarios (auto-instrumentation) that result in excessive attributes count or
> size. Resources are also sent only once per batch instead of per span so it is relatively cheaper
> to have more/larger attributes on them.
> ([OpenTelemetry Common](https://opentelemetry.io/docs/specs/otel/common/index.md))

Resource attributes are exempt — and they are the ones a human sets by hand, typically from
environment variables, once per process. That is exactly where unbounded user-supplied strings
enter.

The mitigation the spec points at is reporting, and almost nobody wires it up:

> dropped due to collection limits MUST be available for exporters to report as described in the
> exporters specification.
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

## Do

- Set `AttributeValueLengthLimit` to a finite number explicitly. Do not rely on the default.
- Read the limit from the *running* SDK, not from the config file — several languages accept the
  environment variable under different names.
- Watch the dropped-attributes counter the exporter is required to expose.
- Keep identifiers, not payloads, in attributes: user IDs, order IDs, template names.
- Bound resource attributes explicitly too, since the exemption means no one else will.

## Don't

- Don't put a request body, response body, stack trace, or SQL dump in an attribute. These are the
  direct producers of the OOM the limit exists to prevent.
- Don't infer safety from `AttributeCountLimit=128` being respected. That says nothing about value
  size.
- Don't rely on truncation to be reported in the application log. The counter is an exporter
  field, not a log line.
- Don't treat the resource-attribute exemption as permission to load unbounded config into
  resource attributes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| OOM under load, correlates with a new attribute | `AttributeValueLengthLimit=Infinity` | Set a finite limit |
| Service dies only at high traffic | Large attributes only on rare paths | Bound value length; drop payloads |
| Unbounded string from env into resource attrs | Resource exemption relied on | Bound resource attributes yourself |
| Truncation invisible | Dropped counter not consumed | Read the exporter's dropped-attribute count |
| 129th attribute missing | `AttributeCountLimit` working as specified | Expected; raise the limit deliberately |

## Verifying

```bash
# 1. What is configured? Note: config presence != effective value.
grep -rniE 'AttributeValueLengthLimit|OTEL_ATTRIBUTE|OTEL_SPAN_ATTRIBUTE|attribute_value_length' \
  --include=*.env --include=*.yaml --include=*.yml --include=*.json \
  --include=*.py --include=*.ts --include=*.go --include=*.java . | head -20

# 2. Observational, and this is the check that counts: print the limits the
#    running SDK reports. An unset AttributeValueLengthLimit reads as Infinity.
#
# 3. Read the exporter's dropped-attribute count. Zero while you expect
#    truncation means the limit is not applied, not that nothing overflows.
```

What this check cannot see: grep proves a limit was *declared*, not that it is *in effect*. The
same configuration can apply different defaults per language SDK and per signal — the common spec
resolves general and model-specific limits with a defined precedence, and a signal-specific limit
wins over the general one. Only the value the running SDK reports settles it. The behaviour that
actually matters — memory growth under load — cannot be seen from configuration at all, and the
dropped-attribute counter is the only early signal, which is why it must be consumed rather than
merely available.