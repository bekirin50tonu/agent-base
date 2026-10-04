---
title: "`acks` levels lose records in different ways, and `acks=0` also disables retries"
rule_id: "RULE-KAFKA-009"
category: "correctness"
scope: "all"
applies_to: "acks, durability, producer config, leader election, replica.lag.time.max.ms"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/producer-configs/"
---

# `acks` levels lose records in different ways, and `acks=0` also disables retries

`acks` reads like a durability dial with three positions. It is three different guarantees with
three different failure modes, and the level most projects run on is not safe against the failure it
looks like it protects against.

## Why

> acks=0 If set to zero then the producer will not wait for any acknowledgment from the server at
> all. The record will be immediately added to the socket buffer and considered sent. No guarantee
> can be made that the server has received the record in this case, and the retries configuration
> will not take effect (as the client won't generally know of any failures). The offset given back for
> each record will always be set to -1.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

Three consequences in one entry, each a distinct hazard:

- **No delivery guarantee.** The record is in the socket buffer, which is not the broker.
- **`retries` becomes inert.** "the retries configuration will not take effect" — a retry policy in
  the config that can never fire.
- **The returned offset is always `-1`.** Anything downstream using producer-returned offsets for
  ordering, deduplication, or checkpointing receives a constant.

> acks=1 This will mean the leader will write the record to its local log but will respond without
> awaiting full acknowledgement from all followers. In this case should the leader fail immediately
> after acknowledging the record but before the followers have replicated it then the record will be
> lost.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

This is the important one. `acks=1` acknowledges *before* replication completes, so a leader
failure immediately after acknowledgement loses an acknowledged record. "The producer did not error"
and "the record survived" are different claims at `acks=1`.

> acks=all This means the leader will wait for the full set of in-sync replicas to acknowledge the
> record. This guarantees that the record will not be lost as long as at least one in-sync replica
> remains alive. This is the strongest available guarantee.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

Note the shape of the `all` guarantee — it is conditioned on an in-sync replica remaining alive. A
cluster whose ISR can shrink to zero under a broad failure does not have it, which is why
`min.insync.replicas` is part of the same decision.

## Do

- Use `acks=all` unless you have a measured reason not to, and pair it with `min.insync.replicas` so
  the guarantee is real rather than nominal.
- Set `enable.idempotence=true` alongside it — that requires `acks` to be `all` anyway, and turns a
  config slip into a startup failure (see `RULE-KAFKA-009`).
- Keep `acks=all` with `retries > 0` so a transient failure is retried rather than surfaced as a
  lost record.
- If throughput forces `acks=1`, treat it as an explicit availability-over-durability choice and
  build a repair path — a reconciliation read against the source of truth, or an idempotent sink
  that absorbs the gap. That is a design consequence, not a config to tune back.
- Check `acks` when a producer is "losing" records with no error, and check `min.insync.replicas`
  before concluding the cluster is at fault.

## Don't

- Don't treat `acks=1` as safe with retries. Retry on a lost acknowledgement produces a duplicate in
  the common case and a loss in the leader-failure case — the config has both failure modes.
- Don't set `acks=0` and keep a retry policy in the same file believing it applies. It cannot.
- Don't read the `-1` offset at `acks=0` as "unknown offset, ignore it". It is a constant, and code
  that stores it as a checkpoint will never advance.
- Don't assume `acks=all` alone survives a full ISR loss. Check `min.insync.replicas`.
- Don't lower `acks` to reduce latency without measuring where the latency actually is — it is
  usually batch accumulation (`linger.ms`) or a slow broker, not the acknowledgement.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Acknowledged records missing after leader failure | `acks=1` before replication | `acks=all` |
| Retries never happen | `acks=0` disables the retry path | `acks=all` |
| Stored offsets all `-1` | `acks=0` return value | `acks=all` |
| Duplicates on retry | Retries without idempotence | `enable.idempotence=true` |
| `NotEnoughReplicas` errors | `min.insync.replicas` too high | Reconcile with `acks` and replication factor |
| Apparent loss with no producer error | `acks=1` + leader failover | `acks=all`; reconcile the gap |

## Verifying

```bash
# 1. The declared level, and the ISR floor it needs to mean anything
grep -rnE '^\s*acks\s*[:=]|min\.insync\.replicas|replica\.factor' \
  --include=*.properties --include=*.yaml --include=*.yml . | head -20

# 2. Code branching on the producer's returned offset -- the `-1` hazard
grep -rnE 'RecordMetadata|send\(.*\)\.get\(\)|\.offset\(\)' --include=*.java --include=*.scala . \
  | head -15

# 3. Settle it at the topic -- the ISR floor and the under-replicated partitions:
#    kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic my-topic
#    (look at ISR; an ISR of 0 or 1 with acks=all still has a narrow window)
#    And at the cluster level:
#    kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers \
#      --entity-default --describe --all | grep min.insync.replicas
```

What this check cannot see: grep reads declared values, and the broker is the authority on what an
ISR actually contained at the moment a record was written — a property no source file records. Step
3 is the direct observation: it tells you whether the cluster currently satisfies the precondition the
`acks=all` guarantee is stated in terms of. It cannot retroactively tell you whether a specific record
was lost to a leader failure, and neither can anything else short of reconciling the topic against
the source of truth — which is the same work the "repair path" in the Do section describes.