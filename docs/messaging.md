---
language: "Messaging"
tag: "messaging"
ecosystem: "backend"
last_updated: "2026-10-01"
summary: "Routing hub and decision matrix for messaging assets."
---

# Documentation Hub: Messaging

> **Agent Directive (Phase 4)**: Inspect the target project for messaging usage patterns.
> Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.

> **Status**: 4 rules covering RabbitMQ exchange and binding topology, quorum vs classic queues,
> delivery limit behavior, and Kafka KRaft replacing ZooKeeper, plus the existing 2 rules
> (`at-least-once-is-the-guarantee-you-get.md` and `concurrent-workers-need-a-real-claim-strategy.md`).

> **Scope**: This hub covers message broker patterns, delivery guarantees, consumer behaviors,
> and streaming platform architectures. Since messaging systems are used across backend,
> frontend (via websockets or webhooks), and data science projects, this hub serves as a
> cross-cutting concern for asynchronous communication patterns.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/messaging/rabbitmq-exchange-and-binding-topology.md`
  - **Why**: RabbitMQ exchanges route messages to queues based on bindings; the default exchange auto-binds by queue name, topic exchanges use `#` and `*` wildcards, and binding durability inherits from both exchange and queue.
  - **When**: Target project uses RabbitMQ for messaging and needs to understand exchange types, binding behavior, and routing reliability.
  - **Target Location**: `docs/rules/messaging/rabbitmq-exchange-and-binding-topology.md`

- **Path**: `rules/messaging/quorum-queue-not-classic-queue.md`
  - **Why**: Quorum queues use Raft replication and differ from classic queues in delivery semantics (x-delivery-limit counts delivery-count), prefetch behavior (global QoS unsupported), and features (no TTL/max-length).
  - **When**: Target project is considering or using RabbitMQ quorum queues and needs to understand their characteristics compared to classic queues.
  - **Target Location**: `docs/rules/messaging/quorum-queue-not-classic-queue.md`

- **Path**: `rules/messaging/delivery-limit-drops-messages-without-a-dlx.md`
  - **Why**: When delivery count exceeds x-delivery-limit, messages are dropped unless a dead-letter exchange is configured; starting in RabbitMQ 4.3, the limit counts delivery-count not acquired-count.
  - **When**: Target project consumes from RabbitMQ queues and needs to configure poison message handling and dead-lettering.
  - **Target Location**: `docs/rules/messaging/delivery-limit-drops-messages-without-a-dlx.md`

- **Path**: `rules/kafka/kraft-replaces-zookeeper.md`
  - **Why**: Kafka KRaft mode replaces ZooKeeper with an internal Raft-based metadata controller, simplifying deployment and removing external dependency.
  - **When**: Target project uses Kafka and needs to understand the migration path from ZooKeeper to KRaft or configure new clusters in KRaft mode.
  - **Target Location**: `docs/rules/kafka/kraft-replaces-zookeeper.md`

## 2. Skills (`skills/`)

- **Path**: `skills/messaging/dead-letter-strategy/SKILL.md`
  - **Why**: Dead-letter queues are essential for handling poison messages, but misconfiguration can lead to silent message loss or operational overhead.
  - **When**: Target project uses message brokers and needs to implement a dead-letter strategy for poison message handling.
  - **Target Location**: `docs/skills/messaging/dead-letter-strategy/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/messaging/agent.json`
  - **Why**: Helps with messaging-related tasks, such as configuring brokers, understanding delivery guarantees, and troubleshooting consumer issues.
  - **When**: Target project uses messaging systems (has broker configurations, consumer code, or messaging client libraries).
  - **Target Location**: `docs/agents/messaging/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/architecture/backend-design-patterns.md`
  - **Why**: The GoF catalogue, the architectural and code anti-patterns, and the per-stack considerations for .NET, Go, Laravel, and Python. It is a reference to consult when choosing patterns, not a constraint to obey.
  - **When**: Target project is choosing between patterns, or a review proposes one and the question is whether it fits the situation.
  - **Target Location**: `docs/architecture/backend-design-patterns.md`

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset`
and commit the file in the same push that updates this hub — otherwise consumers get a 404.