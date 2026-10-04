---
title: "A Future You Never Await Never Runs, and the Compiler's Warning Is Only a Warning"
rule_id: "RULE-RUST-006"
category: "correctness"
scope: "backend"
applies_to: "Any call to an async fn without await; any Future stored in a struct field and never polled; any missing .await at a call site; any CI configuration that allows unused_must_use"
last_updated: "2026-10-04"
source: "https://doc.rust-lang.org/book/ch17-01-futures-and-syntax.html"
---

# A Future You Never Await Never Runs, and the Compiler's Warning Is Only a Warning

Futures in Rust are lazy: building one does no work. The corollary is that a dropped future is not
a cancelled computation — it is one that never started. This is the failure the compiler catches
most of the time, and the failure it misses.

## Why

The Book frames async as pausing points rather than threads:

> Asynchronous programming is an abstraction that lets us express our code in terms of potential
> pausing points and eventual results
> ([The Rust Book — Asynchronous Programming](https://doc.rust-lang.org/book/ch17-00-async-await.html))

and states the consequence plainly on the next page:

> futures in Rust are lazy: they don't do anything until you ask them to with the await keyword.
> ([The Rust Book — Futures and Syntax](https://doc.rust-lang.org/book/ch17-01-futures-and-syntax.html))

`spawn` is the one call that makes a future run without an `await`, and Tokio says so with an
adverb that is the whole rule:

> The provided future will start running in the background immediately when spawn is called
> ([tokio::task::spawn](https://docs.rs/tokio/latest/tokio/task/fn.spawn.html))

So there are three states, and the code at the call site does not distinguish them:

- **awaited** — the future is polled and its result is used
- **spawned** — the future runs and its result may or may not be observed (`RULE-RUST-002`)
- **created and dropped** — the future never ran, and nothing happened

Rustc marks `Future` as `#[must_use]`, so the third state produces a warning at the call site. That
is most of this rule's value, and it is worth being precise about what it is: a **lint**, not an
error. It can be allowed, it can be suppressed crate-wide with `#![allow(unused_must_use)]`, and it
can be silenced by assigning to `_`. The places that survive are the ones worth auditing:

- `let _ = charge_customer(id);` — explicit discard
- a future stored in a struct field that no executor ever polls
- an `async fn` called from another `async fn` without `await`
- a macro arm that discards a future-typed expression

The last of these is the one a compiler cannot help with at all, because by the time the macro
expands the future has already been constructed.

## Do

- Make the async boundary explicit: an `async fn` caller can only forget to `await` in a way that
  the `#[must_use]` lint catches, and cannot get the type wrong:
  ```rust
  async fn charge_customer(id: u64) -> Result<(), Error> {
      ChargeJob { id }.run().await
  }
  ```
- When you must spawn from a sync context, handle the result inside the task, because the outer
  `Result` is the one being dropped:
  ```rust
  fn charge_customer(id: u64) {
      tokio::spawn(async move {
          if let Err(e) = ChargeJob { id }.run().await {
              tracing::error!(%e, "charge failed");
          }
      });
  }
  ```
- Promote the lint to a build failure in CI. It is a `Cargo.toml` line, not a dependency:
  ```toml
  [lints.rust]
  unused_must_use = "deny"
  ```
- Use `tracing` spans for work whose completion you cannot otherwise observe — but close them
  explicitly, because a span opened by a future that never runs can be left open.
- When a struct holds a future, give it a method that polls it (`fn poll(...)`) or store a boxed
  pinned future with an executor that owns it. A field nobody polls is a field that does nothing.

## Don't

- Call an async fn as a statement and read the `()` as success. The function did nothing and
  returned normally.
- Silence `unused_must_use` to clear a build. The lint is the only static check on this class of
  bug, and suppressing it globally disables it everywhere.
- Assume a `Future` in a struct field is running because the struct is alive. Laziness means
  something has to poll it.
- Hand-roll a `block_on` inside a runtime task to force a future to complete. It blocks the
  worker (`RULE-RUST-005`) and can deadlock against a task the same worker should be polling.
- Assume a spawned task's failure is logged somewhere by default. It is not — see the Do section;
  `JoinHandle` drop swallows both the `Err` and the panic.
- Treat `tokio::spawn`'s return value as optional in a function whose whole job is that work.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Function returns `()` and nothing happened | async fn called without `await` | Add `.await`, or make the caller `async` |
| A row is never written, no warning in the log | Spawned, handle discarded, `Err` dropped | Handle the result inside the task |
| Struct field never has any effect | Future stored but never polled | Add a poll method or an owner that polls it |
| Lint fires only in one crate | `#![allow(unused_must_use)]` elsewhere | Deny it workspace-wide |
| Panic inside a spawned task is invisible | Detached handle | Hold the `JoinHandle` and await it |
| Deadlock under load after adding `block_on` | Blocking a worker on a task it should poll | Await instead of `block_on` |
| Intermittent in CI, fine locally | Timing-dependent poll order | Look for an unpolled future, not a race |

## Verifying

```bash
# The lint, promoted to a failure
grep -rn 'unused_must_use\|must_use' Cargo.toml src/lib.rs

# Explicit discards -- the places the lint was silenced on purpose
grep -rn --include='*.rs' 'let _ = .*\.await\|let _ = .*()\.await\|drop(.*fut' src/

# Calls to async fns with no await on the same line
grep -rn --include='*.rs' '^\s*[a-z_]\+\.\+\w\+([^)]*);\s*$' src/ \
  | grep -v 'await\|spawn\|assert\|println\|log::\|tracing::'

# Futures stored in struct fields, which need something to poll them
grep -rn --include='*.rs' ': *impl Future\|: *Pin<Box<dyn Future' src/

# block_on inside a runtime task
grep -rn --include='*.rs' 'block_on' src/
```

The second and third commands are the audit, and together they cover both the deliberate discards
and the ones a caller forgot. The fourth finds futures that exist but have no owner. None of these
can prove a future *was* polled — that is a runtime fact, and the honest check is an assertion in
the task body or a metric on the work's completion, not a grep.
