---
title: "At-Least-Once Is the Guarantee You Get"
rule_id: "RULE-MESSAGING-001"
category: "architecture"
scope: "backend"
applies_to: "Any queue, stream, or broker consumer that mutates state"
last_updated: "2026-09-30"
source: "https://www.rabbitmq.com/docs/quorum-queues, https://redis.io/docs/latest/develop/data-types/streams/consumer-groups/, https://kafka.apache.org/documentation/"
---

# At-Least-Once Is the Guarantee You Get

Every broker that survives a crash delivers a message more than once some of the time. "Exactly-once" names a boundary — usually *read-process-write inside the broker's own log* — and not the journey to your database. Write the consumer so a duplicate is boring.

## Why

Two acknowledgements schemes exist and neither is exactly-once end-to-end. Ack-before-process loses work on a crash; process-before-ack duplicates work on a crash. The second failure is recoverable — a duplicated effect you can detect and swallow. The first is not — the message is gone and nobody knows. So you always take at-least-once and spend the design budget on making it a no-op the second time.

The scoping matters most with Kafka, where transactions do not cross the boundary to a non-Kafka system. A "exactly-once" consumer that writes to Postgres is exactly-once only up to the moment it leaves the log.

## Do

- Acknowledge **after** the side effect commits, never before. If the process dies in between, the message comes back — that is the design working.
- Key deduplication on the **message id or event id**, not on the payload hash and not on arrival order. Payload hashes collide and reorder; the broker-assigned id is stable across redelivery.
- Put the dedupe record and the business write **in the same database transaction**:
  ```sql
  BEGIN;
  INSERT INTO processed_events(event_id) VALUES ($1);   -- PK violation = dup
  UPDATE accounts SET balance = balance + $2 WHERE id = $3;
  COMMIT;
  ```
  A unique-violation on `processed_events` is the whole dedupe check. Swallow it and ack.
- Set a **delivery limit** and dead-letter past it. Unlimited redelivery of a poison message is a denial of service you wrote yourself.
- Give the DLQ an alert and an owner. A queue nobody reads is a delayed outage.

## Don't

- **Don't use `BRPOP`/`RPOP` on a list as a work queue.** A `RPOP` deletes the entry; a crash between pop and process loses it permanently. Use consumer groups (Streams) or a broker with redelivery.
- **Don't turn off the delivery limit** to "make sure nothing is lost". Repeated requeue storms destabilise the broker; the vendor says so directly.
- **Don't assume FIFO globally.** Per-key ordering is the achievable guarantee; global ordering collapses you onto one partition and one consumer.
- **Don't dedupe on the payload.** Two legitimately distinct events can share a body; two redeliveries of one event can differ by a timestamp field.
- **Don't count on broker-side dedupe as your only defence.** Redis Streams gained idempotent production (8.6) and SQS FIFO has a dedup interval — both scope the *producer* side and neither spans a crash-restart of your consumer.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Messages vanish on consumer crash | Ack-before-process | Move the ack after the commit |
| Rows double-written after a deploy | Redelivered messages re-applied | Insert the event id in the same transaction; unique-violation swallows |
| One poison message pegs a consumer forever | No delivery limit | Set `x-delivery-limit`, dead-letter, alert on DLQ depth |
| Reordered events corrupt state | Global-order assumption | Partition/order by entity key; make the handler order-tolerant |
| "Exactly-once" consumer duplicates external writes | EOS scope stops at the log | Treat the hop to the external system as at-least-once |
| List-based queue quietly drops work | `RPOP` deletes before processing | Migrate to consumer groups or a real broker |

## Verifying

1. Run a load test that `SIGKILL`s the consumer mid-batch, repeatedly; assert zero lost messages and at least one duplicate.
2. `SELECT COUNT(*) FROM processed_events GROUP BY event_id HAVING COUNT(*) > 1` — empty result set.
3. Publish one message whose handler raises every time; assert it lands in the DLQ within the configured limit and that an alert fires.
4. `grep -RIn "RPOP\|BLPOP\|LPOP" <target>` — every hit needs a justification comment.

## Caveats on confidence

- The delivery-limit defaults and the at-least-once dead-letter option are verified against the RabbitMQ quorum-queue documentation current as of 2026-09-30 (*"Starting with RabbitMQ 4.0, the delivery limit for quorum queues defaults to 20."*). **Note:** Starting with RabbitMQ 4.3, the delivery limit counts `delivery-count` (number of deliveries to consumers) rather than `acquired-count` (number of times taken from the queue). This means `nack` or `reject` with `requeue=false` no longer increments the limit.
- The Redis Streams idempotent-production claim is dated to Redis 8.6 per the vendor documentation; if your server is older, that path does not exist and producer-side dedupe is entirely your code.
- Kafka's exactly-once *cost* is asserted from the API surface (transactions + `isolation.level=read_committed` + idempotent producer), **not** from benchmark numbers. Do not quote a throughput penalty figure from this rule.
- We did not verify the transactional-dedupe sample against a specific ORM. The SQL shape is portable; the transaction-scoping behaviour of your driver is not necessarily.