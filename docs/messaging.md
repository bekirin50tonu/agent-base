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

> **Status**: 16 rules covering RabbitMQ exchange and binding topology, quorum vs classic queues,
> delivery limit behavior, Kafka KRaft replacing ZooKeeper, Kafka consumer and producer defaults
> (auto-commit, offset reset, poll-interval budget, idempotence, `acks`, delivery timeout, and the
> two rebalance-protocol rules), schema evolution safety, consumer lag monitoring, dead letter queue
> patterns, and message ordering/exactly-once semantics, plus the existing 2 rules
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

- **Path**: `rules/kafka/auto-commit-defaults-to-true.md`
  - **Why**: `enable.auto.commit` defaults to true, so the library commits offsets on a timer the consumer never chose and never sees. A record processed but not yet applied downstream is marked consumed anyway, and a crash loses it with no error.
  - **When**: Target project runs a Kafka consumer group and offset handling, reprocessing, or idempotency was never an explicit decision.
  - **Target Location**: `docs/rules/kafka/auto-commit-defaults-to-true.md`

- **Path**: `rules/kafka/auto-offset-reset-defaults-to-latest.md`
  - **Why**: `auto.offset.reset` defaults to `latest`, so a consumer with no committed offset — a new group, or one whose offsets expired — silently skips the entire retained backlog and reports zero lag while doing it.
  - **When**: Target project builds state from a Kafka stream, or a consumer group has produced unexpectedly empty or partial output.
  - **Target Location**: `docs/rules/kafka/auto-offset-reset-defaults-to-latest.md`

- **Path**: `rules/kafka/max-poll-records-is-a-time-budget-in-disguise.md`
  - **Why**: The defaults of 500 records and a 5-minute poll interval impose a 600 ms per-record deadline that neither setting states. Exceeding it evicts the consumer from the group and triggers a rebalance storm in which every member is healthy and merely slow.
  - **When**: Target project has a Kafka poll loop doing per-record I/O, or sees repeated rebalances with no corresponding failures.
  - **Target Location**: `docs/rules/kafka/max-poll-records-is-a-time-budget-in-disguise.md`

- **Path**: `rules/kafka/idempotence-is-disabled-by-conflicting-config.md`
  - **Why**: `enable.idempotence` defaults to true but is silently disabled when conflicting configs are set and it is not stated explicitly; the resulting `ConfigException` only fires when it is enabled explicitly. Retries can then produce duplicates in production and pass in tests.
  - **When**: Target project configures Kafka producer retries, or is deduplicating consumer output to compensate for at-least-once delivery.
  - **Target Location**: `docs/rules/kafka/idempotence-is-disabled-by-conflicting-config.md`

- **Path**: `rules/kafka/acks-levels-have-different-failure-modes.md`
  - **Why**: The three `acks` levels are three guarantees with three failure modes: `acks=0` makes retries inert and returns offset `-1` always, while `acks=1` acknowledges before replication, so a leader failure loses an acknowledged record with no producer error.
  - **When**: Target project chooses producer durability settings, or is investigating records that disappeared without any surfaced error.
  - **Target Location**: `docs/rules/kafka/acks-levels-have-different-failure-modes.md`

- **Path**: `rules/kafka/delivery-timeout-is-the-real-retry-budget.md`
  - **Why**: `retries` cannot express a time bound; `delivery.timeout.ms` does, and must be at least `request.timeout.ms` + `linger.ms`. Tuning either one for throughput or a slow broker breaks the invariant, and the resulting `TimeoutException` rate worsens when `linger.ms` is raised to help.
  - **When**: Target project sees Kafka `TimeoutException` on send, or tunes `linger.ms`, `request.timeout.ms`, or retry settings on a producer.
  - **Target Location**: `docs/rules/kafka/delivery-timeout-is-the-real-retry-budget.md`

- **Path**: `rules/kafka/consumer-protocol-makes-client-timeouts-unusable.md`
  - **Why**: Setting `group.protocol=consumer` makes `heartbeat.interval.ms`, `session.timeout.ms`, and `partition.assignment.strategy` unusable — no warning — and replaces them with broker-side `group.consumer.*` configs whose heartbeat default is 5000 ms against the client's 3000 ms, silently widening failure detection.
  - **When**: Target project sets or is planning `group.protocol=consumer`, or its Kafka client timeout behaviour changed across a version upgrade.
  - **Target Location**: `docs/rules/kafka/consumer-protocol-makes-client-timeouts-unusable.md`

- **Path**: `rules/kafka/group-protocol-conversion-needs-an-empty-group.md`
  - **Why**: Online migration off the classic rebalance protocol is available only when the group uses an assignor that embeds no custom metadata, which a custom `ConsumerPartitionAssignor` always does. The four stock assignors collapse to two server-side ones, and Kafka 5.0 flips the default with no config change.
  - **When**: Target project uses a custom partition assignor, is upgrading across Kafka 5.0, or is planning a rebalance-protocol migration.
  - **Target Location**: `docs/rules/kafka/group-protocol-conversion-needs-an-empty-group.md`

- **Path**: `rules/messaging/schema-evolution-safety.md`
  - **Why**: Schema evolution—changing the structure of messages over time—is inevitable in production systems, but unsafe evolution can break consumers, cause data loss, or require costly downtime. Safe schema evolution requires backward and forward compatibility strategies, versioning approaches, and contract testing.
  - **When**: Target project uses messaging systems with structured data (JSON, Avro, Protobuf) and needs to evolve message schemas safely without breaking consumers or causing data loss.
  - **Target Location**: `docs/rules/messaging/schema-evolution-safety.md`

- **Path**: `rules/messaging/consumer-lag-monitoring.md`
  - **Why**: Consumer lag—the difference between the current head of a stream and the position of a consumer group—is a critical metric for detecting processing delays and potential consumer failures in streaming systems. Effective lag monitoring requires understanding what lag indicates, setting appropriate alerts, and designing systems to handle lag gracefully.
  - **When**: Target project uses streaming messaging systems (Kafka, RabbitMQ, Redis Streams) and needs to monitor consumer processing health and detect potential bottlenecks or failures.
  - **Target Location**: `docs/rules/messaging/consumer-lag-monitoring.md`

- **Path**: `rules/messaging/dead-letter-queue-patterns.md`
  - **Why**: Dead Letter Queues (DLQs) are essential for handling messages that repeatedly fail processing, but improper implementation can lead to message loss, operational overhead, or false sense of security. Effective DLQ patterns require careful consideration of failure types, retry strategies, and monitoring approaches.
  - **When**: Target project uses message brokers and needs to implement resilient poison message handling without losing visibility into failure patterns.
  - **Target Location**: `docs/rules/messaging/dead-letter-queue-patterns.md`

- **Path**: `rules/messaging/message-ordering-and-exactly-once-semantics.md`
  - **Why**: Message ordering guarantees and exactly-once semantics are critical for data correctness in messaging systems, but they come with important trade-offs and limitations. Understanding what guarantees your broker actually provides—and under what conditions—is essential to avoid silent data corruption or duplication.
  - **When**: Target project requires guaranteed message ordering or exactly-once processing semantics and needs to understand the actual guarantees provided by their messaging system.
  - **Target Location**: `docs/rules/messaging/message-ordering-and-exactly-once-semantics.md`

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

- **Path**: `shared/messaging/offset-commit-strategy-decision-matrix.md`
  - **Why**: The consumer offset settings are one decision, not three knobs. A matrix of requirement × `auto.offset.reset` × `enable.auto.commit` × batch handling, showing which rows are reachable by configuration and which require storing the offset beside the output.
  - **When**: Target project configures a Kafka consumer group, reviews offset-commit strategy, or claims exactly-once delivery to a sink that is not another Kafka topic.
  - **Target Location**: `docs/messaging/offset-commit-strategy-decision-matrix.md`

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset`
and commit the file in the same push that updates this hub — otherwise consumers get a 404.