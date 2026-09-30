---
title: "Quorum Queue Is Not a Classic Queue"
rule_id: "RULE-MESSAGING-003"
category: "correctness"
scope: "all"
applies_to: "RabbitMQ"
last_updated: "2026-10-01"
source: "https://www.rabbitmq.com/docs/quorum-queues"
---

# Quorum Queue Is Not a Classic Queue
Quorum queues replicate state via Raft and provide strong consistency guarantees, but they differ fundamentally from classic queues in behavior, features, and performance characteristics. Treating a quorum queue as a drop-in replacement for a classic queue can lead to unexpected errors, missing features, or performance bottlenecks.

## Why
Classic queues store messages in a single Erlang process per queue (or mirrored across nodes). Quorum queues use a Raft-based replicated log across multiple nodes, which changes several aspects:
- **Message ordering**: Quorum queues guarantee FIFO order within a producer-connection channel; classic queues guarantee FIFO only per queue (but can be affected by prefetch and consumer acknowledgments).
- **Delivery semantics**: Starting with RabbitMQ 4.3, the `x-delivery-limit` counts `delivery-count` (number of times a message was delivered to a consumer), not `acquired-count` (number of times it was taken from the queue). This means that `nack` or `reject` with `requeue=false` (or `delivery_failed=false`) no longer increments the limit.
- **Prefetch behavior**: Global QoS prefetch is not supported with quorum queues — attempting to set a channel-level basic.qos returns a channel error. Per-consumer prefetch must be used instead.
- **Queue declaration**: The `x-queue-type` argument must be set to `quorum` at declaration time; it cannot be added or changed via policy.
- **Features missing**: Quorum queues do not support message TTL, max-length, max-length-bytes, overflow behavior (drop-head/publish-reject), or lazy queue behavior.
- **Performance**: Higher latency per publish due to network round trips for Raft consensus; lower throughput compared to classic queues under low-latency, high-concurrency workloads.
- **Leader election**: If the leader node fails, a new leader is elected — during this brief window, the queue is unavailable for writes.
- **Memory usage**: All nodes in the quorum hold the full queue state (replicated log), so memory usage scales with queue depth across all replicas.

## Do
- Use quorum queues when you need **high availability** and **strong consistency** guarantees (survives node failures without losing messages).
- Set `x-delivery-limit` to control poison message handling; remember that starting in 4.3 it counts delivery attempts, not acquisitions.
- Use **per-consumer prefetch** (`basic.qos` with `global:false`) to control how many messages each consumer can have unacknowledged.
- Monitor **leader status** and **replication lag** via the Prometheus exporter or `rabbitmqctl quorum_queue_status`.
- Size your cluster for **three or five nodes** to tolerate one or two node failures, respectively (dynamic quorum changes allowed in RabbitMQ 4.1+).
- Consider **classic mirrored queues** if you need features like TTL, max-length, or lazy behavior — but accept the weaker consistency guarantees during network partitions.
- Use **quorum queues for short-lived workloads** (e.g., task queues with quick processing) where the higher latency is acceptable.
- Enable **consumer timeout** (since 4.3) to detect stuck consumers: `x-consumer-timeout` and `x-consumer-timeout-mode`.
- Use **delayed retry** (since 4.3) for backoff: `x-delayed-delay`, `x-delayed-exchange`, `x-delayed-type`.

## Don't
- Don't assume quorum queues support **message TTL** or **max-length** — those arguments are ignored if set.
- Don't use **global QoS prefetch** with quorum queues — it will return a channel error; use per-consumer prefetch instead.
- Don't try to change `x-queue-type` via policy or redeclaration — it must be set at initial queue declaration.
- Don't expect **lazy queue** behavior — quorum queues always hold messages in memory (on disk as part of the Raft log, but all nodes maintain full state).
- Don't use quorum queues for **high-throughput, low-latency** publish/subscribe workloads where classic queues would perform better.
- Don't forget that **adding/removing nodes** triggers a new leader election and brief unavailability window.
- Don't monitor queue depth via classic queue metrics alone — quorum queues store the full log on each node, so disk usage is higher.
- Don't use **overflow behaviors** (reject-publish, drop-head) — they are not supported and will be ignored.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Channel error when setting prefetch | Global QoS (`basic.qos` with `global:true`) unsupported on quorum queues | Use per-consumer prefetch (`global:false`) |
| Messages not being limited by `x-delivery-limit` | Starting in 4.3, limit counts `delivery-count`, not `acquired-count`; `nack`/`reject` with `requeue=false` no longer counts | This is the new behavior; adjust expectations or use `x-consumer-timeout` to handle stuck consumers |
| Queue declaration failing with `x-queue-type` not allowed | Attempting to set queue type via policy | Set `x-queue-type=quorum` in the queue declaration arguments |
| Higher than expected latency per publish | Raft consensus requires network round trips to a majority of nodes | Consider classic mirrored queues for lower latency if strong consistency is not required |
| Queue unavailable during leader election | Leader node failure triggers election | Use 5-node quorum to tolerate 2 failures; monitor leader changes via events |
| Memory usage higher than expected | All replica nodes hold full queue state (Raft log) | Monitor memory per node; consider classic queues if memory is a constraint |
| Missing features like TTL or max-length | Those arguments are ignored on quorum queues | Use classic queues or application-level TTL if needed |