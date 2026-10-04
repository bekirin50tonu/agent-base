---
title: "Group protocol conversion needs an empty group, and a custom assignor blocks the online path"
rule_id: "RULE-KAFKA-009"
category: "architecture"
scope: "all"
applies_to: "group.protocol, ConsumerPartitionAssignor, KIP-848, upgrade, downtime, partition assignment"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/operations/consumer-rebalance-protocol/"
---

# Group protocol conversion needs an empty group, and a custom assignor blocks the online path

The migration off the classic rebalance protocol has two paths. One is guaranteed to work and
guaranteed to need downtime; the other avoids downtime and has a precondition that a team with a
custom assignor discovers only by trying it. And Kafka 5.0 removes the choice.

## Why

The offline path is unconditional:

> Consumer groups are automatically converted from Classic to Consumer and vice versa when they are
> empty. Hence, it is possible to change the protocol used by the group by shutting down all the
> consumers and bringing them back up with the group.protocol=consumer configuration. The downside is
> that it requires taking the consumer group down.
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

"Shutting down all the consumers" on a group serving production traffic means the group does nothing
during the window. That is a real, bounded outage — which is a legitimate operational choice for a
planned migration, but it is not free, and it is not what a zero-downtime claim means.

The online path carries a condition:

> Consumer groups can be upgraded without downtime by rolling out the consumer with the
> group.protocol=consumer configuration. When the first consumer using the new Consumer rebalance
> protocol joins the group, the group is converted from Classic to Consumer, and the Classic rebalance
> protocol is interoperated to work with the new Consumer rebalance protocol. This is only possible
> when the classic group uses an assignor that does not embed custom metadata.
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

A client-side custom `ConsumerPartitionAssignor` is precisely a thing that embeds custom metadata. A
team that wrote one reads this and discovers the online migration is unavailable to them — at the
moment they attempt it, with a rolling deploy half-done.

The assignor mapping shows what a stock deployment actually loses:

| Client-side assignor | Server-side assignor |
|---|---|
| RangeAssignor | range |
| CooperativeStickyAssignor | uniform |
| StickyAssignor | uniform |
| RoundRobinAssignor | uniform |

Four stock assignors collapse into two. A deployment that deliberately chose `RoundRobinAssignor`
does not get it after migration — it gets `uniform`, which is a different partitioning behaviour.

Then the choice disappears:

> Apache Kafka 5.0: KafkaConsumer defaults to Consumer protocol, while still supporting Classic
>
> Apache Kafka 6.0: KafkaConsumer only supports Consumer as rebalance protocol, while the broker
> still supports Classic for backward compatibility.
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

At 5.0 the default flips with no config change. Every consumer that never set `group.protocol` moves
to the branch where its client-side timeouts stop applying (see `RULE-KAFKA-008`) and its assignor
selection stops mattering.

## Do

- Set `group.protocol=consumer` deliberately before 5.0 forces it, so the migration is a scheduled
  event with a rollback rather than a surprise on upgrade.
- Check the two things that determine your path *before* planning: whether the group has a custom
  `ConsumerPartitionAssignor`, and whether it can absorb a full consumer shutdown.
- Inventory the assignor in use and confirm the server-side equivalent before migrating. If the
  current choice is not stock, assume behaviour changes.
- Migrate the offline path during a maintenance window when a custom assignor is in use — it is the
  only path guaranteed to work.
- Roll the online path group by group, not fleet-wide, so a conversion failure affects one group.
- Re-verify the effective timeouts after conversion, using the broker-side `group.consumer.*` configs.

## Don't

- Don't plan a zero-downtime migration for a group with a custom assignor without confirming the
  precondition holds. It may not, and the failure appears mid-rollout.
- Don't assume `partition.assignment.strategy` survives the migration. Assignment is server-side
  under the new protocol.
- Don't wait for the 5.0 default flip to "force" the decision. An unannounced protocol change is
  the worst way to find out which timeouts were in effect.
- Don't compare stock assignors by name after migration. `StickyAssignor` and `RoundRobinAssignor`
  are both `uniform` now; same name, different behaviour.
- Don't attempt an online downgrade of a group mid-flight. The reverse conversion happens when the
  last new-protocol consumer leaves, which is itself a moving condition.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Group stuck on classic after rollout | Custom assignor blocks online conversion | Downtime migration, or drop the assignor |
| Partition distribution changed | Stock assignor mapped to `uniform` | Accept and verify, or plan the change |
| Rebalances behave differently post-migration | Server-side assignor in effect | Review `group.consumer.assignors` |
| Timeouts wrong after upgrading to 5.0 | Protocol flipped without a config change | Set `group.protocol` explicitly |
| Partitions unassigned after mixed rollout | Interoperated rebalance mid-conversion | Complete the rollout on one group |
| Downtime longer than planned | Consumers restart serially | Drain and restart in parallel |

## Verifying

```bash
# 1. Is a custom assignor in play? (This decides the migration path.)
grep -rn 'partition.assignment.strategy\|PARTITION_ASSIGNMENT_STRATEGY' \
  --include=*.properties --include=*.yaml --include=*.yml --include=*.java \
  --include=*.scala . | head -20

# 2. Any local class implementing the assignor interface
grep -rln 'ConsumerPartitionAssignor' --include=*.java --include=*.scala . | head

# 3. The protocol the group is actually on, and the assignors available server-side:
#    kafka-configs.sh --bootstrap-server localhost:9092 --entity-type groups \
#      --entity-name my-group --describe --all | grep -E 'protocol|assignor'
#    kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers \
#      --entity-name 1 --describe --all | grep group.consumer.assignors

# 4. Assignment as it actually is, per member:
#    kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group my-group
```

What this check cannot see: step 1 finds declarations and step 2 finds implementations, but neither
tells you whether the custom assignor is *active* in a running group — a class may be configured in a
profile that is not deployed, or inherited from a base config the group never used. Step 3 and 4
are the direct observations: the group's configured protocol and assignors, and the member-to-partition
assignment that results. Comparing step 4's distribution before and after migration is the only way
to see whether behaviour actually changed, and it is the comparison that should gate the rollout.