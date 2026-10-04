---
title: "check_same_thread Is CPython's Default, and g Is Per App Context, Not Per Request"
rule_id: "RULE-FLASK-007"
category: "concurrency"
scope: "backend"
applies_to: "Any Flask app using sqlite3 directly; any teardown or g usage; any ThreadPoolExecutor or background thread inside a request; any manual app.app_context() block"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/python/cpython/main/Doc/library/sqlite3.rst,https://raw.githubusercontent.com/pallets/flask/main/docs/patterns/sqlite3.rst,https://raw.githubusercontent.com/pallets/flask/main/src/flask/ctx.py"
---

# check_same_thread Is CPython's Default, and g Is Per App Context, Not Per Request

"Database state is wrong" in a Flask app is three separate questions with three different owners, and
they get conflated because they all present as the same symptom. Which connection is Flask's
question. Whose thread is CPython's. Whose scope is SQLAlchemy's. `g` is Flask's, and it is per
*application context* — which is not the same thing as per request.

## Why

The thread error people attribute to Flask is CPython's, and its default is on:

> :param bool check_same_thread: If ``True`` (default), :exc:`ProgrammingError` will be raised if
> the database connection is used by a thread other than the one that created it. If ``False``, the
> connection may be accessed in multiple threads; write operations may need to be serialized by the
> user to avoid data corruption.
> ([CPython `sqlite3`](https://raw.githubusercontent.com/python/cpython/main/Doc/library/sqlite3.rst))

Flask's own `sqlite3.rst` contains no occurrence of `thread`, `unusable`, or `check_same_thread`.
The rule is real — Flask's example calls `sqlite3.connect()` without the argument and so inherits
the default — but the mechanism belongs to the stdlib, and knowing that tells you where to look.

Connection lifetime is Flask's, and it is neither pooling nor global:

> The connection is created the first time it's accessed, reused on subsequent access, until it is
> closed when the request context ends.
> ([Flask sqlite3 pattern](https://raw.githubusercontent.com/pallets/flask/main/docs/patterns/sqlite3.rst))

And `g` is the app-context namespace, which is the fourth owner and the one that produces the
genuinely confusing symptom:

> A plain object. Used as a namespace for storing data during an application context.
> ([Flask `ctx.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/ctx.py))

During a request the two scopes coincide, which is why "per request" is usually harmless shorthand.
It stops being harmless in a manual `with app.app_context():` block — a CLI command, a warm-up job, a
background thread — where `g` persists for the whole context and that context can be much longer than
any request. A cached user on `g` there is correct; the same cache in a module global is a cross-user
leak. And a background thread that does *not* push a context sees no `g` at all.

### Telling the three apart

| Symptom | Owner | Fix |
|---|---|---|
| `ProgrammingError` naming `check_same_thread` | CPython | Pass `False` and serialise, or don't hop threads |
| State from a previous user on a fresh request | Flask (`g` misuse) | Move to a per-context store |
| A session outliving the request | SQLAlchemy (`scopefunc`) | Let Flask-SQLAlchemy set the scope |

## Do

- Keep the connection on `g` and let it be created on first use, which is what Flask's pattern does:
  ```python
  def get_db():
      if "db" not in g:
          g.db = sqlite3.connect(DATABASE)      # check_same_thread defaults to True
      return g.db
  ```
- If the request genuinely hops threads, opt out explicitly and serialise the writes yourself:
  ```python
  def get_db():
      if "db" not in g:
          # writes "may need to be serialized by the user to avoid data corruption"
          g.db = sqlite3.connect(DATABASE, check_same_thread=False)
      return g.db
  ```
- Better, do not hold a connection across the thread hop at all. Each task opens its own, which is
  both correct and the reason an ORM exists:
  ```python
  @app.post("/orders")
  def create_order():
      payload = request.get_json()
      with ThreadPoolExecutor() as pool:
          results = list(pool.map(process_one, payload["items"]))
      return {"processed": len(results)}
  ```
- Scope state to the context that owns it, and let a manual context be the boundary:
  ```python
  @app.cli.command("warm-cache")
  def warm_cache():
      with app.app_context():          # g is alive for exactly this block
          cache.set("warm", compute())
  ```
- Use SQLAlchemy 2.0 + Flask-SQLAlchemy and two of the three questions stop mattering: the pool means
  connections are not held across a request, and Flask-SQLAlchemy sets `scopefunc` to the app context
  itself. The session is still removed at teardown, so `RULE-FLASK-006` still applies to it.
- Use a `ContextVar` for request-scoped state you hold yourself, since it propagates into `asyncio`
  tasks the way a thread-local does not — see `shared/python/sync-in-async-boundaries.md`.

## Don't

- Attribute `check_same_thread` to Flask. It is CPython's default, and Flask inherits it by calling
  `sqlite3.connect()` without the argument; the Flask docs never mention it.
- Assume WSGI's one-request-per-thread means the check never fires. It fires the first time someone
  adds a thread pool for CPU work — the standard next optimisation, which is why the optimisation
  introduces the bug rather than exposing it.
- Read `check_same_thread=False` as a fix. It removes the exception, not the hazard; CPython's own
  wording is that writes may corrupt data without serialisation.
- Store per-user or per-request state in a module global. Under threading one context closes
  another's resource, and across contexts the values are simply wrong.
- Treat Flask's sqlite3 pattern as a production configuration. It is a documentation example; its
  teardown note is the part to copy.
- Assume `g` is per request inside a background thread. It is per app context — a thread with no
  context raises, a thread with a context shares it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ProgrammingError` mentioning `check_same_thread` | Connection used from a second thread | `False` + serialise, or a connection per task |
| Data corruption after `check_same_thread=False` | Concurrent writes, unsynchronised | Serialise writes or use a real database |
| Previous user's data on a new request | State in a module global | Store on `g` or in a `ContextVar` |
| `RuntimeError: Working outside of application context` | Background thread without a context | Push `app.app_context()` |
| Stale `g` visible for the whole command | Manual context, `g` alive throughout | Bound the context with `with` |
| Session still present after teardown | `scopefunc` not scoped to the app context | Use Flask-SQLAlchemy, or set `scopefunc` |

## Verifying

```bash
# Direct sqlite use, where the CPython default applies
grep -rn "sqlite3.connect(" --include=*.py .

# Thread hops inside a request, where that default raises
grep -rn "ThreadPoolExecutor\|threading\.\|run_in_executor\|concurrent.futures" --include=*.py .

# State held somewhere other than g
grep -rn "^_db\|^db = \|^[a-z_]*_session *=\|global " --include=*.py .

# Manual contexts, where g outlives the request
grep -rn "app_context()\|test_request_context" --include=*.py .

# Session scope, the SQLAlchemy half
grep -rn "scopefunc\|scoped_session\|Flask-SQLAlchemy\|flask_sqlalchemy" --include=*.py .
```

The first and second commands are the pair: a `sqlite3.connect` default plus a thread hop in the same
request is the `ProgrammingError`, and neither command alone finds it. The third and fourth are the
`g`-scope audit. Nothing here can tell you which context a given request ran in — that is what the
traceback of a `RuntimeError` names.