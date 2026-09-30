---
title: "Fire-and-Forget Hides Exceptions — Nobody Awaiting a Faulted Task Sees Its Failure"
rule_id: "RULE-DOTNET-002"
category: "correctness"
scope: "all"
applies_to: "Any discarded Task, especially Task.Run from a request handler or a background fire-and-forget"
last_updated: "2026-09-30"
source: "https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/"
---

# Fire-and-Forget Hides Exceptions — Nobody Awaiting a Faulted Task Sees Its Failure

A faulted task holds its exception until someone applies an `await` to it. A fire-and-forget
task has no awaiter, so the failure is never released. The method returns `void`-shaped success
and the error is gone.

## Why

The async documentation states the mechanism directly:

> When a task that runs asynchronously throws an exception, that task is faulted. The `Task` object
> holds the exception thrown in the `Task.Exception` property. **Faulted tasks throw an exception
> when the await expression is applied to the task.**

Every clause matters. The exception is *held*, not thrown. It is released on `await` — and only
on `await`. Nobody awaits a fire-and-forget task, so nothing surfaces it. The code path is
identical whether you await or not; only the discard differs. That is what makes this class of
bug survive review: the same call is correct in one place and silently wrong in another, and the
difference is a semicolon's worth of context at the call site.

`Task.Run` is not the anti-pattern. **Discarding the return value is.** The report's framing is
worth keeping: `Run(Action, ct)` is not an async/await anti-pattern, it is a
discarded-return-value anti-pattern, and the cost is entirely in the discard. A fire-and-forget
`Task.Run` with no token is an honest one — the docs never condemn it.

Two amplifiers make it worse in a hosted application:

- **The host does not abandon your work.** The hosted-services page is explicit: *"tasks aren't
  abandoned after cancellation is requested — the caller awaits all tasks to complete."* So a
  shutdown does not rescue you either; the host waits for work that can never be cancelled
  (see `rules/dotnet/cancellation-token-is-a-parameter-not-ambient-state.md`).
- **Unobserved exceptions do not crash the process by default.** Since .NET 4.5 the default is to
  observe-and-continue, so a swallowed task exception produces no crash, no log, and no
  non-zero exit code.

## Do

- **Ask "who awaits this task?" before anything else.** If the answer is nobody, the task is not
  fire-and-forget — it is a failure with the reporting removed.
- **Use `BackgroundService` for work the host should own.** It makes the token a required
  constructor-injected parameter of `ExecuteAsync` and gives the host a task to await, so a
  failure has a place to surface. See
  `rules/dotnet/backgroundservice-over-task-run-for-hosted-work.md`.
- **Store the task if you truly must detach.** Assign it to a field and observe it — a stored
  reference is not an awaited one, so this is containment, not a fix; prefer `BackgroundService`.
- **Await the inner task after `Task.WhenAny`.** `await Task.WhenAny(...)` surfaces no
  exceptions on its own — see `rules/dotnet/whenall-does-not-cancel-and-linked-cts-is-or-only.md`.
- **Test the failure path explicitly.** A test that only exercises the success path cannot see
  this class of bug at all; the code is byte-identical in both cases.

## Don't

- **Treat a method returning `Task` as fire-and-forget because you didn't `await` it at the call
  site.** The compiler's CS4014 warning is pointing at a real defect, not a style preference.
- **Assume the exception surfaces via `TaskScheduler.UnobservedTaskException` in a way that
  helps.** It is raised, and the .NET 4.5+ default does not terminate the process. That is a
  GC-finalizer-time event, long after the request that caused it — useless for diagnosis.
- **Rely on shutdown to cancel detached work.** The host awaits it instead, and if the token
  never reached the delegate, the wait is unbounded.
- **Wrap already-async work in `Task.Run` and call it offloading.** That is manufacturing queue
  pressure, and the starvation it causes then gets "fixed" with `SetMinThreads` — see
  `rules/dotnet/setminthreads-is-not-the-starvation-fix.md`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Handler returns 200, the write never happened | faulted task, nobody awaited | `BackgroundService`, or await the work |
| An exception appears in logs long after the request, from a finalizer | unobserved task exception | await, or observe the task |
| Graceful shutdown hangs for ~30s | host awaits a task that cannot be cancelled | make the token reach the work |
| Works under test, fails in production | the success path never faults | test the throwing path explicitly |
| CS4014 suppressed with `_ =` | discard silenced the warning, not the bug | fix the lifetime, not the warning |

## Verifying

```bash
# 1. Discarded tasks: fire-and-forget calls, plus deliberate discards
grep -rn 'Task\.Run(\|_ = \|^\s*Task\s\+\w\+ = Task' --include=*.cs src/ \
  | grep -v 'await\|\.Wait()\|Dispose()'

# 2. Un-awaited Task-returning methods called from anywhere
grep -rn 'async Task' --include=*.cs src/ | wc -l   # total surface
#    then confirm every call site either awaits, stores, or is a BackgroundService
```

Finding 1 with no `await`, no stored field, and no `BackgroundService` is a discarded task, and
by the mechanism above its failures are unobservable. Fix the lifetime, not the warning.
