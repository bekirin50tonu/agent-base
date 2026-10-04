---
language: "Python"
tag: "python"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Python assets, including Django, FastAPI and Flask web frameworks."
---

# Documentation Hub: Python

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`pyproject.toml`,
> `requirements.txt`). Match the conditions below to determine which `rules`, `skills`,
> `agents`, or `shared` assets to inject.
>
> **Status**: rules and shared tooling are covered, plus the mypy/ruff adoption workflow for
> unannotated codebases and a Python helper agent. Web frameworks are covered as three rule sets
> (Django, FastAPI, Flask) and three decision matrices (sync/async boundaries, task queue
> selection, settings and secrets); each matrix names the recommended package for a problem class
> and the default that package ships with.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/python/pep695-native-generics.md`
  - **Why**: Python 3.12 moved generics into language syntax. The redundant
    `Generic`/`Protocol` base form fails at *runtime*, not at type-check time, so it slips
    past reviewers and CI that only runs a checker.
  - **When**: Target project sets `requires-python >= 3.12` or a `py312+` Ruff
    `target-version`, and the codebase declares generic classes or functions.
  - **Target Location**: `docs/rules/pep695-native-generics.md`

- **Path**: `rules/python/free-threading-detection.md`
  - **Why**: A free-threaded build can run *with the GIL back on* — via `PYTHON_GIL`, `-X
    gil`, or an unmarked C extension re-enabling it at import. Build metadata
    (`sys.version`, wheel tag) reports the distribution, not the running process, so the
    parallelism silently is not there.
  - **When**: Target project deploys on Python 3.13+ free-threaded builds (`python3.14t`),
    or pins `Py_GIL_DISABLED`, or has any C extension in its import graph.
  - **Target Location**: `docs/rules/free-threading-detection.md`

- **Path**: `rules/python/free-threading-overhead.md`
  - **Why**: Overhead is 1-8% single-threaded and platform-dependent, and immortalization
    removes deterministic deallocation — which breaks `weakref.finalize`-based cleanup.
    Adopting on the premise that "threads are fast now" is wrong on both counts.
  - **When**: Target project is evaluating or has adopted a free-threaded build for
    CPU-bound work, or uses `weakref.finalize` / finalizers to release external resources.
  - **Target Location**: `docs/rules/free-threading-overhead.md`

### Web frameworks — Django

- **Path**: `rules/django/transaction-on-commit-or-the-worker-reads-uncommitted-rows.md`
  - **Why**: The request transaction and the worker's read are two separate commits. Without
    `on_commit()` the worker runs while the row is still uncommitted, so the job sees a world state
    that no committed transaction ever contained — and raises `DoesNotExist` rather than waiting.
  - **When**: Target depends on `django>=3.2` and dispatches background work from inside a request,
    or sets `ATOMIC_REQUESTS`, or wraps the dispatch site in `atomic()`.
  - **Target Location**: `docs/rules/django/transaction-on-commit.md`

- **Path**: `rules/django/select-related-and-prefetch-related-do-different-jobs.md`
  - **Why**: `select_related()` on a nullable FK produces `None`, not an error, so a missing parent
    reads as "no parent". The two methods also differ on cache population, and `only()`/`defer()`
    turn a later field access into a query the reader cannot see.
  - **When**: Target depends on `django>=2.0` and uses a Django ORM model with any `ForeignKey`,
    `OneToOne`, or `ManyToMany`, or has `select_related`/`prefetch_related`/`only`/`defer` in it.
  - **Target Location**: `docs/rules/django/select-related-and-prefetch-related.md`

- **Path**: `rules/django/debug-false-with-empty-admins-drops-errors-on-the-floor.md`
  - **Why**: `DEBUG=False` with an empty `ADMINS` is a shipped default, not a setting someone chose.
    The 500 page is right, the log line is right, and no human is notified. `DEBUG=True` then
    additionally disables the `SECURE_*` protections and serves the settings traceback.
  - **When**: Target depends on `django>=3.0` and has `DEBUG` set from the environment, or configures
    logging without configuring `ADMINS`, or runs with `DEBUG` varying per environment.
  - **Target Location**: `docs/rules/django/debug-false-empty-admins.md`

- **Path**: `rules/django/get-or-create-is-not-an-atomic-upsert.md`
  - **Why**: `get_or_create()` is atomic only because of a database uniqueness constraint. Without
    one it returns the existing row silently, so two writers "succeed" into one record. The
    `IntegrityError` it raises otherwise is caught inside a transaction, and catching it leaves the
    transaction broken.
  - **When**: Target depends on `django>=3.0` and calls `get_or_create()` or `update_or_create()`, or
    has a model whose natural key lacks a `unique=True` constraint or `unique_together`.
  - **Target Location**: `docs/rules/django/get-or-create-not-an-atomic-upsert.md`

- **Path**: `rules/django/model-full-clean-is-not-called-by-save.md`
  - **Why**: `save()` persists without validating. `full_clean()` is a separate call that nobody
    makes on the write path, so an invalid row reaches the database and the request returns 200.
    Validators declared on a field are documentation until something invokes them.
  - **When**: Target depends on `django>=2.0` and declares `validators=`, `clean()`, or a
    `CheckConstraint` is absent, or accepts data from a client-facing endpoint.
  - **Target Location**: `docs/rules/django/model-full-clean-not-called-by-save.md`

- **Path**: `rules/django/settings-are-imported-module-constants.md`
  - **Why**: `settings.SECRET_KEY` is an attribute lookup on an imported module, so any module can
    read any setting and nothing enforces which ones a given component needs. The boundary is
    discipline, not a mechanism, and it is invisible at the import site.
  - **When**: Target depends on `django>=3.2`, has a `settings.py` split across `base`/`dev`/`prod`,
    or reads `settings.*` from a module outside the Django app that should own it.
  - **Target Location**: `docs/rules/django/settings-are-module-constants.md`

- **Path**: `rules/django/sync-orm-call-inside-async-view.md`
  - **Why**: A sync ORM call in an `async def` view raises `SynchronousOnlyOperation` — until
    `DJANGO_ALLOW_ASYNC_UNSAFE` is set, which converts a loud failure into a blocked event loop
    and a data race. The guard's existence is the documentation; its override is the bug.
  - **When**: Target depends on `django>=3.1`, declares `async def` views or an async
    `get_queryset`/`get`/`aget`, or sets `DJANGO_ALLOW_ASYNC_UNSAFE`.
  - **Target Location**: `docs/rules/django/sync-orm-call-inside-async-view.md`

### Web frameworks — FastAPI

- **Path**: `rules/fastapi/sync-def-runs-in-a-threadpool-with-a-capacity-limit.md`
  - **Why**: A `def` handler runs in a threadpool with a fixed capacity. When it fills, requests
    **queue** rather than fail, so the limit presents as latency and never as an error. Each sync
    dependency on a request consumes a separate slot.
  - **When**: Target depends on `fastapi` and has any handler or dependency declared with `def`
    rather than `async def`, or imports Starlette/AnyIO and configures a thread limiter.
  - **Target Location**: `docs/rules/fastapi/sync-def-threadpool-capacity-limit.md`

- **Path**: `rules/fastapi/response-model-is-the-output-allowlist.md`
  - **Why**: Without `response_model`, whatever the object carries is serialized. A column added to
    a model later appears in the API response with no change to the endpoint, and there is no test
    that fails when it does.
  - **When**: Target depends on `fastapi` and any route lacks a `response_model` or return
    annotation, or returns an ORM object, a SQLAlchemy row, or a `dict` built from a model.
  - **Target Location**: `docs/rules/fastapi/response-model-is-the-output-allowlist.md`

- **Path**: `rules/fastapi/pydantic-extra-ignore-is-the-write-allowlist.md`
  - **Why**: In Pydantic v2 `extra` defaults to `'ignore'`, so an unknown field in a request body
    is silently dropped and the write proceeds with less data than the client sent. `forbid` turns
    it into a 422 instead. This is the write-side twin of the `response_model` rule.
  - **When**: Target depends on `fastapi` or `pydantic>=2.0` and declares a request-body model
    without `model_config = ConfigDict(extra='forbid')`.
  - **Target Location**: `docs/rules/fastapi/pydantic-extra-ignore.md`

- **Path**: `rules/fastapi/body-as-dict-bypasses-pydantic-entirely.md`
  - **Why**: Annotating a body parameter as `dict` removes validation, the schema, and the
    allowlist in one move, and the OpenAPI output is left untyped. It reaches the handler through
    the same path a validated model would, so nothing downstream distinguishes the two.
  - **When**: Target depends on `fastapi` and any endpoint annotates a body as `dict`, `Any`,
    `list[dict]`, or `Mapping[str, Any]` rather than a Pydantic model.
  - **Target Location**: `docs/rules/fastapi/body-as-dict-bypasses-pydantic.md`

- **Path**: `rules/fastapi/dependency-overrides-is-a-global-dict.md`
  - **Why**: `app.dependency_overrides` is a module-level dict that nothing clears. An override set
    in one test persists into every later test in the process, and a `yield` dependency's teardown
    runs correctly only while the override is still installed.
  - **When**: Target depends on `fastapi` and uses `dependency_overrides` in tests, or overrides a
    dependency with a `yield` fixture without clearing it in teardown.
  - **Target Location**: `docs/rules/fastapi/dependency-overrides-is-a-global-dict.md`

- **Path**: `rules/fastapi/background-tasks-run-in-process-after-the-response.md`
  - **Why**: `BackgroundTasks` runs in the same process after the response, so a deploy kills every
    in-flight task and an exception there is not the client's error. It also has a size limit,
    which means passing a large object through it fails rather than queues.
  - **When**: Target depends on `fastapi` and uses `BackgroundTasks`, `background_tasks.add_task`,
    or a `BackgroundTasks` parameter on a handler.
  - **Target Location**: `docs/rules/fastapi/background-tasks-run-in-process.md`

- **Path**: `rules/fastapi/pydantic-aliases-break-the-orm-write.md`
  - **Why**: Pydantic v2 validation fills the **field name**, not the alias. `SomeORM(**model)` then
    raises `TypeError`, or — with `populate_by_name=False` — the field is left unset and the row is
    written with a default. A validated model does not imply a correctly mapped write.
  - **When**: Target depends on `fastapi` or `pydantic>=2.0` and uses `Field(alias=...)` on a model
    that is unpacked into an ORM constructor or `model_dump()`ed without `by_alias`.
  - **Target Location**: `docs/rules/fastapi/pydantic-aliases-break-the-orm-write.md`

### Web frameworks — Flask

- **Path**: `rules/flask/session-is-signed-not-encrypted-and-the-cookie-is-a-hard-4kb-budget.md`
  - **Why**: The session cookie is signed, not encrypted — the client can read every value in it.
    It is also a hard ~4 KB budget, so a large session is silently truncated, and rotating
    `SECRET_KEY` invalidates every session and signed cookie at once.
  - **When**: Target depends on `flask>=2.0` and uses `session`, `flask-session`, or stores anything
    non-trivial in the cookie, or rotates `SECRET_KEY`.
  - **Target Location**: `docs/rules/flask/session-signed-not-encrypted.md`

- **Path**: `rules/flask/from-object-reads-only-uppercase-attributes.md`
  - **Why**: Every Flask config loader — `from_object`, `from_envvar`, `from_pyfile` — keeps only
    UPPERCASE keys. A lowercase key is dropped, and a dropped key is indistinguishable from an
    unset one: the app runs with `DEBUG=False` while the file says `debug = True`.
  - **When**: Target depends on `flask>=2.0` and loads config via `from_object`, `from_envvar`,
    `from_prefixed_env`, or `from_pyfile`, especially from a `.env`-style module.
  - **Target Location**: `docs/rules/flask/config-loaders-keep-only-uppercase.md`

- **Path**: `rules/flask/app-run-debug-false-is-not-a-guarantee.md`
  - **Why**: `FLASK_ENV` was removed in 2.3, and `FLASK_DEBUG` plus a `.flaskenv` file can both
    enable the debugger regardless of what the call site passed. The Werkzeug debugger is remote
    code execution for anyone who can reach it.
  - **When**: Target depends on `flask>=2.0` and runs `flask run` or `app.run()` in an
    environment where `FLASK_DEBUG` or a committed `.flaskenv` can be set.
  - **Target Location**: `docs/rules/flask/app-run-debug-is-not-a-guarantee.md`

- **Path**: `rules/flask/before-request-non-none-return-stops-every-later-handler.md`
  - **Why**: `before_request` handlers run in **registration order**, and any non-`None` return
    value stops every later one and the view itself. Registering a blueprint after an
    authentication hook can disable that hook's own validation path with no error.
  - **When**: Target depends on `flask>=2.0` and registers more than one `before_request` handler,
    or registers blueprints whose order is not obvious from the file layout.
  - **Target Location**: `docs/rules/flask/before-request-order-is-the-short-circuit.md`

- **Path**: `rules/flask/get-json-silent-true-collapses-two-failures-into-none-and-still-raises-413.md`
  - **Why**: `get_json(silent=True)` returns `None` both for a malformed body and for a body that
    is not an object, so a validation error and a wrong content type look identical. It still
    raises 413 when the body exceeds `MAX_CONTENT_LENGTH`, which makes the failure mode a mix of
    `None` and an exception.
  - **When**: Target depends on `flask>=2.0` and calls `get_json(silent=True)` or `request.json`
    inside a handler that then indexes the result.
  - **Target Location**: `docs/rules/flask/get-json-silent-true-collapses-failures.md`

- **Path**: `rules/flask/teardown-runs-even-when-before-request-never-did.md`
  - **Why**: Teardown is unconditional; acquisition is conditional. A `teardown_request` runs on
    requests rejected before the handler, on 404s, and on CLI commands, so teardown code has to
    tolerate the resource not existing — and must not raise, because its return value is ignored.
  - **When**: Target depends on `flask>=2.0` and defines `teardown_request`, `teardown_appcontext`,
    or holds a resource on `g` that a handler is supposed to acquire first.
  - **Target Location**: `docs/rules/flask/teardown-always-runs.md`

- **Path**: `rules/flask/check-same-thread-is-cpythons-default-and-g-is-per-app-context.md`
  - **Why**: `check_same_thread` is CPython's default, not Flask's — Flask's docs never mention it.
    And `g` is per **app context**, not per request, which coincides only during a request and stops
    coinciding in a manual `with app.app_context():` block or a background thread.
  - **When**: Target depends on `flask>=2.0` and uses `sqlite3` directly, spawns a thread or
    `ThreadPoolExecutor` inside a request, or uses `g` outside a request cycle.
  - **Target Location**: `docs/rules/flask/check-same-thread-and-g-scope.md`

## 2. Skills (`skills/`)

- **Path**: `skills/python/adopt-mypy-on-a-legacy-codebase/SKILL.md`
  - **Why**: The documented order runs the checker *before* any annotation exists, and the
    config inverts to `ignore_errors = True` globally with `False` per finished module — so the
    config file is a work queue whose shrinking entry count is the progress metric. Starts from
    the fact that the typing spec names the gradual guarantee and then explicitly declines to
    enforce it, which is why every escape hatch (`ignore_errors`, `type: ignore`,
    `follow_imports`) is a place the guarantee silently stops holding. Includes the two-numbers
    rule — modules checked vs. modules reachable-but-unchecked — because an unfollowed import
    becomes `Any` silently and you get a green build checking less than its output implies.
    Carries its own limits: documented ordering, zero practitioner corroboration, and the
    `py.typed` remedy deliberately not written up.
  - **When**: Target project is Python with substantial code and little or no type annotation,
    and is adding mypy, adding a type gate to CI, or growing the checked-module set without a
    big-bang flip. Also when a type gate already exists and a green run is not evidence that
    the covered surface is what it appears to be.
  - **Target Location**: `docs/skills/python/adopt-mypy-on-a-legacy-codebase/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/python/agent.json`
  - **Why**: Helps with Python-related tasks, such as adopting mypy, ruff, and other Python best practices.
  - **When**: Target project is a Python project (has `pyproject.toml` or `requirements.txt`).
  - **Target Location**: `docs/agents/python/agent.json`

## 4. Shared Assets (`shared/`)
- **Path**: `shared/tooling/uv-toolchain.md`
  - **Why**: Replaces the pip / flake8 / black / mypy stack with one `uvx`-driven Rust
    toolchain (uv, Ruff, ty), driven without a permanent install.
  - **When**: Target project has a `pyproject.toml` with dependencies, or a hand-maintained
    `requirements.txt`, or CI pins a Python version that the project does not pin locally.
  - **Target Location**: `docs/tooling/uv-toolchain.md`

- **Path**: `shared/git/machine-generated-files.md`
  - **Why**: Most ecosystems commit at least one file their own toolchain rewrites. A merge conflict in those files is not a prose conflict, and the three-field diff tool you would reach for is the wrong tool. This is about telling generated files from authored ones, and knowing which regeneration command belongs to each.
  - **When**: A merge or rebase stops with a conflict in `go.sum`, `uv.lock`, `packages.lock.json`, `gradle-wrapper.jar`, or a similar artifact.
  - **Target Location**: `docs/git/machine-generated-files.md`

### Web frameworks — decision matrices

These sit a level below the framework rules: they are the layers the framework itself does not own,
and each one carries the recommended package for the problem class *plus* the default that package
ships with.

- **Path**: `shared/python/sync-in-async-boundaries.md`
  - **Why**: `asyncio.to_thread` copies `contextvars`; `loop.run_in_executor` does not. The two calls
    have near-identical signatures and the difference is a single missing `copy_context()`, so a
    lost request id or tenant looks like a bug in the code that read it. Includes where the loop
    blocks versus where it queues, and what AnyIO's `abandon_on_cancel` actually gives up.
  - **When**: Target has both `async def` and `def` on one path, reads a `ContextVar` inside work
    submitted to a thread, or mixes `sync_to_async`, `to_thread` and `run_in_executor` in one
    service. Pairs with the Django, FastAPI and Flask threadpool rules.
  - **Target Location**: `docs/python/sync-in-async-boundaries.md`

- **Path**: `shared/python/task-queue-choice.md`
  - **Why**: Celery, Dramatiq, arq, RQ, Huey and Django-Q disagree on one axis — what the broker does
    when a worker dies mid-job. At-most-once loses the work silently, at-least-once duplicates it
    silently, and each library picks a different default you did not choose. Celery's `acks_late`
    is not a retry policy, which is the most common misreading in the ecosystem.
  - **When**: Target depends on `celery`, `dramatiq`, `arq`, `rq`, `huey`, `django-q` or `taskiq`, or
    uses FastAPI/Django `BackgroundTasks` for work that must survive a deploy, or has a bug report
    of a job that ran twice or vanished.
  - **Target Location**: `docs/python/task-queue-choice.md`

- **Path**: `shared/python/settings-and-secrets.md`
  - **Why**: The libraries disagree on both questions that matter: is a missing variable an error or
    a value, and does a typo look like a typo or like an unset variable. `django-environ` fails
    loudly but its `.env` loader quietly prefers the file's absence; `django-configurations`
    defaults silently and ships an opt-in for the strict form; `pydantic-settings` silently downgrades
    `case_sensitive` on Windows. A misspelled variable that also has a default is silently wrong in
    production.
  - **When**: Target reads configuration from the environment, has a `SECRET_KEY` or database URL
    that can be absent at runtime, uses `django-environ`, `pydantic-settings` or
    `django-configurations`, or has a service that "works locally and in production" with no local
    `.env` present.
  - **Target Location**: `docs/python/settings-and-secrets.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
