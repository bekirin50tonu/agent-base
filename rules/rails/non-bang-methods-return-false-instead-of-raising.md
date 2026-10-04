---
title: "Non-bang methods return false instead of raising"
rule_id: "RULE-RAILS-005"
category: "correctness"
scope: "backend"
applies_to: "ActiveRecord, save, save!, update, update!, create, create!, valid?, destroy, delete, update_column, callbacks"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_record_validations.html"
---

# Non-bang methods return false instead of raising

`save`, `update` and `create` return values rather than raising on a validation failure. A caller
that ignores the return value has no signal that the write did not happen.

Worse, `create` returns the object *regardless* of validity — so a truthiness check on the return
value passes even when nothing was written. "The model was valid" and "the write happened" are
separate questions, and the non-bang names do not distinguish them.

## Why

Ruby convention says a method either returns a value or raises; the non-bang/bang pair normally
means "raises on failure, returns a value on success". Here the pair means "returns something on
failure too" — and the something is `false` in one case and a full object in another, so the
truthiness check that reads as idiomatic Ruby passes for both.

> Methods like save, create and update validate a model before persisting it to the database. If
> the model is invalid, no database operations are performed. In this case the save and update
> methods return false. The create method still returns the object, which can be checked for
> errors.
> ([Active Record Basics](https://guides.rubyonrails.org/active_record_basics.html))

> The bang versions (methods that end with an exclamation mark, like save!) raise an exception if
> the record is invalid. The non-bang versions - save and update returns false, and create returns
> the object.
> ([Active Record Validations](https://guides.rubyonrails.org/active_record_validations.html))

That is the whole failure mode in one sentence: `create` returns the object, so `if order = Order.create(params)`
always takes the branch. The record was built in memory, validated in memory, and never written.

The next layer is that validations are not the only reason a write does not happen, and not every
method runs them:

> While validations usually prevent invalid data from being saved to the database, it's important
> to be aware that not all methods in Rails trigger validations. Some methods allow changes to be
> made directly to the database without performing validations.
> ([Active Record Validations](https://guides.rubyonrails.org/active_record_validations.html))

So a method that skips validations can return `true` while having bypassed the rules entirely —
the inverse of the `create` case, and the one that is harder to notice because the code looks like
it saved something.

Callbacks add a third way for the write to not happen. A `before_save` that throws prevents the
save and raises on the bang form only:

> However, it will raise an ActiveRecord::RecordNotSaved when calling create!. This exception
> indicates that the record was not saved due to the callback's interruption.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

And destroy does not fire callbacks at all, which is a different silent gap rather than the same
one:

> Destroy callbacks are triggered whenever a record is destroyed, but ignored when a record is
> deleted.
> ([Active Record Callbacks](https://guides.rubyonrails.org/active_record_callbacks.html))

## Do

Use the bang form wherever the caller cannot act on a failure, which in practice means almost
everywhere outside a form object that is about to render the errors:

```ruby
# Correct — raises, so a caller cannot continue past a failed write
order.update!(params.expect(order: [:status, :notes]))
```

When you must collect errors rather than raise, check `errors` on the object rather than
truthiness — this is the only form that is correct for `create`:

```ruby
# Correct — create returns the object even when nothing was written
order = Order.new(order_params)
if order.save
  redirect_to order
else
  render :new, status: :unprocessable_content
end
```

Make the callback-interruption case explicit rather than relying on the default:

```ruby
# Correct — a callback that aborts the save is a business rule, and reads as one
before_save :ensure_inventory_available

def ensure_inventory_available
  errors.add(:base, "out of stock") && throw(:abort)
end
```

Treat `delete` as a different operation from `destroy` and say which one you mean:

```ruby
# Correct — callbacks fire, associations are cleaned up
order.destroy!

# Correct — no callbacks; the caller owns every consequence
Order.where(id: id).delete_all
```

## Don't

Don't ignore the return value of a persistence call:

```ruby
# Incorrect — returns false when invalid, and the method proceeds as if it worked
order.save
redirect_to order
```

Don't use `create` as a truthiness test:

```ruby
# Incorrect — always truthy, even when the record was never written
if order = Order.create(order_params)
  head :created
end
```

Don't assume `true` from a method means validations ran. `update_column`, `update_all`,
`insert_all` and friends go straight to the database and skip validations by design.

Don't reach for the bang form inside a rescue that is broader than the write, or you convert a
recoverable validation error into a 500:

```ruby
# Incorrect — the bang form's ActiveRecord::RecordInvalid is caught and reclassified
begin
  order.save!
  Stripe::Charge.create(amount: order.amount_cents)
rescue StandardError => e
  head :unprocessable_entity   # now a network error looks like a form error
end
```

Don't use `delete` where you meant `destroy` and then look for the callback that never ran.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 200 response, nothing in the database | Return value of `save`/`create` ignored | Use the bang form, or check `errors` |
| `if order = Order.create(...)` always taken | `create` returns the object regardless of validity | `save` + `errors`, or `create!` |
| Invalid data reaches the database | Validation-skipping method (`update_column`, `update_all`) | Use `update!` so validations run |
| `ActiveRecord::RecordNotSaved` with no clear cause | A callback called `throw(:abort)` | Name the aborting rule, and handle it as a validation |
| `RecordNotFound` for a record that exists | Callback aborted a `destroy!` in the same transaction | Inspect callbacks before the delete |
| Callbacks do not run on delete | `delete` skips them; `destroy` runs them | Pick the operation deliberately |
| A network error surfaces as a 422 | Broad rescue swallowing the bang form's exception | Narrow the rescue to the write |

## Verifying

Find every persistence call that discards its result:

```bash
grep -rn '\.\(save\|update\|create\|destroy\|touch\)(' app/ lib/ --include='*.rb' \
  | grep -vE '[!?]\(|_\(|#|def |\.valid|\.persisted|\.destroyed'
```

Then find the methods that bypass validations entirely — these are the inverse trap and are not
visible in the list above because they do not carry a return value at all:

```bash
grep -rn 'update_column\|update_all\|insert_all\|upsert\|increment!\|decrement!' app/ --include='*.rb'
```

The check that actually catches this is a request test asserting the persisted state, not the
response status:

```ruby
test "an invalid order is not persisted" do
  assert_no_difference -> { Order.count } do
    post orders_path, params: { order: { total: nil } }
  end
end
```

What this check cannot see: it cannot tell you *which* call in a multi-step method swallowed the
failure. A service object that saves three records and returns the last one produces the same
green test. For that, assert on each write's outcome inside the object rather than on the request
boundary, and be aware that a `throw(:abort)` in a callback is indistinguishable from a validation
failure unless the callback adds an error — which is the form to prefer.