---
title: "Delivery Limit Drops Messages Without a Dead-Letter Exchange"
rule_id: "RULE-MESSAGING-004"
category: "correctness"
scope: "all"
applies_to: "RabbitMQ"
last_updated: "2026-10-01"
source: "https://www.rabbitmq.com/docs/quorum-queues"
---

# Delivery Limit Drops Messages Without a Dead-Letter Exchange
When a message delivery count exceeds the queue's `x-delivery-limit`, RabbitMQ drops the message unless a dead-letter exchange (DLX) is configured. Starting with RabbitMQ 4.0, the default delivery limit for quorum queues is 20. In RabbitMQ 4.3, the semantics of the delivery limit changed: it now counts `delivery-count` (the number of times a message was delivered to a consumer) rather than `acquired-count` (the number of times it was taken from the queue). This means that `nack` or `reject` with `requeue=false` (or `delivery_failed=false`) no longer increments the limit, potentially allowing messages to be retried indefinitely unless a DLX is in place.

## Why
The delivery limit is a poison-message protection mechanism. Without it, a consumer that repeatedly fails to process a message could block the queue indefinitely. However, the limit must be understood correctly:
- **Before RabbitMQ 4.0**: No default delivery limit for quorum queues.
- **RabbitMQ 4.0–4.2**: Default delivery limit of 20, counting `acquired-count`.
- **RabbitMQ 4.3+**: Default delivery limit of 20, now counting `delivery-count`.

The change in 4.3 means that negative acknowledgments (`nack`) or rejections (`reject`) that do not requeue the message (`requeue=false`) are no longer counted toward the limit. Only actual deliveries to consumers increment the counter. This affects how poison message handling works:
- If a consumer consistently `nack`s a message without requeue, the delivery count does not increase, so the message may be retried many times before hitting the limit (if ever).
- To truly limit delivery attempts, consumers must either acknowledge the message (positive or negative with requeue) or rely on a dead-letter exchange to remove the message after the limit is exceeded.

When the delivery limit is exceeded and no dead-letter exchange is configured, the message is silently dropped — no warning, no dead-lettering, just gone. This can lead to data loss if the application assumes messages are either processed or dead-lettered.

## Do
- Always configure a **dead-letter exchange** (DLX) for queues where message loss is unacceptable — this ensures that exceeded-delivery-limit messages are routed to a dead-letter queue for inspection.
- Set `x-delivery-limit` explicitly if you need a different threshold; remember that the default is 20 for quorum queues.
- Monitor `delivery-count` via message headers or the management API to track how many times a message has been delivered.
- Use `x-acquired-count` (available since 4.3) if you need to track how many times a message was taken from the queue, independent of delivery attempts.
- Design consumers to be idempotent so that redelivery does not cause unintended side effects.
- Test poison message handling: publish a message, have a consumer consistently `nack` it, and verify that after the limit is exceeded it is dead-lettered (or dropped if no DLX).
- Consider using the **delayed retry** plugin or `x-delayed-*` arguments for backoff-based retry instead of immediate requeue.

## Don't
- Don't assume that a message will be dead-lettered after exceeding the delivery limit — without a DLX, it is dropped.
- Don't rely on `nack`/`reject` with `requeue=false` to increment the delivery limit in RabbitMQ 4.3+ — those actions no longer count.
- Don't set `x-delivery-limit` to `-1` (unlimited) unless you explicitly want to disable poison message protection — this is not recommended.
- Don't forget that the delivery limit applies per-message, not per-consumer or per-queue rate.
- Don't confuse `delivery-count` with `acknowledge-count` — the former increments on every delivery to a consumer, regardless of outcome.
- Don't use the delivery limit as a rate-limiting mechanism; it is a poison-message cutoff, not a throttling tool.
- Don't expect classic queues to behave the same way — classic queues have always counted `deliveries` (not acquisitions) for their delivery limit, and the default limit is also 20.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Messages disappearing without dead-lettering | Delivery limit exceeded and no DLX configured | Add a dead-letter exchange and queue; monitor the dead-letter queue for insights |
| Consumers seeing the same message many times before giving up | `nack`/`reject` without requeue not counting toward limit in 4.3+ | Change consumer behavior to acknowledge or requeue; or rely on DLX after limit |
| Sudden drop in message processing rate | Many messages hitting delivery limit and being dropped | Investigate why consumers are failing; increase limit if appropriate; add DLX to avoid loss |
| Confusion over delivery limit metrics | Mixing up `delivery-count` and `acquired-count` | Use the correct metric for your RabbitMQ version; since 4.3, limit uses `delivery-count` |
| Expecting TTL or max-length to work with delivery limit | Those queue arguments are independent; delivery limit does not imply TTL | Set TTL and max-length separately if needed |