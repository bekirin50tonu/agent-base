---
title: "`ShouldBeUnique` Deduplicates Dispatches — It Does Not Make a Job Idempotent"
rule_id: "RULE-LARAVEL-002"
category: "correctness"
scope: "backend"
applies_to: "Any job class implementing ShouldBeUnique or ShouldBeUniqueUntilProcessing"
last_updated: "2026-10-03"
source: "https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md,https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Queue/CallQueuedHandler.php"
---

# `ShouldBeUnique` Deduplicates Dispatches — It Does Not Make a Job Idempotent

`ShouldBeUnique` takes a cache lock **at dispatch time**. If the lock is held, the job is not
pushed; if it is not held, the lock is taken and the job is pushed. It answers "is this already
*queued*?" — never "has this already *happened*?".

## Why

When the job finishes — **or exhausts its retries** —
`CallQueuedHandler::ensureUniqueJobLockIsReleased()` releases the lock. Neither branch records that
the work was done; both simply make the key available again. So a retry after a mid-`handle()`
crash is a fresh dispatch, and it will be accepted.

The 12.x docs carry a precondition most code never reads, and it invalidates the feature silently:

> **Unique jobs require a cache driver that supports
> [locks](https://laravel.com/framework/docs/12.x/cache#atomic-locks).** Currently, the
> `memcached`, `redis`, `dynamodb`, `database`, `file`, and `array` cache drivers support atomic
> locks.
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

Against any other driver the lock still *works* — it is just no longer atomic, so two workers
racing to dispatch the same unique job can both take it. The interface stays implemented, the type
hint stays satisfied, and no error is raised.

The second precondition is absolute:

> **Unique job constraints do not apply to jobs within batches.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

An interface that reads as a class-level guarantee is scoped to single dispatches.

### The failure it is usually wanted for is out of reach

The case that motivates `ShouldBeUnique` in practice is a job that died *inside* `handle()`. That
is outside the interface's reach by construction: the lock exists to stop a second job being
*enqueued*, and by the time the job crashes the enqueue decision is long finished. The re-release
path from `retry_after-must-exceed-worker-timeout.md` is not a dispatch, so the unique lock is
never consulted for it.

## Do

- Scope the interface to what it actually does, in the job's own docblock:
  ```php
  use Illuminate\Contracts\Queue\ShouldBeUnique;

  /**
   * Dedups overlapping dispatches only. handle() must still be safe to run twice —
   * see rules/laravel/retry-after-must-exceed-worker-timeout.md.
   */
  class UpdateSearchIndex implements ShouldQueue, ShouldBeUnique
  {
      public function uniqueId(): string
      {
          return "search-index:{$this->product->id}";
      }

      public function uniqueFor(): int
      {
          return 300;
      }
  }
  ```
- Make `handle()` idempotent independently — a unique constraint on the effect, an idempotency key
  stored with the result, or a conditional update checked by affected-row count:
  ```php
  DB::table('processed_webhooks')
      ->insertOrIgnore(['key' => $this->key, 'processed_at' => now()]);
  ```
  `insertOrIgnore` returning `0` means you already did the work — return early rather than re-sending.
- Verify the cache driver is on the atomic list above before relying on the interface at all.
- Use `uniqueId()` to key on the *entity*, not the class, or every dispatch of the same job class
  across all entities collapses into one.

## Don't

- Treat `ShouldBeUnique` as proof a job runs at most once. It proves at most one *copy sits on the
  queue* at dispatch time.
- Reach for `uniqueFor` expecting a record of execution. It bounds how long the job stays unique —
  a staleness limit on queue position — and says nothing about `handle()` having run.
- Assume a shared Redis cache makes this complete. It fixes the multi-server *dispatch* race; the
  post-dispatch crash window is untouched, because that failure never re-enters dispatch.
- Use `ShouldBeUniqueUntilProcessing` expecting more protection. Its lock drops when the job
  *starts*, so it correctly prevents a queued pile-up and has strictly less protection for a job
  that fails after starting.
- Move a unique job into a batch and keep the interface. The class still implements it; see
  `batch-jobs-bypass-unique-constraints.md`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Job runs twice, log shows two `handle()` entries | Duplicate arrived via re-release, not via a second dispatch — `ShouldBeUnique` was never consulted | Make `handle()` idempotent; the interface does not apply here |
| Unique lock silently not working across servers | `uniqueVia` resolves to separate, or non-atomic, cache stores | Point `uniqueVia` at a shared atomic-lock driver (redis/memcached/database) |
| Two dispatches of the "unique" job both accepted | Non-atomic cache driver | Switch to an atomic-lock driver |
| Unique job runs N times inside a batch | Batch carve-out | Do not rely on uniqueness in batches; enforce in the job body |

## Verifying

```bash
# Which jobs claim uniqueness, and against which cache store
grep -rln 'ShouldBeUnique' app/Jobs/
grep -rn 'uniqueVia' app/Jobs/ app/Providers/

# Is the default cache driver actually atomic?
grep -n "'default'" config/cache.php
```

This shows which jobs *claim* the guarantee and which store backs it. It cannot show whether a
given `handle()` is idempotent — that is a per-job property, and the only check is the affected-row
count or unique constraint in the job body.
