---
title: "get_json(silent=True) Collapses Two Different Failures Into None, and Still Raises 413"
rule_id: "RULE-FLASK-005"
category: "correctness"
scope: "backend"
applies_to: "Any handler calling request.get_json(silent=True); any MAX_CONTENT_LENGTH setting; any code assuming silent means no exception is possible"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/werkzeug/main/src/werkzeug/wrappers/request.py,https://raw.githubusercontent.com/pallets/flask/main/src/flask/wrappers.py,https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py"
---

# get_json(silent=True) Collapses Two Different Failures Into None, and Still Raises 413

`silent=True` returns `None` for two failures that need different responses, plus a third case that
is not a failure at all. And it does not mean "never raises": the body is read outside the guarded
block, so a size limit produces a `413` on a code path written specifically so it would not raise.

## Why

The contract, from Werkzeug — `get_json` no longer lives in Flask, so this is the authoritative text:

> Parse :attr:`data` as JSON. If the mimetype does not indicate JSON (:mimetype:`application/json`,
> see :attr:`is_json`), or parsing fails, :meth:`on_json_loading_failed` is called and its return value
> is used as the return value. By default this raises a 415 Unsupported Media Type resp.
> ([Werkzeug `request.py`](https://raw.githubusercontent.com/pallets/werkzeug/main/src/werkzeug/wrappers/request.py))

> :param silent: Silence mimetype and parsing errors, and return ``None`` instead.
> ([Werkzeug `request.py`](https://raw.githubusercontent.com/pallets/werkzeug/main/src/werkzeug/wrappers/request.py))

So `None` means one of three things, and they are not interchangeable:

1. **Not a JSON request** — wrong `Content-Type`. The correct response is `415`, or a documented
   fallback if forms are genuinely accepted.
2. **JSON that did not parse** — malformed body. The correct response is `400`.
3. **A body that is literally `null`** — a valid JSON document. No error occurred, and the handler
   proceeds with `None`, which is exactly the same value as cases 1 and 2.

The body shows why `silent` is not "never raises":

```python
        data = self.get_data(cache=cache)

        try:
            rv = self.json_module.loads(data)
        except ValueError as e:
            if silent:
                rv = None
```
([Werkzeug `request.py`](https://raw.githubusercontent.com/pallets/werkzeug/main/src/werkzeug/wrappers/request.py))

`get_data()` is outside the `try`, and it is what enforces `MAX_CONTENT_LENGTH`, raising
`werkzeug.exceptions.RequestEntityTooLarge` — a `413`, and not a `ValueError`. The flag guards
parsing and mimetype only. Note the shipped default:

```python
        "MAX_CONTENT_LENGTH": None,
```
([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

so this is a project that has set the limit — at which point the silent path has an exit nobody
wrote.

### The failure that is loud in the wrong place

The shape that works:

```python
data = request.get_json(silent=True)
if data is None:
    return jsonify({"error": "bad request"}), 400
```

and the shape that does not:

```python
payload = request.get_json(silent=True)
return process(payload["id"])     # TypeError, forty lines away, body nowhere in the traceback
```

The second is not quieter — it is louder, in a helper that has no idea a request is involved. The
diagnostic cost is the whole problem: the exception names `process`, not `get_json`, and nothing
points at the request that caused it.

## Do

- Drop `silent` unless the client is genuinely mixed. The framework then distinguishes `415` from
  `400`, and the traceback is local:
  ```python
  @app.post("/orders")
  def create_order():
      payload = request.get_json()     # 415 for wrong content type, 400 for malformed
      return OrderService.create(payload["id"])
  ```
- When `silent` is genuinely wanted — a form-or-JSON endpoint — branch on the check `get_json` itself
  makes, so `None` cannot arrive by accident:
  ```python
  @app.post("/orders")
  def create_order():
      if not request.is_json:
          return create_order_from_form()
      payload = request.get_json()       # malformed JSON is a 400, not a None
      return OrderService.create(payload["id"])
  ```
- Handle all three `None` cases and the `413` explicitly if you do keep `silent`:
  ```python
  from werkzeug.exceptions import RequestEntityTooLarge
  from flask import abort

  @app.post("/orders")
  def create_order():
      try:
          payload = request.get_json(silent=True)
      except RequestEntityTooLarge:
          abort(413)

      if payload is None:
          abort(400, description="expected a JSON object")
      if not isinstance(payload, dict) or "id" not in payload:
          abort(422, description="expected {'id': ...}")
      return OrderService.create(payload["id"])
  ```
- Validate at the boundary with a model, so the handler receives a typed object and the `None` has
  nowhere to travel. `flask-smorest` removes the manual `get_json` call entirely by generating the
  schemas; `flask-pydantic` covers arguments and forms, and its JSON body path still goes through
  `get_json`, so it does not solve this one on its own.
- Set `MAX_CONTENT_LENGTH` deliberately, since the shipped value is `None`:
  ```python
  app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024
  ```

## Don't

- Treat `silent=True` as "cannot raise". The `413` comes from `get_data()`, before the guarded
  `loads`.
- Assume one `None` check covers the cases. Wrong content type and malformed JSON need different
  status codes, and a literal `null` body needs neither — it is valid input that happens to be
  `None`.
- Index into the result without an `isinstance` check. A JSON body can be a list, a string, or a
  number, and `payload["id"]` on any of them raises far from the boundary.
- Use `silent=True` because clients are "well-behaved". The `413` has nothing to do with client
  behaviour — it is your own limit or your proxy's.
- Attribute `get_json`'s defaults to Flask. `Flask.Request` overrides only
  `on_json_loading_failed` and `max_cookie_size`; the method and its `silent` default are
  Werkzeug's, which matters when reading version-dependent behaviour.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: 'NoneType' is not subscriptable` in a helper | `None` from `get_json` travelled | Validate at the boundary; check `isinstance` |
| `400` where the client sent the wrong `Content-Type` | `415` and `400` collapsed into one | Drop `silent`, or branch on `request.is_json` |
| `413` from a handler written never to raise | `MAX_CONTENT_LENGTH` enforced outside the guarded block | Catch `RequestEntityTooLarge`, or drop `silent` |
| Handler treats a literal `null` body as bad input | `None` is also valid JSON | Distinguish by checking `request.is_json` first |
| `TypeError: list indices must be integers` | Body was a JSON array, not an object | `isinstance(payload, dict)` before subscripting |
| `get_json` docs do not match the code | Method is Werkzeug's, not Flask's | Cite Werkzeug for version-sensitive behaviour |

## Verifying

```bash
# Every silent call site — the audit
grep -rn "get_json(" --include=*.py .

# Calls that subscribe to the None without checking what produced it
grep -rn -A3 "get_json(silent=True)" --include=*.py .

# Subscripts on a parsed body, with no isinstance guard in view
grep -rn -A3 "get_json" --include=*.py . | grep -E "\[[\"'][a-zA-Z_]+[\"']\]"

# The size limit, which is what produces the uncaught 413
grep -rn "MAX_CONTENT_LENGTH" --include=*.py --include=*.cfg --include=*.toml --include=*.env* .
```

The first command is the audit and the rest are its consequences: every `silent=True` hit is a
boundary where three outcomes collapsed into one value, and the fourth command tells you whether
there is a `413` path nobody handled. Nothing here can tell you what a request actually sent —
`request.is_json` and the body length are the runtime facts, and only a boundary test asserts them.