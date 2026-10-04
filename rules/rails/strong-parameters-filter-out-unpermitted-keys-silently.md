---
title: "Strong parameters filter out unpermitted keys silently"
rule_id: "RULE-RAILS-004"
category: "security"
scope: "backend"
applies_to: "ActionController, strong parameters, params.expect, permit, mass assignment, redirect_to, filter_parameter_logging"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/action_controller_overview.html"
---

# Strong parameters filter out unpermitted keys silently

Strong Parameters does not reject an unpermitted key — it drops it. The request succeeds with a
200, the mass assignment runs, and the attribute the form was supposed to set keeps its old
value. Nothing in the response, the log, or the exception handler says a key was discarded.

The Rails 8.1 form is `params.expect`. The current guide contains zero occurrences of
`params.require(` — writing against the older API produces rules that are wrong for every current
application, and the older name is what most tutorials and most existing code still use.

## Why

The filter is the feature. The document says parameters "cannot be used in Active Model mass
assignments until they have been explicitly permitted", which reads as a precondition — the caller
must permit, or the write is rejected. What it does not say is what happens to a key that was sent
but not permitted: it is removed from the hash before the model ever sees it.

> With Action Controller Strong Parameters, parameters cannot be used in Active Model mass
> assignments until they have been explicitly permitted. This means you will need to decide which
> attributes to permit for mass update and declare them in the controller.
> ([Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html))

> If you have not called permit on the key, it will be filtered out. Arrays, hashes, or any other
> objects are not injected by default.
> ([Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html))

A dropped key is not an error condition; it is the default outcome for every key the controller
author did not think about. The visible symptom is a form that silently does nothing, or a mass
assignment that quietly omits the field the user just filled in.

The sharp edge is permitting a nested structure wholesale, which disables scalar checking for
everything inside it — present and future:

> This marks the :log_entry parameters hash and any sub-hash of it as permitted and does not check
> for permitted scalars, anything is accepted.
> ([Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html))

> Extreme care should be taken when calling expect with an empty hash, as it will allow all current
> and future model attributes to be mass-assigned.
> ([Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html))

Note what "future" means here: a permitted nested hash permits attributes that do not exist yet. A
column added next quarter is mass-assignable the day it ships.

Even where the key survives, its value must be on the permitted scalar list, so a dropped key can
be a type problem rather than an absence:

> For the permitted key :id, its value also needs to be one of these permitted scalar values:
> String, Symbol, NilClass, Numeric, TrueClass, FalseClass, Date, Time, DateTime, StringIO, IO,
> ActionDispatch::Http::UploadedFile, and Rack::Test::UploadedFile.
> ([Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html))

The same filtering instinct does not extend to `redirect_to`, which is the other place unpermitted
user input reaches a sensitive sink:

> As a general rule, passing user input directly into redirect_to is considered dangerous.
> ([Securing Rails Applications](https://guides.rubyonrails.org/security.html))

> Restricted lists are never complete.
> ([Securing Rails Applications](https://guides.rubyonrails.org/security.html))

That sentence is the general form of this whole rule. An allowlist that is maintained by hand is a
list that is incomplete by default, and the gap is invisible.

## Do

Use `params.expect` and name every key, including nested ones:

```ruby
# Correct — explicit, and expect raises rather than returning an empty hash
def update
  order = Order.find(params.expect(:id))
  order.update!(params.expect(order: [:status, :notes]))
  redirect_to order
end
```

Require nested scalars by naming them individually, so a new column is not mass-assignable until
someone permits it on purpose:

```ruby
# Correct — permit the structure, then the scalars inside it
params.expect(comment: [:body, :parent_id, replies: [:body]])
```

Fail loudly when a key the form needs was dropped, rather than letting the write proceed with the
old value:

```ruby
# Correct — a missing key is a client error, not a silent no-op
permitted = params.expect(order: [:status, :notes])
missing = %i[status notes].reject { |k| permitted[:order].key?(k) }
raise ActionController::ParameterMissing, missing.join(", ") if missing.any?
```

Keep the redirect target on a route helper rather than on user input:

```ruby
# Correct — never a user-supplied path
redirect_to edit_admin_order_path(order)
```

Rely on output escaping rather than input filtering, and filter only for logs:

> As a second step, it is good practice to escape all output of the application, especially when
> re-displaying user input, which hasn't been input-filtered (as in the search form example earlier
> on).
> ([Securing Rails Applications](https://guides.rubyonrails.org/security.html))

## Don't

Don't permit an empty hash or a whole sub-hash and call it done:

```ruby
# Incorrect — every current and future attribute on the model is mass-assignable
params.expect(order: {})
params.expect(order: [:meta])   # :meta and everything nested inside it
```

Don't use the older spelling as though it were current:

```ruby
# Incorrect for Rails 8.1 code — no occurrences remain in the current guides
params.require(:order).permit(:status)
```

Don't treat a 200 as evidence the field was written. It only says no exception was raised, and
dropping a key never raises:

```ruby
# Incorrect — reports success on every response, including the ones that dropped the key
order.update(params.expect(order: [:status]))
head :ok
```

Don't assume a key the form sends is a key the controller permitted. The mismatch is silent in both
directions — an extra key is dropped, a renamed key is dropped, and both look identical from the
response.

Don't pass a request parameter into `redirect_to` on the theory that strong parameters already
filtered it. They did not; strong parameters cover mass assignment, not this sink.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Form submits, field never changes | Key not permitted; it was filtered, not rejected | Permit it, and assert on the persisted value |
| 200 response, attribute unchanged | Same, with no exception anywhere | Check `permitted.key?` and raise if absent |
| A newly added column is mass-assignable | Nested hash permitted wholesale | Permit nested scalars by name |
| `NoMethodError` on a permitted value | Value is not a permitted scalar type | Check the type against the scalar list |
| Mass assignment reaches an unintended attribute | `params.expect(model: {})` | Enumerate the keys; never permit empty |
| Open redirect after a form post | User input passed to `redirect_to` | Redirect via a route helper |
| Tests pass but the admin panel is exploitable | Tests only exercise permitted paths | Add a test that posts an unpermitted key |

## Verifying

Find every mass-assignment site, then find the ones that permit a whole structure:

```bash
grep -rn 'params\.\(expect\|require\|permit\)' app/controllers/ --include='*.rb'

# empty or bare-hash permits — the ones that accept everything, present and future
grep -rn 'permit(\w*:\s*\[\]\|expect(\w*:\s*{\s*}\|\.permit!\|permit!(' app/ --include='*.rb'
```

The check that actually catches the drop is a test that posts the key and asserts the persisted
value, because the response status cannot distinguish the two cases:

```ruby
test "an unpermitted key does not silently leave the old value" do
  patch admin_order_path(@order), params: { order: { status: "shipped", is_admin: true } }
  assert_equal "shipped", @order.reload.status
  refute @order.reload.is_admin, "is_admin was never permitted"
end
```

What this check cannot see: it cannot detect that a permitted key is *wrongly* permitted — an
`is_admin` that appears in the permit list passes this assertion perfectly and is still a privilege
escalation. The allowlist has to be read against the model, not against the request. Nor can grep
see `permit` reached indirectly through a helper that builds the list at runtime, which is worth
grepping for separately if the app has one.