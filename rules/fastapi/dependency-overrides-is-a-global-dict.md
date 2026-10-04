---
title: "app.dependency_overrides Is a Global Dict; an Override That Is Not Reset Persists"
rule_id: "RULE-FASTAPI-005"
category: "correctness"
scope: "backend"
applies_to: "Any test suite using app.dependency_overrides; any yield dependency overridden with a plain function; any override set outside test code"
last_updated: "2026-10-04"
source: "https://fastapi.tiangolo.com/advanced/testing-dependencies/"
---

# app.dependency_overrides Is a Global Dict; an Override That Is Not Reset Persists

The dependency override mechanism is process-global mutable state on the application object. It is
consulted on every request that depends on the key, and it has no scoping to a test, a fixture, or a
request.

## Why

The whole mechanism, in the docs' words:

> For these cases, your **FastAPI** application has an attribute `app.dependency_overrides`, it is a
> simple `dict`.
> ([FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/))

"Simple `dict`" is doing more work than it appears to. It is process-global mutable state, and the
docs state the reset explicitly:

> Then you can reset your overrides (remove them) by setting `app.dependency_overrides` to be an
> empty `dict`:
> ([FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/))

```Python
app.dependency_overrides = {}
```
([FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/))

Assigning a new dict rather than calling `.clear()`. Both work in practice — nothing holds a
long-lived reference to the old dict — but the documented form is assignment, so that is the form
worth grepping for.

### The fixture that leaks

```python
@pytest.fixture
def as_admin():
    app.dependency_overrides[require_admin] = lambda: User(id=1, is_staff=True)
    yield
    app.dependency_overrides = {}       # the documented reset
```
([FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/))

That is correct. The variants that are not:

- A fixture that sets the override with **no teardown**. One renamed test later it survives into
  every subsequent test in the session, including tests that never used the fixture. Because the
  override is keyed on the dependency *function*, and most auth overrides are `is_staff=True` or a
  stub id, the survivors fail in ways that look like application bugs.
- An override in `conftest.py` with no teardown — the same leak with a wider blast radius, because
  it applies to every test in the directory.
- A module-level override set at import time "for convenience". It applies in production too, since
  it is the same `app` object.

### The failure is loud in tests and silent in production

In tests, the next test fails and someone investigates — which is why this looks rare. It appears
instead as "the suite is flaky in full-suite runs but passes in isolation": full-suite runs are
exactly where a leaked override shows up, and running one file alone hides it completely.

The dangerous direction is the reverse — an override that reaches production. That requires writing
to `app.dependency_overrides` outside test code, which is unusual, and the reason the grep below is
one line: the mechanism has no scoping that would catch the mistake.

### Overriding a yield dependency silently removes its cleanup

FastAPI supports dependencies that clean up after the response. If the override replaces a `yield`
dependency with a plain function, the cleanup in the *original* never runs — a leaked connection, an
unclosed session, a transaction never rolled back. It surfaces as a warning or as a later test's
failure, so it is easy to attribute to something else.

## Do

- Always restore, using the documented form, and write the test that proves it:
  ```python
  import pytest
  from fastapi.testclient import TestClient

  @pytest.fixture
  def as_admin():
      app.dependency_overrides[require_admin] = lambda: User(id=1, is_staff=True)
      yield
      app.dependency_overrides = {}

  def test_admin_endpoint(as_admin):
      assert TestClient(app).get("/admin").status_code == 200

  # Correct — this test is the leak detector. Without it, a missing teardown is invisible
  # until someone runs the suite in a different order.
  def test_non_admin_endpoint():
      assert TestClient(app).get("/admin").status_code == 403
  ```
- Autouse a reset fixture so no individual fixture has to remember it:
  ```python
  @pytest.fixture(autouse=True)
  def reset_dependency_overrides():
      yield
      app.dependency_overrides = {}
  ```
- Override with a `yield` function when the original is a `yield` dependency, so the cleanup shape is
  preserved:
  ```python
  # Correct — the override has the same lifecycle as what it replaces
  def override_db():
      db.session = TestSession()
      yield
      db.session.remove()
  ```
- Assert on the cleanup where the original owned it. Make the test that depends on the cleanup the
  one that would notice, rather than assuming the fixture ran.

## Don't

- Set an override at module level. It applies in production, because it is the same `app` object.
- Rely on pytest to save you. Teardown runs for ordinary exceptions, which is exactly why this
  looks rare — it is the hard-exit paths and the missing-yield fixtures that leak.
- Override an HTTP dependency to fake its response. Overriding replaces the dependency's *logic* as
  well as its network call, so a bug in that logic is invisible to the test. Mock the transport
  instead (`httpx.MockTransport` or `respx`) so the real code path runs.
- Treat the dict as scoped to a test. There is no per-test or per-request form; the only scope is
  the reset.
- Assume a library's auth dependency is safe to override. `fastapi-users` and `fastapi-jwt-auth`
  internals become keys in this dict, and neither library knows an override of it exists.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A test fails only in a full-suite run | An override leaked from an earlier test | Autouse a reset fixture |
| A test gets `200` where it expects `403` | A surviving `is_staff=True` override | Reset after every test, and add a non-privileged test that would notice |
| A connection or session leaks across tests | A `yield` dependency overridden with a plain function | Override with a `yield` function |
| Production authenticates as a fake user | An override set at module or import scope | Move it into a fixture; grep for writes outside tests |
| A bug in an HTTP dependency is invisible to tests | The dependency itself was overridden | Mock the transport, not the dependency |
| `conftest.py` overrides leak into unrelated directories | No teardown in the conftest fixture | Autouse a reset at the session root |

## Verifying

```bash
# Every override, and where it is set — the ones outside a fixture are the finding
grep -rn "dependency_overrides" --include=*.py .

# Writes that are not a reset (the reset is an assignment of an empty dict)
grep -rn "dependency_overrides\[" --include=*.py .

# Fixtures that set an override — check each one has a teardown
grep -rn -A6 "@pytest.fixture" --include=conftest.py --include=test_*.py . | grep -B2 -A4 "dependency_overrides"

# Yield dependencies, which are the ones whose cleanup an override can remove
grep -rn -B2 "^yield$" --include=*.py .
```

The first two commands are the check: an override written outside a test module, or an index
assignment with no matching reset nearby, is the leak. The third is the manual read — pytest does
run teardown on ordinary failures, so the fixture to look at is the one without a `yield`. Nothing
here can tell you whether an override preserves the lifecycle of the dependency it replaces.