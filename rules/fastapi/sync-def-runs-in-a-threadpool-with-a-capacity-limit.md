---
title: "A def Handler Runs in a Threadpool With a Capacity Limit You Never Chose"
rule_id: "RULE-FASTAPI-001"
category: "concurrency"
scope: "backend"
applies_to: "Any FastAPI path operation or dependency declared with def rather than async def; and any async def that calls blocking code"
last_updated: "2026-10-04"
source: "https://fastapi.tiangolo.com/async/,https://raw.githubusercontent.com/encode/starlette/master/starlette/concurrency.py,https://raw.githubusercontent.com/agronholm/anyio/master/src/anyio/_backends/_asyncio.py"
---

# A def Handler Runs in a Threadpool With a Capacity Limit You Never Chose

FastAPI's most misread default. Writing `def` instead of `async def` does not mean "synchronous,
therefore safe" — it means "synchronous, therefore offloaded to a bounded resource". The bound is
not in the sentence that documents the behaviour.

## Why

The documented behaviour:

> When you declare a path operation function with normal `def` instead of `async def`, it is run in
> an external threadpool that is then awaited, instead of being called directly (as it would block
> the server).
> ([FastAPI async docs](https://fastapi.tiangolo.com/async/))

And it applies to dependencies too, which is the part usually missed:

> The same applies for [dependencies](tutorial/dependencies/index.md). If a dependency is a standard
> `def` function instead of `async def`, it is run in the external threadpool.
> ([FastAPI async docs](https://fastapi.tiangolo.com/async/))

FastAPI delegates the offload to Starlette, which delegates to AnyIO:

```python
async def run_in_threadpool(func: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    func = functools.partial(func, *args, **kwargs)
    return await anyio.to_thread.run_sync(func)
```
([Starlette `concurrency.py`](https://raw.githubusercontent.com/encode/starlette/master/starlette/concurrency.py))

`to_thread.run_sync` with no explicit limiter acquires a token from the run's **default** limiter,
and AnyIO creates that default on first use:

```python
    @classmethod
    def current_default_thread_limiter(cls) -> CapacityLimiter:
        try:
            return _default_thread_limiter.get()
        except LookupError:
            limiter = CapacityLimiter(40)
            _default_thread_limiter.set(limiter)
            return limiter
```
([AnyIO asyncio backend](https://raw.githubusercontent.com/agronholm/anyio/master/src/anyio/_backends/_asyncio.py))

**Forty concurrent sync handlers per event loop.** Past that, `run_sync` waits on the limiter's
queue. This is the silent half of the claim, and it is invisible in both directions: the forty-first
request does not fail, it *queues*, and a queued request has the same latency profile as a slow one.
Nothing logs. The symptom is "under load everything gets slow and no errors appear in the log" —
a saturation problem misread as a slow database.

Two properties of that limiter that are easy to get wrong:

- It is a `RunVar` — per event loop, per run, not per process. `uvicorn --workers 4` gives four
  independent limits of 40, so process-wide concurrency is `40 × workers`, and each worker can
  saturate alone.
- It counts **tokens, not requests**. A `def` dependency and a `def` handler each consume one, so a
  single endpoint with three sync dependencies has four tokens per in-flight request.

### The two failure modes are opposites, and both present as latency

- **Blocking inside `async def`** — the event loop stops. Not "that request is slow": every
  concurrent request in that worker stops for the duration. FastAPI's docs warn about this
  indirectly, by telling you the opposite case is what `def` is for.
- **`def` handlers exceeding 40** — no impact on anything except those requests. It degrades; it
  does not break.

So writing `def` everywhere gives you a hard 40-request ceiling with no error, and writing `async
def` everywhere gives you one slow `requests` call taking down the worker. Neither shows up in an
error-rate dashboard, because neither is an error.

## Do

- Use blocking I/O in a `def` handler, offloaded to the threadpool:
  ```python
  import httpx

  # Correct — one thread, capped at 40 per event loop
  @app.get("/user/{uid}")
  def get_user(uid: int):
      return httpx.get(f"https://upstream/users/{uid}").json()
  ```
- Use an async client in an `async def` handler, so no threadpool token is consumed at all:
  ```python
  # Correct — nothing to bound, because the loop is never blocked
  @app.get("/user/{uid}")
  async def get_user(uid: int, client: httpx.AsyncClient):
      return (await client.get(f"https://upstream/users/{uid}")).json()
  ```
- If you must raise the ceiling, raise it deliberately and size the connection pool with it. N
  threadpool tokens means up to N concurrent database connections; if the pool is smaller, the
  handler blocks *in the thread*, which is strictly worse than blocking in the queue:
  ```python
  # Correct — an explicit capacity decision, at startup, with the pool sized to match
  import anyio.to_thread

  @app.on_event("startup")
  async def size_threadpool():
      anyio.to_thread.current_default_thread_limiter().total_tokens = 100
  ```
- Keep the threadpool off the hot path instead, when the work is genuinely async-capable. That is
  the better answer whenever it is available, and it is why the docs' advice is directionally right
  even though it reads as a performance note.

## Don't

- Reach for `async def` on reflex because the framework is async, then call blocking code inside
  it. That is worse than either consistent choice.
- Install a request rate limiter expecting it to solve this. `fastapi-limiter` and friends bound
  *inbound request rate*, which is a different axis — and a rejected request can still hold a slot
  briefly, so it can make the threadpool ceiling worse rather than better.
- Assume `uvicorn --workers 4` raises the ceiling to 160 in any meaningful sense. The limits are
  independent per worker; a p99 that is saturated is saturated in one of them.
- Count only handlers when sizing. Sync dependencies consume tokens too, so tokens per in-flight
  request is handlers plus sync dependencies on the path.
- Treat a linearly-climbing p99 as evidence of a slow query. A queueing threadpool and a slow query
  produce the same curve; only the token count distinguishes them.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| p99 climbs under load, no errors logged | Sync handlers queued on the 40-token limiter | Make handlers async, or raise the limiter and the pool |
| One endpoint is slow and every endpoint is slow | Blocking call inside `async def` stopped the loop | Use an async client, or move it to a `def` handler |
| Latency degrades on one worker only | The limiter is a `RunVar`, per event loop | Size for the worst worker, not the average |
| Threadpool waits on a DB pool wait | More tokens than DB connections | Size `pool_size` >= token count, or lower the tokens |
| Rate limiting made latency worse | A rejected request still held a slot | Rate limit upstream of the app, or fix the token count |
| Correct on one uvicorn worker, wrong on another | Independent limits, uneven saturation | Raise the limiter or remove sync work from the path |

## Verifying

```bash
# Path operations and dependencies that consume threadpool tokens
grep -rn "^\s*def \|^def " --include=*.py . | grep -v "async def\|_test\|conftest"

# Async handlers containing calls that are almost certainly blocking
grep -rn -A15 "^\s*async def " --include=*.py . | grep -n "requests\.\|time.sleep\|\.read()\|open("

# An explicit limiter override, and the DB pool it has to agree with
grep -rn "total_tokens\|current_default_thread_limiter\|pool_size\|max_overflow" --include=*.py .
```

The first command over-reports badly — every `def` in the project, including ones no route reaches.
Narrow it to the router modules before reading. The third is the sizing check: a raised token count
with a pool smaller than it is the failure that looks like a slow database. No grep can tell you
which `def` handlers are actually reachable from a route; that is the router file, read.