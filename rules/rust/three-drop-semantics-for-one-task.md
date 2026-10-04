---
title: "One Tokio Task Has Three Drop Semantics, and Only One of Them Cancels"
rule_id: "RULE-RUST-002"
category: "concurrency"
scope: "backend"
applies_to: "Any use of tokio::task::spawn whose JoinHandle is discarded on some path; any JoinSet; any AbortHandle; any spawn_blocking call; any graceful shutdown path that drops task handles"
last_updated: "2026-10-04"
source: "https://docs.rs/tokio/latest/tokio/task/struct.JoinHandle.html"
---

# One Tokio Task Has Three Drop Semantics, and Only One of Them Cancels

`tokio::task::spawn` hands you a `JoinHandle<T>` and nothing requires you to keep it. What happens
when you let it go is not cancellation. The task keeps running, its result is computed and
discarded, and a panic inside it is swallowed. In the same module, `JoinSet` does the exact
opposite on drop, and `AbortHandle` does neither.

## Why

The detach is documented as the normal behaviour, not as a caveat:

> The provided future will start running in the background immediately when spawn is called
> ([tokio::task::spawn](https://docs.rs/tokio/latest/tokio/task/fn.spawn.html))

> A JoinHandle detaches the associated task when it is dropped
> ([tokio::task::JoinHandle](https://docs.rs/tokio/latest/tokio/task/struct.JoinHandle.html))

> If a JoinHandle is dropped, then the task continues running in the background and its return
> value is lost.
> ([tokio::task::JoinHandle](https://docs.rs/tokio/latest/tokio/task/struct.JoinHandle.html))

`JoinSet`, one type away, inverts it:

> When the JoinSet is dropped, all tasks in the JoinSet are immediately aborted.
> ([tokio::task::JoinSet](https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html))

So `JoinHandle` on drop = the task runs on, unheard from. `JoinSet` on drop = the tasks die. Getting
the first behaviour out of a `JoinSet` takes a separate, explicit call:

> moves all tasks from this JoinSet without aborting them. […] continue to run in the background
> even if the JoinSet is dropped.
> ([tokio::task::JoinSet](https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html))

The third type is the trap, because its name promises the opposite of what it does:

> Unlike a JoinHandle, an AbortHandle does not represent the permission to await the task's
> completion, only to terminate it.
> ([tokio::task::AbortHandle](https://docs.rs/tokio/latest/tokio/task/struct.AbortHandle.html))

> Dropping an AbortHandle releases the permission to terminate the task - it does not abort the
> task.
> ([tokio::task::AbortHandle](https://docs.rs/tokio/latest/tokio/task/struct.AbortHandle.html))

And one thing is not abortable at all, by design:

> Be aware that tasks spawned using spawn_blocking cannot be aborted because they are not async.
> ([tokio::task::spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html))

> spawn_blocking tasks cannot be aborted once they start running
> ([tokio::task::spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html))

Completion is not guaranteed either, which is what makes shutdown the second place this bites:

> There is no guarantee that a spawned task will execute to completion.
> ([tokio::task::spawn](https://docs.rs/tokio/latest/tokio/task/fn.spawn.html))

> When a runtime is shutdown, all outstanding tasks are dropped, regardless of the lifecycle of that
> task.
> ([tokio::task::spawn](https://docs.rs/tokio/latest/tokio/task/fn.spawn.html))

## Do

- Hold the handle whenever the task's result matters, so its `Result` is observed and its panic
  surfaces:
  ```rust
  let charge = tokio::spawn(charge_customer(order.clone()));
  let receipt = tokio::spawn(send_receipt(order));
  let (charged, sent) = tokio::try_join!(charge, receipt)?;
  ```
- Use a `JoinSet` for bounded fan-out, and let drop-on-error do the cancelling you were going to
  write by hand:
  ```rust
  let mut set = JoinSet::new();
  for chunk in chunks {
      set.spawn(process(chunk));
  }
  while let Some(result) = set.join_next().await {
      result??;
  }
  // Anything still running when `set` drops is aborted, not detached.
  ```
- Use `AbortHandle` when a component that is not the owner needs to stop a task, and treat the
  clone as a capability you have handed out deliberately.
- Call `detach_all()` if a `JoinSet` genuinely must outlive its scope — the name says what it does
  and it makes the intent visible to a reader.
- Size the blocking pool and never call `spawn_blocking` while holding a lock the async side must
  acquire. The task cannot be aborted, so the cancellation that would have released it never comes.
- Drain handles on shutdown explicitly (`JoinSet::shutdown().await`, or await the handles) rather
  than relying on scope unwinding order.

## Don't

- `tokio::spawn(...)` as a statement for work that writes to a database, sends mail, or advances a
  state machine. The `Result` is discarded and the panic is swallowed, and the code reads exactly
  like the fire-and-forget case that is correct.
- Read `JoinSet` as a tidier `JoinHandle`. One detaches on drop and one aborts, they are adjacent in
  the same module, and the compiler picks neither.
- Assume dropping an `AbortHandle` cleans up. It releases the permission and the task runs on; the
  name says "abort" and the behaviour is "forgot".
- Reach for `abort` to stop a `spawn_blocking` task that has already started. It cannot be
  aborted; if it holds a lock, the failure is a hang rather than an error.
- Assume a short shutdown means the work finished. Truncating in-flight tasks is fast by
  construction — a 4 ms shutdown and a 900 ms one differ by exactly the tasks you drained.
- Hand an `AbortHandle` clone to a request-scoped or connection-scoped component that may outlive
  the task it can kill.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| An audit row is never written, no error anywhere | Detached `spawn`; the `Result` was discarded | Hold the handle and join it |
| A panic inside a task vanishes | Detached task; the panic never reaches a joiner | Hold the handle, or use `JoinSet` |
| Work truncated during deploy, shutdown was suspiciously fast | Handles dropped as the shutdown path unwound | Drain explicitly before exiting |
| A `JoinSet` cancelled in-flight DB writes on the error path | Drop aborts every task in the set | Intentional — use `detach_all` if the writes must finish |
| Dropped an `AbortHandle`, task kept running | Drop releases permission; it does not abort | Call `abort()` explicitly |
| Hang after cancelling | `spawn_blocking` holding a lock the async side needs | Never hold a lock across `spawn_blocking` |
| Latency grows under load with no error | Bounded blocking pool, overflow queues, unabortable | Size the pool; move CPU work to `rayon` |

## Verifying

```bash
# Spawns whose handle is discarded on some path -- the audit starts here
grep -rn --include='*.rs' 'tokio::spawn\|task::spawn' src/ \
  | grep -v 'let \|let mut \|=\s*tokio::spawn\|push('

# JoinSets and whether their drop-abort is intended
grep -rn --include='*.rs' -A8 'JoinSet::new' src/

# AbortHandle clones: each one hands a third party the power to kill a task
grep -rn --include='*.rs' 'AbortHandle\|\.abort()' src/

# Blocking work, and whether it can be aborted or holds a lock
grep -rn --include='*.rs' -A6 'spawn_blocking' src/ | grep -n 'lock()\|\.await'

# Shutdown paths that drop handles rather than draining them
grep -rn --include='*.rs' -A12 'fn shutdown\|ctrl_c\|signal::' src/
```

The first command is the one that matters: every hit is work whose outcome nobody observes. It
cannot tell you whether that work needed observing — that is a question about whether it writes, and
the answer is in what the closure body does, not in the call. Neither the `abort` grep nor the
blocking-pool grep can show runtime cancellation ordering, which is why `RULE-RUST-003` exists: the
same tasks behave differently depending on which combinator polls them.
