---
title: "RabbitMQ Exchange and Binding Topology"
rule_id: "RULE-MESSAGING-002"
category: "correctness"
scope: "all"
applies_to: "RabbitMQ"
last_updated: "2026-10-01"
source: "https://www.rabbitmq.com/docs/exchanges"
---

# RabbitMQ Exchange and Binding Topology
RabbitMQ exchanges route messages to queues based on bindings. The default exchange is a direct exchange with empty name that auto-binds every queue by queue name. Topic exchanges use `#` for zero-or-more words and `*` for exactly one word in routing keys. Binding durability inherits from both source exchange and destination queue, which can lead to inconsistent routing when nodes hosting non-replicated classic queues are stopped.

## Why
Exchanges are the routing layer of RabbitMQ. Understanding exchange types and binding behavior is crucial for designing reliable message topologies:
- The **default exchange** (empty name, direct type) automatically binds queues using their name as the routing key — enabling simple direct publishing without explicit bindings.
- **Topic exchanges** interpret `.` as word delimiters: `#` matches zero or more words, `*` matches exactly one word.
- **Binding durability** depends on both the exchange durability and the queue durability — if either is transient, the binding is not surviving broker restarts.
- Stopping a node hosting non-replicated classic queues removes transient queues and semi-durable bindings; rapid remove/re-add cycles can yield inconsistent routing state.
- Preferring policies over hardcoded `x-arguments` avoids redeployment needs when changing routing behavior.
- **E2E (head-of-line) bindings** route a message exactly once and do not update destination queue ingress metrics on redelivery.

## Do
- Use the **default exchange** for simple direct routing: publish to `""` (empty string) with routing key equal to target queue name — no explicit binding needed.
- Use **topic exchanges** for hierarchical routing: `#` for subtree matches (e.g., `audit.#`), `*` for single-level wildcards (e.g., `audit.*.third`).
- Make exchanges and queues **durable** if you need bindings to survive broker restarts: set `durable: true` when declaring both.
- Use **policies** to set exchange/queue arguments (like `alternate-exchange`) — policies can be changed at runtime without redeclaring objects.
- Prefer **lazy queues** for long-lived backlogs: they swap pages to disk earlier, reducing RAM pressure.
- Monitor **binding churn** via `rabbitmqctl list_bindings` or the management API — frequent binding changes can indicate unstable topology.
- When using **alternate exchanges**, publish unroutable messages to them for dead-lettering or inspection.
- For **high-throughput topologies**, consider using multiple exchanges to avoid single-point contention.

## Don't
- Don't assume binding durability from exchange durability alone — both exchange and queue must be durable for the binding to survive restarts.
- Don't rely on transient queues or semi-durable bindings for critical message paths — stopping a node will lose them.
- Don't perform rapid remove/re-add cycles of exchanges/queues hosting non-replicated classic queues — this can lead to inconsistent routing state during the window.
- Don't hardcode routing logic in `x-arguments` if it might change; use policies instead so updates don't require producer/consumer redeployment.
- Don't forget that **E2E bindings** only count a message once toward ingress metrics, even if redelivered multiple times — plan monitoring accordingly.
- Don't use topic exchanges without understanding the word-boundary semantics: `.` separates words, so `audit.#.update` matches `audit.tenant.update` but not `audit.tenant.account.update`.
- Don't publish directly to a queue name via the default exchange unless you're sure no other binding uses that routing key — the default exchange blindly matches routing key to queue name.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Messages disappearing despite correct publishing | Bindings lost due to transient exchange/queue or node failure | Make exchanges and queues durable; use mirrored or quorum queues for HA |
| Routing inconsistencies after node restart | Semi-durable bindings lost when node hosting non-replicated classic queue stopped | Use mirrored/quorum queues; avoid relying on non-replicated classic queues for bindings |
| Wildcard topics not matching as expected | Misunderstanding `#` (zero-or-more) vs `*` (exactly one) semantics | Test topic patterns with actual publishing; remember `.` is word delimiter |
| Sudden drop in throughput after topology change | Hardcoded `x-arguments` requiring redeployment | Use policies for exchange/queue arguments; update policies at runtime |
| Messages routed to wrong queue despite correct keys | Binding to wrong exchange or queue due to typo in declaration | Validate exchange/queue names in client code; use configuration management |
| Binding explosion causing high memory usage | Too many dynamic bindings (e.g., per-user exchanges) | Consider alternate architectures like sharding or using message headers for routing |