---
language: "Backend Architecture"
tag: "architecture"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for cross-cutting backend architecture assets."
---

# Documentation Hub: Backend Architecture

> **Agent Directive (Phase 4)**: This hub is **cross-cutting** — it is not resolved from a
> dependency file. Evaluate it for any backend project that matches one of the triggers below,
> in addition to the language hub the project resolves to. A project can match both; judge
> each entry separately.
>
> **Triggers**: `docker-compose.yml` with two or more app services, `kustomization.yaml` or a
> `*.k8s.yaml` manifest set, `services/` or `apps/` as a top-level directory, a broker config
> (`kafka.properties`, `rabbitmq.conf`, or a `*broker*.yml`), or a `temporal`/`restate`/`dbos`
> dependency in any manifest file.
>
> **Status**: eight rules covering durable execution, event-publishing atomicity, vertical-slice
> organization, the service-extraction decision, idempotency keys, delivery guarantees, concurrent
> worker claims, and trace propagation. The extraction rule is deliberately the hard one: the common
> failure is splitting on architecture fashion rather than on a trigger.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/architecture/durable-execution-is-not-a-queue.md`
  - **Why**: Durable execution persists the workflow's position, not just its messages, so
    recovery resumes mid-sequence instead of restarting. The cost is a constraint that fails
    silently: replay re-executes the workflow body, so any `Date.now`, randomness, or direct I/O
    in it diverges the replay from the recorded history. The three runtimes differ on where that
    state lives, and DBOS's choice — same transaction as your business write — changes whether
    you need an outbox at all.
  - **When**: Target project has a workflow spanning multiple steps, lasting minutes or longer,
    or one that must survive a crash mid-sequence or pause for a human decision.
  - **Target Location**: `docs/rules/architecture/durable-execution-is-not-a-queue.md`

- **Path**: `rules/architecture/event-publishing-has-a-dual-write-problem.md`
  - **Why**: Writing to a database and publishing to a broker are two commits with no shared
    transaction, so no ordering of the two is always right. This names the three approaches that
    close the gap — transactional outbox, Change Data Capture via the replication log, and event
    sourcing — with the specific cost of each, and why duplicate delivery has to be assumed
    rather than designed away.
  - **When**: Target project writes to a database and publishes to Kafka, RabbitMQ, NATS, or a
    cloud queue, or runs a polling job that reads changed rows to trigger downstream work.
  - **Target Location**: `docs/rules/architecture/event-publishing-has-a-dual-write-problem.md`

- **Path**: `rules/architecture/vertical-slice-organizes-by-feature.md`
  - **Why**: A controllers/services/repositories layout makes one feature's change span four
    directories, concentrating merge conflicts in the shared layers. Slicing by feature makes
    the use case the unit of change. It also introduces real costs — infrastructure duplication
    and cross-cutting features that still cross slices — and it is the shared kernel that absorbs
    the duplication, deliberately, not by accident.
  - **When**: Target project is organized by technical layer and merge conflicts concentrate in
    one shared directory, or multiple teams are editing features against the same service layer.
  - **Target Location**: `docs/rules/architecture/vertical-slice-organizes-by-feature.md`

- **Path**: `rules/architecture/extract-a-service-only-for-a-named-trigger.md`
  - **Why**: Service decomposition has a running operational cost that is paid continuously —
    network calls that can fail, distributed transactions, deployment coupling, and debugging
    that crosses a process boundary. Most extractions do not buy back that cost, and the ones
    that do tend to have a named trigger: an independent scaling profile, an independent release
    cadence, a data-ownership boundary, a different runtime, or a team that must deploy without
    coordinating. This makes the trigger the decision, and the absence of one the default
    answer: stay a module.
  - **When**: Target project proposes extracting a module into a network service, or is
    adopting a microservice pattern for structure rather than for a trigger.
  - **Target Location**: `docs/rules/architecture/extract-a-service-only-for-a-named-trigger.md`

- **Path**: `rules/architecture/microservices-vs-monolith-approaches.md`
  - **Why**: Architectural style significantly impacts deployment complexity, team autonomy, scaling granularity, and operational overhead. Choosing microservices for the wrong reasons introduces distributed system complexity without benefits, while staying with a monolith too long creates deployment bottlenecks and coupling that hinders team productivity. The decision should align with concrete triggers like independent scaling needs, release cadence, team boundaries, and data ownership rather than architectural fashion.
  - **When**: Target project is evaluating architectural styles for service decomposition or experiencing deployment bottlenecks, team coordination overhead, or scaling limitations with a monolithic architecture.
  - **Target Location**: `docs/rules/architecture/microservices-vs-monolith-approaches.md`

- **Path**: `rules/idempotency/idempotency-keys-are-client-generated-and-scoped.md`
  - **Why**: A retry is not rare — a client whose `POST` response was lost must choose between a
    duplicate write and a lost one. The key has to exist before the request leaves the client
    (a server-minted key is lost with the response) and the lookup has to be scoped to something
    the client cannot supply alone (an unscoped key is a cross-tenant read primitive). Also covers
    the trap people fall into: the TTL window is *effectively*-once, not exactly-once, so a retry
    25 hours later is a second write. Notes that `Idempotency-Key` is a de-facto convention, not
    an RFC — the IETF draft expired in 2026.
  - **When**: Target project exposes POST or PATCH that clients are expected to retry — payment,
    billing, order creation, webhook receivers, or any endpoint whose callers have a retry loop.
  - **Target Location**: `docs/rules/idempotency/idempotency-keys-are-client-generated-and-scoped.md`

- **Path**: `rules/messaging/at-least-once-is-the-guarantee-you-get.md`
  - **Why**: Every crash-surviving broker redelivers sometimes, and "exactly-once" names a
    boundary rather than the journey to your database. Pairs the acknowledgement-ordering decision
    (ack-after-commit, because a duplicate is recoverable and a loss is not) with the dedupe
    pattern that makes a duplicate a no-op, and names the list-pop trap that loses work outright.
  - **When**: Target project consumes from a queue, stream, or broker and mutates state — a
    `kafka` consumer, a `bullmq`/`sidekiq` worker, a Redis `BRPOP` loop, or a `FOR UPDATE` job
    table poller.
  - **Target Location**: `docs/rules/messaging/at-least-once-is-the-guarantee-you-get.md`

- **Path**: `rules/messaging/concurrent-workers-need-a-real-claim-strategy.md`
  - **Why**: A SELECT-then-UPDATE job claim is correct on the happy path and corrupted under
    concurrency, and the corruption is intermittent enough to ship. The rule gives the three real
    options — `FOR UPDATE SKIP LOCKED`, idempotency-key-first workers, and honestly-scoped
    exactly-once emulation — and the failure mode for each. Applies to the SQL-job-table case as
    often as the broker case.
  - **When**: Target project has two or more workers or replicas claiming from the same source —
    a job table, a queue, or a shared work list.
  - **Target Location**: `docs/rules/messaging/concurrent-workers-need-a-real-claim-strategy.md`

- **Path**: `rules/observability/correlation-ids-are-just-trace-ids-plus-propagated-fields.md`
  - **Why**: A bespoke `X-Correlation-Id` solves logging and then costs you a propagation hop in
    every framework between ingress and datastore — miss one and the trail breaks silently. W3C
    Trace Context is the standard carrier and the tooling already in the stack ingests it. The
    rule also separates the two fields people conflate: `tracestate` is a size-boxed,
    vendor-state container, while business identifiers belong in W3C `Baggage`.
  - **When**: Target project fans a request across processes, queues, or databases and needs to
    join logs across those hops — or has hand-rolled a correlation header and is wondering why
    traces break in the async leg.
  - **Target Location**: `docs/rules/observability/correlation-ids-are-just-trace-ids-plus-propagated-fields.md`

- **Path**: `rules/kubernetes/liveness-probe-causes-cascading-failures.md`
  - **Why**: Liveness probe failures trigger container restarts; under load, this can shift work to surviving instances and cause cascading failures.
  - **When**: Target project uses Kubernetes liveness probes to check container health, especially for long-running services or microservices.
  - **Target Location**: `docs/rules/kubernetes/liveness-probe-causes-cascading-failures.md`

- **Path**: `rules/kubernetes/readiness-and-startup-are-different-questions.md`
  - **Why**: Startup probes gate liveness/readiness during init; readiness probes control traffic routing; using the wrong probe type leads to premature traffic or delayed failure detection.
  - **When**: Target project has containers that need extra time to start (e.g., Java/Spring) or uses probes to gate traffic via Services.
  - **Target Location**: `docs/rules/kubernetes/readiness-and-startup-are-different-questions.md`

- **Path**: `rules/kubernetes/namespaces-are-not-a-tenancy-boundary.md`
  - **Why**: Namespaces provide name scoping and policy attachment but do not isolate resources strongly enough for multi-tenancy security.
  - **When**: Target project uses Kubernetes namespaces to separate environments, teams, or components and needs to understand isolation limits.
  - **Target Location**: `docs/rules/kubernetes/namespaces-are-not-a-tenancy-boundary.md`

- **Path**: `rules/kubernetes/resource-requests-limits-qos-class.md`
  - **Why**: Resource requests and limits determine QoS class (Guaranteed/Burstable/BestEffort), which influences scheduling and eviction decisions.
  - **When**: Target project sets resource requests/limits on containers or pods and needs to understand scheduling and eviction behavior.
  - **Target Location**: `docs/rules/kubernetes/resource-requests-limits-qos-class.md`

## 2. Skills (`skills/`)

_Empty — no cross-cutting backend architecture workflows synthesized yet._

## 3. Agents (`agents/`)

_Empty — architecture guidance is delivered as rules; a persona would duplicate the language
hubs without adding routing._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/architecture/backend-design-patterns.md`
  - **Why**: The GoF catalogue, the architectural and code anti-patterns, and the per-stack
    considerations for .NET, Go, Laravel, and Python. It is a reference to consult when choosing
    a pattern, not a constraint to obey — which is why it is shared rather than a rule.
  - **When**: Target project is choosing between patterns, or a review proposes one and the
    question is whether it fits the situation.
  - **Target Location**: `docs/architecture/backend-design-patterns.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.