---
title: "select() Hands You the Loser, join() Discards Nothing, and join! Never Short-Circuits"
rule_id: "RULE-RUST-004"
category: "correctness"
scope: "backend"
applies_to: "Any use of futures::future::select, select_all, try_join, select_biased or the join!/try_join! macros; any code assuming join! stops when one future completes; any reasoning about what a losing branch costs"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs"
---

# select() Hands You the Loser, join() Discards Nothing, and join! Never Short-Circuits

The two `futures` combinators differ in a way their names do not advertise: `select` returns the
losing future to you, and `join` cannot stop early at all. Neither behaviour is visible from the
macro syntax, and both change what a lost branch costs.

## Why

`select` states it in its own doc comment:

> The returned future will finish with both the value […] and a future representing the completion
> of the other work.
> ([futures-rs — future/select.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs))

> Note that this function consumes the receiving futures […] wrapped version of them.
> ([futures-rs — future/select.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs))

The type makes it unmissable once you write the match — the arms are pairs:

> Either::Left((value1, _)) => value1,
> ([futures-rs — future/select.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs))

`join` has no such arm, because it never has a winner:

> polls multiple futures simultaneously, returning a tuple of all results once complete.
> ([futures::join!](https://docs.rs/futures/latest/futures/macro.join.html))

The implementation is the proof. `join.rs` polls **both** futures on every wakeup, with a
non-short-circuiting operator, so both operands are always evaluated:

> all_done &= futures.fut1.as_mut().poll(cx).is_ready();
> ([futures-rs — future/join.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/join.rs))

> all_done &= futures.fut2.as_mut().poll(cx).is_ready();
> ([futures-rs — future/join.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/join.rs))

There is no early return between those two lines. `select.rs` by contrast returns at the first
`Ready` and carries the other future out with it:

> let (a, b) = self.inner.as_mut().expect("cannot poll Select twice");
> ([futures-rs — future/select.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs))

> if let Poll::Ready(val) = a.poll_unpin(cx) {
> ([futures-rs — future/select.rs](https://raw.githubusercontent.com/rust-lang/futures-rs/master/futures-util/src/future/select.rs))

The word in that `expect` is worth reading twice: *"cannot poll Select twice"*. `Select` is a
one-shot future with a runtime-asserted invariant, not a type-level one.

## Do

- Use `tokio::select!` when the losers should be **cancelled**, and check each branch against
  `RULE-RUST-003`.
- Use `futures::future::select` when the loser must **survive**, and make the decision to drop it
  explicit at a line you wrote:
  ```rust
  use futures::future::{select, Either};

  let (user, audit) = match select(fetch_user(id), write_audit(id)).await {
      Either::Left((user, audit)) => (user, audit),
      Either::Right((audit, user)) => (user, audit),
  };
  audit.await?;   // or drop it deliberately — now it is your decision, visible here
  ```
- Use `select_all` when the number of futures is a runtime value. It borrows a `&mut` slice rather
  than consuming, so cancelling the race costs nothing and there is no loser's fate to reason
  about.
- Use `join!` when you genuinely want both, and `try_join!` when you want the first error — knowing
  that neither stops early.
- Reach for `select_biased` when branch order is the behaviour you need, and say so in a comment.
  The default is randomised, which is correct and makes order-dependent bugs intermittent.

## Don't

- Assume `join!(a, b)` returns when `a` completes. It waits for both; a slow second future delays
  the answer you already have.
- Assume `try_join!` short-circuits on the first `Err` and abandons the rest. It still polls both to
  completion, so the slow one delays the error.
- Read `select`'s `_` in `Either::Left((value, _))` as "the other future was discarded". It is a
  live future handed back to you — the most common misreading of the combinator.
- Mix `tokio::select!` and `futures::select` in the same codebase without a comment saying which
  convention each site uses. They have opposite cancellation behaviour and the same name.
- Poll a `Select` value more than once, or drive it with `select` in a loop without re-fusing. The
  `expect` is the runtime guard; hitting it is a bug, not a warning.
- Assume `select!`'s randomised first branch is a bug. It is deliberate, and switching to
  `biased;` to make a flaky test pass hides the order dependence rather than fixing it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A fast answer waits on a slow second future | `join!` does not short-circuit | `futures::future::select` |
| The first error surfaces seconds late | `try_join!` polls both to completion | Wrap the slow side in a timeout |
| A branch's work silently stopped mid-way | `tokio::select!` cancelled it | Check against `RULE-RUST-003`; use `futures::select` |
| Panic: "cannot poll Select twice" | A `Select` driven more than once, often in a loop without re-fusing | Re-create or `.fuse()` the future each iteration |
| A test is green locally and red in CI | `select!` randomises the first branch polled | Find the order dependence; `biased;` only if the order is intended |
| Borrow error moving a future into `select_all` | It borrows rather than consumes | Hold the futures in a `Vec` and pass `&mut` |
| A branch's `Result` never used | `select` returned the loser; the `_` arm dropped it | Await or explicitly drop at the match site |

## Verifying

```bash
# Both spellings, so the convention used at each site is visible
grep -rn --include='*.rs' 'join!\|try_join!\|select!\|select_all\|select_biased' src/

# Sites using the futures crate's select, where the loser comes back
grep -rn --include='*.rs' -A6 'future::select\|select_all' src/

# Ordered variants, the deliberate exception to randomisation
grep -rn --include='*.rs' 'biased;' src/

# Loops that re-drive a select without re-fusing -- the "polled twice" panic
grep -rn --include='*.rs' -B3 -A3 'loop {' src/ | grep -B3 -A3 'select'
```

The first command is the whole audit — it finds every place where the two similarly-named
combinators meet, and the answer to "which one did this site mean" is in the import at the top of
the file. The last command finds the runtime panic before it happens. None of these can tell you
whether a particular branch is cancellation-safe; that is `RULE-RUST-003`, and it needs Tokio's
list, not a grep.
