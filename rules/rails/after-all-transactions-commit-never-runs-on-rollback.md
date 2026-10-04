---
title: "after_all_transactions_commit never runs on rollback"
rule_id: "RULE-RAILS-002"
category: "correctness"
scope: "backend"
applies_to: "after_all_transactions_commit, ActiveRecord, nested transactions, outbox, Active Job, requires_new"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_record_callbacks.html"
---

# after_all_transactions_commit never runs on rollback

A block registered with `after_all_transactions_commit` is documented in one sentence that
contains the entire failure mode: *"If any of the currently open transactions is rolled back, the
block is never called."*

No exception, no log line, no failed-job entry. The block simply does not run. This is a
deliberate design — the callback exists to run once, after the outermost transaction commits, and
there is nothing to run it against if the work is discarded — but it means code relying on it for
an irreversible side effect (a payment capture, a webhook, a third-party call) must keep its own
record of "this was supposed to happen and did not".

## Why

The name describes *when* it runs and says nothing about *what happens instead*. Read as a
scheduling promise — "run this after everything commits" — it implies a guarantee of eventual
execution. There is no such guarantee. The block has exactly two outcomes: it runs, or the work
was thrown away.

> A callback registered to after_all_transactions_commit will be triggered after the outermost
> transaction is committed. If any of the currently open transactions is rolled back, the block is
> never called.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

This is the sharpest contrast in the framework's default behaviour. A `rescue` block catches an
error. An `ensure` block runs either way. `after_all_transactions_commit` does neither — there is
no counterpart hook to register, so the "otherwise" branch has to be written by hand.

Two properties of the surrounding transaction callbacks make the gap wider than it looks:

> When a transaction completes, the after_commit or after_rollback callbacks are called for all
> models created, updated, or destroyed within that transaction. However, if an exception is
> raised within one of these callbacks, the exception will bubble up and any remaining after_commit
> or after_rollback methods will not be executed.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

> If your callback code raises an exception, you'll need to rescue it and handle it within the
> callback in order to allow other callbacks to run.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

So the block can be skipped by a rollback the application never sees, and it can be skipped by
an exception raised in an earlier callback. Both are silent with respect to the side effect.

Ordering is definition order since Rails 7.1, which was reversed before that:

> By default (from Rails 7.1), transaction callbacks will run in the order they are defined.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

## Do

If the side effect must not be lost when the transaction rolls back, write the intent into the
database in the same transaction, and let a separate process act on it:

```ruby
# Correct — the outbox row rolls back with the transaction, so nothing is stranded
class Payment < ApplicationRecord
  after_all_transactions_commit { OutboxWorker.perform_later(id) }

  after_commit :enqueue_capture, on: :create

  private

  def enqueue_capture
    CaptureWorker.perform_later(id)
  end
end
```

```ruby
# The outbox row is written inside the transaction, by the caller
Payment.create!(outbox_entries: [{ kind: "capture", payload: params }])
```

Use it when the side effect is genuinely "only if this transaction survives" and losing it is
correct behaviour — a cache invalidation, a derived row, a search index update:

```ruby
# Correct — losing this on rollback is the intended semantics
after_all_transactions_commit :refresh_denormalized_counters
```

Pair it with `after_rollback` when you need to know the work was discarded:

```ruby
after_all_transactions_commit :publish_event
after_rollback              :log_discarded_event
```

Guard every registered block so one failure cannot skip the others:

```ruby
def publish_event
  EventBus.publish(payload)
rescue EventBus::Error => e
  Rails.logger.error("publish failed for #{self.class}##{id}: #{e.message}")
end
```

## Don't

Don't treat it as a guaranteed delivery mechanism:

```ruby
# Incorrect — on any rollback of any enclosing transaction, the charge is never captured
after_all_transactions_commit { Stripe::Charge.create(amount: amount_cents) }
```

Don't call the external system directly from inside it. The transaction has committed by then, so
there is no rollback that can undo the call, and a network failure cannot be recovered from.

Don't use it as the only record that a side effect is owed. If nothing in the database says the
capture should have happened, no reconciliation job can find it later.

Don't combine it with a rescue elsewhere in the method and assume the block still runs. A rescue
around the transaction body that re-raises leaves the rollback path intact; one that swallows the
exception commits, and the block fires against work that should have been abandoned.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Side effect never happened, no error anywhere | Enclosing transaction rolled back | Write intent to an outbox row in-transaction |
| Side effect never happened, log shows a callback error | An earlier callback raised | Rescue inside each callback |
| Works in tests, never in production | Test transaction rolls back on teardown, so the block is skipped | Assert on the outbox row, not the callback |
| Payment captured but the order is gone | Block ran for a committed transaction; order deleted later | Reconcile; the callback is not the durable record |
| Ordering differs across environments or upgrades | Pre-7.1 reversal of transactional callback order | Pin Rails ≥ 7.1; do not depend on order |
| Block fires inside a `requires_new` that later commits | It is *outermost*-commit only, not per-savepoint | Use `after_commit` for per-record effects |

## Verifying

Find every registration and check each has a durable counterpart:

```bash
grep -rn 'after_all_transactions_commit' app/ lib/ --include='*.rb'
```

Then, for each hit, confirm the side effect is either reconstructible from a committed row or
enqueued from one:

```bash
# registrations whose body calls out to something outside the process
grep -rn -A6 'after_all_transactions_commit' app/ --include='*.rb' \
  | grep -iE 'HTTP|Net::|Faraday|Stripe|\.deliver_later|client\.'
```

The check that actually catches this is a test that rolls back on purpose:

```ruby
test "no capture is attempted when the transaction rolls back" do
  assert_no_difference -> { CaptureWorker.jobs.size } do
    Payment.transaction do
      Payment.create!(amount_cents: 100)
      raise ActiveRecord::Rollback
    end
  end
end
```

What this check cannot see: it cannot prove the block *does* run on the happy path, because the
test transaction wraps the example and a bare `create` inside the test also never commits for the
same reason. Test both sides — one test that rolls back and asserts nothing was enqueued, and one
that commits explicitly and asserts something was. Nor can it see that the external call
succeeded; a worker that dies between `perform` and the API response leaves no trace here either,
which is the argument for the outbox row rather than the callback.