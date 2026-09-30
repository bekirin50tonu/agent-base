---
title: "Durable Execution Is Not a Queue With Retries"
rule_id: "RULE-ARCH-002"
category: "architecture"
scope: "all"
applies_to: "Any backend with multi-step, long-running, or crash-sensitive workflows"
last_updated: "2026-09-30"
source: "https://temporal.io/blog/durable-digest-august-2026, https://docs.dbos.dev/, https://restate.dev/, https://www.thoughtworks.com/radar/techniques/ignoring-durability-in-agent-workflows"
---

# Durable Execution Is Not a Queue With Retries

A durable execution runtime persists the *progress* of a workflow, not just its messages.
That distinction is the whole value and the whole trap: the runtime replays your workflow
from the beginning on recovery, and anything not wrapped in a deterministic step runs twice.

## Why

The naive alternative — a job queue plus a retry policy — gives you at-least-once delivery of
*messages*. It does not give you a resumable *position*. When the worker dies between step 3
and step 4, a queue redelivers the job; your code restarts from the beginning and has to
re-derive everything it already did. Durable execution stores the workflow history externally,
so recovery resumes at the recorded step rather than the start.

The cost is a constraint most codebases violate on first contact: **the workflow body must be
deterministic**. Replay re-executes it, so non-deterministic work — `Date.now()`, random
numbers, direct I/O, calls to `Date`-bearing APIs — must be moved behind the runtime's
deterministic primitives, or the replay diverges from the recorded history and the workflow
corrupts.

The three mature implementations differ in where that state lives:

| Runtime | State location | Consequence |
|---|---|---|
| **Temporal** | External event-sourced workflow history; SDKs for many languages | Language-agnostic, but the history is a separate store from your database |
| **DBOS** | Postgres (or CockroachDB), with each step committing in the same transaction as the business logic | The step and its data change are atomic — no outbox needed for the workflow's own writes |
| **Restate** | Purpose-built distributed log in a single binary | Lowest latency of the three by its own claims; separate deployment to operate |

DBOS's coupling is the one most often missed: because the step commits in the same transaction
as your business logic, you cannot treat the database as a follower of the workflow. Get that
wrong and you build an outbox that the runtime already provides.

Thoughtworks placed *"Ignoring durability in agent workflows"* in the **Caution** ring of the
April 2026 radar, noting durable execution now has integrations inside LangGraph and Pydantic
AI. Caution is the useful signal: the pattern is established enough to have a failure mode, and
the failure mode is that it gets adopted for workflows that never needed it.

## Do

- Use a durable runtime when a workflow is multi-step, spans minutes or hours, must survive a
  crash mid-sequence, or needs to be resumed from a human decision made days later.
- Keep the workflow body deterministic: no wall-clock reads, no randomness, no direct network
  or database calls outside the runtime's deterministic primitives. Move them into activities.
- Treat activities as at-least-once and make their side effects idempotent. Replay is the normal
  recovery path, not an exception.
- Pick the runtime by where the state should live, not by benchmark. DBOS if the workflow's
  writes must be atomic with your relational data; Temporal if you need SDK coverage across
  languages; Restate if you are willing to operate its log and latency dominates.
- Expect a per-step latency overhead in the milliseconds range, and measure it against your
  step count rather than against a single call.

## Don't

- Do not adopt a durable runtime for a workflow that fits in one database transaction. The
  operational surface is much larger than the problem.
- Do not put non-deterministic code in the workflow body "just this once" — replay runs it
  again, and divergence is silent until recovery.
- Do not treat durable execution as a substitute for idempotency at the activity boundary.
  Dedup and exactly-once *effects* still have to be built.
- Do not assume a managed offering is portable. Vendor lock-in is the documented cost of this
  pattern, and the SDK-level abstraction does not remove it — the state model does.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Workflow corrupts after a worker crash and replay | Non-deterministic code in the workflow body | Move the code into an activity; keep the body pure |
| Side effects happen twice after recovery | Activity treated as exactly-once | Add an idempotency key to every activity that writes or charges |
| Workflow step succeeds but its database write is missing | Runtime state and business data committed separately | Use a runtime that commits both in one transaction, or write your own outbox |
| Latency budget exceeded | Per-step overhead multiplied by step count | Measure overhead × steps before committing to the pattern |
| Migration off the runtime is a rewrite | State model, not SDK API, was the coupling | Evaluate portability of the *history*, not of the client library |

## Verifying

1. Kill a worker mid-workflow and confirm it resumes at the last completed step rather than the
   first.
2. Replay a workflow and assert the side-effect count is unchanged — the idempotency key check.
3. Search the workflow body for `Date.now`, `random`, `uuid4`, and direct I/O; each hit is a
   replay hazard.
4. Measure per-step overhead and multiply by the workflow's real step count before shipping.

## Caveats on confidence

Vendor performance claims (Restate's sub-10ms durable action) are marketing and were not
independently benchmarked in this research. Adoption maturity is uneven: Temporal and Restate
sit at early majority, DBOS at early adopter. *Researched 2026-09-30.*