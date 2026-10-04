---
title: "One Blocking Call Stops Every Task on That Worker, and the Default Test Runtime Hides It"
rule_id: "RULE-RUST-005"
category: "concurrency"
scope: "backend"
applies_to: "Any synchronous call inside an async task; any blocking library used from a Tokio task; any spawn_blocking call; any test suite using the default #[tokio::test] flavor; any runtime built on new_current_thread"
last_updated: "2026-10-04"
source: "https://docs.rs/tokio/latest/tokio/macro.select.html"
---

# One Blocking Call Stops Every Task on That Worker, and the Default Test Runtime Hides It

Concurrency inside a Tokio task is cooperative. A branch that blocks the thread does not make
itself slow — it stops everything else that worker was going to do, including tasks that were only
waiting on a timer. And the runtime configuration that turns this into a panic is the one your
tests run on by default.

## Why

Tokio's `select!` docs state the property, and then the consequence:

> by running all async expressions on the current task, the expressions are able to run
> concurrently but not in parallel.
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

> if one branch blocks the thread, all other expressions will be unable to continue
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

"Unable to continue" is the whole failure. The scope is the worker thread, not the task.

The escape hatch refuses to run in one of the two configurations you might pick:

> Note that this function cannot be used within a current_thread runtime
> ([tokio::task::block_in_place](https://docs.rs/tokio/latest/tokio/task/fn.block_in_place.html))

> This function panics if called from a current_thread runtime.
> ([tokio::task::block_in_place](https://docs.rs/tokio/latest/tokio/task/fn.block_in_place.html))

And the default test runtime is exactly that configuration:

> The default test runtime is single-threaded. Each test gets a separate current-thread runtime.
> ([tokio::test](https://docs.rs/tokio/latest/tokio/attr.test.html))

So the code path that panics in production is the one your suite structurally cannot exercise
unless you ask for the other flavor:

> Returns a new builder with the multi thread scheduler selected.
> ([tokio::runtime::Builder](https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html))

When the escape hatch is unavailable, the alternative is a bounded pool that queues rather than
rejects:

> After reaching the upper limit, the tasks are put in a queue.
> ([tokio::task::spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html))

Queueing plus unabortability (`RULE-RUST-002`) is the second-order failure: under load, latency
accumulates in a queue whose depth is invisible and whose contents cannot be cancelled.

## Do

- Send CPU-bound work to `rayon`, which has its own pool and does not consume a runtime worker:
  ```rust
  let total: i64 = rows.par_iter().map(|r| r.amount).sum();
  ```
- Use a genuinely blocking call via `spawn_blocking`, and hold nothing the async side must acquire:
  ```rust
  let value = tokio::task::spawn_blocking(move || expensive_parse(&raw)).await??;
  ```
- Keep one single-threaded test for every code path that calls `block_in_place`, because that is the
  configuration where it panics and the one your suite otherwise never exercises.
- Test blocking-sensitive code under `flavor = "multi_thread"` **and** keep a current-thread test —
  the pair is what covers both configurations.
- Use `yield_now` when you only need fairness, and know its limit: it yields to the scheduler, it
  does not free a thread that is already blocked.
- Audit for a blocking library at the dependency boundary. A driver with both a sync and an async
  API will be used synchronously by someone eventually.

## Don't

- Call a synchronous driver, file read, or CPU-heavy computation directly in an async task. Duration
  is the wrong axis to judge it by; the axis is whether the worker can poll anything else meanwhile.
- Use `#[tokio::test(flavor = "multi_thread")]` everywhere to "match production" and consider the
  coverage sufficient. That choice hides every `block_in_place` panic.
- Call `block_in_place` in a binary built on `new_current_thread`. It is a documented panic, not a
  degraded mode.
- Hold a `Mutex` across `spawn_blocking`. The task cannot be aborted, so the cancellation that
  would have released the guard never arrives and the failure presents as a hang.
- Assume `spawn_blocking` fails loudly when the pool is full. It queues.
- Count blocking-pool usage as free. Each call consumes a slot for the whole pool's default
  capacity, and overflow is latency you cannot see.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Whole process stalls, no error | Blocking call on a `current_thread` runtime | Move the work off; do not add threads |
| Random latency spikes on some requests only | One worker blocked, others fine | Find the sync call; move it to `rayon` or `spawn_blocking` |
| Panic in production, never in tests | `block_in_place` on a current_thread runtime | Add a single-threaded test for that path |
| Hang after a cancel request | `spawn_blocking` holding a needed lock | Never hold a lock across it |
| Latency grows with load, no errors | Bounded blocking pool, overflow queues | Size the pool; move CPU work to `rayon` |
| Tests pass, production stalls | Suite is all `multi_thread` | Keep one `current_thread` test per runtime built that way |
| `block_in_place` panic in a worker, not the main path | A dependency called it from a nested task | Audit transitive blocking calls, not just your own |

## Verifying

```bash
# Tests that run single-threaded -- the configuration block_in_place rejects
grep -rn --include='*.rs' '#\[tokio::test' src/ tests/ | grep -v flavor

# Blocking escapes and blocking calls; each hit needs a justification
grep -rn --include='*.rs' 'block_in_place\|spawn_blocking\|std::thread::sleep' src/

# Locks that might be held across a blocking boundary
grep -rn --include='*.rs' -A8 'spawn_blocking' src/ | grep -n '\.lock()\|\.await'

# Runtimes built without a worker thread
grep -rn --include='*.rs' 'new_current_thread\|flavor = "current_thread"' src/

# Sync APIs of async-capable dependencies, the usual accidental block
grep -rn --include='*.rs' 'reqwest::blocking\|::blocking::' src/
```

The first and fourth commands together are the coverage check: if the first returns hits and the
fourth returns none, no test is exercising the configuration that panics. The second command finds
the blocking calls, but it cannot tell you whether a given one is short enough to be harmless —
that is a measurement, and the fifth command exists because the measurement usually lives in a
dependency rather than in your source.
