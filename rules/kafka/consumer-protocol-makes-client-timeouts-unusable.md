---
title: "`group.protocol=consumer` silently ignores three client timeout settings"
rule_id: "RULE-KAFKA-008"
category: "correctness"
scope: "all"
applies_to: "group.protocol, heartbeat.interval.ms, session.timeout.ms, partition.assignment.strategy, group.consumer.session.timeout.ms"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/operations/consumer-rebalance-protocol/"
---

# `group.protocol=consumer` silently ignores three client timeout settings

Since Kafka 4.0 a second group protocol exists. The client stays on the old one unless asked — but
the moment a deployment asks, three timeout settings it was configured with stop having any effect,
with no error, and are replaced by broker-side configs in a different file.

## Why

> Since Apache Kafka 4.0, the Consumer fully supports the new Consumer rebalance protocol. However,
> the protocol is not enabled by default. The group.protocol configuration must be set to consumer
> to enable it.
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

The server side is already on the new protocol:

> The new consumer protocol is automatically enabled on the server since Apache Kafka 4.0.
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

And opting in disables the client configs with no deprecation warning:

> When the new rebalance protocol is enabled, the following configurations and APIs are no longer
> usable:
> - heartbeat.interval.ms
> - session.timeout.ms
> - partition.assignment.strategy
> - enforceRebalance(String) and enforceRebalance()
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

"No longer usable" — not warned, not ignored-with-log, unusable. Their replacements live on the
broker:

> The consumer heartbeat interval and the session timeout are controlled by the server now with the
> following configs: group.consumer.heartbeat.interval.ms, group.consumer.session.timeout.ms
> ([Consumer Rebalance Protocol](https://kafka.apache.org/43/operations/consumer-rebalance-protocol/))

And the values are not the same, which is the part that survives long after the migration:

| Setting | Classic (client) | Consumer protocol (broker) |
|---|---|---|
| `session.timeout.ms` | 45000 (45 s) | `consumer.session.timeout.ms` = 45000 (45 s) |
| `heartbeat.interval.ms` | 3000 (3 s) | `consumer.heartbeat.interval.ms` = **5000 (5 s)** |

The timeout matches. The heartbeat does not. A cluster that tuned `heartbeat.interval.ms=500` for a
high-latency broker keeps 5000 after migrating, and its effective failure-detection window grew
without anything changing in the client config.

The consumer config page states the rule from both sides:

> This config is only supported if group.protocol is set to "classic".
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

> Note that this client configuration is not supported when group.protocol is set to "consumer".
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

## Do

- Decide which protocol you are on and record it, because every timeout value below is conditional
  on that one flag.
- When migrating, audit the client-side timeout values you are *abandoning* and carry the intent into
  the broker-side `group.consumer.*` configs — do not rely on their defaults matching.
- Fail startup if `group.protocol=consumer` is set alongside any of the three unusable client keys,
  so a stale config cannot survive a migration unnoticed.
- Re-derive `heartbeat.interval.ms` explicitly on the broker if the client value was ever tuned away
  from its default. This is the setting whose default differs.
- Watch `session.timeout.ms` bounds: they are clamped by `group.min.session.timeout.ms` and
  `group.max.session.timeout.ms` on the broker regardless of protocol.

## Don't

- Don't set `group.protocol=consumer` in one deployment step and assume the timeout behaviour is
  unchanged. It is not, and nothing says so at runtime.
- Don't tune `heartbeat.interval.ms` on the client and run `group.protocol=consumer`. The tuning is
  stored in a file everyone still reads and applies to nothing.
- Don't assume a broker-side `consumer.session.timeout.ms` of 45000 means a client-side
  `session.timeout.ms` of 45000 has any effect. Same number, different object.
- Don't add `partition.assignment.strategy` alongside `group.protocol=consumer` expecting it to be
  used. Assignment is server-side (`group.consumer.assignors`); see `RULE-KAFKA-009`.
- Don't treat "it migrated and nothing broke" as evidence the settings were carried over. Nothing
  breaking is the expected result of a setting being ignored.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Failure detection slower after migration | Broker heartbeat default 5000 ≠ client 3000 | Set `consumer.heartbeat.interval.ms` explicitly |
| Frequent rebalances after migration | Client `session.timeout.ms` ignored | Set `consumer.session.timeout.ms` |
| Session timeout not honoured | Value clamped by broker min/max | Check `group.min/max.session.timeout.ms` |
| Custom assignor has no effect | `partition.assignment.strategy` unusable | Use `group.consumer.assignors` |
| `enforceRebalance()` throws | API removed under the new protocol | Remove the call |

## Verifying

```bash
# 1. Which protocol, and are the unusable keys still present?
grep -rn 'group.protocol\|group_protocol\|GROUP_PROTOCOL' --include=*.properties \
  --include=*.yaml --include=*.yml --include=*.java . | head -20
grep -rn 'heartbeat.interval\|session.timeout\|partition.assignment.strategy' \
  --include=*.properties --include=*.yaml --include=*.yml . | head -20

# 2. The broker-side replacements, for the group in question:
#    kafka-configs.sh --bootstrap-server localhost:9092 --entity-type groups \
#      --entity-name my-group --describe --all | grep -E 'session.timeout|heartbeat.interval'

# 3. Settle it against the running consumer -- effective config, not declared config:
#    ConsumerConfig c = new ConsumerConfig(props);
#    c.getString(ConsumerConfig.GROUP_PROTOCOL_CONFIG);
#    or from JMX: the consumer's group.protocol and rebalance metrics
```

What this check cannot see: grep cannot tell which branch is active, and the same file can contain
both protocols' settings with only one of them in effect. Step 2 reads the broker's actual group
config, which is the authoritative source for the values that replace the client's — but only after
the group exists, and it says nothing about what the client is still *trying* to configure. Step 3
is what closes the gap: asking the running client which protocol it resolved to is the only direct
observation of which set of timeouts applies. The useful discipline is the combination — client says
`consumer`, broker shows the `group.consumer.*` values, client config file has none of the three
unusable keys.