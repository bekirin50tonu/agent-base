---
title: "`auto.offset.reset` defaults to `latest`, so a new group silently skips the backlog"
rule_id: "RULE-KAFKA-003"
category: "correctness"
scope: "all"
applies_to: "auto.offset.reset, consumer group, new group, retention, partition count, backfill"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/consumer-configs/"
---

# `auto.offset.reset` defaults to `latest`, so a new group silently skips the backlog

A consumer group with no committed offset starts at the head of the log. The backlog is not
consumed — it is skipped. The application connects, reports healthy, and has never seen a single
historical record. No event, log line, or metric distinguishes this from a correct deployment.

## Why

The config decides what happens when there is no offset, which is the *ordinary* case for a new
`group.id` and the *extraordinary* case for offsets deleted out from under a running system:

> What to do when there is no initial offset in Kafka or if the current offset does not exist any
> more on the server (e.g. because that data has been deleted):
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

The default is `latest`, not `earliest`:

```
TYPE:	string
DEFAULT:	latest
VALID VALUES:	[latest, earliest, none, by_duration:PnDTnHnMn.nS]
IMPORTANCE:	medium
```

So every deploy that introduces a new `group.id` — staging, a new service, a renamed config key —
starts at the end. Consumers react to events by design, so they appear healthy; the events that
already happened simply never arrive.

The second trigger is the one that bites an established group. The doc carries an explicit warning:

> Note that altering partition numbers while setting this config to latest may cause message delivery
> loss since producers could start to send messages to newly added partitions (i.e. no initial
> offsets exist yet) before consumers reset their offsets.
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

Increase partition count on a healthy group and records written to the *new* partitions before the
consumer's reset lands are lost. The trigger is an infrastructure change that looks unrelated to the
consumer — the schema migration that breaks the writer, except nothing breaks visibly.

`none` is the honest setting when silence is unacceptable: it throws instead of guessing. The guess
is the dangerous part, not the reset.

## Do

- Choose `earliest` for consumers that build state from history, and `none` for event-driven
  consumers that must never silently skip.
- Set it explicitly in every consumer, so the behaviour is a decision on file rather than a default
  inherited silently.
- Check the committed offset after a group's first successful run, in CI or in a post-deploy step.
  Zero committed offsets on a group with traffic is the signal.
- Re-verify offsets after a retention-policy change or a topic recreation; both can invalidate them
  and trigger the same path.
- Use the rewind property when you need to replay: a consumer "can deliberately rewind back to an old
  offset and re-consume data" ([Consumer Position](https://kafka.apache.org/43/design/design/)),
  so a skip is recoverable *while retention still holds the records*.
- Use `by_duration` where you want a bounded lag rather than a hard edge.

## Don't

- Don't assume `latest` is safe because "the consumer starts quickly". Starting quickly is the
  problem.
- Don't change partition counts without checking the consumers' offsets — the increase is a data-loss
  event for records written in the gap.
- Don't use `earliest` as a reflex on a high-volume event topic. It will start a replay of the
  entire retention window and may not catch up before the next deploy.
- Don't treat a zero consumer lag as evidence the consumer is caught up. On `latest` with no
  committed offset, lag is legitimately zero and nothing was read.
- Don't assume `none` will fail on the first poll. It fails when the offset is *needed*, which for a
  topic that happens to have no traffic may be much later.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| New consumer group processes nothing historical | `latest` on a group with no offset | `earliest`, then rewind/replay |
| Events "lost" with no producer error | Records written to new partitions before reset | Check offsets after partition change |
| State built by a consumer is empty and looks correct | Silent skip on first run | Assert a committed offset after first run |
| Consumer throws on a fresh group | `none` with no committed offset | Expected — backfill then commit |
| Retention change appears to restart consumption | Offset expired, re-reset applied | Re-verify offsets after retention changes |

## Verifying

```bash
# 1. What every consumer declares, and whether the value is the risky one
grep -rn 'auto.offset.reset\|auto_offset_reset\|AUTO_OFFSET_RESET' --include=*.properties \
  --include=*.yaml --include=*.yml --include=*.java --include=*.py --include=*.go . | head -20

# 2. Absent declarations -- these are running on `latest`
grep -rln 'ConsumerConfig\|KafkaConsumer\|confluent_kafka\|kafka-python' --include=*.java \
  --include=*.py --include=*.go . | xargs grep -Ln 'auto.offset.reset\|AUTO_OFFSET_RESET' 2>/dev/null | head -20

# 3. Settle it against the broker -- the group's actual committed offsets:
#    kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group my-group
#    A group with partitions listed and CURRENT-OFFSET of -1 has no committed offset.
```

What this check cannot see: grep finds declarations, not the values the client used — the same gap as
`RULE-KAFKA-002`. Step 2 is a heuristic and will list consumers that configure the value through a
builder, a YAML file it does not scan, or a shared base class. What settles it is step 3, and the
specific thing to look for is `-1`: that is the broker reporting a group with no committed offset,
which is exactly the condition under which `auto.offset.reset` decides the outcome. A consumer that
never got far enough to commit will also show `-1`, so this check tells you the setting *matters*
here, not by itself which branch it took.