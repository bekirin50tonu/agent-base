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
> **Status**: four rules covering durable execution, event-publishing atomicity, vertical-slice
> organization, and the service-extraction decision. The extraction rule is deliberately the
> hard one: the common failure is splitting on architecture fashion rather than on a trigger.

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

## 2. Skills (`skills/`)

_Empty — no cross-cutting backend architecture workflows synthesized yet._

## 3. Agents (`agents/`)

_Empty — architecture guidance is delivered as rules; a persona would duplicate the language
hubs without adding routing._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/architecture/design-patterns-library.md`
  - **Why**: The GoF catalogue, the architectural and code anti-patterns, and the per-stack
    considerations for .NET, Go, Laravel, and Python. It is a reference to consult when choosing
    a pattern, not a constraint to obey — which is why it is shared rather than a rule.
  - **When**: Target project is choosing between patterns, or a review proposes one and the
    question is whether it fits the situation.
  - **Target Location**: `docs/architecture/design-patterns-library.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.