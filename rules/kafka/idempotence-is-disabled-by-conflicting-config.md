---
title: "`enable.idempotence` defaults to true and conflicting config silently disables it"
rule_id: "RULE-KAFKA-009"
category: "correctness"
scope: "all"
applies_to: "enable.idempotence, retries, acks, max.in.flight.requests.per.connection, duplicate records"
last_updated: "2026-10-04"
source: "https://kafka.apache.org/43/configuration/producer-configs/"
---

# `enable.idempotence` defaults to true and conflicting config silently disables it

Idempotence is on by default. The trap is not that it is off — it is that a perfectly reasonable
looking configuration turns it off without an error, and the recommended way to control retries is
one of the ways to do it.

## Why

> Idempotence is enabled by default if no conflicting configurations are set. If conflicting
> configurations are set and idempotence is not explicitly enabled, idempotence is disabled. If
> idempotence is explicitly enabled and conflicting configurations are set, a ConfigException is
> thrown.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

Three behaviours behind one flag:

| You set | Outcome |
|---|---|
| Nothing conflicting | Idempotent (default) |
| Something conflicting, idempotence unmentioned | **Not** idempotent, no error |
| Idempotence explicitly `true` plus a conflict | `ConfigException` at startup |

The second row is the defect. The flag's default is silently inverted by the presence of other
settings.

The conflicts are three:

> Note that enabling idempotence requires max.in.flight.requests.per.connection to be less than or
> equal to 5 (with message ordering preserved for any allowable value), retries to be greater than
> 0, and acks must be 'all'.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

`retries > 0` is the one people trip on, because the same page recommends against using it:

> Users should generally prefer to leave this config unset and instead use delivery.timeout.ms to
> control retry behavior.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

So following the doc's advice about retries can remove idempotence. Set `retries=0` for a
"no-retry" policy, and you have also lost exactly-once-on-retry.

Without idempotence, retries duplicate. The doc names the window precisely:

> Allowing retries while setting enable.idempotence to false and max.in.flight.requests.per.connection
> to greater than 1 will potentially change the ordering of records because if two batches are sent
> to a single partition, and the first fails and is retried but the second succeeds, then the records
> in the second batch may appear first.
> ([Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/))

And reordering matters wherever a consumer compares values or assumes recency — a last-write-wins
update now processes an older record last.

## Do

- Set `enable.idempotence=true` explicitly. That converts the silent branch into a startup
  `ConfigException` naming the conflict, which is the behaviour you want.
- Keep `acks=all`, `retries > 0`, and `max.in.flight.requests.per.connection <= 5` — the three
  conditions, and the last one exactly so.
- Control retry behaviour with `delivery.timeout.ms` (see `RULE-KAFKA-009`), not by setting
  `retries=0`.
- Assert the trio at startup so a config change that breaks the combination fails at boot rather
  than in production traffic.
- Expect duplicates at the consumer anyway. Idempotent production is not idempotent consumption;
  consumers must tolerate re-delivery independently.

## Don't

- Don't rely on the default. It holds only while nobody touches the conflicting keys, which is not
  a property you can review for — it is a property you can break.
- Don't set `retries=0` to get faster failure without checking what else that changes. It disables
  idempotence unless you set it explicitly.
- Don't raise `max.in.flight.requests.per.connection` above 5 for throughput and assume ordering is
  unaffected. Above 5 the broker "only retains at most 5 batches for each producer", so earlier
  batches may be dropped.
- Don't read "idempotence is enabled by default" as a durability guarantee. It dedupes retries; it
  says nothing about whether the record reaches the log — that is `acks`, see `RULE-KAFKA-009`.
- Don't treat a successful send as a durable record when `acks` is not `all`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Duplicate records after a broker blip | Idempotence disabled by a conflicting config | Set it explicitly; fix the conflict |
| Older record applied last | Retries without idempotence, in-flight > 1 | `enable.idempotence=true` |
| No `ConfigException` where one was expected | Idempotence not explicitly enabled | State the flag |
| Producer slower after tuning retries | Retry path now duplicating work | Restore idempotence, tune `delivery.timeout.ms` |
| Records missing under in-flight > 5 | Broker retains at most 5 batches | Cap in-flight at 5 |
| Duplicates only during incidents | Idempotence present but consumers not idempotent | Dedupe or idempotent writes downstream |

## Verifying

```bash
# 1. Is the flag stated, or merely inherited?
grep -rn 'enable.idempotence\|ENABLE_IDEMPOTENCE' --include=*.properties --include=*.yaml \
  --include=*.yml --include=*.java . | head -20

# 2. The three conflicting keys, whose combination inverts the default when the flag is unstated
grep -rnE '^\s*(retries|acks|max\.in\.flight\.requests\.per\.connection)\s*[:=]' \
  --include=*.properties --include=*.yaml --include=*.yml . | head -20

# 3. Settle it by asking the client, not the file -- the effective config:
#    ProducerConfig p = new ProducerConfig(props);
#    p.getBoolean(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG);   // what the producer will use
#    Also useful: the producer's own JMX/`kafka.producer` metrics expose the retry count;
#    a non-zero `record-retry-total` alongside duplicate records is the signature.
```

What this check cannot see: files are intent, and the effective config is assembled from defaults,
environment variables, and client-library overrides that never appear in source — which is exactly
why step 3 asks the client rather than reading the file. Step 2 lists conflicting keys whether or not
idempotence is stated alongside them, so it flags configurations that are in fact fine. The
observation that settles it is behavioural: duplicate records in the log accompanied by a non-zero
retry metric proves retries happened without dedupe, and the only way to confirm the flag state at
that moment is the client's effective config.