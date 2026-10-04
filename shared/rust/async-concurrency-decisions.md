---
title: "Rust async and concurrency — which primitive, and what its default costs you"
category: "concurrency"
scope: "backend"
last_updated: "2026-10-04"
source: "https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html"
---

# Rust async and concurrency — which primitive, and what its default costs you

Four questions decide almost every case in an async Rust codebase. They do not line up with the
type signatures, so each answer below names the primitive *and* the default that primitive ships
with — because in every case here the default is the faster, more permissive choice, and the
failure is the default behaving exactly as documented.

This sits one level below `RULE-RUST-001` … `RULE-RUST-006`, which explain each mechanism. This
matrix is for choosing between them.

## The four questions

1. **Do I need the result?** If yes, `tokio::spawn` is wrong — a dropped handle discards it, and a
   panic inside the task goes with it. (`RULE-RUST-002`)
2. **Must the loser be cancelled, or kept?** Cancel → `tokio::select!`, and *every* branch must be
   cancellation-safe. Keep → `futures::future::select`, which hands the loser back. (`RULE-RUST-003`,
   `RULE-RUST-004`)
3. **Is the work CPU-bound or unavoidably blocking?** CPU → `rayon`. Blocking → `spawn_blocking`,
   sized, and never holding a lock. (`RULE-RUST-005`)
4. **Does the trait need to be a trait object?** If yes, it cannot contain an `async fn`.
   (`RULE-RUST-001`)

## The decision table

| You need | Use | Not | Its own default failure |
|---|---|---|---|
| A trait usable as `dyn Trait` | `fn f(&self) -> impl Future<Output = T> + Send + '_` | `async fn f(&self)` | Compiles, monomorphises, and silently loses dyn compatibility |
| `Send`/`Sync` variants of an existing trait | `#[trait_variant::make(...)]` | `#[async_trait]` | Per-call future boxing; the `Send` choice is per-crate |
| The task's `Result` observed | Hold the `JoinHandle` | `tokio::spawn(...)` discarded | Detach; result and panic both lost |
| Bounded fan-out, cancel on error | `JoinSet` | bare `spawn` | Drop **aborts** — not what a `JoinHandle` would do |
| Uncancelled fan-out from a `JoinSet` | `JoinSet::detach_all()` | relying on drop | The name says what it does; use it |
| Let a non-owner stop a task | `AbortHandle` | dropping it | Drop releases permission; it does **not** abort |
| Race branches, cancel the losers | `tokio::select!` | — | Losers dropped; only cancellation-safe futures allowed |
| Race branches, keep the losers | `futures::future::select` | `tokio::select!` | `Either` arms written by hand; single-shot future |
| Race a runtime-sized set | `futures::future::select_all` | `tokio::select!` | Borrows rather than consumes, so nothing is cancelled |
| Wait for all, no early exit | `join!` | `select!` | Does not stop when one side completes |
| First error, no early exit | `try_join!` | `select!` | Still polls both to completion |
| Deterministic branch order | `select_biased` / `biased;` | the default | The default randomises the first branch on purpose |
| Read a framed protocol | `Framed` + `LengthDelimitedCodec` | `read_exact` in a `select!` | The codec's length field must be bounded |
| CPU-bound work | `rayon` par-iterators | `spawn_blocking` | Separate pool; `rayon::spawn` may outlive the stack frame |
| Unavoidable blocking call | `spawn_blocking`, no lock held | blocking inline in a task | Unabortable; overflow queues |
| Fairness without blocking | `tokio::task::yield_now` | `block_in_place` | Does not help an already-blocked thread |
| A future that must actually run | `await`, or `spawn` and handle it | creating it | Laziness; `#[must_use]` is only a lint |

## The three drop semantics, side by side

The single most-missed item in the ecosystem. All three types are in `tokio::task`, all three are
about dropping, and all three do something different:

| Type | Dropped means | Result of the task |
|---|---|---|
| `JoinHandle<T>` | Detach | Runs to completion, `T` is lost, panic is swallowed |
| `JoinSet<T>` | Abort | Tasks are killed mid-flight |
| `AbortHandle` | Nothing | Task runs on; you merely lost permission to stop it |

`AbortHandle` is the one where the name most directly promises the opposite of the behaviour.

And one thing is outside all three: `spawn_blocking` cannot be aborted at all once started, so
`abort`, `JoinSet` drop, and runtime shutdown all fail to reach it. That is the design — you cannot
cancel a thread mid-syscall — but it means "I cancelled it" and "I asked it politely to stop" are
different claims about the same line of code.

## The traps that interact

Individually each row above is a review comment. The failures that actually reach production come
from the interaction:

- **Runtime configuration hides blocking bugs.** A `block_in_place` call panics on a
  `current_thread` runtime, which is exactly what `#[tokio::test]` builds by default. A suite that
  is all `flavor = "multi_thread"` never exercises the configuration that panics. (`RULE-RUST-005`)
- **Detachment hides shutdown truncation.** A dropped `JoinHandle` means a 4 ms deploy is
  indistinguishable from a clean one, and the truncated work is the work whose result nobody was
  watching anyway. (`RULE-RUST-002`)
- **Cancellation plus an unsafe branch hides data loss.** An accidentally-cancelled `read_exact`
  presents as a protocol desync in a component that has no reason to suspect the select loop.
  (`RULE-RUST-003`)
- **Queueing plus unabortability hides overload.** The blocking pool queues rather than rejects,
  and its contents cannot be cancelled, so a cancel does not drain it. (`RULE-RUST-002`,
  `RULE-RUST-005`)
- **Laziness plus a silenced lint hides a no-op.** `let _ =` and crate-wide
  `#![allow(unused_must_use)]` turn "the work never ran" into a function that returns `()`
  normally. (`RULE-RUST-006`)

## Verifying

```bash
# 1. Do I need the result? -- spawns whose handle is discarded
grep -rn --include='*.rs' 'tokio::spawn\|task::spawn' src/ \
  | grep -v 'let \|let mut \|=\s*tokio::spawn\|push('

# 2. Cancel or keep? -- both spellings, so the convention per site is visible
grep -rn --include='*.rs' 'select!\|future::select\|select_all' src/

# 3. CPU or blocking?
grep -rn --include='*.rs' 'rayon\|par_iter\|spawn_blocking\|block_in_place' src/

# 4. Trait objects, against traits containing async fn
grep -rn --include='*.rs' 'Box<dyn \|&dyn \|Arc<dyn ' src/
grep -rn --include='*.rs' -B20 'async fn' src/ | grep -E '^\S+[-:]trait ' | sort -u

# Configuration coverage: is any current_thread path tested?
grep -rn --include='*.rs' '#\[tokio::test' src/ tests/ | grep -v flavor
grep -rn --include='*.rs' 'new_current_thread\|flavor = "current_thread"' src/
```

Questions 1 and 4 produce two lists that must not overlap; if they do, the trait in both has lost
the capability the call site needs. The last pair is the coverage check for the blocking trap: if
the first returns hits and the second returns none, nothing is testing the configuration that
panics.

None of these greps can tell you whether a specific `select!` branch is cancellation-safe, whether
a blocking call is short enough to be harmless, or whether a spawned future was ever polled. Those
need Tokio's cancellation-safety list, a measurement, and a runtime assertion respectively.
