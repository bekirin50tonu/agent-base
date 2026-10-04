---
title: "Column defaults do not reach existing rows — but NOT NULL does"
rule_id: "RULE-RAILS-003"
category: "correctness"
scope: "backend"
applies_to: "ActiveRecord, migrations, add_column, change_column, change_column_default, null false, backfill, data migrations"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_record_migrations.html"
---

# Column defaults do not reach existing rows — but NOT NULL does

Two adjacent migration operations do opposite things to existing data, and the difference is not
intuitive:

- Adding a column **with a default** applies the default to future rows only. Existing rows are
  not rewritten.
- Adding a column **with `null: false`** is applied as a table constraint, so it applies to
  existing records too — and the migration fails if any row violates it.

The first is silent: the column exists, `schema.rb` shows the default, and every pre-existing row
reads as `NULL`. A report that filters on the new column returns nothing and nothing is logged.

## Why

The default is a statement about what a *new* row gets, and the constraint is a statement about
what *every* row must satisfy. Reading both as "what this column contains" is what produces the
bug. The migration succeeds, the application deploys, and the defect appears in a query result
rather than in a log.

> Note that if you are using a dynamic value (such as a date), the default will only be calculated
> the first time (i.e. on the date the migration is applied). Use nil for NULL. Depending on your
> database, existing records may not receive the default value.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

The dynamic-value clause is a second trap stacked on the first: a date or timestamp default is
evaluated *when the migration runs*, not when each row is written, so a backfilled value is the
migration date for every row.

> This changes the default value of the :approved field from true to false. This change will only be
> applied to future records, any existing records do not change.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

> This sets :name field on products to a NOT NULL column. This change applies to existing records
> as well, so you need to make sure all existing records have a :name that is NOT NULL.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

Two adjacent facts from the same page that shape how you fix it — indexes are not part of either
column operation, and `change_column` cannot be reversed:

> For add_column or change_column there is no option for adding indexes. They need to be added
> separately using add_index.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

> The change_column command is irreversible. To ensure your migration can be safely reverted, you
> will need to provide your own reversible migration.
> ([Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html))

## Do

Write the backfill as a separate, explicit migration so it is reviewable and re-runnable:

```ruby
# Migration 1 — schema only
class AddApprovedToOrders < ActiveRecord::Migration[8.1]
  def change
    add_column :orders, :approved, :boolean, default: true
  end
end
```

```ruby
# Migration 2 — data, in batches so a large table does not lock for the whole backfill
class BackfillOrdersApproved < ActiveRecord::Migration[8.1]
  def up
    Order.in_batches(of: 10_000) do |batch|
      batch.update_all(approved: true)
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
```

Add the constraint only after the backfill has run, in its own migration:

```ruby
# Migration 3 — now it is safe, and it fails loudly if the backfill missed rows
class RequireOrdersApproved < ActiveRecord::Migration[8.1]
  def change
    change_column_null :orders, :approved, false
    add_index :orders, :approved
  end
end
```

Use `null: false` at creation only on a table with no rows, and generate the column together with
its index rather than assuming `add_column` carries it.

Prefer a static default over a dynamic one when you want a value that reflects the row's own
history — `Date.today` in a default freezes at migration time:

```ruby
# Correct — the default is a constant, so every row gets the same, explicable value
add_column :orders, :approved, :boolean, default: true, null: false
```

## Don't

Don't assume adding a default with data present backfills it:

```ruby
# Incorrect — 4.2M pre-existing rows still read NULL; nothing warns
add_column :orders, :approved, :boolean, default: true
```

Don't combine the schema change, the backfill, and the `NOT NULL` constraint in one migration. If
the backfill fails halfway you get a half-migrated table with a constraint that may or may not
apply, depending on the database — see `RULE-RAILS-007` for why that depends on the adapter.

Don't use a dynamic default where per-row meaning is intended:

```ruby
# Incorrect — every row gets the date the migration ran, whatever the row's own date
add_column :audit_logs, :created_on, :date, default: -> { 'CURRENT_DATE' }
```

Don't try to roll back a `change_column` migration with `change`. It is irreversible by design, and
guessing the previous type produces a migration that runs but restores the wrong column.

Don't add the index in the same migration as the column and assume the migration is one unit of
deploy — the index build and the backfill have very different runtimes on a real table.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| New column is `NULL` on every pre-existing row | Default applies to future rows only | Separate backfill migration with `update_all` |
| Migration fails on `NOT NULL` with a constraint error | Constraint applies to existing rows | Backfill first, constrain second |
| Backfilled date equals the migration date | Dynamic default evaluated once, at migration time | Constant default, or set the value in the backfill |
| Rows appear in the column only after they are next written | Default applied on next update | Explicit backfill; do not rely on later writes |
| Rollback fails or restores the wrong type | `change_column` is irreversible | Write `up`/`down` explicitly |
| Migration too slow or locking on a large table | Backfill in one statement | `in_batches` with a batch size |
| Column exists but the query plan does not use it | `add_column` carries no index | Separate `add_index` migration |

## Verifying

The gap is a data question, so check the data, not the schema:

```bash
# rows that would be invisible to any filter on the new column
bin/rails runner 'puts Order.where(approved: nil).count'
bin/rails runner 'puts Order.where(approved: nil).limit(5).pluck(:id)'
```

Compare that against the row count the column was meant to cover — a non-zero count on a table
that already had rows is the defect, and it is invisible in `schema.rb`.

```bash
# every migration that adds or changes a column, in order, so the backfill can be seen as a step
grep -rn 'add_column\|change_column\|change_column_default\|change_column_null' db/migrate/ | sort
```

What this check cannot see: it cannot tell you *why* the rows are `NULL` — a forgotten backfill
and a backfill that failed halfway look identical from here. Read the migration history in order
rather than reasoning from the schema alone, and confirm the backfill migration is listed between
the column and the constraint. Nor can it see rows written after the backfill by a code path that
sets the attribute explicitly to `nil`.