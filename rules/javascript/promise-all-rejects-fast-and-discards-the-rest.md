---
title: "Promise.all() rejects on the first failure, and the other operations keep running with their results unreachable"
rule_id: "RULE-JAVASCRIPT-009"
category: "correctness"
scope: "all"
applies_to: "Promise.all, Promise.allSettled, Promise.race, AbortController, cancellation, side effects"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises"
---

# Promise.all() rejects on the first failure, and the other operations keep running with their results unreachable

`Promise.all()` is read as "wait for everything". It is "wait for everything, or give up at the
first rejection" — and the give-up is silent about work still in flight.

## Why

MDN states both halves, and the second is the one that produces a wrong system rather than a failed
call:

> If one of the promises in the array rejects, Promise.all() immediately rejects the returned promise.
> The other operations continue to run, but their outcomes are not available via the return value of
> Promise.all(). This may cause unexpected state or behavior. Promise.allSettled() is another
> composition tool that ensures all operations are complete before resolving.
> ([Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises))

Three silent failures follow from that one sentence:

1. **The other side effects still happen.** A write the caller now believes was rolled back actually
   committed, because the promise it was waiting on did not get cancelled.
2. **Their results are gone.** The retry the caller writes re-does every operation rather than the one
   that failed, so a non-idempotent write happens twice.
3. **Only the first failure is named.** A second rejection that arrives later surfaces as an
   unhandled rejection at the point it rejects, not as part of the error you caught.

The cancellation story is a documented absence rather than a missing feature, and it is what makes
fix (1) hard — there is no way to stop the other operations from the caller:

> Promise itself has no first-class protocol for cancellation, but you may be able to directly cancel
> the underlying asynchronous operation, typically using AbortController.
> ([Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises))

## Do

- Use `Promise.all` only when a partial success is a failure anyway. If a failure in one item should
  not discard the others, use `Promise.allSettled` and inspect every result.
- Attach an `AbortController` to every operation in the set and abort it in the failure path, so the
  in-flight work actually stops rather than committing after you have moved on.
- Make writes idempotent — upserts keyed by a unique column rather than inserts — so the retry
  `Promise.all` forces on you is safe. This is the fix that survives regardless of which combinator
  you chose.
- Name the failing item in the error. Wrap each operation so its rejection carries the index or key,
  because `Promise.all`'s error names only the first.
- Handle every promise. A second rejection inside `Promise.all` is an unhandled rejection, not a
  value you can catch later.
- Await each side effect in the operation that owns it, so the operation's own promise does not
  resolve before its write has committed.

## Don't

- Don't use `Promise.all` for a batch where partial failure is meaningful — importing rows, sending N
  notifications, writing N records. You will retry all of them and double the successful ones.
- Don't assume a rejection cancels the rest. It does not; the operations continue and their side
  effects land.
- Don't treat the caught error as the whole story. Later rejections from the same set are not
  aggregated, and they surface separately.
- Don't use `Promise.all` as a timeout mechanism. `Promise.race` against a timer is the way, and even
  then the losing operation keeps running unless it takes a signal.
- Don't leave a fetch inside `Promise.all` without an `AbortSignal`. A component unmounting mid-flight
  leaves the request and its server-side effect running.
- Don't assume a rejected `Promise.all` means nothing was written.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Duplicate rows / duplicate emails after a retry | Partial writes committed, all operations redone | `allSettled`, or make writes idempotent |
| A write landed despite the caller seeing an error | Other operations were never cancelled | `AbortController` per operation |
| Only the first of two failures is reported | `Promise.all` names one rejection | Wrap each to carry its index |
| An `unhandledRejection` after a caught error | Later rejections of the same set | Attach a handler to every promise |
| Request completes after the component unmounted | No `AbortSignal` on the fetch | Wire `AbortController` to unmount |

## Verifying

```bash
# 1. Every Promise.all -- each is a batch whose partial-success policy must be explicit
grep -rn 'Promise.all(' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx --include=*.jsx . \
  | grep -v node_modules | head -30

# 2. Batches containing writes -- the idempotency question
grep -rn -B3 -A3 'Promise.all(' --include=*.js --include=*.ts . | grep -v node_modules \
  | grep -iE '\.(post|put|patch|insert|create|save|send)\(|fetch\(' | head -20

# 3. allSettled used where it was the better choice, for contrast
grep -rn 'Promise.allSettled' --include=*.js --include=*.ts . | grep -v node_modules | head -10

# 4. Fetches with no abort signal, inside a batch or a component
grep -rnE 'fetch\(' --include=*.js --include=*.ts --include=*.tsx . | grep -v node_modules \
  | grep -v 'signal:' | head -20

# 5. Settle it at runtime -- the whole defect, three lines:
#    node -e 'let ran=[]; const p=Promise.all([Promise.reject(new Error("a")),
#      new Promise(r=>setTimeout(()=>{ran.push("side effect");r(1)},50))]).catch(()=>{});
#      setTimeout(()=>console.log(ran),100)'      ->  [ "side effect" ]
#    node -e 'Promise.all([Promise.reject(1),Promise.reject(2)]).catch(e=>console.log(e))'  ->  1
```

What this check cannot see: steps 1–4 find the combinator and the shape of what it wraps, but
whether a batch *needs* `allSettled` is a product decision — a batch where any failure must abort the
whole unit of work is correct as written, and no grep can tell that from a batch that silently
half-commits. Step 2 pairs by proximity, so a write two functions away in the same batch is
invisible to it. The instrument that settles it is step 5: attach a side effect to the losing branch
and watch whether it fires after the rejection.