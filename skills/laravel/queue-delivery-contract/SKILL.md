---
name: queue-delivery-contract
description: "Establish what a Laravel queue job actually guarantees about delivery before writing or changing one. Use when adding a job, tuning retry_after/--timeout, dispatching inside a transaction, or moving a job into a batch."
version: "1.0.0"
tags:
  - laravel
  - queue
  - correctness
---

# Laravel Delivers At Least Once — Write the Job Against That, Not Against "Once"

Every queue job must be safe to run twice, because every mechanism that looks like it prevents a
duplicate has a boundary outside which it does nothing. This skill is the ordered pass that
establishes what is actually guaranteed for a given job, before the job is written — because the
guarantees live in four different files and none of them reference each other.

Read the rules alongside this: `rules/laravel/retry-after-must-exceed-worker-timeout.md`,
`should-be-unique-is-dedup-not-idempotency.md`,
`dispatch-after-commit-or-the-worker-races-your-transaction.md`, and
`batch-jobs-bypass-unique-constraints.md`.

## Why

Laravel ships two numbers that must be ordered, in two different files, neither referencing the
other:

| File | Setting | Shipped value |
|---|---|---|
| `config/queue.php` (all connections) | `retry_after` | `90` |
| `WorkCommand.php` | `{--timeout=60}` | `60` |
| `WorkCommand.php` | `{--tries=1}` | `1` |

The docs state the invariant and the consequence:

> The `--timeout` value should always be at least several seconds shorter than your `retry_after`
> configuration value […] **If your `--timeout` option is longer than your `retry_after`
> configuration value, your jobs may be processed twice.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

`--tries=1` is the part that surprises people. With one try, a job killed by `--timeout` is not
retried within that worker at all — the **only** thing that ever retries it is the `retry_after`
re-release. So the ordering above is not a tuning nicety; it *is* the delivery guarantee.

Everything else in this skill exists to locate the boundaries of that mechanism. The re-release
is a duplicate-delivery event, and the remaining questions are: which duplicates does each dedup
mechanism actually catch, and what state is visible to the job when it runs.

## Step 1 — Read the three numbers before touching the job

Find the declared values, not the remembered ones. `retry_after` is per-connection in
`config/queue.php`, so a project with a `redis` and an `sqs` connection has two of them, and the
pair must hold for each worker process, not per application.

```bash
grep -n "'retry_after'" config/queue.php
grep -rn '\-\-timeout\|\-\-tries' deploy/ supervisor/ 2>/dev/null
grep -rn 'stopwaitsecs' supervisor/
```

Read the results as a triple:

1. `--timeout` < `retry_after`, for every connection a worker consumes.
2. `stopwaitsecs` > the largest `--timeout` among the workers that unit supervises — otherwise
   Supervisor's `SIGKILL` escalation decides the outcome, and the queue config is irrelevant.
3. `--tries` ≥ 2 if the job is expected to survive a transient failure within one worker. At
   `1`, a failure is a re-release, which is slower and lands on a different worker with a fresh
   counter.

If the margin is only the shipped 30 seconds, that is a placeholder, not a measurement. Establish
the real p99 from Horizon before accepting it.

## Step 2 — Decide which duplicate-suppression mechanism this job needs

There are four, and each has a boundary stated in the docs. Match the job to the narrowest one
that covers the actual failure it has.

**At-least-once, unconditional.** The baseline. No interface required. The job must be idempotent
on its own effect.

**`ShouldBeUnique` / `ShouldBeUniqueUntilProcessing`** — a *dispatch-time* cache lock, answering
"is this already queued?", never "has this already happened?". Two preconditions from the docs:

> **Unique jobs require a cache driver that supports
> [locks](https://laravel.com/framework/docs/12.x/cache#atomic-locks).** Currently, the
> `memcached`, `redis`, `dynamodb`, `database`, `file`, and `array` cache drivers support atomic
> locks.

> **Unique job constraints do not apply to jobs within batches.**

The lock is released by `CallQueuedHandler::ensureUniqueJobLockIsReleased()` on completion **or**
on exhausting retries. Neither branch records that the work was done. So a crash *inside*
`handle()` — the case people reach for this interface to solve — is outside its reach by
construction: the re-release is not a dispatch, so the lock is never consulted for it.

**Idempotency key / unique constraint on the effect** — the mechanism that actually covers the
re-release, because it is checked at write time rather than at enqueue time:

```php
$claimed = DB::table('processed_webhooks')
    ->insertOrIgnore(['key' => $this->key, 'processed_at' => now()]);

if ($claimed === 0) {
    return; // the key is already claimed — a prior run did the work
}

$this->deliver();
```

`insertOrIgnore` returns the number of rows inserted: `0` means the key was already present, so
this run is a duplicate. Gate on the return value — a `where(...)->exists()` check *after* the
insert is always true and protects nothing. This is the check that survives every duplicate path
at once, because it is evaluated at write time rather than at enqueue time.

**`uniqueFor()`** — a staleness bound on queue position, not a record of execution. It answers
"stop treating this as unique after N seconds", nothing more.

Verify the cache driver is on the atomic list before relying on the interface at all:

```bash
grep -n "'default'" config/cache.php
grep -rln 'ShouldBeUnique' app/Jobs/
grep -rn 'uniqueVia' app/Jobs/ app/Providers/
```

## Step 3 — Establish when the job's data becomes visible

`after_commit` is `false` on every shipped connection, so a `dispatch()` inside `DB::transaction()`
publishes the job immediately and a fast worker can run it before the commit lands.

> When dispatching a job within a transaction, **it is possible that the job will be processed by a
> worker before the parent transaction has committed. When this happens, any updates you have made
> to models or database records during the database transaction(s) may not yet be reflected in the
> database.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

Note what is absent from the default: no "dispatched on commit, cancelled on rollback". A
`ROLLBACK` leaves the job on the queue, running against rows that never existed. Discard-on-rollback
arrives with `after_commit => true` (or per-job `->afterCommit()`).

Do not confuse the two axes. `->afterCommit()` is a *transaction* boundary;
`->onConnection('deferred')` / `'background'` is a *response* boundary — a separately spawned
process. A job needing the second cannot get it from the first.

```bash
grep -rn "'after_commit'" config/queue.php
grep -rn 'dispatch(' app/ | grep -v afterCommit
```

The second list is a review queue: a dispatch outside any transaction is fine, and no grep can tell
you whether an enclosing `DB::transaction()` exists at the call site. Read the callers.

## Step 4 — Check whether batching is on the table

`Bus::batch()` does not queue N independent jobs. It queues one unit that, when processed, wraps
its jobs in a database transaction, and three guarantees stop at its edge:

- Callbacks are serialized — `$this` does not exist in them.
- Batched jobs are wrapped in transactions, so statements that trigger implicit commits (DDL) must
  not run inside them.
- Unique job constraints do not apply.

The transaction is a **rollback** guarantee, not a **durability** guarantee. Batch a job that
calls a payment provider: the charge succeeds, job #400 fails, the transaction rolls back — jobs
#1–#399 are undone in the database and #1–#400 have charged real cards.

```bash
grep -rn 'Bus::batch\|Bus::chain' app/
```

Read that list against the HTTP-call and `ShouldBeUnique` lists. A job in both the batch and the
HTTP list is the rollback asymmetry. A job in both the batch and the unique list is a guarantee
that vanished through a refactor that did not touch the job class.

## When to stop and escalate

Stop and get a decision rather than continuing, when any of these is true:

- **The job's effect is not idempotent and cannot be made so.** A charge, a shipped parcel, a
  sent SMS. The correct answer is a design change — an idempotency key with a durable record, or
  a queue that supports deduplication natively — not a retry configuration.
- **The measured p99 is close to `retry_after`.** Widening the pair is a real option but it lengthens
  the window in which a crashed job is invisible, and the change touches every worker on that
  connection. That is an operational decision, not a code one.
- **The default cache driver is not on the atomic-lock list.** Existing `ShouldBeUnique` jobs are
  already degraded without error. That is a separate migration with its own risk.
- **A `ShouldBeUnique` job already runs inside a batch.** Either the guarantee is believed to exist
  and does not, or the job is genuinely non-idempotent. Both need a human to pick which.
- **The dispatch happens inside a transaction whose rollback semantics are load-bearing** —
  inventory reservation, seat booking, quota. `afterCommit()` fixes the visibility race but changes
  what happens on rollback, and that is a product decision.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Same job runs twice, no error, effect applied twice | `--timeout` ≥ `retry_after`, released while still running | Restore `timeout < retry_after` on every connection |
| Job silently vanishes under load | `stopwaitsecs` < `--timeout`; Supervisor kills first | Raise `stopwaitsecs` above the largest `--timeout` |
| `ModelNotFoundException` in a job, only under load | Worker ran before the parent transaction committed | `->afterCommit()`, or move the dispatch out of the closure |
| Job ran against data that was rolled back | `after_commit => false`; nothing retracts a dispatch | `->afterCommit()` on every dispatch inside a transaction |
| `ShouldBeUnique` job ran N times | Duplicate arrived via re-release, not a second dispatch | Enforce idempotency in the job body; the interface is not consulted |
| Unique lock not working across servers | `uniqueVia` resolves to separate, or non-atomic, stores | Point it at a shared atomic-lock driver |
| External charges applied, rows missing | Batch rolled back after side effects outside the transaction | Make the job idempotent; do not batch external effects |
| Failures retried slowly, on a different worker | `--tries=1`, so every retry is a `retry_after` re-release | Raise `--tries` if the job should survive in-worker |

## Verifying

```bash
# 1. The three numbers, and their ordering
grep -n "'retry_after'" config/queue.php
grep -rn '\-\-timeout\|\-\-tries' deploy/ supervisor/ 2>/dev/null
grep -rn 'stopwaitsecs' supervisor/

# 2. Which dedup mechanism each job claims
grep -rln 'ShouldBeUnique' app/Jobs/
grep -rn 'uniqueVia' app/Jobs/ app/Providers/
grep -n "'default'" config/cache.php

# 3. Transaction visibility
grep -rn "'after_commit'" config/queue.php
grep -rn 'dispatch(' app/ | grep -v afterCommit

# 4. Batch membership, read against 2 and against network calls
grep -rn 'Bus::batch\|Bus::chain' app/
grep -rn 'Http::\|->post(\|->get(' app/Jobs/
```

This reads declared configuration and claimed interfaces. It cannot establish that a given
`handle()` is idempotent, nor whether an enclosing `DB::transaction()` exists at a dispatch site,
nor whether a job's real runtime sits inside its timeout — those are per-job properties, and the
checks for them are an affected-row count in the job body, a read of the caller, and a p99 from
Horizon.

## Limits of this skill

Pinned to Laravel 12.x queue behaviour. `retry_after`, `--timeout`, `--tries` defaults, the atomic
cache driver list, and the batch carve-outs all change between major versions.

For a version newer than the pinned one, verify against the source rather than this document:
`src/Illuminate/Queue/Console/WorkCommand.php` for the flag defaults,
`config/queue.php` for `retry_after` and `after_commit`, and
`CallQueuedHandler.php` for when the unique lock is released. If Boost is installed in the target
application, its `Search Docs` MCP tool covers the documentation side of the same question
semantically, across 17,000+ documentation pages.

The skill covers delivery guarantees only. It does not cover job payload construction, queue
naming, backoff strategy, or batching *design* — it tells you what a batch stops guaranteeing, not
whether you should use one.
