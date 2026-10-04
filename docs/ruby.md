---
language: "Ruby"
tag: "ruby"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Ruby on Rails assets."
---

# Documentation Hub: Ruby

> **Agent Directive (Phase 4)**: Inspect the target project's `Gemfile` and `Gemfile.lock` for
> `rails` and `activerecord`, then grep for `after_all_transactions_commit`, `after_commit`,
> `after_save`, `after_destroy`, `.save(`, `.update(`, `.create(`, `.destroy(`, `.delete_all`,
> `update_column`, `update_all`, `disable_ddl_transaction`, `change_column`, `perform_caching`,
> `caches_action`, `Rails.cache`, `queue_as`, `retry_on`, `discard_on`, `params.expect`,
> `params.require`, `permit`, and `use_transactional_tests`. Match the conditions below to
> determine which `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the places where Rails' defaults are documented, correct, and silently
> not what the author assumed — the three transaction callbacks and what each guarantees, the
> non-bang persistence methods, jobs that are never retried, column defaults that reach only
> future rows, strong parameters that filter rather than reject, migrations that may run without
> a transaction, and a caching flag that is off in development and true in production. No `skills`
> yet.
>
> **Version note**: written against the **Rails 8.1** guides. Three boundaries are load-bearing.
> Strong Parameters are spelled `params.expect` in current Rails — the 8.1 guides contain zero
> occurrences of `params.require(`, though `require`/`permit` remain the common spelling in
> existing code. Transaction callbacks run in **definition order since Rails 7.1**; before that
> the order was reversed. And **Solid Cache is the default store for apps generated with Rails
> 8.0+**, where the generic configuration entry still documents `:file_store`. Rails 8.1 also
> renamed `use_transactional_fixtures` to `use_transactional_tests`. Check `Gemfile.lock` before
> attributing a Rails defect to application code. There is a separate `docs/laravel.md` hub; this
> one covers the Rails framework itself, and the two overlap only on the outbox-and-callback shape.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/rails/after-commit-runs-after-the-data-is-already-persisted.md`
  - **Why**: `after_save` and `after_commit` differ by one word and diverge only on the failure
    path. In `after_save` an exception rolls the transaction back and the row goes with it; in
    `after_commit` the write already landed and an exception rolls nothing back — so the usual
    reason to reach for it, talking to a system that cannot join the transaction, is exactly where
    the guarantees diverge. The whole callback chain is wrapped in a transaction, and one raising
    callback halts every later one.
  - **When**: Target project defines `after_commit`, `after_save` or `after_destroy` callbacks that
    call an external service, enqueue a job, delete a file, or send mail.
  - **Target Location**: `docs/rules/rails/after-commit-runs-after-the-data-is-already-persisted.md`

- **Path**: `rules/rails/after-all-transactions-commit-never-runs-on-rollback.md`
  - **Why**: The documented behaviour is one sentence — "If any of the currently open transactions
    is rolled back, the block is never called." No exception, no log line, no failed-job entry. The
    callback runs once after the outermost commit, and on the discard path there is nothing to run
    it against. Code relying on it for a payment capture, a webhook or a third-party call has no
    record that the work was owed, so the effect is lost silently.
  - **When**: Target project registers `after_all_transactions_commit`, or enqueues work from a
    transaction callback for an effect that must not be lost.
  - **Target Location**: `docs/rules/rails/after-all-transactions-commit-never-runs-on-rollback.md`

- **Path**: `rules/rails/column-defaults-do-not-reach-existing-rows.md`
  - **Why**: Two adjacent migration operations do opposite things. A column default "will only be
    applied to future records, any existing records do not change", so every pre-existing row reads
    `NULL` with nothing logged. A `null: false` constraint, by contrast, "applies to existing
    records as well" and fails the migration if any row violates it. Dynamic defaults are worse
    still — the value is calculated once, on the date the migration ran.
  - **When**: Target project adds a column with a default, changes a default, or plans to constrain
    a column that already has data.
  - **Target Location**: `docs/rules/rails/column-defaults-do-not-reach-existing-rows.md`

- **Path**: `rules/rails/strong-parameters-filter-out-unpermitted-keys-silently.md`
  - **Why**: "If you have not called permit on the key, it will be filtered out." The request
    returns 200, the mass assignment runs, and the attribute the form was meant to set keeps its
    old value — nothing rejects the write. The Rails 8.1 spelling is `params.expect`; the current
    guides contain no `params.require(` at all. Permitting a nested hash wholesale "does not check
    for permitted scalars, anything is accepted", including columns added later.
  - **When**: Target project mass-assigns from params in any controller, permits a nested structure,
    or redirects using request input.
  - **Target Location**: `docs/rules/rails/strong-parameters-filter-out-unpermitted-keys-silently.md`

- **Path**: `rules/rails/non-bang-methods-return-false-instead-of-raising.md`
  - **Why**: "The bang versions ... raise an exception if the record is invalid. The non-bang
    versions - save and update returns false, and create returns the object." So
    `if order = Order.create(...)` always takes the branch, and an ignored `save` return value
    leaves the caller proceeding as though the write landed. And "not all methods in Rails trigger
    validations" — `update_column` and `update_all` report success while skipping them entirely.
  - **When**: Target project calls `save`, `update`, `create`, `destroy` or `delete` without an
    exclamation mark, or uses a validation-skipping method.
  - **Target Location**: `docs/rules/rails/non-bang-methods-return-false-instead-of-raising.md`

- **Path**: `rules/rails/failed-jobs-are-not-retried-by-default.md`
  - **Why**: "A failed job will not be retried, unless configured otherwise", and jobs without
    `retry_on` "go straight to failed executions without retrying". At-least-once is a property of
    the transport, not of Active Job's failure handling, so `deliver_later` inherits a guarantee it
    does not have. Unassigned jobs also share the `default` queue, so unrelated work competes.
  - **When**: Target project enqueues jobs or mail with `perform_later` / `deliver_later`, has job
    classes with no `retry_on` or `discard_on`, or shares the default queue.
  - **Target Location**: `docs/rules/rails/failed-jobs-are-not-retried-by-default.md`

- **Path**: `rules/rails/migration-ddl-transaction-is-on-unless-disabled.md`
  - **Why**: Each migration is wrapped in a transaction "in databases that support DDL
    transactions" — where they are unsupported, "the parts of it that have succeeded will not be
    rolled back. You will have to rollback the changes manually." The opt-out,
    `disable_ddl_transaction!`, applies to every statement in the migration. And `change_column`
    is irreversible, so `change` cannot infer the inverse.
  - **When**: Target project has migrations using `disable_ddl_transaction!`, `change_column`,
    concurrent index builds, or data backfills alongside schema changes.
  - **Target Location**: `docs/rules/rails/migration-ddl-transaction-is-on-unless-disabled.md`

- **Path**: `rules/rails/caching-is-on-in-production-and-off-in-development.md`
  - **Why**: `perform_caching` is "false in the development environment, true in production", and
    "only affects caching provided by Action Controller. It will not impact low-level caching" — so
    a `Rails.cache` path behaves identically in both while `caches_action` is inert locally.
    Expiring an inner fragment "does not automatically expire any outer fragment that contains it",
    and the default store for Rails 8.0+ apps is Solid Cache rather than the documented
    `:file_store`.
  - **When**: Target project uses fragment caching, `Rails.cache`, or has `perform_caching`
    differing between environments.
  - **Target Location**: `docs/rules/rails/caching-is-on-in-production-and-off-in-development.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/rails/agent.json`
  - **Why**: Helps with Ruby on Rails tasks, such as deciding whether a side effect belongs in
    `after_save`, `after_commit` or `after_all_transactions_commit`, and recording an irreversible
    effect so a rollback cannot lose it, noticing when a persistence call returns `false` or an
    object instead of raising, giving a job an explicit retry policy because failed jobs are not
    retried by default, backfilling existing rows after adding a column with a default rather than
    trusting the default to reach them, splitting a migration into schema, data and constraint so a
    partial application is impossible, enabling `perform_caching` in development so a
    fragment-cache bug reproduces locally, and filtering unpermitted params explicitly instead of
    expecting a request with a dropped key to be rejected.
  - **When**: Target project depends on `rails` or `activerecord`, and contains any transaction
    callback, mass assignment, background job, migration, or fragment cache.
  - **Target Location**: `docs/agents/rails/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/rails/the-defaults-that-are-different-in-two-environments.md`
  - **Why**: Four questions decide most Rails defects — which side effect survives a rollback, which
    failure is loud, which rows a change touches, and which environment is in force — and in each
    the shipped default answers a question nobody asked. Several are two values, one per
    environment, so the code is identical and the behaviour is not. The matrix names each default
    *and* its cost, because the recurring shape is the one from the Docker, Node.js and Laravel
    rounds: the framework is correct and the author's model of the framework is what is wrong. One
    grep surfaces every decision at once.
  - **When**: Target project depends on Rails and has more than a handful of callbacks, mass
    assignments, job enqueues, or migrations — or deploys the same code to environments whose
    caching settings differ.
  - **Target Location**: `docs/rails/the-defaults-that-are-different-in-two-environments.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.