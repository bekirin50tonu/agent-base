---
title: "Ruby on Rails — which default is in force, and where"
category: "architecture"
scope: "backend"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/configuring.html"
---

# Ruby on Rails — which default is in force, and where

Four decisions account for most Rails defects that surface somewhere other than the code that
caused them. In each one the shipped default is a reasonable choice that answers a question nobody
asked — and in several it is *two* values, one per environment, so the code is identical and the
behaviour is not.

This sits one level below `RULE-RAILS-001` … `RULE-RAILS-008`, which explain each mechanism. This
matrix is for choosing between them.

## The four questions

1. **Which side effect survives a rollback?** `after_save` rolls back, `after_commit` does not, and
   `after_all_transactions_commit` never runs at all. (`RULE-RAILS-001`, `RULE-RAILS-002`)
2. **Which failure is loud?** Non-bang persistence returns `false` or the object; a job that fails
   is not retried. (`RULE-RAILS-005`, `RULE-RAILS-006`)
3. **Which rows does this touch?** A default reaches new rows, a constraint reaches all of them.
   (`RULE-RAILS-003`)
4. **Which environment am I in?** `perform_caching` is `false` in development and `true` in
   production — and it does not govern `Rails.cache` at all. (`RULE-RAILS-008`)

## The defaults, in one table

| Decision | Shipped default | The default's cost |
|---|---|---|
| `after_save` on exception | Rolls back | Side effect gone with the row |
| `after_commit` on exception | Rolls nothing back | Row persists, side effect half-done |
| `after_all_transactions_commit` on rollback | Block never runs | No error, no log, no retry |
| Callback raising | Skips all later callbacks | One failure hides the rest |
| Transactional callback order | Definition order since 7.1 | Reversed before 7.1 |
| `save` / `update` on invalid | Return `false` | Caller that ignores it proceeds |
| `create` on invalid | Returns the object | Truthiness check always passes |
| `create!` on aborted callback | `RecordNotSaved` | Names the class, not the rule |
| `destroy` vs `delete` | `destroy` runs callbacks | `delete` silently skips them |
| `update_column` / `update_all` | Skips validations | Invalid data by design |
| Failed job | No retry | Work lands in failed executions unread |
| Unretried job queue | `"default"` | Unrelated jobs compete |
| Column default | Future rows only | Pre-existing rows read `NULL` |
| Column `null: false` | All rows | Migration fails if any row violates |
| Dynamic column default | Evaluated once, at migration time | Every row gets the migration date |
| `add_column` index | None | Unindexed new column |
| `change_column` reversibility | Irreversible | `change` cannot infer the inverse |
| DDL transaction | On, per migration | Off where the engine lacks it |
| `disable_ddl_transaction!` | Per migration, all statements | One opt-out removes the net everywhere |
| `perform_caching` | `false` dev, `true` prod | Bug reproduces only in production |
| `perform_caching` scope | Action Controller only | `Rails.cache` unaffected either way |
| Cache store (Rails 8.0+) | Solid Cache | Differs from the generic `:file_store` |
| Inner fragment expiry | Does not reach the outer one | Page serves stale content |
| Test wrapping | Implicit transaction, rolled back | Commit path never exercised |
| `params.expect` with `{}` | Everything permitted | Future columns mass-assignable too |
| Unpermitted key | Filtered, not rejected | 200 response, nothing written |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Side effect that must not survive a rollback | Write it in `after_save` | `after_commit` | Row gone, side effect stale |
| Notify an external system | `after_commit` + outbox row | `after_save` | Exception rolls nothing back |
| Guarantee an irreversible effect | Outbox row in-transaction | `after_all_transactions_commit` | Skipped silently on rollback |
| Cache invalidation | `after_all_transactions_commit` | `after_commit` | Skipped by the test transaction |
| One callback must not kill the others | `rescue` inside each | A bare callback | Later callbacks never run |
| A form that renders errors | `save` + `errors` | `save!` | 500 instead of 422 |
| A write that must not be missed | `save!` / `update!` / `create!` | `save` / `create` | `false` discarded, `create` truthy |
| Build then decide validity | `Order.new` + `save` | `Order.create` | Truthiness always passes |
| Clean up associations on delete | `destroy!` | `delete_all` | Callbacks silently skipped |
| Bypass validations deliberately | `update_column`, with a comment | `update!` | Invalid data, by design |
| Retry a transient failure | `retry_on` in the job class | A `sleep` loop in `perform` | Policy invisible in the class |
| Stop retrying a permanent failure | `discard_on` | `retry_on StandardError` | Same failure, ten times |
| Separate urgent work | `queue_as :name` | Default queue | Unrelated jobs compete |
| Give new rows a value | `add_column ..., default:` | Expecting a backfill | Old rows read `NULL` |
| Give every row a value | Backfill, then `change_column_null` | One migration | Constraint fails, or gap is silent |
| Per-row dates | Constant default, or backfill | `default: -> { ... }` | Every row gets migration date |
| Index a new column | Separate `add_index` migration | Bundled into `add_column` | Unindexed column |
| Reverse a type change | Explicit `up` / `down` | `change` | Irreversible, or wrongly inferred |
| One statement that cannot be transactional | Its own migration with `disable_ddl_transaction!` | Opt-out at the top of a schema migration | Every statement unprotected |
| Develop a fragment-cache path | `perform_caching = true` locally | Shipping default | Bug reproduces only in production |
| Cache something computed | `race_condition_ttl` | `expires_in` alone | Stampede at expiry |
| Expire a nested fragment | Expire the outer one too | Expiring the inner one | Stale page, no signal |
| A reversible destructive migration | `raise IrreversibleMigration` in `down` | Guessing the inverse | Rollback looks like it worked |
| A job enqueued from `after_commit` | `after_all_transactions_commit` | `after_save` | Enqueued for a row that never lands |
| A job whose delivery matters | Outbox row + worker | The callback alone | No retry, no record |

## The pattern shared by most of these rows

Many rows above have the same shape, and it is the same shape found in the Docker, Node.js and
Laravel rounds: **the default is documented, correct, and silently not what the author assumed.**

- `after_save` is "after the save", and is before the commit.
- `after_all_transactions_commit` is "run it after the commit", and never runs at all.
- `create` is "create it", and returns the object whether or not it did.
- `save` is "save it", and returns `false` when it did not.
- A failed job is "queued work", and is not retried.
- A column default is "the default", and reaches only future rows.
- `perform_caching` is "is caching on", and is off where you debug and true where you deploy.
- Unpermitted params are "filtered", not rejected, so the response is a 200.

In each case Rails is right and the author's model of Rails is the thing that is wrong. The
question worth asking of a Rails codebase is not "is the write correct" but **"which of these
four defaults is in force here, and is it the same one that will be in force in the environment
where this fails."**

Four habits follow, and none of them needs a framework change:

- **Prefer the loud form by default.** `save!`, `update!`, `create!`, explicit `raise
  IrreversibleMigration`. The non-bang forms are correct when you are about to render errors and
  nowhere else.
- **Write intent into the database, not into a callback.** An outbox row rolls back with the
  transaction; `after_all_transactions_commit` does not run at all.
- **Split every migration into schema, data, constraint.** Three files instead of one, and each one
  has an obvious failure mode you can reason about.
- **Turn the caches on in development.** The environments should disagree about data, never about
  which code paths exist.

## The one check that answers most of it

```bash
grep -rnE 'after_all_transactions_commit|after_commit|after_save|\.(save|update|create|destroy|delete)\(|update_column|update_all|disable_ddl_transaction|perform_caching|caches_action|Rails\.cache|queue_as|retry_on|discard_on|params\.\w+\(\s*\w+:\s*\{\s*\}' \
  app/ config/ lib/ db/migrate/ --include='*.rb'
```

One grep, and every decision above shows up as a line that has to be justified. The rows worth
reading first are the ones whose effect reaches code that never mentions Rails: the
`after_all_transactions_commit` registrations, and every job class with no `retry_on`.

Two follow-ups are worth running before trusting the result:

- **In CI**, run the suite with `perform_caching = true` and again with a random seed; fail the
  build if either differs. That is the only mechanical check for the environment split
  (`RULE-RAILS-008`).
- **At the boundary**, post an unpermitted key and assert the attribute did not change
  (`RULE-RAILS-004`). A 200 is not evidence the field was written.

## Sources

- [Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html)
- [Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html)
- [Active Record Validations](https://guides.rubyonrails.org/active_record_validations.html)
- [Active Record Basics](https://guides.rubyonrails.org/active_record_basics.html)
- [Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html)
- [Securing Rails Applications](https://guides.rubyonrails.org/security.html)
- [Active Job Basics](https://guides.rubyonrails.org/active_job_basics.html)
- [Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html)
- [Configuring Rails Applications](https://guides.rubyonrails.org/configuring.html)
- [Testing Rails Applications](https://guides.rubyonrails.org/testing.html)

## Version note

Written against the **Rails 8.1** guides, and three boundaries are load-bearing:

- **Strong Parameters are spelled `params.expect` in current Rails.** The 8.1 guides contain zero
  occurrences of `params.require(`; `require` and `permit` remain the common spelling in existing
  code and in most tutorials, so a rule written against the older form is wrong for every current
  application.
- **Transaction callbacks run in definition order since Rails 7.1.** Before 7.1 the order was
  reversed. Any code that depends on transactional callback order changes behaviour across that
  boundary with no diff in the application.
- **Solid Cache is the default cache store for apps generated with Rails 8.0 and later.** The
  generic configuration entry still documents `:file_store`, so the store you get depends on when
  the app was generated, not on what the configuration reference says today.

Rails 8.1 also renamed `use_transactional_fixtures` to `use_transactional_tests`; the old name
does not appear anywhere in the current guides. All three mean the same code can behave correctly
on one version and incorrectly on another with no change of intent — check `Gemfile.lock` before
assuming a Rails defect is an application defect. There is a separate `docs/laravel.md` hub; this
one covers the Rails framework itself, and the two overlap only on the outbox-and-callback shape,
which Laravel reaches through `after_commit` and Rails through `after_all_transactions_commit`.