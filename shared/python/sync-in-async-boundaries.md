---
title: "Crossing the Sync/Async Boundary: run_in_executor Drops Context, to_thread Does Not"
category: "concurrency"
applies_to: "Any Python service mixing sync and async code; asyncio, Trio, or AnyIO; Django async views, FastAPI sync dependencies, Flask with async extensions; ThreadPoolExecutor and process pools"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/python/cpython/main/Doc/library/asyncio-task.rst,https://raw.githubusercontent.com/python/cpython/main/Lib/asyncio/threads.py,https://raw.githubusercontent.com/python/cpython/main/Lib/asyncio/base_events.py,https://raw.githubusercontent.com/agronholm/anyio/master/src/anyio/to_thread.py,https://raw.githubusercontent.com/agronholm/anyio/master/docs/threads.rst,https://raw.githubusercontent.com/django/asgiref/main/asgiref/sync.py,https://raw.githubusercontent.com/django/django/main/docs/topics/async.txt,https://raw.githubusercontent.com/fastapi/fastapi/master/docs/en/docs/async.md"
---

# Crossing the Sync/Async Boundary: run_in_executor Drops Context, to_thread Does Not

Mixing sync and async code in one process produces two failure shapes. One is loud — the event loop
stops and latency climbs. The other is silent: the work ran, returned the right value, and lost the
`contextvars` it needed. The distinction that separates them is not the framework, the function, or
the thread pool; it is **which of two nearly identical stdlib calls you used**.

The framework-level rules are in `rules/django/sync-orm-call-inside-async-view.md`,
`rules/fastapi/sync-def-runs-in-a-threadpool-with-a-capacity-limit.md`, and
`rules/flask/check-same-thread-is-cpythons-default-and-g-is-per-app-context.md`. This file is the
framework-agnostic layer underneath them.

## When to Use

- A codebase has both `async def` and `def` in the same service, and the boundary between them is
  decided per call site rather than by one wrapper.
- A `contextvars`-based value — request id, auth token, tenant, trace span — is missing inside a
  thread, a task, or a worker.
- An `async def` handler is slower than a `def` one and nobody can say why.
- Adding a thread pool or `run_in_executor` to "speed up" a blocking call, and latency got worse.
- Reviewing a call that reads a `ContextVar` inside a function scheduled onto a thread.

## The axis: two calls that look the same and are not

`asyncio.to_thread` is three lines of stdlib, and it propagates context:

```python
async def to_thread(func, /, *args, **kwargs):
    """Asynchronously run function *func* in a separate thread.

    Any *args and **kwargs supplied for this function are directly passed
    to *func*. Also, the current :class:`contextvars.Context` is propagated,
    allowing context variables from the main thread to be accessed in the
    separate thread.

    Return a coroutine that can be awaited to get the eventual result of
    *func*.
    """
    loop = events.get_running_loop()
    ctx = contextvars.copy_context()
    func_call = functools.partial(ctx.run, func, *args, **kwargs)
    return await loop.run_in_executor(None, func_call)
```
([CPython `asyncio/threads.py`](https://raw.githubusercontent.com/python/cpython/main/Lib/asyncio/threads.py))

`loop.run_in_executor` is what `to_thread` delegates to, and it does **not**:

```python
    def run_in_executor(self, executor, func, *args):
        self._check_closed()
        if self._debug:
            self._check_callback(func, 'run_in_executor')
        if executor is None:
            executor = self._default_executor
            # Only check when the default executor is being used
            self._check_default_executor()
            if executor is None:
                executor = concurrent.futures.ThreadPoolExecutor(
                    thread_name_prefix='asyncio'
                )
                self._default_executor = executor
        return futures.wrap_future(
            executor.submit(func, *args), loop=self)
```
([CPython `asyncio/base_events.py`](https://raw.githubusercontent.com/python/cpython/main/Lib/asyncio/base_events.py))

`executor.submit(func, *args)` — the function goes across, the context does not. That single
missing `copy_context()` is the whole difference between the two calls, and it is invisible in a
review because the two signatures are near-identical.

> Note that this changed: `asyncio.to_thread` gained context propagation when it was introduced in
> 3.9, and earlier write-ups of "the stdlib does not propagate contextvars into threads" are wrong for
> that function. It remains true for `run_in_executor`.

### The full table

| Operation | Runs on | Copies `contextvars` | Cancellation |
|---|---|---|---|
| `await` on a coroutine | same event loop | yes | yes |
| `asyncio.create_task` | same event loop | **yes — copies** | yes |
| `asyncio.to_thread` | worker thread | **yes** | no (thread keeps running) |
| `loop.run_in_executor` | worker thread | **no** | no |
| `anyio.to_thread.run_sync` | worker thread | **yes** | `abandon_on_cancel=True` only |
| `ProcessPoolExecutor` | another process | no — not transferable | no |

Two rows deserve care. `create_task` **copies** the context, so a value *written* to a `ContextVar`
inside the task does not propagate back out; a mutation that appears to vanish. And neither
`to_thread` nor `run_in_executor` propagates cancellation: a cancelled future leaves the worker
running, still holding whatever it was holding, until it finishes on its own.

## Where the loop gets blocked, and where it does not

A sync function called from `async def` runs on the event loop thread and stops everything — every
other request, every timer, every heartbeat. The rule is not "never call sync from async", it is
"never call *blocking* sync from async". A 5 ms `dict.get` is fine. A 5 ms database query is not,
and it is not unusual.

```python
# Incorrect — 500 ms during which the entire loop is stopped
async def handler():
    time.sleep(0.5)
    return await other_request_handler()
```

The measurement to take is the duration, not the function name. Everything over a few milliseconds
on the loop thread is a candidate; everything over a few tens is definitely one.

Django's guard is the exception that proves the rule — it raises `SynchronousOnlyOperation` rather
than blocking, precisely so the mistake is loud:

> The synchronous API of the ORM is the main example, but there are other parts that are also
> protected in this way.
>
> If you try to run any of these parts from a thread where there is a *running event loop*, you will
> get a :exc:`~django.core.exceptions.SynchronousOnlyOperation` error.
> ([Django `async.txt`](https://raw.githubusercontent.com/django/django/main/docs/topics/async.txt))

`DJANGO_ALLOW_ASYNC_UNSAFE` disables that guard, which converts a loud failure into a silent data
race. See `rules/django/sync-orm-call-inside-async-view.md`.

FastAPI's is the opposite: it does not raise, it routes to a threadpool with a fixed capacity.

> When you declare a *path operation function* with normal `def` instead of `async def`, it is run in
> an external threadpool that is then awaited, instead of being called directly (as it would block the
> server).
> ([FastAPI `async.md`](https://raw.githubusercontent.com/fastapi/fastapi/master/docs/en/docs/async.md))

That capacity is a real limit — AnyIO's `current_default_thread_limiter()` lazily creates a
`CapacityLimiter(40)`, and it counts *tokens*, so several sync dependencies on one request consume
several. When the limiter is full, requests **queue** rather than fail, which is why it presents as
latency and never as an error. See
`rules/fastapi/sync-def-runs-in-a-threadpool-with-a-capacity-limit.md`.

## The rule that generalises

| Situation | Answer |
|---|---|
| Django async view calling sync ORM | `sync_to_async(...)` — asgiref does `contextvars.copy_context()` per call |
| FastAPI `def` handler or dependency | Nothing — it is already in the threadpool |
| Any other sync call from `async def` | `await asyncio.to_thread(...)` |
| Already on AnyIO/Trio | `await to_thread.run_sync(...)` |
| Sync work on an async hot path | Move it to a queue; see `shared/python/task-queue-choice.md` |

`asgiref`'s `sync_to_async` copies the context per call, `asyncio.to_thread` copies it once,
`loop.run_in_executor` does not copy it. That is the whole decision, and it is a one-line check.

```python
# Incorrect — a ContextVar read inside the worker returns the default or raises LookupError
from asyncio import get_running_loop
loop = get_running_loop()
db = await loop.run_in_executor(None, load_order, order_id)

# Correct — context propagated
from asyncio import to_thread
order = await to_thread(load_order, order_id)

# Correct when the code is already AnyIO/Trio, and cancellable
from anyio import to_thread
order = await to_thread.run_sync(load_order, order_id)
```

AnyIO is already a dependency of FastAPI, Starlette, and Django's async support, so this is often
not a new dependency at all — check before adding one.

### The AnyIO trade-off

`abandon_on_cancel` is the parameter that decides whether cancellation actually stops anything, and
its own documentation states the cost:

> If the ``abandon_on_cancel`` option is enabled and the task waiting for its completion is
> cancelled, the thread will still run its course but its return value (or any raised exception) will
> be ignored.
> ([AnyIO `to_thread.py`](https://raw.githubusercontent.com/agronholm/anyio/master/src/anyio/to_thread.py))

and the prose version:

> By default, tasks are shielded from cancellation while they are waiting for a worker thread to
> finish. You can pass the ``abandon_on_cancel=True`` parameter to allow such tasks to be cancelled.
> Note, however, that the thread will still continue running – only its outcome will be ignored.
> ([AnyIO `threads.rst`](https://raw.githubusercontent.com/agronholm/anyio/master/docs/threads.rst))

So cancellation that "works" leaves an untracked thread still holding a database connection. That
is the trade, stated plainly, and it is why the default is `False`: for most calls, waiting is
safer than abandoning a thread mid-transaction.

## What to check first when something is "missing"

| Symptom | Check |
|---|---|
| `ContextVar` default inside a worker | Was it `run_in_executor` rather than `to_thread`? |
| Value set in a task not visible outside | `create_task` **copies** the context |
| Value set outside visible in a task | Expected — the copy is the point |
| Latency spikes with no slow handler | Something blocking the loop; measure durations |
| Requests queue but never error | Threadpool capacity limiter, not an exception |
| Cancellation does not stop the work | Expected for threads; `abandon_on_cancel` only ignores the outcome |
| Thread still active after a `timeout` | The future was cancelled, the thread was not |

## Greps

```bash
# The context-dropping call — this is the audit
grep -rn "run_in_executor" --include=*.py .

# The context-preserving stdlib call
grep -rn "asyncio.to_thread\|to_thread.run_sync\|sync_to_async" --include=*.py .

# Context-carrying state, which is what gets lost
grep -rn "ContextVar\|contextvars\|get_current_user\|request_id\|ContextMiddleware" --include=*.py .

# Blocking calls that may be on the loop thread
grep -rn "time.sleep\|requests\.\|urllib\|\.read()\|\.result()" --include=*.py .

# Django's guard being disabled
grep -rn "DJANGO_ALLOW_ASYNC_UNSAFE" --include=*.py --include=*.env* --include=*.yml --include=*.toml .
```

The first command is the whole audit and it is worth running first: every hit is a thread that will
not see the request context, and the second command tells you what the project does correctly
elsewhere, so the two are read together. Nothing here can tell you which `ContextVar` a given worker
actually read — that is what a log line inside the worker is for.

## Caveats

- **Process pools are not a workaround for context loss.** `contextvars` are per-thread and not
  transferable across `pickle`; anything a worker needs must be passed as an argument, and that is
  an argument for why a process pool is usually the wrong tool for request-shaped work.
- **`ContextVar` defaults are the second-order trap.** A `ContextVar` declared with a default returns
  that default on the wrong thread instead of raising, so a context-propagation bug becomes a
  request served as anonymous rather than an exception. Declare without a default where you can.
- **The `CapacityLimiter(40)` default is AnyIO's, not FastAPI's.** FastAPI documents the threadpool and
  does not document the number; the limit comes from the AnyIO backend, which means an AnyIO
  version bump can change it. Tune it explicitly with `anyio.to_thread.current_default_thread_limiter()`
  rather than relying on it.
- **This asset does not cover:** greenlet-based concurrency (`gevent`), Trio's own task semantics
  beyond the AnyIO wrapper, `from_thread.run_sync` for calling *back* into the loop from a worker,
  `asyncio.Runner` / loop-policy choices, structured-concurrency task groups as an organising
  principle, and profiling the loop itself (`asyncio` debug mode, `py-spy`, `aiomonitor`) — which is
  what tells you *which* call is blocking rather than guessing from the code.