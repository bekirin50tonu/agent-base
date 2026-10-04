---
title: "Migration DDL transactions are on unless explicitly disabled"
rule_id: "RULE-RAILS-007"
category: "correctness"
scope: "backend"
applies_to: "ActiveRecord, migrations, disable_ddl_transaction, change_column, reversible, MySQL, atomic migrations"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_record_migrations.html"
---

# Migration DDL transactions are on unless explicitly disabled

Migrations wrap themselves in a transaction, which gives all-or-nothing schema changes where the
database supports it. Two consequences are easy to miss:

- Not every database supports it. Where DDL transactions are unavailable, a half-applied
  migration is left behind and must be cleaned up by hand.
- Some statements cannot run inside a transaction at all, and the fix is
  `disable_ddl_transaction!` — which turns off the safety net for the whole migration.

The safety net is per-database and per-migration, so the same code can be atomic in CI and
half-applied in production.

## Why

The transaction is the default, which means the *absence* of it is the thing that has to be
noticed. Reading a migration tells you whether it opted out; reading the schema tells you nothing,
because a half-applied migration can leave a schema that looks valid.

> In databases that support DDL transactions, changing the schema in a single transaction, each
> migration is wrapped in a transaction.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

> If the database does not support DDL transactions with statements that change the schema, then
> when a migration fails, the parts of it that have succeeded will not be rolled back. You will have
> to rollback the changes manually.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

Both halves of that are load-bearing: not the rollback, but the *manual* cleanup. The framework's
recovery story for a failed migration is a person reading the error and undoing the parts by hand.

The opt-out exists because some statements genuinely cannot run in a transaction:

> There are queries that you can’t execute inside a transaction though, and for these situations
> you can turn the automatic transactions off with disable_ddl_transaction!:
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

That trade is all-or-nothing per migration: one statement that needs it takes the safety net away
from every other statement in the same file.

Reversibility is the other half, and it does not survive contact with real column changes:

> The change_column command is irreversible. To ensure your migration can be safely reverted, you
> will need to provide your own reversible migration.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

> Sometimes your migration will do something which is just plain irreversible; for example, it
> might destroy some data.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

> The change method is the primary way of writing migrations. It works for the majority of cases in
> which Active Record knows how to reverse a migration's actions automatically.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

That last one is the honest scope of `change`: the majority of cases, determined by whether Active
Record can infer the inverse — not a guarantee.

## Do

Keep the transaction on unless a specific statement needs it off, and put such a statement in its
own migration so the others keep their net:

```ruby
# Correct — the data operation gets its own file, clearly marked
class BackfillOrderTotals < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    Order.in_batches(of: 5_000) { |batch| batch.update_all(total_cents: 0) }
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
```

Write `up`/`down` explicitly for any `change_column`, and state the old type rather than letting it
be inferred:

```ruby
# Correct — reversible because the inverse is written, not guessed
class ChangeOrdersStatusType < ActiveRecord::Migration[8.1]
  def up
    change_column :orders, :status, :string, limit: 32, null: false
  end

  def down
    change_column :orders, :status, :integer, using: "status::integer"
  end
end
```

Make the irreversible ones say so, so `rails db:rollback` fails loudly rather than silently doing
nothing:

```ruby
class DropLegacyStatus < ActiveRecord::Migration[8.1]
  def up
    remove_column :orders, :legacy_status   # data is gone; there is no inverse
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "legacy_status was not preserved"
  end
end
```

Verify a migration against the production database engine before relying on its atomicity, and
have a written recovery step for the ones that opt out.

## Don't

Don't put `disable_ddl_transaction!` at the top of a migration that also does schema changes you
would have wanted rolled back:

```ruby
# Incorrect — every statement here is unprotected, not just the one that needed it
class MigrateEverything < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_column :orders, :total_cents, :integer
    remove_column :orders, :legacy_total
    create_index :orders, :total_cents       # none of these roll back on failure
  end
end
```

Don't assume a failed migration left the schema unchanged. On an adapter without DDL transactions
it did not, and `rails db:migrate` will refuse to continue until the version is reconciled.

Don't rely on `change` for anything that destroys data or changes a column type. Rails cannot infer
those inverses, and a `change` that half-infers is worse than an explicit `up`/`down` because it
looks reversible in the diff.

Don't run `rails db:rollback` against a migration you have not read. On a non-transactional
adapter, the rollback of one migration can compound a half-applied earlier one.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Table has the new column and none of the index | Migration failed midway, no DDL transaction | Manual cleanup, then reconcile the version |
| `db:migrate` refuses to run | Recorded version disagrees with the schema | Fix the schema, then `db:migrate:status` |
| Rollback restored the wrong type | `change_column` inferred a wrong inverse | Write `up`/`down` explicitly |
| Schema is correct but the migration is marked irreversible | `change` used on an action Rails cannot reverse | Accept it and say so, or write the inverse |
| CI migrations succeed, staging ones half-apply | Different database engine | Confirm DDL transaction support per environment |
| A migration locks a large table for minutes | Backfill inside a schema migration | Split it and batch it, with the opt-out |
| Index build fails midway | Concurrent index inside a transaction | Separate migration with `disable_ddl_transaction!` |

## Verifying

Find the migrations that turned the safety net off, and the ones that cannot be reversed:

```bash
grep -rn 'disable_ddl_transaction!' db/migrate/

# change_column under `change` is the common irreversible case
grep -rln 'change_column' db/migrate/ | xargs grep -L 'def down\|def up'
```

Then confirm what your engine actually does, since this is the assumption everything rests on:

```bash
bin/rails runner 'puts ActiveRecord::Base.connection.adapter_name'
bin/rails db:migrate:status
```

The check that actually catches a half-applied migration is a dry run against a copy of
production's schema, not a test database:

```bash
# apply, verify, then roll back — on the real engine
bin/rails db:migrate
bin/rails db:migrate:status
bin/rails db:rollback
```

What this check cannot see: it cannot tell you the migration is safe under production *data
volume*. A migration that is atomic and correct on an empty table can lock for longer than your
deploy window on a table with real rows, and that failure appears as a timeout with no partial
state at all — the transaction rolls back cleanly and the deploy fails for a reason no schema
check would have found. Time the backfill separately, batch it, and add the index separately from
the column.