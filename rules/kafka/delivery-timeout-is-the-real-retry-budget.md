---
title: "`delivery.timeout.ms` must exceed `request.timeout.ms` + `linger.ms`"
rule_id: "RULE-KAFKA-007"
category: "correctness"
scope: "all"
applies_to: "delivery.timeout.ms, request.timeout.ms, linger.ms, retries, TimeoutException, replica.lag.time.max.ms"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/producer-configs/"
---

# `delivery.timeout.ms` must exceed `request.timeout.ms` + `linger.ms`

`retries` counts attempts. It cannot express a wall-clock bound, and the doc says so. What expresses
the bound is `delivery.timeout.ms` — and it is constrained by two other settings whose defaults
already violate it once you tune either.

## Why

> Users should generally prefer to leave this config unset and instead use delivery.timeout.ms to
> control retry behavior.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

What `retries` cannot express is *how long*: a count against brokers with variable latency gives no
deadline. The bound is a different setting:

> An upper bound on the time to report success or failure after a call to send() returns. This
> limits the total time that a record will be delayed prior to sending, the time to await
> acknowledgement from the broker (if expected), and the time allowed for retriable send failures.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

```
delivery.timeout.ms   DEFAULT: 120000 (2 minutes)
request.timeout.ms    DEFAULT: 30000 (30 seconds)
linger.ms             DEFAULT: 5
```

Those defaults satisfy the constraint. Tuning breaks it:

> The value of this config should be greater than or equal to the sum of request.timeout.ms and
> linger.ms.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

The arithmetic is: a record can spend up to `linger.ms` waiting for batch accumulation and up to
`request.timeout.ms` awaiting the response, and the delivery timeout covers the whole span. Set
`linger.ms=500` for throughput, leave the other two at defaults, and `500 + 30000` is still under
`120000` — fine. Raise `request.timeout.ms` to 120000 for a slow broker and `120000 + 5` exceeds the
delivery budget: the record is declared failed before the client has finished waiting for a response
that would have succeeded. The signature is a `TimeoutException` rate that gets *worse* when you tune
`linger.ms` further for throughput — the setting intended to help is what pushes it over.

The same family of constraint runs the other way:

> This should be larger than replica.lag.time.max.ms (a broker configuration) to reduce the
> possibility of message duplication due to unnecessary producer retries.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

A `request.timeout.ms` shorter than the broker's replica lag causes the client to give up and retry a
request that was still in progress — duplication, not loss.

## Do

- State the invariant where the values live, and check it: `delivery.timeout.ms >= request.timeout.ms
  + linger.ms`.
- Tune `delivery.timeout.ms` as the outer bound and let retries follow from it, rather than counting
  attempts.
- Keep `request.timeout.ms` comfortably *above* the broker's `replica.lag.time.max.ms`. Read that
  value from the broker rather than assuming it.
- Assert the invariant at startup — it is three lines and it converts a production `TimeoutException`
  rate into a boot failure.
- Alert on the delivery-timeout rate specifically. It is the metric that distinguishes "the broker is
  slow" from "our budget is too small for what we ask of it".

## Don't

- Don't raise `request.timeout.ms` without re-checking `delivery.timeout.ms`. That is the exact
  sequence that produces the failure.
- Don't tune `linger.ms` upward to fix a timeout problem. Batching delay is *inside* the budget the
  timeout enforces; increasing it eats the budget.
- Don't set `delivery.timeout.ms` very large as a general fix. The record's effective latency
  becomes the timeout, and callers inherit it.
- Don't interpret a `TimeoutException` as "the broker is down". Check whether the arithmetic holds
  before blaming the cluster.
- Don't copy `retries` values between services without checking that the sibling configs still
  satisfy the sum.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TimeoutException` rising after tuning | `delivery.timeout.ms < request.timeout.ms + linger.ms` | Raise `delivery.timeout.ms` |
| Timeouts worse with more batching | Larger `linger.ms` eats the budget | Lower `linger.ms` or raise the timeout |
| Duplicate records on a slow broker | `request.timeout.ms < replica.lag.time.max.ms` | Raise `request.timeout.ms` |
| Retry loop with no progress | Retries exhaust before any response | Fix the timeout arithmetic first |
| Latency equals the timeout value | Timeout is the effective latency budget | Tune batch and broker, not the ceiling |
| Works in staging, fails in production | Broker lag time differs by environment | Read the broker value per environment |

## Verifying

```bash
# 1. The three values the invariant spans
grep -rnE '^\s*(delivery\.timeout\.ms|request\.timeout\.ms|linger\.ms)\s*[:=]' \
  --include=*.properties --include=*.yaml --include=*.yml . | sort | head -20

# 2. The invariant itself, computed from the file rather than assumed
#    for f in $(find . -name '*.properties' -o -name '*.yml'); do
#      d=$(grep -oP 'delivery\.timeout\.ms[=: ]\K[0-9]+' "$f" | head -1); r=$(...); l=$(...)
#      [ -n "$d" ] && [ "$d" -lt $((r + l)) ] && echo "VIOLATION: $f ($d < $r + $l)"
#    done

# 3. The broker side of the second constraint:
#    kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers \
#      --entity-name 1 --describe --all | grep replica.lag.time.max.ms

# 4. The observed rate:
#    kafka producer metrics: record-retry-total, request-latency-avg
```

What this check cannot see: the file tells you the declared values; it cannot tell you the broker's
`replica.lag.time.max.ms`, which is a per-broker setting and often differs between environments — that
is why step 3 queries the broker instead of assuming a number. Step 4 distinguishes the two
directions: a high retry count with healthy request latency points at the budget arithmetic, while
high latency with few retries points at the broker. Neither grep nor the config file can observe what
the producer actually did; only the client metrics and the broker config settle it.