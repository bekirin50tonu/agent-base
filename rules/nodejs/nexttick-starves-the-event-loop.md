---
title: "process.nextTick() starves the event loop when it reschedules itself"
rule_id: "RULE-NODEJS-003"
category: "concurrency"
scope: "backend"
applies_to: "Node.js, process.nextTick, queueMicrotask, event loop starvation, retry loops"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/process.html"
---

# process.nextTick() starves the event loop when it reschedules itself

The next-tick queue is drained to exhaustion before the event loop is allowed to continue, and
a tick scheduled from inside a tick joins the same drain:

> This queue is fully drained after the current operation on the JavaScript stack runs to
> completion and before the event loop is allowed to continue.
> ([Process](https://nodejs.org/api/process.html))

The documentation states the consequence directly:

> It's possible to create an infinite loop if one were to recursively call process.nextTick().
> ([Process](https://nodejs.org/api/process.html))

And the ordering relative to the other microtask queue is fixed:

> The process.nextTick() queue is always processed before the microtask queue within each
> ([Global objects](https://nodejs.org/api/globals.html))

A tick loop that never stops rescheduling is therefore not a slow path — it is a stopped event
loop. I/O callbacks never run, timers never fire, and `setImmediate` never executes. The socket
stays open because nothing closed it, so the client observes a hang, and the process shows
100% CPU with a healthy heap and no stack growth to suggest recursion.

## Why

The pattern is defensive code written to "check again once the current work settles":

```javascript
function waitFor(fn, attempt = 0) {
  if (fn()) return;
  if (attempt > 1000) throw new Error('gave up');
  process.nextTick(() => waitFor(fn, attempt + 1));
}
```

With the bound, this is correct. The bound is the entire safety property, and it is one optional
parameter that a later edit can drop. Once dropped, the function still reads as bounded to
anyone skimming it, still passes the tests that only need a few attempts, and starves the loop
completely.

The cost is invisible in profiles because there is no recursion — each tick runs and returns.
The CPU profile shows a flat hot loop, not a stack overflow, and memory stays constant.

## Do

- Bound every rescheduling retry with a count or a deadline. The bound is what makes the loop
  safe; the scheduling API does not.
- Yield to the macrotask queue when you need I/O to progress: `setImmediate`, or
  `setTimeout`/`timers/promises` with a delay.
- Use `queueMicrotask()` for ordering within a single turn — it is the documented replacement
  for `nextTick`, which is marked Legacy.
- For a cancellable retry delay, `timers/promises.setTimeout(delay, value, { signal })` so
  shutdown can interrupt it.
- Treat any loop that re-enters its own scheduler as requiring a bound, by code review rule.

```javascript
// Correct — bounded retries, yielding to the event loop between attempts
import { setTimeout as delay } from 'node:timers/promises';

async function waitFor(fn, { attempts = 10, step = 50, signal } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (fn()) return true;
    await delay(step, undefined, { signal });   // macrotask: I/O gets a turn
  }
  throw new Error('gave up');
}
```

## Don't

- Don't reschedule from inside a tick handler without a bound. This is the rule.
- Don't replace `process.nextTick()` with `queueMicrotask()` and call it fixed. A
  self-rescheduling microtask starves the microtask queue instead, which is equally unbounded
  and additionally starves promise continuations.
- Don't use a longer tick delay as the fix. It reduces the rate of a spin that is already
  wrong; the loop still never lets I/O run.
- Don't debug a 100% CPU process by looking for recursion. There is none, by construction.
- Don't add an unbounded retry "temporarily" to unblock a deploy.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Process at 100% CPU, heap flat | Tick loop never yields | Bound the retry |
| Socket open, client hangs | I/O callbacks never scheduled | Yield to the macrotask queue |
| Timers never fire | Event loop never advanced | Same |
| Only under load | Retry count scales with contention | Add a deadline, not just a count |
| Promises stop resolving too | Microtask queue starved | Stop self-rescheduling microtasks |
| Profiler shows no recursion | Flat loop, not recursion | Read the retry bound, not the stack |

## Verifying

```bash
# Every nextTick and microtask site, to check for self-rescheduling
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'process\.nextTick\(|queueMicrotask\(' src/

# Retry loops -- each needs a bound read in the surrounding function
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'attempt|retry|retries|maxRetries' src/

# Scheduling inside a callback, the shape that starves
grep -rn --include='*.{js,mjs,cjs,ts}' -A3 -E 'nextTick\(|queueMicrotask\(' src/

# Blocking detection, once the loop is already wedged
node --trace-sync-io app.js
```

The first and third lists overlap but answer different questions: the first finds every
scheduling site, the third finds the ones nested inside another callback — which is where
self-rescheduling lives. Each hit needs its enclosing function read to confirm a bound.

These greps cannot tell whether a retry will terminate, because that depends on the predicate
being polled, not on the scheduler. Confirm by counting the attempts in the code, and if there
is no count, treat it as unbounded.