---
title: "`SetMinThreads` Is Not the Starvation Fix — It Has Five Named Ways to Make Things Worse"
rule_id: "RULE-DOTNET-004"
category: "performance"
scope: "all"
applies_to: "Services that call ThreadPool.SetMinThreads, or that show thread-pool queue latency"
last_updated: "2026-09-30"
source: "https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadpool.setminthreads"
---

# `SetMinThreads` Is Not the Starvation Fix — It Has Five Named Ways to Make Things Worse

The API reference documents the folklore remedy and then enumerates five mechanisms by which it
degrades performance. One of them makes a *healthy* pool look starved, which is how the folklore
got written.

## Why

The reference is unusually direct. The trigger is blocking, and the word for the fix is
*temporary*:

> You can use `SetMinThreads` to increase the minimum number of threads, such as **to temporarily
> work around** issues where some queued work items or tasks block thread pool threads. Those
> blockages sometimes lead to a situation where all worker or I/O completion threads are blocked
> (starvation).

So the trigger is **blocking** — the disease. Starvation is the symptom. The remedy is scoped to
that one cause and explicitly temporary.

Then the caution, and the five mechanisms:

> **Caution** — Using the `SetMinThreads` method to increase the minimum number of threads can
> cause performance problems as described in the preceding text. In most cases, the thread pool
> will perform better with its own algorithm for allocating threads. Reducing the minimum to less
> than the number of processors can also hurt performance.
>
> However, increasing the minimum number of threads might degrade performance in other ways:
>
> - The thread pool may schedule more worker threads, even when the worker threads are not getting
>   blocked. The oversubscription can cause threads that get scheduled-out to be significantly
>   delayed as they wait in a long queue to get another time slice, delaying some work items or
>   tasks.
> - Worker threads may take more CPU time in dequeuing work items due to having to scan more
>   threads to steal work from.
> - Context switching between threads may increase CPU usage.
> - Garbage collection may take more CPU time in thread stack walking.
> - The process may consume more memory.

**The first bullet is the trap.** It is a false-positive amplifier: the very mechanism you reach
for when threads are starved *also* makes queue lookups slower when threads are healthy. So it
can make a healthy pool look slow and a starved pool look better, in ways that are hard to
attribute. That is the whole reason "raise min threads" is folklore rather than a rule.

Two more details that get misread:

- The default "is set to the processor count" — which is also why *"Reducing the minimum to less
  than the number of processors can also hurt performance."* You cannot tune downward past the
  default without a documented cost either.
- The minimum is a floor, not a guarantee: *"When demand is low, the actual number of thread pool
  threads can fall below the minimum values."* Observing fewer threads than you configured is not
  a bug.
- **Scope limit:** *"This method is not supported when the Windows thread pool is configured to be
  used instead of the .NET thread pool."* On that configuration the knob does nothing.

## Do

- **Diagnose before touching the pool.** If you cannot rule out oversubscription-induced delay,
  work-stealing scan cost, and context-switch overhead from the list above, you have not
  identified a cause yet. The bullet list is a measurement checklist.
- **Remove the blocking call instead.** The docs' own guidance on when `Task.Run` is warranted at
  all is narrow: *"You can use `Task.Run` to move CPU-bound work to a background thread, but a
  background thread doesn't help with a process that's just waiting for results to become
  available."* The starvation remedy is *don't offload I/O-bound waiting to `Task.Run`*, not
  *add threads*.
- **Treat a raise as an assertion you should be able to defend.** You are claiming the pool's own
  injection heuristic is failing you — and accepting payment in one of the five listed ways.
- **Check whether the Windows thread pool is in use** before concluding the setting did nothing.

## Don't

- **Add `SetMinThreads` as a blanket startup mitigation.** It is documented as a temporary
  workaround for a specific cause, with a caution attached, and it degrades the healthy case.
- **Wrap already-async work in `Task.Run` to "get off the request thread."** That manufactures the
  queue pressure people then treat with `SetMinThreads` — treating the symptom that the code
  created.
- **Read thread counts below your configured minimum as a malfunction.** The pool is documented to
  run below the minimum when demand is low.
- **Set the minimum below the processor count** to "leave headroom." Documented as hurting
  performance.
- **Keep a `SetMinThreads` call after fixing the blocking call.** The docs scope it to a
  temporary workaround; leaving it in place keeps the five costs without the cause.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Queue latency rose after adding min threads | oversubscription delay (bullet 1) | revert; find the blocking call |
| CPU up, throughput flat | work-stealing scan cost + context switching (bullets 2–3) | revert; the pool's own heuristic is right |
| `SetMinThreads` has no effect | Windows thread pool in use, not the .NET pool | unsupported configuration |
| Thread count below the configured minimum | demand is low; documented behavior | not a bug |
| Latency worse with more threads than fewer | the false-positive amplifier — healthy pool made to look starved | revert; do not tune from this symptom |

## Verifying

```bash
# 1. Is the knob in use, and is it in startup code (i.e. permanent)?
grep -rn 'SetMinThreads' --include=*.cs src/

# 2. The real disease: blocking calls on the pool
grep -rn '\.Result\b\|\.Wait()\|Thread\.Sleep\|Task\.Run(' --include=*.cs src/

# 3. Java-style offload of already-async work
grep -rn 'Task\.Run(async' --include=*.cs src/
```

Finding 1 next to finding 2 is the diagnosis in one screen: a mitigation for blocking, applied
while the blocking remains. Fix 2 first, then re-measure before deciding whether 1 was ever
needed.
