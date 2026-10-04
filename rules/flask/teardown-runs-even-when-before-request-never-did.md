---
title: "Teardown Always Runs, Including Where the Handler That Acquired the Resource Never Did"
rule_id: "RULE-FLASK-006"
category: "correctness"
scope: "backend"
applies_to: "Any teardown_appcontext or teardown_request function; any resource stored on g; any code holding per-context state in a module global"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/flask/main/docs/patterns/sqlite3.rst,https://raw.githubusercontent.com/pallets/flask/main/src/flask/sansio/app.py,https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py"
---

# Teardown Always Runs, Including Where the Handler That Acquired the Resource Never Did

Teardown is unconditional; acquisition is conditional. That asymmetry is the whole rule. A
`teardown_request` runs on every context teardown of the app — including requests rejected before
your handler, a 404, a CLI command, a `with app.app_context():` block — so teardown code has to
tolerate the resource not existing.

## Why

Flask's own SQLite pattern states it as a note, and the pattern that follows is defensive for a
documented reason rather than out of habit:

> Please keep in mind that the teardown request and appcontext functions are always executed, even if
> a before-request handler failed or was never executed. Because of this we have to make sure here
> that the database is there before we close it.
> ([Flask sqlite3 pattern](https://raw.githubusercontent.com/pallets/flask/main/docs/patterns/sqlite3.rst))

```python
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db
```
([Flask sqlite3 pattern](https://raw.githubusercontent.com/pallets/flask/main/docs/patterns/sqlite3.rst))

Two `getattr(..., None)` in one small function is the tell. The acquire is guarded; the matching
teardown in the same file is guarded the same way, and that symmetry is the requirement.

The contract on what teardown code may do is stated in the source:

> Teardown functions must avoid raising exceptions. If they execute code that might fail they must
> surround that code with a ``try``/``except`` block and log any errors.
> ([Flask `sansio/app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/sansio/app.py))

> The return values of teardown functions are ignored.
> ([Flask `sansio/app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/sansio/app.py))

So three things are true at once: teardown may run where the resource was never acquired, teardown
must not raise, and what it returns is discarded — a teardown cannot clean up by returning anything.

### Why this is intermittent rather than broken

A teardown written as `g._database.close()` works on every request that reached the handler that
opened the connection, which under normal traffic is every request. It fails on exactly the requests
worth seeing: a request rejected at the first `before_request`, a URL that matched nothing, a CLI
command, and — for `teardown_request` specifically — any 500 raised earlier in the chain. So the
symptom is an `AttributeError` in teardown on the requests that were already broken, which reads as
"the app is fine except sometimes", and the traceback points at the teardown rather than at the
request that never acquired anything.

### Two related shapes

**Module-level state instead of `g`.** A resource held in a module global works until two contexts
share it — under threading, one teardown closes another's connection. `g` is per *application
context*, which is the scope that matches the teardown's own lifetime.

**`g` is per app context, not per request.** During a request the two coincide, which is why the
distinction normally does not matter. It matters in a manual `with app.app_context():` block, where
the context outlives any request and `g` is still populated. If teardown code assumes "the request is
over", that is the assumption to check.

## Do

- Make teardown tolerate absence, swallow nothing silently, and log the exception argument — it is
  often the only record of the failure that caused the teardown to run:
  ```python
  import logging

  @app.teardown_appcontext
  def close_db(exception):
      db = g.pop("_database", None)          # pop, not getattr: absence is the normal case
      if db is None:
          return
      try:
          db.close()
      except Exception:
          app.logger.exception("failed to close the database connection")
      finally:
          if exception is not None:
              app.logger.info("teardown after error: %r", exception)
  ```
- Keep the acquire and the teardown in the same file, so the guarded access is visible next to the
  code that justifies it. That is what Flask's own pattern does and it is why it reads defensively.
- Use `Flask-SQLAlchemy` for database sessions. It registers its own teardown, and knowing two of its
  defaults saves a debugging session: `SQLALCHEMY_TRACK_MODIFICATIONS` was removed in 3.0 and
  setting it now raises, and the session is scoped to the **app context**, not the request — so
  pushing a manual app context gets a session that belongs to no request.
- Use a `ContextVar` for request-scoped state you hold yourself. It propagates into `asyncio` tasks
  the way a thread-local does not, which matters once anything in the stack is async — see
  `shared/python/sync-in-async-boundaries.md`.
- Test the path where the handler never ran. One unauthenticated or 404 request through the whole
  stack is the cheapest teardown test there is.

## Don't

- Write teardown as `g._database.close()`. The request that was rejected at the first
  `before_request` is the case that never acquired it, and it is the case you most want to see behave
  correctly.
- Assume an app-registered teardown only runs for that app's requests. It runs for every context
  teardown of the app, including CLI commands and manual `app_context()` blocks.
- Let a teardown raise, on the grounds that Flask 3.2 calls all of them anyway. That change means a
  failing teardown no longer *cascades*; the first one still fails, on the request where the resource
  was never acquired:
  > .. versionchanged:: 3.2
  >
  > All callbacks are called rather than stopping on the first error.
  > ([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))
- Store a connection, session, or file handle in a module global. It is shared across contexts and
  teardown will close whichever one it finds.
- Expect a teardown's return value to do anything. It is ignored.
- Use `teardown_request` where `teardown_appcontext` is meant, or assume the reverse. The app-context
  variant outlives the request; the request variant fires while the request object is still current.
  Choosing wrongly shows up as a resource that is closed while something still holds it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `AttributeError` in teardown, intermittently | Resource never acquired on that path | `g.pop(..., None)` and return |
| A CLI command or `app_context()` block crashes | Teardown assumes a request | Same |
| Connection closed by another request's teardown | Resource in a module global | Store on `g` |
| Teardown raises and hides the real error | No try/except around the cleanup | Log and continue |
| `SQLALCHEMY_TRACK_MODIFICATIONS` raises on set | Removed in Flask-SQLAlchemy 3.0 | Delete the setting |
| Session leaks out of a manual `app_context()` | Flask-SQLAlchemy scopes to the app context | Do not push contexts manually around session use |

## Verifying

```bash
# Every teardown, with its body
grep -rn -A8 "teardown_request\|teardown_appcontext" --include=*.py .

# Teardowns that index g rather than popping it — these raise when absent
grep -rn -A8 "teardown_request\|teardown_appcontext" --include=*.py . | grep -E "g\.[a-z_]+\."

# Resources held somewhere other than g
grep -rn "^_db\|^db = \|global \|^[a-z_]*_session *=" --include=*.py .

# Manual app contexts, where g outlives the request
grep -rn "app_context()\|test_request_context" --include=*.py .

# Flask-SQLAlchemy settings that were removed
grep -rn "TRACK_MODIFICATIONS" --include=*.py .
```

The first command is the audit, and the second is the mechanical version of the same question — a
teardown that reaches into `g` with an attribute access will raise on the paths where nothing was
acquired. The fourth finds the contexts where that assumption is already false. Nothing here can tell
you which requests actually reached the acquire; that is a per-route question, and the unauthenticated
request in a test is what answers it.