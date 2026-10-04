---
title: "A Sync ORM Call Inside an Async View Either Raises or Blocks the Loop"
rule_id: "RULE-DJANGO-007"
category: "concurrency"
scope: "backend"
applies_to: "Any Django project with async views, async ORM calls, or DJANGO_ALLOW_ASYNC_UNSAFE set in any environment"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/topics/async/"
---

# A Sync ORM Call Inside an Async View Either Raises or Blocks the Loop

Django 5.0 added async views and async ORM methods, together with a guard on everything that was
not made coroutine-aware. The guard raises by default. The escape hatch is what turns a loud
failure into a silent one, and it is a single environment variable.

## Why

The classification:

> Certain key parts of Django are not able to operate safely in an async environment, as they have
> global state that is not coroutine-aware. These parts of Django are classified as "async-unsafe",
> and are protected from execution in an async environment. The synchronous API of the ORM is the
> main example, but there are other parts that are also protected in this way.
> ([Django 6.1 Async support](https://docs.djangoproject.com/en/6.1/topics/async/))

The scope of the guard is wider than most people expect — it is not only about `await`ing:

> If you try to run any of these parts from a thread where there is a running event loop, you will
> get a `SynchronousOnlyOperation` error. Note that you don't have to be inside an async function
> directly to have this error occur. If you have called a sync function directly from an async
> function, without using `sync_to_async()` or similar, then it can also occur. This is because your
> code is still running in a thread with an active event loop, even though it may not be declared
> as async code.
> ([Django 6.1 Async support](https://docs.djangoproject.com/en/6.1/topics/async/))

That second sentence is the one to keep: **calling** a sync function from an async function is
enough. A `def` helper invoked by an `async def` view can raise, and the traceback points at the
helper — so the cause is separated from the effect by a call frame that says nothing about async.

The escape hatch, in the docs' own words:

> If you enable this option and there is concurrent access to the async-unsafe parts of Django, you
> may suffer data loss or corruption. Be very careful and do not use this in production environments.
> ([Django 6.1 Async support](https://docs.djangoproject.com/en/6.1/topics/async/))

`DJANGO_ALLOW_ASYNC_UNSAFE` converts a `SynchronousOnlyOperation` traceback into concurrent access
to ORM state that is not coroutine-aware. That is a data-corruption class failure, not a
performance one — and it is one environment variable, which is exactly the kind of change made to
unblock a deploy and never removed.

### Why the environments disagree

The middle case is what costs days: `DJANGO_ALLOW_ASYNC_UNSAFE=true` in a **local** `.env` so the
developer's async view works, and in **CI** because the test client drives the view differently than
uvicorn does. Production may be clean. The mechanism differs per environment and the difference is
invisible until it isn't.

The docs also note that this fires outside your code entirely — Jupyter and IPython transparently
provide an event loop, so a function that works in `manage.py shell` can raise in a notebook. Any
environment where a bug reproduces locally but not in CI is explained by that.

## Do

- Use the async ORM API from an async view:
  ```python
  # Incorrect — the sync API from an async context
  class OrderListView(View):
      async def get(self, request):
          orders = Order.objects.filter(status="open")   # SynchronousOnlyOperation
          return JsonResponse({"count": orders.count()})

  # Correct
  class OrderListView(View):
      async def get(self, request):
          orders = [o async for o in Order.objects.afilter(status="open")]
          return JsonResponse({"count": len(orders)})
  ```
- Put the boundary at the wrapper, not at each call site. `asgiref` is already a Django dependency;
  there is nothing to add:
  ```python
  from asgiref.sync import sync_to_async

  def _load_orders_sync(status: str) -> list[dict]:
      return list(Order.objects.filter(status=status).values("id", "total"))

  # Correct — one wrapper, and it is the thing that owns the sync/async decision
  class OrderListView(View):
      async def get(self, request):
          orders = await sync_to_async(_load_orders_sync)("open")
          return JsonResponse({"count": len(orders)})
  ```
- Note the difference between the two thread adapters when context matters. `anyio`'s
  `to_thread.run_sync` propagates `contextvars` into the worker thread; bare `asyncio.to_thread`
  does not, so a `ContextVar`-based request id or auth token silently disappears on the hop. See
  `shared/python/sync-in-async-boundaries.md`.
- Move the work off the request entirely when it does not belong there — `sync_to_async` still
  holds the connection open for the duration of the view. See `shared/python/task-queue-choice.md`.

## Don't

- Set `DJANGO_ALLOW_ASYNC_UNSAFE` to make a traceback go away. The traceback is the correct output
  of a program with a data race in it.
- Set it in a local `.env` or a CI config "temporarily". The variable's damage is in its
  *persistence*, not its use, and the environment that has it is the one you cannot debug later.
- Assume `SynchronousOnlyOperation` means you forgot an `await`. It fires on a plain call from a
  sync function that an async function called directly.
- Trust a test suite that runs the async view through the sync test client to prove the async path
  works. That path exercises a different mechanism than uvicorn does.
- Hand-roll the thread hop with `asyncio.to_thread` in code that carries request context. It works
  until a `ContextVar` is involved, and then it fails as missing data rather than as an error.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `SynchronousOnlyOperation` from a view | Sync ORM call reached an async context | `afilter`/async iteration, or `sync_to_async` |
| Traceback points at an unrelated `def` helper | A sync function called from an async one, not awaited | Find the caller; the helper is not the bug |
| Intermittent wrong rows, wrong transaction owner | `DJANGO_ALLOW_ASYNC_UNSAFE` with concurrent access | Remove the variable; the race it hides is real |
| Works in `manage.py shell`, raises in a notebook | IPython's autoawaited event loop | Same fix as any async context |
| Passes in CI, fails under uvicorn | Test client exercises a different path | Test through the real ASGI entry point |
| Request id or auth token missing inside a thread | `asyncio.to_thread` does not propagate `contextvars` | Use `anyio.to_thread.run_sync` |

## Verifying

```bash
# The variable, in every environment file that could carry it
grep -rn "DJANGO_ALLOW_ASYNC_UNSAFE\|django_allow_async_unsafe" --include=*.py --include=*.env* --include=*.yml --include=*.yaml --include=*.toml --include=*.cfg .

# Sync ORM calls that might be reachable from an async view
grep -rn "\.objects\.\(filter\|get\|all\|create\|count\|exists\|aggregate\)(" --include=*.py .

# The async views themselves, and the sync helpers they call
grep -rn "async def" --include=*.py .
```

The first command is the one that matters most, and it is a grep over configuration rather than
code — that is the shape of this failure. The second and third find the candidates; whether any of
them is actually reachable from an async context is a call-graph question no grep answers, so read
the callers of anything a `def` helper invokes.