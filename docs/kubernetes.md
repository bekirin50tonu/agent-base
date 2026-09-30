---
language: "Kubernetes"
tag: "kubernetes"
ecosystem: "backend"
last_updated: "2026-10-01"
summary: "Routing hub and decision matrix for Kubernetes assets."
---

# Documentation Hub: Kubernetes

> **Agent Directive (Phase 4)**: Inspect the target project for Kubernetes usage patterns.
> Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.

> **Status**: 6 rules covering liveness probe cascading failures, readiness vs startup probe semantics,
> namespace limitations, resource requests/QoS class relationships, pod disruption budgets for
> high availability, and priority classes and preemption, plus 1 shared asset on resource requests and QoS classes.

> **Scope**: This hub covers Kubernetes cluster orchestration, pod lifecycle management,
> resource allocation, and eviction policies. Since Kubernetes is used across backend,
> frontend (via dev tools), and data science projects, this hub serves as a cross-cutting
> concern for container orchestration patterns.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

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

- **Path**: `rules/kubernetes/pod-disruption-budgets-ensure-high-availability.md`
  - **Why**: Pod Disruption Budgets (PDBs) limit the number of pods of a replicated application that can be down simultaneously from voluntary disruptions, ensuring high availability during cluster operations like node drains, upgrades, and autoscaling. PDBs work with the Eviction API to gracefully evict pods while respecting availability constraints.
  - **When**: Target project uses Kubernetes Deployments, StatefulSets, or other controllers managing replicated pods and needs to maintain availability during voluntary disruptions such as node drains or cluster autoscaling.
  - **Target Location**: `docs/rules/kubernetes/pod-disruption-budgets-ensure-high-availability.md`

- **Path**: `rules/kubernetes/priority-classes-and-preemption.md`
  - **Why**: Priority Classes allow you to assign importance values to Pods, enabling the scheduler to preempt (evict) lower priority Pods when resources are needed for higher priority Pods. Preemption ensures critical workloads can be scheduled even under resource pressure, but misconfiguration can lead to unintended evictions or starvation.
  - **When**: Target project uses Kubernetes and needs to ensure critical workloads are scheduled first during resource pressure, or to prevent certain workloads from being preempted.
  - **Target Location**: `docs/rules/kubernetes/priority-classes-and-preemption.md`

## 2. Skills (`skills/`)

- **Path**: `skills/kubernetes/debug-crashloop-backoff/SKILL.md`
  - **Why**: CrashLoopBackOff is a common Kubernetes failure mode where containers crash, restart, and repeat. This skill provides a systematic approach to diagnosing the root cause.
  - **When**: Target project has pods stuck in CrashLoopBackOff state or needs to troubleshoot Kubernetes application failures.
  - **Target Location**: `docs/skills/kubernetes/debug-crashloop-backoff/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/kubernetes/agent.json`
  - **Why**: Helps with Kubernetes-related tasks, such as debugging pod issues, understanding resource usage, and interpreting kubectl output.
  - **When**: Target project uses Kubernetes (has deployments, services, or kubectl configured).
  - **Target Location**: `docs/agents/kubernetes/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/kubernetes/resource-requests-and-qos-classes.md`
  - **Why**: Requests = guarantee, limits = ceiling; QoS class is derived from the relationship between requests and limits across all containers in a pod.
  - **When**: Target project configures resource requests and limits for containers and needs to understand scheduling, eviction, and QoS behavior.
  - **Target Location**: `docs/shared/kubernetes/resource-requests-and-qos-classes.md`

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset`
and commit the file in the same push that updates this hub — otherwise consumers get a 404.