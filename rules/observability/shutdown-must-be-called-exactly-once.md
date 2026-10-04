---
title: "`Shutdown` must be called exactly once — and skipping it loses the last batch"
rule_id: "RULE-TELEMETRY-004"
category: "correctness"
scope: "backend"
applies_to: "OpenTelemetry shutdown, ForceFlush, SIGTERM handler, BatchSpanProcessor, graceful shutdown, lost telemetry at exit"
last_updated: "2026-10-04"
source: "https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md"
---

# `Shutdown` must be called exactly once — and skipping it loses the last batch

Telemetry is lost at process exit far more often than in transit. The shutdown contract is precise,
and the common implementation — a signal handler that does not exist, or a flush with no timeout —
satisfies every API requirement while dropping the last batch on the floor.

## Why

> This method provides a way for provider to do any cleanup required. `Shutdown` MUST be called only
> once for each `TracerProvider` instance. After the call to `Shutdown`, subsequent attempts to get a
> `Tracer` are not allowed. SDKs SHOULD return a valid no-op Tracer for these calls, if possible.
> `Shutdown` SHOULD provide a way to let the caller know whether it succeed...
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

Read the combination together, because each clause creates a distinct silent path:

- Shutdown is **single-use**. Calling it twice is a contract violation, and the spec's remedy for
  the second call is to hand back a no-op `Tracer` — which records nothing.
- Calls after shutdown are **not an error**. They are quietly downgraded. Code holding a `Tracer`
  obtained after shutdown accepts every call and produces no span.
- Whether it **succeeded is only `SHOULD`**-reported. A failed shutdown and a successful one look
  the same unless the return value is inspected.

The flush contract has the same shape, including the part that causes hangs:

> This method provides a way for provider to immediately export all spans that have not yet been
> exported for all the internal processors. `ForceFlush` SHOULD provide a way to let the caller know
> whether it succeeded, failed or timed out. `ForceFlush` SHOULD complete or abort within some
> timeout. `ForceFlush` can be implemented as a blocking API or an asynchronous A...
> ([OpenTelemetry Trace SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/index.md))

"SHOULD complete or abort within some timeout" is a recommendation, not a guarantee. A blocking
`ForceFlush` in a SIGTERM handler with no timeout is the classic version: the process hangs past
its termination grace period, the platform sends SIGKILL, and the batch is lost — with an exit
status that looks like an ordinary kill rather than a telemetry failure.

## Do

- Register a SIGTERM handler that calls `ForceFlush` with an explicit timeout, then `Shutdown`,
  then exits.
- Inspect both return values. The spec only recommends telling you; treat an uninspected return as
  an unverified assumption.
- Budget the flush against the platform's kill grace period, not against what flush "should" take.
- Fetch and cache `Tracer` instances *before* shutdown. Anything created afterwards is a no-op by
  specification.
- Guard the handler so shutdown runs once — signal handlers can fire twice under some supervisors.

## Don't

- Don't rely on process exit to flush. The last batch is exactly what a batching processor has not
  sent yet.
- Don't call `Shutdown` and then construct new telemetry. It will not error; it will discard.
- Don't flush without a timeout in a signal handler.
- Don't treat a clean exit code as evidence telemetry was exported. A SIGKILL after a hung flush
  exits non-zero for an unrelated reason, and a skipped handler exits zero having exported nothing.
- Don't register shutdown on only one of several providers — each instance needs it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Last batch missing on every deploy | No flush on SIGTERM | Handler: flush with timeout, then shutdown |
| Process hangs on termination | Blocking flush, no timeout | Pass an explicit timeout |
| Telemetry vanishes after shutdown in code | `Tracer` fetched post-shutdown | Cache tracers before shutdown |
| Shutdown handler runs twice | Signal delivered twice | Guard with a once-flag |
| Exit code normal, no traces exported | Handler absent entirely | Add it; assert canary spans at exit |

## Verifying

```bash
# 1. Is a shutdown/flush handler registered at all?
grep -rniE 'SIGTERM|signal\.signal|addEventListener\(.?terminate|atexit|ForceFlush|force_flush|shutdown\(' \
  --include=*.ts --include=*.js --include=*.py --include=*.go --include=*.java . | head -20

# 2. Does the handler pass a timeout, and does it inspect the result?
#    An uninspected return value leaves a failed flush indistinguishable
#    from a successful one.

# 3. Observational, and this is the one that counts: send SIGTERM, then count
#    spans that were exported versus spans that were created. A gap equal to
#    the batch size is the finding.
```

What this check cannot see: whether a flush completed is a property of the export path at the
moment of termination, and it is invisible to every static check. A handler that exists, passes a
timeout, and inspects its result can still lose the batch if the termination grace period is
shorter than the export latency — and that is only visible by comparing spans created against
spans exported across a real SIGTERM. Note also that the SIGKILL case is invisible by definition:
there is no handler left running to report it.