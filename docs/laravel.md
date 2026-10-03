---
language: "Laravel"
tag: "php"
ecosystem: "backend"
last_updated: "2026-10-03"
summary: "Routing hub and decision matrix for Laravel assets."
---

# Documentation Hub: Laravel

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`composer.json`,
> and the `laravel/framework` version constraint). Match the conditions below to determine
> which `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the queue delivery contract — the four places Laravel's at-least-once
> guarantee is narrower than it reads — plus three Eloquent and application-structure rules whose
> failure modes are silence rather than errors. Pinned to Laravel 12.x queue behaviour; the
> Eloquent rules hold across 11.x–13.x. No `shared` assets yet.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/laravel/retry-after-must-exceed-worker-timeout.md`
  - **Why**: Laravel ships two numbers that must be ordered, in two different files, neither
    referencing the other — `retry_after: 90` in `config/queue.php` and `--timeout=60` on
    `queue:work`, plus `--tries=1`. With one try, the `retry_after` re-release is the *only*
    mechanism that ever retries a job, so the ordering is the delivery guarantee rather than a
    tuning choice. Invert it and the job is released back onto the queue while the original
    worker is still executing it — two concurrent runs, no exception raised.
  - **When**: Target project runs `queue:work` or Horizon, has a `retry_after` value in
    `config/queue.php`, or defines Supervisor units with `stopwaitsecs`.
  - **Target Location**: `docs/rules/retry-after-must-exceed-worker-timeout.md`

- **Path**: `rules/laravel/should-be-unique-is-dedup-not-idempotency.md`
  - **Why**: `ShouldBeUnique` is a dispatch-time cache lock answering "is this already queued?",
    never "has this already happened?". It is released on completion *or* on exhausted retries,
    so neither branch records the work as done — and the crash-inside-`handle()` case it is
    usually wanted for is outside its reach by construction, because a re-release is not a
    dispatch. Also requires an atomic-lock cache driver, and does not apply inside batches.
  - **When**: Target project has a job class implementing `ShouldBeUnique` or
    `ShouldBeUniqueUntilProcessing`, or a `uniqueVia`/`uniqueId`/`uniqueFor` method in
    `app/Jobs/`.
  - **Target Location**: `docs/rules/should-be-unique-is-dedup-not-idempotency.md`

- **Path**: `rules/laravel/dispatch-after-commit-or-the-worker-races-your-transaction.md`
  - **Why**: `after_commit` is `false` on every shipped connection, so a `dispatch()` inside
    `DB::transaction()` publishes the job immediately and a fast worker can run it before the
    commit lands — reading rows that do not exist yet. Nothing retracts a dispatched job on
    rollback under the default. Distinct from the `deferred`/`background` connections, which are
    after-*response* boundaries on a separate axis.
  - **When**: Target project calls `dispatch()` inside a `DB::transaction()` closure, or from a
    model observer or event listener that runs within one, or has any `dispatch(` in `app/` that
    is not marked `afterCommit`.
  - **Target Location**: `docs/rules/dispatch-after-commit-or-the-worker-races-your-transaction.md`

- **Path**: `rules/laravel/batch-jobs-bypass-unique-constraints.md`
  - **Why**: `Bus::batch()` does not queue N independent jobs — it queues one unit that wraps
    its jobs in a database transaction, and three guarantees stop at its edge: callbacks are
    serialized so `$this` is absent, DDL triggers implicit commits outside the rollback scope,
    and unique job constraints do not apply. The transaction is a rollback guarantee, not a
    durability one: a batched job that charges a card is not undone when the batch rolls back.
  - **When**: Target project calls `Bus::batch` or `Bus::chain`, or a job is being considered for
    moving into one — typically during backlog relief, mid-incident.
  - **Target Location**: `docs/rules/batch-jobs-bypass-unique-constraints.md`

- **Path**: `rules/laravel/validation-belongs-in-form-request.md`
  - **Why**: A controller holding both input-shape decisions and the business action mixes them
    while the input is still untrusted. A `FormRequest` moves validation and authorization ahead
    of the method body — and naming the class for the *operation* rather than the entity is what
    keeps `StoreOrderRequest`/`UpdateOrderRequest` as siblings that can legitimately differ.
    The job-side instance of the same principle is a thin `handle()`.
  - **When**: Target project calls `$request->validate()` inside a controller, has a request class
    named after an entity, or has a `handle()` containing domain logic rather than coordination.
  - **Target Location**: `docs/rules/validation-belongs-in-form-request.md`

- **Path**: `rules/laravel/eager-load-or-you-pay-n-plus-one.md`
  - **Why**: A relationship accessed as a property is a query the first time it is touched on an
    instance — and inside a loop, "the first time" is once per iteration. The case that survives
    review is the upward one: the framework documents that N+1 arises **even when eager loading**,
    because Eloquent does not hydrate the parent onto each child. `chaperone()` is the fix, not
    another `with()`. Plus the cheapest form, `$user->account->id` where the row already carries
    the key.
  - **When**: Target project loops over Eloquent models, renders a collection in Blade, or
    defines `hasMany`/`belongsToMany` relations whose children are shown with their parent.
  - **Target Location**: `docs/rules/eager-load-or-you-pay-n-plus-one.md`

- **Path**: `rules/laravel/mass-assignment-is-a-write-allowlist.md`
  - **Why**: Attributes missing from `$fillable` are **silently discarded** — so the same
    mechanism that blocks `is_admin=1` also drops a legitimate new column with no exception, no log
    line, and an HTTP 201. `validated()` and `$fillable` are two independent allowlists over two
    different questions and nothing checks they agree. JSON columns need `'column->key'` in
    `$fillable`; `$guarded = []` cannot reach them at all.
  - **When**: Target project calls `create()`, `update()`, or `fill()` with request-derived input,
    or a model in `app/Models/` has `$guarded = []` or a narrow `$guarded`.
  - **Target Location**: `docs/rules/mass-assignment-is-a-write-allowlist.md`

## 2. Skills (`skills/`)

- **Path**: `skills/laravel/queue-delivery-contract/SKILL.md`
  - **Why**: The four queue guarantees live in four different files — `config/queue.php`,
    `WorkCommand.php`, `CallQueuedHandler.php`, and the docs — and none of them reference each
    other. The skill is the ordered pass that establishes what is actually guaranteed for a given
    job before it is written: read the three numbers, match the job to the narrowest duplicate
    suppression mechanism that covers its actual failure, establish when its data becomes visible,
    then check whether batching is on the table. Ends with the cases that need a human decision
    rather than a config change.
  - **When**: Target project adds a job class, tunes `retry_after`/`--timeout`/`--tries`,
    dispatches inside a transaction, or is moving a job into a batch.
  - **Target Location**: `docs/skills/laravel/queue-delivery-contract/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/php/agent.json`
  - **Why**: Helps with PHP/Laravel-related tasks, such as queue delivery guarantees, Eloquent
    mass assignment, and other Laravel best practices.
  - **When**: Target project is a PHP/Laravel project (has `composer.json` requiring
    `laravel/framework`).
  - **Target Location**: `docs/agents/php/agent.json`

## 4. Shared Assets (`shared/`)

_None yet. The first candidate is a Supervisor + Horizon `queue:work` unit template — the three
numbers in rule 001 and the `stopwaitsecs` bound are one unit, and getting them right should not
be a per-project decision._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.

## Re-verifying against a newer Laravel

The queue rules are pinned to **Laravel 12.x**. Before applying them to a 13.x or 14.x project,
re-check the four files that carry the claims, rather than trusting the prose:

| Claim | File |
|---|---|
| `--timeout=60`, `--tries=1` defaults | `src/Illuminate/Queue/Console/WorkCommand.php` |
| `retry_after: 90`, `after_commit: false` defaults | `config/queue.php` |
| When the unique lock is released | `src/Illuminate/Queue/CallQueuedHandler.php` |
| Atomic-lock cache driver list, batch carve-out | the version's `queues` documentation page |

If **Laravel Boost** is installed in the target application
(`composer require laravel/boost --dev`), its `Search Docs` MCP tool answers the documentation half
of this semantically across 17,000+ pages, and it supports 10.x through 13.x. Boost's own
`Project Rules` layer is glob-scoped by a `paths:` frontmatter field, which is the same scoping
model this manifest's **When** conditions describe — so a Boost-installed consumer can map these
entries into `.ai/rules/` directly.
