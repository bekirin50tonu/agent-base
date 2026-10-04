---
title: "Offset Commit Strategy — Decision Matrix"
category: "architecture"
applies_to: "Any Kafka consumer team whose offset-commit settings (auto.offset.reset, enable.auto.commit, max.poll.records) were never decided together; any design claiming exactly-once delivery"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/consumer-configs/,https://kafka.apache.org/43/design/design/"
---

# Offset Commit Strategy — Decision Matrix

The three consumer settings that matter are not independent knobs. `auto.offset.reset` decides what
happens with no offset, `enable.auto.commit` decides who makes the claim, and `max.poll.records`
decides how much of the claim you must finish before the group revokes your right to make it. Pick
one row, not one setting.

## When to Use

- A new consumer group is being configured and the three settings are being set one at a time,
  each by a separate ticket.
- A review asks "what happens to the offset when the consumer dies mid-batch" and no single
  answer exists.
- A data-loss bug report points at `auto.offset.reset=latest` or at auto-commit, and the fix
  being proposed is flipping one setting instead of choosing a row.
- A design document claims exactly-once delivery to a sink that is not another Kafka topic.
- Any schema-migration replay, where offsets and retained records are the only recovery tool.

## The matrix

| Requirement | `auto.offset.reset` | `enable.auto.commit` | Batch handling | Failure mode if wrong |
|---|---|---|---|---|
| Build state from full history | `earliest` | `false`, commit prefix | One long pass | Silent empty state |
| React to events, never skip | `none` (or `earliest` + backfill) | `false`, commit prefix | Prefix of N | Silent skip, zero lag reported |
| At-most-once, explicitly chosen | any | `true` | Whole batch | Intentional, documented loss |
| Exactly-once, Kafka → Kafka | — | offsets in the transaction | Whole batch | Duplicate output |
| Exactly-once, external sink | — | offset stored beside output | Whole batch | Two-phase commit required |

Rows 4 and 5 are the ones that cannot be reached by configuration, only by architecture.

## Why the last two rows are not settings

> The classic way of achieving this would be to introduce a two-phase commit between the storage of
> the consumer position and the storage of the consumers output. This can be handled more simply and
> generally by letting the consumer store its offset in the same place as its output. This is better
> because many of the output systems a consumer might want to write to will not support a two-phase
> commit.
> ([Message Delivery Semantics](https://kafka.apache.org/43/design/design/))

The compensating mechanism for exactly-once is therefore structural: put the offset *in the output
store* and let one atomic write cover both. Kafka gives you exactly-once for free when the sink is
another Kafka topic — the offset is written as a message in the transaction. It does not give you
anything for a database that cannot participate in a two-phase commit. A design that needs Kafka
offsets and a relational database to agree across two systems is at-least-once, permanently, and the
correct response is to say so rather than to hunt for a setting that does not exist.

## Recovery is a rewind, not a restore

> A consumer can deliberately rewind back to an old offset and re-consume data. This violates the
> common contract of a queue, but turns out to be an essential feature for many consumers. For
> example, if the consumer code has a bug and is discovered after some messages are consumed, the
> consumer can re-consume those messages once the bug is fixed.
> ([Consumer Position](https://kafka.apache.org/43/design/design/))

This is why a bad commit is recoverable rather than fatal — provided retention still holds the
records. A skipped backlog is a replay, not a deletion. That is the single strongest argument for
choosing `earliest`: the failure it risks is recoverable, while the silent skip that `latest` risks
is only recoverable while the retention window is open.

## The pattern

```java
// The three settings, decided together, with the reason each exists.
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");   // no initial offset
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");     // no implicit claim
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "100");          // fits the poll-interval budget
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "300000");

// Per-batch: process a prefix, commit that prefix, leave the rest to be re-delivered.
int sinceCommit = 0;
TopicPartition last = null;
long lastOffset = -1;

for (ConsumerRecord<String, Order> record : consumer.poll(Duration.ofMillis(1000))) {
    orderService.persist(record.value());          // durable first
    last = new TopicPartition(record.topic(), record.partition());
    lastOffset = record.offset();
    if (++sinceCommit >= commitInterval) {
        consumer.commitSync(Map.of(last, new OffsetAndMetadata(lastOffset + 1)));
        sinceCommit = 0;
    }
}
```

Two details carry the correctness:

- **Commit the prefix, not the batch.** Stopping early leaves an uncommitted suffix, which is
  re-delivered. Committing the batch on early exit is how at-most-once sneaks back in under an
  at-least-once config.
- **`lastOffset + 1`.** The offset is "the offset of the next message to consume", so committing
  `lastOffset` replays one record. Harmless under at-least-once with an idempotent write — which is
  why the design doc calls such updates idempotent — but it should be deliberate.

## Choosing a commit interval

The interval trades latency against the `CommitFailedException` risk that grows with rebalance
frequency.

| Downstream per-record cost | Suggested `max.poll.records` | Commit interval |
|---|---|---|
| < 5 ms (local DB, cache) | 500 (default) | 500 records |
| 50 ms (HTTP to a normal service) | 100–200 | 50 records |
| 500 ms+ or variable (model inference) | 10–50 | 5–10 records |

Compute `max.poll.interval.ms / max.poll.records` and check it exceeds your p99 per-record cost with
headroom. That division is the whole budget, and neither default states it anywhere.

## When to accept at-most-once

Row 3 is legitimate for: high-volume telemetry where loss is preferable to backpressure, metrics
counters that are superseded rather than accumulated, and any stream where the sink is idempotent and
the value of a specific historical record is near zero. It is not legitimate as "we never got around
to it" — the difference is that a chosen at-most-once is a decision you can defend in a review, and a
default one is a decision nobody made.