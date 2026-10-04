---
title: "`max.poll.records` is a time budget: 500 records against a 5-minute poll interval"
rule_id: "RULE-KAFKA-004"
category: "concurrency"
scope: "all"
applies_to: "max.poll.records, max.poll.interval.ms, poll loop, rebalance, consumer lag, backpressure"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/consumer-configs/"
---

# `max.poll.records` is a time budget: 500 records against a 5-minute poll interval

Two defaults interact and neither names the problem: the consumer must finish a 500-record batch
*and* call `poll()` again within 5 minutes. That is 600 ms per record. Exceed it and you are not
getting an error — you are being evicted from the group, repeatedly.

## Why

```
max.poll.records       DEFAULT: 500
max.poll.interval.ms   DEFAULT: 300000 (5 minutes)
```

> The maximum number of records returned in a single call to poll().
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

> The maximum delay between invocations of poll() when using consumer group management. This places
> an upper bound on the amount of time that the consumer can be idle before fetching more records.
> If poll() is not called before expiration of this timeout, then the consumer is considered failed
> and the group will rebalance in order to reassign the partitions to another member.
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

The contract is a deadline, and the batch size is what you must fit inside it. A consumer making one
downstream HTTP call per record at 800 ms misses it. The consequence chain:

1. the consumer is considered failed,
2. the group rebalances,
3. partitions move to another member,
4. that member runs the same code, is also slow, and also misses it,
5. the group rebalances again.

A rebalance storm caused by nothing more than an arithmetic nobody wrote down. Every member is
healthy; they are being evicted for being slow, and the churn guarantees the slowness persists.

Lowering `max.poll.records` is the right lever, and the doc is explicit that it does not reduce
buffering:

> Note, that max.poll.records does not impact the underlying fetching behavior. The consumer will
> cache the records from each fetch request and returns them incrementally from each poll.
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

It reduces how much you must *finish* per cycle — exactly the quantity the deadline constrains.

With `enable.auto.commit` also on its default, this compounds: offsets commit while the slow member
is being evicted, so the work is both slow *and* unrecorded. See `RULE-KAFKA-002`.

## Do

- Do the division before choosing either value: `max.poll.interval.ms / max.poll.records` is the
  per-record budget. Write the number down in the config file next to the setting.
- Lower `max.poll.records` so the budget exceeds your worst-case per-record cost with headroom —
  p99, not the median.
- Track p99 of "time from `poll()` returning to next `poll()`" as a metric. It is the quantity the
  broker enforces, and nothing in the application reports it by default.
- Process a *prefix* of the batch and commit that prefix, then return. The remainder is re-delivered
  as ordinary at-least-once, which converts an eviction into a redelivery.
- Raise `max.poll.interval.ms` where the work is legitimately long — a batch ETL step, an embedding
  call — understanding it lengthens the time the group takes to notice a genuinely dead consumer.
- Prefer `pause()`/`resume()` and a deadline check over a blocking sleep inside the poll loop.

## Don't

- Don't tune `max.poll.records` up for throughput without redoing the arithmetic. A larger batch is
  a proportionally larger obligation.
- Don't call `poll()` on a timer just to "stay alive". Polling without processing the previous
  batch does not reset the risk — the group sees no progress either.
- Don't run slow work inside the poll loop and commit before it. That is both evictions and lost
  records; the two failure modes compose.
- Don't treat rebalance storms as a Kafka problem first. Check per-record processing time against
  the budget before suspecting the broker.
- Don't raise `max.poll.interval.ms` to hours to make the symptom disappear. It also delays
  detection of real failures and holds partitions idle.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Group rebalances continuously | Batch exceeds the poll interval | Lower `max.poll.records` |
| Consumer evicted mid-batch, restarts elsewhere | `poll()` too late | Prefix processing, commit prefix |
| Lag grows while throughput is flat | Rebalance churn prevents catch-up | Fix the time budget |
| All members slow down together | Every member misses the deadline | Raise the interval or cut per-record cost |
| `CommitFailedException` after rebalance | Offsets for partitions no longer owned | Commit only still-owned partitions |
| Throughput improves, lag does not | Buffering unchanged by design | Reduce per-record cost, not just batch size |

## Verifying

```bash
# 1. The arithmetic, in the config as written
grep -rn 'max.poll.records\|max.poll.interval' --include=*.properties --include=*.yaml \
  --include=*.yml . | head -20

# 2. The real per-record cost -- what has to fit inside the budget
grep -rnE 'poll\(' --include=*.java --include=*.py --include=*.go . | head -20

# 3. Blocking calls inside the loop body -- each one is time out of the budget
grep -rnE 'await\(|\.get\(\)|sleep\(|time\.Sleep' --include=*.java --include=*.py --include=*.go . \
  | grep -v test | head -20

# 4. Settle it at the broker -- rebalance frequency per group:
#    kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group my-group
#    and in the broker log, the member id / generation churn for that group.
```

What this check cannot see: the config grep reads intent, not the running value, and the per-record
cost is a property of the workload, not of the source — grep sees a `.get()` and cannot tell a
2 ms cache read from a 2 s downstream call. Step 4 is what settles it: a group whose member
assignment churns on a timer has a consumer exceeding the interval, whatever the source says. The
useful refinement is that if rebalances occur on a suspiciously regular period rather than
randomly, suspect a fixed cost in the loop (a retry, a fixed sleep, a connection pool warm-up) rather
than variable downstream latency.