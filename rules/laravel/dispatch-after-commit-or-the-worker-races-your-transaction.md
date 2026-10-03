---
title: "Dispatch After Commit, or the Worker Races the Transaction That Spawned It"
rule_id: "RULE-LARAVEL-003"
category: "correctness"
scope: "backend"
applies_to: "Any dispatch() call made inside DB::transaction(), or from a model observer/event listener that runs within one"
last_updated: "2026-10-03"
source: "https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md,https://raw.githubusercontent.com/laravel/framework/12.x/config/queue.php"
---

# Dispatch After Commit, or the Worker Races the Transaction That Spawned It

`after_commit` is `false` on every shipped queue connection. Dispatching inside `DB::transaction()`
therefore publishes the job *before* the rows it depends on are visible, and a worker fast enough
will read a database state that does not exist yet.

## Why

The instinct is that a transaction hides uncommitted work. It hides it from *other connections on
the same database* — which is why the code that wrote it looks correct. The queue is not on that
connection, and the worker is not in that transaction.

The timeline, with shipped defaults:

1. `DB::beginTransaction()` — `INSERT INTO orders …`, not yet committed.
2. `dispatch(new SendInvoice($order->id))` — with `after_commit => false` the payload is pushed to
   Redis/SQS/the database queue **now**.
3. The worker reserves the job and runs `Order::find($id)`.
4. Step 3 happens **before** step 1's `COMMIT` reaches the database, or on a replica that has not
   yet received it. `find()` returns `null`.

The docs describe the race in exactly these terms:

> While it is perfectly fine to dispatch jobs within database transactions, you should take special
> care to ensure that your job will actually be able to execute successfully. When dispatching a
> job within a transaction, **it is possible that the job will be processed by a worker before the
> parent transaction has committed. When this happens, any updates you have made to models or
> database records during the database transaction(s) may not yet be reflected in the database.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

Note what is absent: there is no "dispatched on commit, cancelled on rollback" in the default
configuration. The job is dispatched on dispatch, and nothing retracts it. The rollback clause
belongs to the *corrected* behaviour:

> When the `after_commit` option is `true` […] Laravel will wait until the open parent database
> transactions have been committed before actually dispatching the job. […] **If a transaction is
> rolled back due to an exception that occurs during the transaction, the jobs that were dispatched
> during that transaction will be discarded.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

Under `after_commit => false`, a `ROLLBACK` leaves the job on the queue, running against rows that
never existed.

## Do

- Mark the job, so the dispatch defers to commit and a rollback discards it:
  ```php
  SendInvoice::dispatch($order)->afterCommit();
  ```
- Or set it deliberately per connection when every job in that queue depends on committed state:
  ```php
  // config/queue.php — opt in consciously, not by accident
  'redis' => [
      'driver' => 'redis',
      'after_commit' => true,
  ],
  ```
- Move the dispatch out of the transaction closure when the job does not depend on the transaction
  at all — after the `DB::transaction()` call returns is the simplest correct placement.
- Remember `afterCommit()` is a *transaction* boundary, distinct from a *response* boundary:
  ```php
  // After the HTTP response — a separately spawned process, NOT a commit guarantee
  RecordDelivery::dispatch($order)->onConnection('background');
  ```
  A job needing the second cannot get it from the first.
- In tests, assert the ordering rather than trusting a passing suite: a local run usually has the
  worker lose the race, so the bug reproduces under production load, not on your laptop.

## Don't

- Dispatch from inside the transaction closure and consider it fine because "the transaction hides
  it." It hides it from the writer's connection only.
- Expect `after_commit => false` to discard jobs on rollback. Nothing retracts a dispatched job.
- Read `onConnection('deferred')` or `onConnection('background')` as an after-commit guarantee.
  They are after-response; the commit axis is separate.
- Assume an `$order->id` payload makes a job transaction-independent. The payload is fine; the
  *lookup it triggers* is what races.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ModelNotFoundException` in a job, only under load | Worker picked the job up before the transaction committed | `->afterCommit()` on the dispatch, or move it out of the closure |
| Job runs against data that was rolled back | `after_commit => false`; dispatch is not retracted by rollback | Same — and audit every dispatch inside a transaction |
| Intermittent nulls that disappear in local dev | Local worker loses the race; production worker wins it | Fix the ordering; add a test that asserts the job sees committed rows |
| Job correctly deferred but fired before the response was sent | `deferred`/`background` used where `afterCommit()` was needed | Distinguish the two axes explicitly |

## Verifying

```bash
# Is the default still the unsafe one?
grep -rn "'after_commit'" config/queue.php

# Which dispatches run inside a transaction? (manual read — the check is structural)
grep -rn 'dispatch(' app/ | grep -v afterCommit
```

The second command lists every dispatch not marked `afterCommit()`. It is a review queue, not a
verdict: a dispatch outside any transaction is fine. What it cannot tell you is whether an enclosing
`DB::transaction()` exists at the call site — that is the part to check by reading the caller.
