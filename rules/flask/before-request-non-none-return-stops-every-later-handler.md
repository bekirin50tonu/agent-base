---
title: "A before_request Returning Anything Non-None Stops Every Handler After It, Including the View"
rule_id: "RULE-FLASK-004"
category: "correctness"
scope: "backend"
applies_to: "Any @app.before_request or @blueprint.before_request handler; any handler returning a boolean or a falsy value to signal rejection; any app relying on registration order for auth or validation"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py"
---

# A before_request Returning Anything Non-None Stops Every Handler After It, Including the View

`before_request` is not a hook, it is a chained middleware with an early return. The chain order is
fixed by the framework rather than by where you registered, and the first handler to return
anything that is not `None` becomes the response — which includes `False`, `""`, and `0`.

## Why

The contract is documented in the source docstring, and `docs/blueprints.rst` on `main` does not
mention `before_request` at all, so this is the only place it is written down:

> If any :meth:`before_request` handler returns a non-None value, the value is handled as if it was
> the return value from the view, and further request handling is stopped.
> ([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

The body shows the chain, and the order is the part that is not guessable:

```python
        names = (None, *reversed(req.blueprints))

        for name in names:
            if name in self.url_value_preprocessors:
                for url_func in self.url_value_preprocessors[name]:
                    url_func(req.endpoint, req.view_args)

        for name in names:
            if name in self.before_request_funcs:
                for before_func in self.before_request_funcs[name]:
                    rv = self.ensure_sync(before_func)()

                    if rv is not None:
                        return rv  # type: ignore[no-any-return]

        return None
```
([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

Two facts come out of it:

1. **App-level handlers run first**, then blueprints **outermost to innermost** — that is what
   `(None, *reversed(req.blueprints))` encodes.
2. **Within one level, execution follows registration order**, and the first non-`None` return ends
   everything, including the view.

So a `before_request` handler has exactly one legal value to return, and it is nothing.

### The failure that reads as a bug in the wrong file

The realistic mistake is `return False` to mean "reject this request". `False` is not `None`, so
Flask treats it as a response value and the request becomes a `500` — or an empty `200`, depending
on what the WSGI layer does with a non-response. The handler looks correct; the traceback names the
view, which never ran.

The same shape appears without any return statement at all: a handler whose last line is an
expression, or an assignment whose value is falsy-but-not-`None`. `before_request_funcs` stores the
function, not its result, so an accidental trailing expression in one handler silently becomes the
response for **every route that handler's blueprint serves** — and the response differs per route
depending on what that expression evaluated to.

A third variant is the one that survives review because the return is legitimate: an auth handler
that returns `redirect(url_for("login"))` short-circuits every later handler, so any validation or
rate-limit registered after it does not run for unauthenticated requests. That is sometimes the
intent and frequently is not.

## Do

- Reject by raising. `abort` raises, so no later handler runs and no `after_request` handler sees a
  normal return path:
  ```python
  from flask import abort

  @app.before_request
  def require_admin():
      if not current_user.is_admin:
          abort(403)          # not False — abort raises, Flask never builds a response
  ```
- When a return *is* the intent, make it unconditional and obvious, and put it first:
  ```python
  @app.before_request
  def require_terms_accepted():
      if current_user.is_authenticated and not current_user.terms_accepted_at:
          return redirect(url_for("terms.accept"))
      return None             # explicit, so the reader is not left inferring it
  ```
- Test the chain, not the handler in isolation. One test per level of the chain, asserting the status
  and that the view did not run:
  ```python
  def test_unauthenticated_is_rejected(client):
      resp = client.get("/admin/users")
      assert resp.status_code == 403
      assert resp.location is None        # not a redirect, not a 500
  ```
- Prefer a decorator to a global `before_request` once a check belongs to specific routes. `Flask-
  HTTPAuth` and `Flask-Login`'s `login_required` put the check on the view, where the ordering
  question cannot arise. Note `Flask-Login`'s own default: `unauthorized_handler` redirects to
  `login_view` rather than returning `401`, which is right for a browser app and wrong for an API.
- Keep at most one app-level `before_request`, and make it something that never returns.

## Don't

- Return `False`, `""`, or `0` to reject. Every one of them is a response. `abort(403)` is the
  rejection mechanism.
- Write a handler whose last statement is an expression. It becomes the response for every route in
  scope, varying by route, with no error anywhere.
- Assume registration order is visible from the source files. It is fixed at the app level (`None`
  first) but blueprint order is `reversed(req.blueprints)` — outer-to-inner — and which blueprint is
  "outer" depends on registration order across modules.
- Register a second global `before_request` to fix a first one that returns a value. The new handler
  never runs for the requests the first one short-circuits, so the fix appears not to work and the
  real cause stays invisible.
- Count on a `before_request` guard running after an auth guard registered at a different level.
  The level decides, and the level is not the registration line you are looking at.
- Use `return redirect(...)` in a validation handler. It is a legal response and it disables every
  later check for exactly the requests most likely to need them.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `500` on a route whose `before_request` looks right | Handler returned `False`/`""`/`0` | `abort(...)` |
| Empty or unexpected `200` on some routes only | Trailing expression in a handler, evaluated per route | Explicit `return None` |
| Auth `redirect` served where a `401` was expected | `Flask-Login`'s `unauthorized_handler` default | Set it for API-shaped apps |
| A later `before_request` never runs | An earlier one returned non-`None` | Find the short-circuit, not the missing handler |
| Rate limit or CORS handler not applied | Registered after one that returns a value | Move it earlier; prefer a decorator |
| Blueprint ordering changes when files move | `reversed(req.blueprints)` at request time | Order-independent: use per-view decorators |

## Verifying

```bash
# Every before_request handler, with its body
grep -rn -A8 "before_request" --include=*.py .

# Handlers returning something other than None or a redirect/abort
grep -rn -A8 "before_request" --include=*.py . | grep -E "return (False|True|0|\"|')"

# Trailing expressions — the invisible variant, a return that is not a return statement
grep -rn -A8 "before_request" --include=*.py . | grep -vE "return|def |^\S+[-:]\s*$"

# Registration order, which fixes the chain within a level
grep -rn "\.register_blueprint\|before_request_funcs" --include=*.py .
```

The first command is the manual read, and it is short enough to do by hand — every handler is a few
lines and the question is always "can this return something". The second is the mechanical version
of the same question. The fourth tells you which order the chain will actually run in, since that
is what makes a missing handler puzzling. Nothing here can tell you which handler returned a value
on a particular request; that needs a log line or the status assertion in a chain test.