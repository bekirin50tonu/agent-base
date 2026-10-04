---
title: "after_commit runs after the data is already persisted"
rule_id: "RULE-RAILS-001"
category: "correctness"
scope: "backend"
applies_to: "ActiveRecord, after_commit, after_save, after_destroy, after_rollback, transactional callbacks, Active Job"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_record_callbacks.html"
---

# after_commit runs after the data is already persisted

`after_save` and `after_commit` sound interchangeable. They are not, and the difference is the
boundary between "my code can still stop this" and "the write already happened". Inside
`after_save` the transaction is still open: raise and the row is rolled back, so the database
ends up matching what the code intended. Inside `after_commit` the commit has already happened
and an exception rolls nothing back.

The usual reason to reach for `after_commit` — talking to an external system, which cannot
participate in the database transaction — is exactly where the two guarantees diverge most.

## Why

The scoping does not read as scoping. `after_commit` and `after_save` differ by one word, both are
called "after", and both fire on a save. The asymmetry only appears in the failure path, and the
failure path is by definition the one not exercised by the test suite.

> after_commit makes very different guarantees than after_save, after_update, and after_destroy.
> For example, if an exception occurs in an after_save the transaction will be rolled back and the
> data will not be persisted.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

> However, during after_commit the data was already persisted to the database, and thus any
> exception won't roll anything back anymore.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

The failure is symmetric across the model lifecycle, and `after_destroy` is the sharpest case
because the side effect is usually irreversible:

> If anything raises an exception after the after_destroy callback is called and the transaction
> rolls back, then the file will have been deleted and the model will be left in an inconsistent
> state.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

Two further properties of the same chain decide whether the *rest* of your callbacks run at all:

> The whole callback chain is wrapped in a transaction. If any callback raises an exception, the
> execution chain gets halted and a rollback is issued, and the error will be re-raised.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

> If your callback code raises an exception, you'll need to rescue it and handle it within the
> callback in order to allow other callbacks to run.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

So one unguarded `after_commit` can cost you every later callback, not just its own.

## Do

Keep `after_commit` for the side effect that genuinely cannot participate in the transaction, and
make the record of intent part of the same transaction:

```ruby
# Correct — the outbox row is written in the transaction; a worker sends it later
class Order < ApplicationRecord
  after_commit :enqueue_confirmation

  private

  def enqueue_confirmation
    ConfirmationMailer.with(order: self).deliver_later
  end
end
```

Rescue inside `after_commit` so a failure in one callback does not silently skip the rest:

```ruby
# Correct — one callback's failure cannot take the others down with it
def notify_warehouse
  WarehouseClient.push(self)
rescue WarehouseClient::Error => e
  Rails.logger.error("warehouse push failed for order #{id}: #{e.message}")
  # record it durably; do not re-raise, or later callbacks are skipped
end
```

Use the rollback counterpart when the side effect must be undone rather than merely reported:

```ruby
# Correct — the cache entry is dropped when the write does not land
after_rollback :expire_cached_summary
```

Prefer `after_commit` over `after_save` for anything external, and prefer enqueuing over calling
out from inside the request when the work is not required to be immediate.

## Don't

Don't do irreversible work in `after_save` and assume an exception protects you:

```ruby
# Incorrect — the file is gone even if the transaction rolls back
after_save :delete_from_object_store
```

Don't use `after_save` to enqueue a job and then assume at-least-once delivery. If the
transaction commits and the job is enqueued from `after_commit`, the delivery guarantee you
actually have is the one described in `RULE-RAILS-006` — no retry by default.

Don't let a callback raise. An exception escaping `after_commit` skips every remaining
`after_commit` and `after_rollback` for that transaction:

```ruby
# Incorrect — an exception here skips every callback registered after it
def sync_to_crm
  CrmClient.push(self)   # network timeout raises → later callbacks never run
end
```

Don't assume callback ordering is yours to rely on. Before Rails 7.1 the order of multiple
transactional callbacks was reversed relative to definition order; since 7.1 they run in
definition order. Code written against the old behaviour is order-dependent across an upgrade.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A record exists but the external system has no copy | Side effect ran in `after_save`, transaction rolled back after | Move to `after_commit`, or accept it can be skipped |
| External system has a copy but the record does not | Side effect ran before the commit, commit failed | Same — and accept it needs an outbox, not a callback |
| Some callbacks run, later ones do not | A callback raised | Rescue inside each callback |
| File or object deleted for a rolled-back row | `after_destroy` did irreversible work | Make it reversible, or reconcile separately |
| Callback order changed across a Rails upgrade | Pre-7.1 reversal of transactional callback order | Pin Rails ≥ 7.1, do not depend on order |
| Job enqueued but never processed | Enqueued from `after_commit`, then failed | See `RULE-RAILS-006` — no retry by default |

## Verifying

Find every transactional callback and every side effect reachable from one:

```bash
# transactional callbacks — the ones whose guarantees differ from after_save
grep -rn 'after_commit\|after_rollback' app/ --include='*.rb'

# side-effecting calls inside any callback, which must be after_commit-only
grep -rn -A8 'after_commit\|after_save\|after_destroy' app/models/ --include='*.rb' \
  | grep -iE 'deliver_later|HTTP|Net::|Faraday|RestClient|S3|client\.|_client\.'
```

The check that actually catches the asymmetry is a test that forces the rollback path, because
nothing else exercises it:

```ruby
test "no confirmation is enqueued when the order is rolled back" do
  assert_no_difference -> { ConfirmationMailer.deliveries.size } do
    assert_raises(ActiveRecord::Rollback) do
      Order.create!(total: 1).tap { raise ActiveRecord::Rollback }
    end
  end
end
```

What this check cannot see: it cannot tell you whether the external system *did* receive the
call. If the process dies between the commit and the enqueue, no callback fires and no test
fails — that gap is only closable with an outbox row written inside the same transaction, and
that is a design change, not a test. Nor can it see callbacks registered from a gem, which are
invisible to a grep of `app/`.