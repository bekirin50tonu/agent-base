---
title: "`BackgroundService` Over `Task.Run` — the Host Owns the Task, So a Failure Has Somewhere to Surface"
rule_id: "RULE-DOTNET-005"
category: "correctness"
scope: "aspnet-core"
applies_to: "ASP.NET Core apps with work outliving a request: background jobs, polling loops, timers, queue consumers"
last_updated: "2026-09-30"
source: "https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services?view=aspnetcore-10.0"
---

# `BackgroundService` Over `Task.Run` — the Host Owns the Task

`Task.Run` hands the work to the thread pool and returns a `Task` nobody holds.
`BackgroundService.ExecuteAsync` hands the work to the host, which keeps a reference,
awaits it on shutdown, and supplies the cancellation token as a required parameter.

## Why

The base class contract is a single sentence that contains the whole argument:

> BackgroundService is a base class for implementing a long running IHostedService.
>
> `ExecuteAsync(CancellationToken)` is called on the thread pool to run the background service.
> The implementation returns a Task that represents the entire lifetime of the background
> service. **The host blocks in `StopAsync(CancellationToken)` waiting for `ExecuteAsync` to
> complete.**

The host holds your task. That is precisely the reference a fire-and-forget lacks, and it is
what makes the three failure modes in `rules/dotnet/fire-and-forget-hides-exceptions.md`
impossible to reach through this base class: there is an awaiter, so a faulted `ExecuteAsync`
is observed; the host's await is bounded; and the token arrives as a parameter.

**Shutdown is a negotiation, not a kill.** The asymmetry is documented and quantified:

> The cancellation token has a default 30 second timeout to indicate that the shutdown process
> should no longer be graceful. When cancellation is requested on the token:
>
> - Any remaining background operations that the app is performing should be aborted.
> - Any methods called in StopAsync should return promptly.
>
> **However, tasks aren't abandoned after cancellation is requested—the caller awaits all tasks
> to complete.**

So an `ExecuteAsync` that ignores the token has bought a **30-second shutdown on every
deploy**. That is the price of non-cooperation, and it is a known number rather than a hang.

**`PeriodicTimer` is the documented replacement for `System.Threading.Timer`**, and the
difference is the awaiting:

```csharp
using PeriodicTimer timer = new(TimeSpan.FromSeconds(30));
try
{
    while (await timer.WaitForNextTickAsync(stoppingToken))
    {
        await DoWork();
    }
}
catch (OperationCanceledException)
{
    _logger.LogInformation("Timed Hosted Service is stopping.");
}
```

Three properties the `Timer` version lacks. The tick is **awaited**, so iterations cannot
overlap. The token is passed **into** `WaitForNextTickAsync`, so shutdown is immediate rather
than next-tick. The `OperationCanceledException` is caught at a boundary that lets the method
return normally, so the host's `StopAsync` await completes. The page names the hazard the old
approach carries: *"The Timer doesn't wait for previous executions of `DoWork` to finish, so
the approach shown might not be suitable for every scenario."*

**The work-item signature makes non-propagation a compile error.** The queued-task sample
threads the token at three levels in six lines:

```csharp
while (!stoppingToken.IsCancellationRequested)
{
    var workItem = await TaskQueue.DequeueAsync(stoppingToken);
    try { await workItem(stoppingToken); }
    catch (Exception ex) { _logger.LogError(ex, "…"); }
}
```

The work item is `Func<CancellationToken, ValueTask>` — the token is a **required parameter of
the leaf**, so a callee that forgets to forward it does not compile. Compare
`Task.Run(async () => await Db.Save())`, where nothing enforces anything and the non-cancellable
version is the only version. This is the structural difference in one signature: the
hosted-service design makes the defect unrepresentable.

**The scope constraint is why fire-and-forget is tempting in the first place:**

> To use scoped services within a BackgroundService, create a scope. **No scope is created for a
> hosted service by default.**

A hosted service has no `HttpContext` and no ambient request scope. That is a real cost — but
it is also an argument *for* the pattern on request-scoped work, since it forces you to pass
values rather than capture a request's machinery.

## Do

- **Pass values out of the request, not its machinery.** Serialize what the work needs
  (an id, a tenant key) and resolve services inside a scope you create. Capturing
  `HttpContext` or a request-scoped service into detached work is the defect this pattern
  exists to prevent.
- **Create a scope explicitly** for anything scoped, and dispose it — including per work item
  in a queue consumer, not just once around the loop.
- **Await every tick and every work item** before looping. That single property is what
  fire-and-forget cannot offer, and it is why `PeriodicTimer` is preferred over `Timer`.
- **Catch `OperationCanceledException` at the top of `ExecuteAsync`** so the method returns
  normally. An escaping cancellation exception reads as a crash and skips the clean return.
- **Treat the 30-second `ShutdownTimeout` as a budget.** If the work cannot finish in 30
  seconds, it needs to checkpoint, not to ignore the token.
- **Do cleanup in `Dispose`, not `StopAsync`.** *"If an error is thrown during background task
  execution, `Dispose` should be called even if `StopAsync` isn't called"* — because an
  unexpected process failure means `StopAsync` never runs at all.

## Don't

- **Detach a `Task.Run` from a request handler and call the work done.** The host has no
  reference, so shutdown cannot bound it and no exception will ever be observed.
- **Use `System.Threading.Timer` for async work.** It does not wait for the previous execution
  to finish, so iterations overlap. Use `PeriodicTimer`.
- **Put long-running work in `StartAsync`.** *"StartAsync should be limited to short running
  tasks because hosted services are run sequentially, and no further services are started until
  StartAsync runs to completion."* Startup is serialized; the work belongs in `ExecuteAsync`.
- **Assume `StopAsync` is guaranteed.** *"If the app shuts down unexpectedly (for example, the
  app's process fails), `StopAsync` might not be called."* Anything load-bearing goes in
  `Dispose`.
- **Reach for `IHostedService` over `BackgroundService` without a reason.** The base class is
  what supplies the awaited-task contract; hand-rolling `IHostedService` re-implements it and
  drops the `ExecuteAsync` shape.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Every deploy takes ~30s to shut down | `ExecuteAsync` ignores the token | pass it to every await; respect the budget |
| Two runs of the same job overlap | `System.Threading.Timer` doesn't wait | `PeriodicTimer`, awaited tick |
| `ObjectDisposedException` mid-job | request-scoped service captured past the request | pass values; create a scope |
| Failure never appears anywhere | detached task, no awaiter | `BackgroundService` |
| Startup of later services delayed | long work in `StartAsync` | move it to `ExecuteAsync` |
| Cleanup skipped on crash | `StopAsync` not called on process failure | move it to `Dispose` |

## Verifying

```bash
# 1. Detached work — the thing BackgroundService replaces
grep -rn 'Task\.Run(' --include=*.cs src/ | grep -v 'await\|=\s*Task\.Run\|\.Wait()'

# 2. Overlap-prone timers
grep -rn 'new System\.Threading\.Timer\|new Timer(' --include=*.cs src/

# 3. Hosted services that ignore their own token
grep -rn -A6 'ExecuteAsync' --include=*.cs src/ | grep -c 'IsCancellationRequested\|stoppingToken'

# 4. Scope discipline
grep -rn 'CreateScope\|IServiceScopeFactory' --include=*.cs src/
```

Findings 1 and 2 are the work to move. Finding 3 returning 0 for a hosted service that awaits
anything is the shutdown-budget bug; finding 4 returning 0 for a service that touches scoped
dependencies is the disposal bug.
