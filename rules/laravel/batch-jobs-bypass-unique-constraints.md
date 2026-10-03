---
title: "A Batch Is a Different Execution Context — Three Guarantees Stop at Its Edge"
rule_id: "RULE-LARAVEL-004"
category: "correctness"
scope: "backend"
applies_to: "Any Bus::batch() / Bus::chain() usage, and any job considered for moving into one"
last_updated: "2026-10-03"
source: "https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md"
---

# A Batch Is a Different Execution Context — Three Guarantees Stop at Its Edge

`Bus::batch()` does not queue N independent jobs. It queues one unit that, when processed, wraps
its jobs in a database transaction. Each job is unaware of this: no marker in the class says "I
behave differently inside a batch", and nothing changes when the job is moved into one.

## Why

The framework states two of the three consequences as a *single* warning, and the conjunction is
the load-bearing part:

> **Since batch callbacks are serialized and executed at a later time by the Laravel queue, you
> should not use the `$this` variable within the callbacks. In addition, since batched jobs are
> wrapped within database transactions, database statements that trigger implicit commits should
> not be executed within the jobs.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

Both halves share one cause: the batch is a unit that outlives the process that created it. The
callbacks no longer have an instance; the jobs no longer have an uncommitted boundary.

The third is stated separately, and it is absolute:

> **Unique job constraints do not apply to jobs within batches.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

`ShouldBeUnique` is checked at dispatch. A batched job is dispatched as part of the batch, not as
itself. So the protection in `should-be-unique-is-dedup-not-idempotency.md` evaporates through a
refactor that does not touch the job class — no deprecation, no exception, no type error.

### The rollback boundary covers the database and nothing else

The batch's transaction is a **rollback** guarantee, not a **durability** guarantee. Batch a job
that calls an external service and the two boundaries diverge in both directions:

- The HTTP call to the payment provider succeeds; the batch then fails on job #400; the
  transaction rolls back. Jobs #1–#399 are undone in the database, but #1–#400 already charged
  real cards.
- A statement that implicitly commits — `CREATE TABLE`, `ALTER TABLE`, `TRUNCATE` — commits early.
  Every remaining job runs outside the rollback scope the batch appeared to guarantee.

## Do

- Batch only work whose unit of effect is a database write and nothing else. That is the condition
  the DDL warning above is really about, stated for its narrowest case.
- Write callbacks that take everything they need as an argument, never off `$this`:
  ```php
  Bus::batch($jobs)
      ->then(function (Batch $batch) use ($reportId) {
          // $reportId arrives via capture; $this does not exist here
          GenerateReport::dispatch($reportId);
      })
      ->catch(function (Batch $batch) use ($reportId) {
          Log::warning('batch failed', ['report' => $reportId]);
      })
      ->finally(function (Batch $batch) use ($reportId) {
          Notify::dispatch($reportId);
      })
      ->dispatch();
  ```
- Make any batched job that touches an external service idempotent on its own, because the
  transaction will not do it for you.
- Keep DDL and migrations out of batched jobs entirely.

## Don't

- Move a `ShouldBeUnique` job into a batch and keep the interface. The class still implements it;
  the guarantee is simply not consulted.
- Write a batch callback that reads `$this` or an injected service off the job. It serializes, the
  binding is absent, and it fails at runtime on the batch rather than at dispatch — the same
  closure written against a dispatched job works, which is what makes the move look safe in review.
- Read "batched jobs are transactional" as "the batch is atomic." It is atomic with respect to the
  database only.
- Assume the carve-out only affects large-volume jobs. Backlog relief is exactly when batches get
  introduced — typically mid-incident, the worst time to discover a guarantee was conditional.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| External charges applied, database rows missing | Batch rolled back after the side effect; the side effect is outside the transaction | Make the job idempotent; do not batch external effects |
| Unique job ran N times inside a batch | Batch carve-out on `ShouldBeUnique` | Enforce uniqueness in the job body |
| `$this` unavailable in a batch callback | Callbacks are serialized | Pass what you need via `use (...)` capture |
| Batch appears transactional but later jobs are not rolled back | An implicit-commit statement (DDL) ended the transaction early | Remove DDL from batched jobs |
| Rollback undid far more than the failing job | Expected — the batch is one transaction | Narrow the batch, or move side effects out of it |

## Verifying

```bash
# Which jobs are batched, and which of them claim uniqueness or touch the network?
grep -rn 'Bus::batch\|Bus::chain' app/
grep -rln 'ShouldBeUnique' app/Jobs/
grep -rn 'Http::\|->post(\|->get(' app/Jobs/
```

Read the two lists against each other: a job appearing in both the batch and the HTTP list is the
rollback asymmetry, and a job in both the batch and the `ShouldBeUnique` list is the missing
guarantee. The greps find the overlap; only reading the job body decides whether it is safe.
