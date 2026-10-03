---
title: "`retry_after` Is a Contract, `--timeout` Is the Enforcement — Keep Them Ordered"
rule_id: "RULE-LARAVEL-001"
category: "correctness"
scope: "backend"
applies_to: "Any Laravel queue deployment: config/queue.php retry_after, queue:work --timeout, and Supervisor stopwaitsecs"
last_updated: "2026-10-03"
source: "https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md,https://raw.githubusercontent.com/laravel/framework/12.x/config/queue.php,https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Queue/Console/WorkCommand.php,https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Queue/Worker.php"
---

# `retry_after` Is a Contract, `--timeout` Is the Enforcement — Keep Them Ordered

Laravel ships two numbers that must be ordered, in two different files, neither referencing the
other. `retry_after` is the deadline after which the job is released back onto the queue.
`--timeout` is when the worker process is killed. The kill must happen **before** the release.

## Why

> The `--timeout` value should always be at least several seconds shorter than your `retry_after`
> configuration value. This will ensure that a worker processing a frozen job is always
> terminated before the job is retried. **If your `--timeout` option is longer than your
> `retry_after` configuration value, your jobs may be processed twice.**
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

The two numbers serve two different guarantees, which is the part that gets collapsed:

> The `retry_after` configuration option and the `--timeout` CLI option are different, but work
> together to ensure that jobs are not lost and that jobs are only successfully processed once.
> ([Laravel 12.x Queues](https://raw.githubusercontent.com/livewire/laravel-docs/12.x/queues.md))

"not lost" is `retry_after`. "only processed once" is the ordering. Invert the pair and the job is
re-released at `retry_after` **while the original worker is still executing it** — two concurrent
runs of the same job, no exception, no failed test.

The enforcement is a hard process kill, not a cooperative request. `Worker::timeoutForJob()`
computes the bound and hands it to `pcntl_alarm()`; the registered handler then kills the worker.
That is why a kill that arrives *too late* gives the job no chance to notice anything.

### The shipped defaults

| File | Setting | Value |
|---|---|---|
| `config/queue.php` (all connections) | `retry_after` | `90` |
| `WorkCommand.php` | `{--timeout=60}` | `60` |
| `WorkCommand.php` | `{--tries=1}` | `1` |

`--tries=1` matters as much as the other two. With one try, a job killed by `--timeout` is not
retried within that worker at all — the **only** thing that ever retries it is the `retry_after`
re-release. Under the shipped defaults the two-clock interaction is the sole duplicate-delivery
mechanism in the system.

## Do

- Assert the ordering in config, not in a comment:
  ```php
  // config/queue.php
  'redis' => [
      'driver' => 'redis',
      'retry_after' => 90,   // must exceed the largest --timeout below
  ],
  ```
  and in the Supervisor unit: `command=php artisan queue:work redis --timeout=60`.
- Size the pair **per job**, not once per application. If a job legitimately needs more than the
  current budget, raise `retry_after` first, then the timeout — never the reverse.
- Set Supervisor's `stopwaitsecs` **greater than** the `--timeout` of the workers it supervises, so
  Laravel's own timeout fires before Supervisor's `SIGKILL` escalation.
- Use Horizon's dashboard or `php artisan queue:failed` to establish the real p99 runtime of a job
  before choosing numbers for it; the default 60/90 pair is a placeholder, not a measurement.

## Don't

- Set `--timeout=0` thinking it disables the mechanism. It only removes the kill: with
  `retry_after=90`, a frozen worker is never killed, the job is re-released at 90s and executed a
  second time — and the original worker never dies and keeps holding it.
- Raise `--timeout` for one slow job without re-checking `retry_after`. The 30-second margin is
  only meaningful while both numbers stay at their defaults; a job whose real runtime falls
  *between* the two values is duplicated on every run, not rarely.
- Assume `--tries` or Horizon protects you. `--tries` bounds attempts by *one* worker; the
  duplicate arrives on a *different* worker with its own counter. Horizon reads the same
  `retry_after`.
- Read `stopwaitsecs` as unrelated to queue config. If it is shorter than `--timeout`, Supervisor
  kills the worker before Laravel's timeout handling runs, and the ordering guarantee is decided
  by a file outside `config/queue.php`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Same job runs twice, no error, effect applied twice | `--timeout` ≥ `retry_after`, so the job is released while still running | Restore `timeout < retry_after`; re-check every Supervisor unit |
| Job silently vanishes under load | `stopwaitsecs` < `--timeout`, so Supervisor kills the worker first | Raise `stopwaitsecs` above the largest `--timeout` |
| Jobs lost during a deploy, then all re-run at once | `queue:restart` sent `SIGTERM` and the worker died mid-job; `retry_after` re-released them | Raise `stopwaitsecs`; expect re-delivery, make the job safe to run twice |
| Duplicate persists after fixing the ratio | The duplicate is not from the queue — see `should-be-unique-is-dedup-not-idempotency.md` | Make `handle()` idempotent; the ordering fix removed one source, not all |

## Verifying

```bash
# The ratio, straight from config and the worker command
grep -n "'retry_after'" config/queue.php
grep -rn '\-\-timeout' deploy/ supervisor/ 2>/dev/null
grep -rn 'stopwaitsecs' supervisor/
```

This reads the declared numbers. It does not prove the margin is *sufficient* for your slowest
job — for that, read the measured p99 runtime from Horizon and check it sits well inside
`retry_after`.
