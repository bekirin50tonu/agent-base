---
title: "`WhenAll` Does Not Cancel, a Linked CTS Is OR-Only, and `WhenAny` Hides the Exception"
rule_id: "RULE-DOTNET-003"
category: "correctness"
scope: "all"
applies_to: "Fan-out/fan-in code: Task.WhenAll, Task.WhenAny, CreateLinkedTokenSource, CancelAfter"
last_updated: "2026-09-30"
source: "https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/cancel-an-async-task-or-a-list-of-tasks"
---

# `WhenAll` Does Not Cancel, a Linked CTS Is OR-Only, and `WhenAny` Hides the Exception

Three composition primitives that look like they cooperate and do not. Aggregating *work* and
aggregating *cancellation* are separate axes, and one of them only has a direction you might not
expect.

## Why

**Composition of work is not composition of cancellation.** `Task.WhenAll` "returns a `Task`
object that completes when all the tasks in its argument list are complete" — it aggregates
completion and exceptions. It does not cancel anything, and it does not know your
`CancellationTokenSource` exists. Wiring both requires you to own the link.

**Composition of cancellation is OR, and only OR.** `CreateLinkedTokenSource` "creates a
`CancellationTokenSource` that will be in the canceled state when **any** of the source tokens are
in the canceled state." That same "any of" wording is on all four overloads —
`(CancellationToken)`, `(CancellationToken[])`, `(CancellationToken, CancellationToken)`, and the
newer `ReadOnlySpan<CancellationToken>`. There is deliberately **no** "cancel when *all* of"
overload. A linked source is a disjunction, full stop. If you need one token to require
consensus, that primitive does not exist.

**`WhenAny` returns a wrapper, and the exception is in the wrapper's contents.** The docs call
this line important:

> This line is important because `Task.WhenAny` returns a `Task<Task>` — a wrapper task that
> contains the completed task. When you `await Task.WhenAny`, you're waiting for the wrapper task
> to complete, and the result is the actual task that finished first. However, **to retrieve that
> task's result or ensure any exceptions are properly thrown, you must await the completed task
> itself** (stored in `finishedTask`).

So `await Task.WhenAny(...)` on its own surfaces **nothing**. You end up holding a `Task`, you
feel like you handled it, and the exception is still unobserved — the same defect as
`rules/dotnet/fire-and-forget-hides-exceptions.md` wearing a different costume.

**And `WhenAny` fires before cancellation lands.** Microsoft's own tutorial makes this explicit
with a comment that is the whole lesson:

```csharp
Task finishedTask = await Task.WhenAny(new[] { cancelTask, sumPageSizesTask });
if (finishedTask == cancelTask)
{
    // wait for the cancellation to take place:
    try { await sumPageSizesTask; }
    catch (OperationCanceledException) { /* ... */ }
}
```

`WhenAny` returns when the *canceller* finishes — which is **before** the cancelled work has
actually stopped. The docs confirm the consequence: "If the first task to complete is the
`cancelTask`, the `sumPageSizeTask` is awaited. If it was cancelled, when awaited it throws a
`System.Threading.Tasks.TaskCanceledException`." Skipping that second await is a second, subtler
source of orphaned work.

## Do

- **Link the tokens explicitly, and keep the link alive.** `CreateLinkedTokenSource` is the only
  primitive that cancels all children at once. Disposing the linked source is part of the
  obligation — it is `IDisposable`, and the source it wraps usually is too.
- **Await the inner task after every `WhenAny`.** The docs' own sample does `await finishedTask;`
  and flags the line as important. Treat the missing line as a defect, not an optimization.
- **Await the cancelled work before returning**, as in the tutorial's
  `// wait for the cancellation to take place:` block. That is the "don't exit until cancellation
  has been processed" step.
- **Use `CancelAfter` for timeouts** — it "schedules the cancellation of any associated tasks
  that aren't complete within the period of time that's designated by the `CancelAfter`
  expression" — and dispose in a `finally`.
- **Catch `OperationCanceledException`, the base type.** Note the shipped code in the tutorial
  article catches the base class even where the prose says `TaskCanceledException`. That is the
  correct, more robust choice.
- **Use a single shared CTS when lifetimes are genuinely identical.** Linked sources exist for
  independent lifetimes — one for app shutdown, one per request, one per timeout budget. If all
  children really share a lifetime, one CTS is simpler and lazier, and skips the extra dispose
  obligation.

## Don't

- **Expect `WhenAll` to cancel siblings when one throws.** It does not. It aggregates; it does not
  propagate cancellation backwards. To cancel siblings you must hold a CTS and cancel it.
- **Reach for a linked source when you want AND-semantics.** No such overload exists. "Cancel
  when all sources cancel" must be built by hand.
- **Write `await Task.WhenAny(tasks);` and call it handled.** You awaited the wrapper. Await the
  result.
- **Return as soon as the canceller completes.** The work is still running; you have merely been
  told the canceller finished first.
- **Treat `WhenAll` as a barrier that guarantees the work stopped.** It guarantees *completion*,
  and for cancelled tasks that completion is a `TaskCanceledException` you still have to observe.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| One child faults, siblings keep running | `WhenAll` aggregates, does not cancel | hold a CTS; cancel it in a handler |
| Exception never surfaces from a `WhenAny` race | awaited the wrapper, not the inner task | `await finishedTask;` |
| Shutdown returns while work still runs | returned when the canceller finished | await the cancelled work first |
| Linked source never fires | expected — it is OR, and no source cancelled | one source must actually cancel |
| Timeout fires but the source leaks | `Dispose()` omitted | `finally { cts.Dispose(); }` |
| `TaskCanceledException` escapes as a 500 | caught the wrong type, or none | catch `OperationCanceledException` |

## Verifying

```bash
# 1. WhenAny without the inner await
grep -rn -A2 'await Task\.WhenAny' --include=*.cs src/ | grep -v 'finishedTask\|completed\|= '

# 2. WhenAll with no CTS held nearby
grep -rn -B5 'await Task\.WhenAll' --include=*.cs src/ | grep -c 'CancellationTokenSource'

# 3. CancelAfter without a dispose
grep -rn -A8 'CancelAfter(' --include=*.cs src/ | grep -c 'Dispose()'
```

Finding 1 is the silent one — the code compiles, the race is handled, and the exception is still
lost. Findings 2 and 3 are omissions that a reader can confirm in a glance.
