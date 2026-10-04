---
title: "A scope's children do not propagate failure — the joiner decides"
rule_id: "RULE-JVM-005"
category: "correctness"
scope: "backend"
applies_to: "StructuredTaskScope, Joiner, awaitAll, allSuccessfulOrThrow, anySuccessfulResultOrThrow, onComplete, Subtask.State"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/505"
---

# A scope's children do not propagate failure — the joiner decides

Structured concurrency guarantees *structure*: no thread outlives the block. It does not guarantee
that a failed child is noticed. That is a property of the `Joiner` you pass to `open()`, and one
of the documented factories discards failures on purpose.

The result is the survivable kind of bug: the safety property you adopted the API for keeps
working, while the correctness property you were relying on quietly evaporates.

## Why

`StructuredTaskScope` itself contains no failure-handling logic. It hands each completion to
`Joiner.onComplete(...)`, whose boolean return is the entire decision:

> The onFork method is invoked when forking a subtask, while the onComplete method is invoked when
> a subtask completes. Both methods return a boolean to indicate whether the scope should be
> cancelled.
> ([JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505))

And the JEP is explicit that failure does not propagate by itself:

> Accordingly, even when subtasks are submitted and joined in the same task, the failure of one
> subtask cannot automatically cause the cancellation of another: In the above handle() method, the
> failure of fetchOrder() cannot automatically cause the cancellation of findUser(). The future for
> fetchOrder() is unrelated to the future for findUser(), and neither is related to the thread that
> will ultimately join it via its get() method.
> ([JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505))

The factory to notice is `awaitAll()`:

> awaitAll(), which returns a new joiner that simply waits for all subtasks to complete, whether
> successfully or not;
> ([JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505))

Nothing throws. `join()` returns normally. Failed subtasks come back `UNAVAILABLE` or `FAILED`:

> UNAVAILABLE: The subtask result or exception is not available. This state indicates that the
> subtask was forked but has not completed, it completed after the scope was canceled, or it was
> forked after the scoped was canceled.
> ([Structured Concurrency](https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html))

So `stream.map(Subtask::get)` over the results, without a `state()` check, is a rule that reads
plausibly and throws or silently drops depending on which states you happened to reach.

The two axes are independent and the joiner name conflates them. `allSuccessfulOrThrow` **does not**
cancel siblings on failure — it waits for everything and throws at the end, so a subtask that hangs
blocks the join even though another failed irrecoverably. `anySuccessfulResultOrThrow` cancels as
soon as one succeeds. Cancellation is not observation.

Two documented traps close the section. `close()` always waits, and interruption is cooperative:

> To allow for cancellation, subtasks must be coded so that they finish as soon as possible when
> interrupted. Subtasks that do not respond to interrupts because, e.g., they block on methods
> that are not interruptible, may delay the closing of a scope indefinitely. The close method
> always waits for threads executing subtasks to finish, even if the scope is cancelled. Execution
> cannot continue beyond the close method until the interrupted threads finish.
> ([JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505))

And a `Joiner` is single-scope, single-use:

> When using any kind of Joiner, it is critical to create a new Joiner for each
> StructuredTaskScope. Joiner objects should never be used in different task scopes or re-used
> after a scope is closed.
> ([JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505))

Holding one in a field, or behind a factory that caches, is a real footgun.

## Do

- Use `allSuccessfulOrThrow()` or the zero-argument `open()` when any child failure must fail the
  scope. That is the default fail-if-any policy.
- Check `Subtask.state()` before reading `get()` from a stream of subtasks.
- Write the joiner per scope, inline. Never cache one.
- Make subtasks interruptible: propagate `InterruptedException` rather than swallowing it, or
  `close()` will hang.
- Choose `awaitAll()` deliberately — only when partial success is genuinely acceptable, and then
  document what the caller does about the failed ones.

## Don't

- Don't assume a scope propagates child failure because the class name says "structured".
- Don't `stream().map(Subtask::get)` on a result stream without checking `state()`.
- Don't expect `allSuccessfulOrThrow()` to be fail-fast. It is wait-then-throw.
- Don't cache a `Joiner` in a field, a singleton, or a `@Bean`. It is forbidden and the failure is
  a scope, not an exception.
- Don't swallow `InterruptedException` inside a subtask — that turns a fast cancellation into a
  hang that `close()` cannot break.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| One subtask failed, `join()` returned normally | `awaitAll()` or a joiner whose `onComplete` returns `false` | Use `allSuccessfulOrThrow()`, or check `state()` |
| `NoSuchElementException` from `Subtask.get()` | Read a `FAILED`/`UNAVAILABLE` subtask | Filter on `state() == SUCCESS` |
| Scope hangs on close after a failure | Subtask swallowed `InterruptedException` | Propagate the interrupt |
| A subtask failure ignored in a "cancel siblings" case | `allSuccessfulOrThrow` does not cancel on failure | Use a joiner returning `true`, or accept wait-then-throw |
| Second scope misbehaves with the first's joiner | Joiner reused across scopes | Construct per scope |
| One hung subtask blocks an already-failed scope | Wait-then-throw joiner | Use a `Config` timeout |

## Verifying

```bash
# 1. Every structured-concurrency site
grep -rn 'StructuredTaskScope\|awaitAll\|allSuccessfulOrThrow\|anySuccessfulResult' src/main/java/

# 2. The joiners that discard failure -- these need an argument
grep -rn 'awaitAll' src/main/java/

# 3. Reading a subtask without checking state
grep -rnE '\.map\(Subtask::get\)|for \(.*: scope\..*\)|\.get\(\)' src/main/java/ \
  | grep -i subtask

# 4. Cached joiners -- forbidden, and invisible at runtime until it is wrong
grep -rn 'Joiner' src/main/java/ | grep -iE 'static|final|field|@Bean'

# 5. Swallowed interrupts inside subtasks
grep -rn -A4 'catch (InterruptedException' src/main/java/ | grep -vE 'throw|Thread.currentThread'
```

What this check cannot see: it cannot tell you whether `onComplete` returns `true` — that is inside
a lambda body the grep does not read. The check that matters is behavioural: write a test that
makes one subtask throw and asserts the scope throws. That is the only instrument that distinguishes
a joiner that fails the scope from one that watches it fail and continues.