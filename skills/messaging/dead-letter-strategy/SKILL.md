---
title: "Implement Dead-Letter Strategy for Message Brokers"
category: "messaging"
applies_to: "RabbitMQ, Redis Streams, Kafka"
last_updated: "2026-10-01"
source: "https://www.rabbitmq.com/docs/dlx, https://redis.io/docs/latest/develop/data-types/streams/consumer-groups/, https://kafka.apache.org/documentation/"
---

# Implement Dead-Letter Strategy for Message Brokers
Dead-letter queues (DLQs) are essential for handling poison messages that repeatedly fail processing. Without a DLQ strategy, poison messages can cause consumer starvation, resource exhaustion, or silent message loss. This skill covers DLQ implementation patterns for common message brokers.

## Why
Poison messages are inevitable in any messaging system:
- Application bugs that cause consistent processing failures
- Data corruption or schema mismatches
- Downstream service outages that make processing temporarily impossible
- Malicious or malformed input that crashes parsers

Without a dead-letter strategy:
- Consumers waste cycles retrying the same failing message
- Other messages may be delayed behind the poisonous one (depending on queue design)
- Broker resources (memory, disk, file descriptors) may be consumed unnecessarily
- Operational visibility is lost — you don't know which messages are failing and why

## Do
- Always configure a **dead-letter exchange** (DLX) and **dead-letter queue** (DLQ) for critical queues.
- Set appropriate `x-delivery-limit` or equivalent (e.g., Kafka's retry.backoff.ms + retries) to control when messages go to the DLQ.
- Monitor DLQ depth and set alerts — a growing DLQ indicates processing problems.
- Design DLQ consumers for inspection, not automatic reprocessing — humans should decide whether to fix and republish.
- Include useful metadata in DLQ messages: original exchange/routing key, delivery count, timestamps, and failure reason if available.
- Test your DLQ path: publish a message, configure a consumer to always fail, and verify it ends up in the DLQ after the limit.
- Consider using **delayed dead-lettering** or **retry timers** instead of immediate DLQ for transient failures.
- For streaming platforms like Kafka, understand that DLQ-like patterns often require consumer-side implementation (e.g., side topics for failed records).

## Don't
- Don't set `x-delivery-limit` to `-1` (unlimited) — this disables poison message protection and can lead to stuck consumers.
- Don't automatically reprocess DLQ messages without understanding why they failed — this can cause infinite loops of the same failure.
- Don't ignore DLQ monitoring — a silent DLQ that fills up is a delayed outage waiting to happen.
- Don't assume that a message in the DLQ is safe to discard — it may represent data loss that needs investigation.
- Don't use the same queue for both normal processing and dead-lettering — this complicates monitoring and can cause confusion.
- Don't forget that DLQs themselves can become poisoned if the DLQ consumer fails — monitor DLQ consumers too.
- Don't rely solely on broker-side DLQ mechanisms for Kafka — consider consumer-side pattern with separate failure topics.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| DLQ growing without bound | Consumer consistently failing to process certain messages | Investigate root cause; fix application bug or downstream dependency |
| Messages disappearing despite DLQ configuration | Missing or misconfigured dead-letter exchange/queue | Verify DLX binding and DLQ existence; check broker logs for dead-lettering errors |
| DLQ consumer crashing on DLQ messages | DLQ contains messages that also fail the DLQ consumer | Fix DLQ consumer to handle poisonous messages or inspect and discard |
| No messages in DLQ despite known failures | Delivery limit not exceeded or dead-lettering not configured | Check delivery count metrics; verify DLX/ DLQ setup |
| High broker resource usage despite DLQ | DLQ not consuming messages; backed-up main queue | Ensure DLQ consumer is running and properly configured |