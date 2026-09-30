---
title: "A CancellationToken Is a Parameter, Not Ambient State — and Task.Run Does Not Pass It"
rule_id: "RULE-DOTNET-001"
category: "correctness"
scope: "all"
applies_to: "Any async method that receives a CancellationToken and calls other async work"
last_updated: "2026-09-30"
source: "https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.run"
---

# A CancellationToken Is a Parameter, Not Ambient State — and `Task.Run` Does Not Pass It

A `CancellationToken` is handed to someone, never delivered on your behalf. There is no
ambient context to recover, so the token stops flowing at exactly one place: a signature that
does not declare it.

## Why

The `CancellationToken` API reference defines the whole model in two clauses — the token
"propagates notification that operations should be canceled," and, critically, **"The token
cannot be used to initiate cancellation."** The `CancellationTokenSource` is the signal; the
token is the receipt. You can only deliver a receipt by putting it in a parameter list.

This is a sharp departure from the pre-async model. A thread blocked in `WaitHandle.WaitOne`
receives an interrupt. An `async` method has no thread to interrupt, so the parameter list is the
only channel. That is why "the token stopped flowing" is a diagnosable bug rather than a mystery:
there is exactly one cause — a signature that omits it.

The sharpest instance is documented on `Task.Run` itself, and it is easy to read past:

> cancellationToken — A cancellation token that can be used to cancel the work **if it has not
> yet started**. **`Run(Action, CancellationToken)` does not pass `cancellationToken` to
> `action`.**

The identical sentence appears on the `Run(Func<Task>, CancellationToken)` overload. So the
outer overload's token gates **scheduling only**. `"if it has not yet started"` is the entire
window of its power:

> If cancellation is requested before the task begins execution, the task does not execute.
> Instead it is set to the Canceled state and throws a `TaskCanceledException` exception.

The moment the delegate is running, that token is inert. Handing a token to
`Task.Run(async () => await Db.Save(), token)` and walking away produces a method with **no
cancellation whatsoever inside it** — the commonest shape of this bug, because it reads as though
cancellation were wired up.

## Do

- **Thread the token through every signature on the path.** One missing parameter is the whole
  bug. Cancellation is cooperative — "The objects that receive the notification can respond in
  whatever manner is appropriate" — so a callee that never received the token never learns.
- **Inside a `Task.Run` delegate, capture the token from a field, not the overload parameter.**
  This is what Microsoft's own hosted-services sample does, and the contrast is instructive:
  `MonitorLoop` stores `_cancellationToken = applicationLifetime.ApplicationStopping` in its
  constructor and checks `while (!_cancellationToken.IsCancellationRequested)` inside
  `MonitorAsync`. The crossing is a **closure over a constructor-injected field**, because
  `Task.Run`'s own parameter was omitted and would not have worked.
- **Cancel by composition, not by the outer overload.** For "stop this when that happens," use
  `CancellationTokenSource.CreateLinkedTokenSource` and pass the linked token *into* the work —
  see `rules/dotnet/whenall-does-not-cancel-and-linked-cts-is-or-only.md`.
- **Treat an abandoned task as uncancellable work, not as a cancelled task.** If nobody holds a
  reference and nobody awaits, assume it runs to completion regardless of every token in scope.

## Don't

- **Treat a `Task.Run` token as though it cancels the work.** It does not, and the docs say so on
  the parameter itself. This is the single highest-value thing to know about `Task.Run`.
- **Assume `async` propagates the token automatically.** There is no `AsyncLocal` in this design.
  If the token is not a parameter of the callee, the callee is uncancellable.
- **Reach for a thread interrupt to cancel async work.** There is no thread to interrupt; a
  blocking wait in an async method is the disease that causes starvation in the first place.
- **Write a "cancel on timeout" loop by hand when `CancelAfter` exists.** The shipped tutorial
  pattern is the whole shape: `s_cts.CancelAfter(3500); await WorkAsync();` in a `try`, a
  `catch (OperationCanceledException)`, and `s_cts.Dispose()` in a `finally` — the dispose is
  flagged `Important`, not optional.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Abort requested, work finishes anyway | `Task.Run`'s token was scheduling-only | pass the token into the delegate's own calls |
| Inner operation unaffected by a timeout | signature omits the token | add the parameter; there is no ambient fallback |
| Work outlives the object that requested cancellation | no linked source; the callee holds a different token | `CreateLinkedTokenSource` |
| Cancel arrives before the delegate starts, nothing happens | documented — task is Canceled, does not execute | expected; distinguish from the running case |
| Timeout "works" but the source leaks | `Dispose()` omitted | `CancellationTokenSource` is `IDisposable`; `finally` block |

## Verifying

```bash
# 1. Fire-and-forget: a Task.Run / _ = whose result is never awaited or stored
grep -rn 'Task\.Run(' --include=*.cs src/ | grep -v 'await\|=\s*Task\.Run\|\.Wait()'

# 2. Token-taking methods that do not pass it on
grep -rn 'CancellationToken\s\+\w*)' --include=*.cs src/ | head -40
#    then, for each hit, confirm the body forwards it to its own async callees

# 3. Where a token arrives but nothing consumes it
grep -rn 'CancellationToken' --include=*.cs src/ | grep -c 'ThrowIfCancellationRequested\|IsCancellationRequested'
```

The pair that matters is 1 and 2: an unawaited `Task.Run` *plus* a token-taking method that
does not forward its token is the exact compound failure — work that cannot be cancelled and
whose failure nobody will ever see.
