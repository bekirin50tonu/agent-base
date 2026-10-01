---
title: "Message Ordering and Exactly-Once Semantics in Messaging Systems"
rule_id: "RULE-MESSAGING-006"
category: "correctness"
scope: "all"
applies_to: "Messaging"
last_updated: "2026-10-01"
source: "https://kafka.apache.org/documentation/#semantics, https://kafka.apache.org/documentation/#design_guarantees, https://www.rabbitmq.com/reliability.html"
---

# Message Ordering and Exactly-Once Semantics in Messaging Systems
Message ordering guarantees and exactly-once semantics are critical for data correctness in messaging systems, but they come with important trade-offs and limitations. Understanding what guarantees your broker actually provides—and under what conditions—is essential to avoid silent data corruption or duplication.

## Why
Messaging systems provide different levels of ordering and delivery guarantees that directly impact application correctness:
- **Ordering**: Ensures messages are processed in the sequence they were sent (critical for financial transactions, event sourcing, or state changes).
- **Exactly-once**: Guarantees each message is processed exactly one time (prevents duplicate actions like double-charging or duplicate state updates).

However, these guarantees are not absolute:
- Kafka provides ordering only within a partition, not across topics or partitions.
- Exactly-once semantics in Kafka require idempotent producers and transactional APIs, and only apply to producing to Kafka and consuming from Kafka—not to external systems.
- RabbitMQ provides no inherent ordering guarantees across queues or exchanges; ordering within a queue depends on consumer acknowledgment behavior.
- "Exactly-once" is often a myth in distributed systems—what's usually achievable is "effectively-once" through deduplication or idempotency.

Application designers must understand these limitations to build correct systems that handle duplicates gracefully and don't rely on stronger guarantees than the system actually provides.

## Do
- **For ordering requirements**:
  - In Kafka: ensure all related messages go to the same partition (same key) if ordering is required.
  - In RabbitMQ: use a single queue per ordering chain, or implement application-level sequencing if cross-queue ordering is needed.
  - Never assume FIFO delivery across multiple queues, partitions, or topics without explicit design.
  - Use message timestamps or sequence numbers in the payload for application-level reordering if needed.
- **For exactly-once processing**:
  - Design consumers to be idempotent (safe to process the same message multiple times).
  - Use deduplication IDs in messages and maintain a record of processed IDs (e.g., in a database or cache).
  - In Kafka: use the transactional API for producers and enable `enable.idempotence=true` for exactly-once production to Kafka topics.
  - In RabbitMQ: publisher confirms + consumer acknowledgmos + idempotent consumers provide a practical exactly-once-like guarantee.
  - Track processing state externally (e.g., database transactions that include both business logic and marker that message was processed).
- **General practices**:
  - Always assume messages can be delivered more than once (at-least-once delivery is the norm).
  - Design business logic to handle duplicates gracefully (e.g., "INSERT ... ON CONFLICT DO NOTHING" or check-if-exists before creating).
  - Use consensus protocols or distributed transactions only when absolutely necessary—prefer idempotency and deduplication.
  - Monitor for duplicate processing and alert when deduplication logic is triggered frequently.
  - Test failure scenarios: kill consumers mid-process, restart brokers, and verify no data loss or duplication occurs.

## Don't
- Don't assume Kafka provides global ordering across partitions or topics—it only guarantees ordering within a single partition.
- Don't assume RabbitMQ preserves message order when using multiple consumers on a queue without understanding acknowledgment behavior.
- Don't rely on "exactly-once delivery" as a broker feature—focus on idempotent consumers and deduplication instead.
- Don't use Kafka transactions for every message—they have significant throughput overhead; batch or use idempotent producers for high-volume scenarios.
- Don't assume that enabling idempotent producers in Kafka makes your end-to-end processing exactly-once—it only applies to producing to Kafka.
- Don't ignore that consumer failures can cause message redelivery even with acknowledgments (if ack is sent after processing but processing fails afterward).
- Don't use per-message Kafka transactions for high-throughput use cases—consider idempotent producers instead.
- Don't assume that RabbitMQ publisher guarantees apply to the message journey—they only confirm the broker received the message, not that it was routed or consumed.
- Don't build systems that break if a message is processed twice—design for duplicates from the start.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Duplicate database writes or side effects | Consumer processed same message multiple times due to retry or restart | Make consumer idempotent or implement deduplication using message ID |
| Inconsistent state due to out-of-order processing | Messages processed from different partitions/queues without coordination | Ensure related messages share the same key (Kafka) or use a single queue (RabbitMQ) |
| Message loss during broker restart | Producer not waiting for acknowledgments or using async sends | Use synchronous produces or wait for publisher confirms |
| Silent data corruption | Assuming exactly-once when system only provides at-least-once | Add application-level deduplication or idempotency checks |
| Performance degradation | Using Kafka transactions for every message | Enable producer idempotence (`enable.idempotence=true`) instead of per-message transactions |
| Out-of-order events in event sourcing | Consuming from multiple Kafka partitions without merge logic | Use Kafka Streams or application logic to merge partition streams in order |
| Duplicate processing after consumer crash | Acknowledgments sent before processing completes | Move acknowledgment to after processing completes successfully |
| Increased latency | Waiting for synchronous produces or transactions | Batch messages or use idempotent producers for better throughput |
| Consumer starvation | One slow consumer holding up queue due to redelivery | Increase consumer count, use competing consumers, or implement priority queues |

## Verifying
- Check Kafka producer config: `enable.idempotence=true` and `acks=all` for strongest ordering and durability guarantees.
- Verify consumer group processing: `kafka-consumer-groups --describe` shows lag and offset distribution.
- Test with duplicate messages: send the same message twice and verify your consumer handles it correctly.
- Monitor for duplicate processing: increment a counter when a duplicate message ID is detected.
- Check RabbitMQ publisher confirms: ensure your publisher waits for confirms before considering a message sent.
- Verify queue ordering: send numbered messages to a single queue with one consumer and verify they arrive in order.
- Test failure scenarios: kill broker/consumer mid-process and verify recovery behavior.
- Review application logs for duplicate processing warnings or errors.
- Check that your deduplication store (e.g., Redis set, database table) is properly sized and doesn't grow indefinitely.