---
title: "`enable.auto.commit` defaults to `true`, so offsets advance past unprocessed records"
rule_id: "RULE-KAFKA-009"
category: "correctness"
scope: "all"
applies_to: "enable.auto.commit, offset commit, consumer groups, at-most-once, at-least-once"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/consumer-configs/"
---

# `enable.auto.commit` defaults to `true`, so offsets advance past unprocessed records

The consumer's offset is the only record Kafka keeps of what has been consumed, and the commit
happens on a timer whether or not the application finished the work. Nothing throws, nothing logs
at error level. A consumer that processes 300 of 500 records and dies has already told the group it
is done with all 500.

## Why

The design doc explains why this is possible in the first place — Kafka deliberately keeps almost no
per-message state:

> This means that the position of a consumer in each partition is just a single integer, the offset
> of the next message to consume. This makes the state about what has been consumed very small, just
> one number for each partition.
> ([Consumer Position](https://kafka.apache.org/43/design/design/))

There is no acknowledgement to record and therefore no way for the broker to distinguish "handed to
the consumer" from "processed by the consumer". The commit is a claim the consumer makes about its
own progress. The only question is *when* it is permitted to make that claim, and the default answer
is without being asked:

> If true the consumer's offset will be periodically committed in the background.
> ([Consumer Configs](https://kafka.apache.org/43/configuration/consumer-configs/))

`TYPE: boolean DEFAULT: true`. The consumer commits on a timer, in the background, independent of
your loop.

The design doc also names the correct ordering, which is not a tuning knob but the entire definition
of at-least-once:

> It can read the messages, process the messages, and finally save its position. In this case there
> is a possibility that the consumer process crashes after processing messages but before saving its
> position.
> ([Message Delivery Semantics](https://kafka.apache.org/43/design/design/))

That ordering *is* at-least-once. The shipped default is at-most-once with a timer attached.

## Do

- Set `enable.auto.commit=false` and commit explicitly, unless you have specifically chosen
  at-most-once and written that choice down.
- Make the commit *after* the side effect is durable — not after the record is read, and not at the
  top of the loop body.
- Commit a prefix of the batch when you stop early, never the whole batch. An uncommitted suffix is
  re-delivered; a committed one is gone.
- Use `commitSync` where losing a commit on process death is worse than the throughput cost, and
  `commitAsync` with a retry where it is not.
- Write the downstream operation idempotently anyway. Explicit commits give at-least-once, which
  means duplicates are expected and must be handled.
- Assert `enable.auto.commit` explicitly in a startup self-check so the guarantee you reasoned about
  is the guarantee that is running.

## Don't

- Don't treat "the consumer didn't throw" as evidence that records were processed. With auto-commit
  on, a clean shutdown and a crashed process are indistinguishable in the offsets.
- Don't set `enable.auto.commit=true` to simplify the code. It removes the only point where the
  application asserts what it has done.
- Don't commit offsets for records you skipped because of a filtering condition, unless skipping
  them is the intent.
- Don't rely on the default and add error handling later. The default is invisible in review — it is
  the absence of a line, not a line.
- Don't mix `commitSync` with per-record commits in a tight loop. The round trip will dominate and
  will likely push you past `max.poll.interval.ms` — see `RULE-KAFKA-009`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Records silently missing after a crash | Auto-commit advanced past unprocessed work | `enable.auto.commit=false`, explicit commits |
| Reprocessing the same record repeatedly | Explicit commit before the work was durable | Commit after the side effect |
| Whole batch lost on one bad record | No per-record failure handling | Process a prefix, commit the prefix |
| Throughput collapses with explicit commits | Sync commit per record | Batch commits at an interval |
| Offsets look correct but output is not | Offset committed, downstream write lost | Make the side effect durable first |

## Verifying

```bash
# 1. Is auto-commit left at the default, or set explicitly? The answer decides everything else.
grep -rn 'enable.auto.commit\|enable\.auto\.commit' --include=*.properties --include=*.yaml \
  --include=*.yml --include=*.conf --include=*.java . | head -20

# 2. Client code: any explicit commit at all?
grep -rnE '\.(commitSync|commitAsync)\(' --include=*.java --include=*.kt \
  --include=*.py --include=*.go . | head -20

# 3. Config built in code rather than a file -- where a grep for the key finds nothing.
grep -rnE 'ENABLE_AUTO_COMMIT_CONFIG|enable\.auto\.commit' --include=*.java . | head -10

# 4. Settle it against the broker -- the consumer's own view of what it has committed:
#    kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
#      --describe --group my-group --offsets
#    Then compare with what the application log says it processed.
```

What this check cannot see: grep finds configuration *declarations*, and a declaration is not the
value the client used — `ConsumerConfig` defaults fill in anything absent, an environment variable
or a mounted secret may override the file, and a framework builder may inject values the source
never mentions. Step 1 returning nothing is consistent with both "using the default `true`" and
"explicitly set to true". Step 2 returning nothing is consistent with "no commits" and "commits
hidden behind a wrapper". What settles the question is step 4: the committed offset compared against
what was actually processed is the only direct observation of what the switch controls, and it is
the same comparison an incident post-mortem will make.