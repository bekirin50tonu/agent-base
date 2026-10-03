---
title: "`$fillable` Is a Write Allowlist, and the Default Failure Mode Is Silence"
rule_id: "RULE-LARAVEL-007"
category: "security"
scope: "backend"
applies_to: "Any Eloquent model populated from request input, directly or via validated(), and any model with $guarded = []"
last_updated: "2026-10-03"
source: "https://laravel.com/framework/docs/12.x/eloquent,https://github.com/alexeymezenin/laravel-best-practices"
---

# `$fillable` Is a Write Allowlist, and the Default Failure Mode Is Silence

A model with neither `$fillable` nor `$guarded` cannot be mass-assigned — `create()` throws. A
model with `$fillable` writes exactly the listed attributes. A model with `$guarded = []` writes
everything. The trap is in the middle case.

## Why

> By default, attributes that are not included in the `$fillable` array are **silently discarded**
> when performing mass-assignment operations.
> ([Laravel 12.x Eloquent](https://laravel.com/framework/docs/12.x/eloquent))

That is the whole defect in one phrase, and it cuts both ways from the same mechanism:

- **Fail-safe** — the attack is blocked. This is the documented motivation: *"A mass assignment
  vulnerability occurs when a user passes an unexpected HTTP request field and that field changes a
  column in your database that you did not expect."*
- **Fail-silent** — a legitimate field is blocked. Add a column, forget `$fillable`, ship. The
  field is dropped on every write: no exception, no log line, no failed assertion, HTTP 201.

The second is far more common and costs days. And because `validated()` returns only what the
*rules* allowed, the validation rules and `$fillable` are **two independent allowlists over two
different questions** — what is valid input, versus what the model will write — and nothing checks
that they agree. A field can be perfectly validatable and still not be a column the model should
set: `id`, `role`, `account_id`, `email_verified_at` all validate fine and all are dangerous.

The framework ships the switch, as it does for lazy loading:

```php
public function boot(): void
{
    Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());
}
```
([Laravel 12.x Eloquent](https://laravel.com/framework/docs/12.x/eloquent))

It converts every dropped field into an exception naming the attribute, at the point of the write.
Like `preventLazyLoading()`, the documented default is off in production — so without it, the
silent discard is what reaches production.

## Do

- Declare `$fillable` explicitly on every model reachable from a request, listing writable
  attributes and nothing else:
  ```php
  class User extends Authenticatable
  {
      protected $fillable = ['name', 'email', 'password'];
  }
  ```
- Write JSON-column keys with their arrow syntax, literally. A nested key is a separate entry:
  ```php
  protected $fillable = ['name', 'options->enabled', 'options->theme'];
  ```
  Per the docs, *"each column's mass assignable key must be specified in your model's `$fillable`
  array. For security, Laravel does not support updating nested JSON attributes when using the
  `guarded` property"* — `$guarded = []` will not reach them.
- Treat `$fillable` as the intersection point: enumerate the columns the operation may set,
  intersect with what the rules permit, and require the state-changing ones explicitly.
- Turn on `preventSilentlyDiscardingAttributes()` outside production, and pair it with a test that
  writes every field the endpoint accepts.
- Construct instances with `new User()` plus explicit assignment when the write set is decided at
  the call site rather than on the model.

## Don't

- Use `$guarded = []` on anything reachable from user input. The docs state the trade-off plainly:
  *"If you choose to unguard your model, you should take special care to always hand-craft the
  arrays passed to Eloquent's `fill`, `create`, and `update` methods."* That is a manual discipline
  applied at every call site, replacing an enforced allowlist.
- Read `$request->validated()` as making `$fillable` redundant. It is the other allowlist, over
  the other question.
- Use a narrow `$guarded` (anything not `['*']`) as an allowlist by exclusion. It is correct only
  while every new column is considered, and new columns are exactly what nobody reconsiders.
  `$fillable` states what *is* writable, which is the direction that fails safe.
- Assume an HTTP 201 or a passing test means the field was written. A silently discarded attribute
  is indistinguishable from one that was never requested.
- Merge a raw `$request->all()` into a model to avoid maintaining a list. That is the mass
  assignment vulnerability the mechanism exists to prevent.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Privilege escalation field reaches the database | `$guarded = []` or a narrow `$guarded`, fed by request input | Declare `$fillable`; the allowlist is the control |
| New column never persists, no error anywhere | Attribute missing from `$fillable`, silently discarded | Add it; enable `preventSilentlyDiscardingAttributes()` |
| JSON column updates appear to do nothing | Nested key absent from `$fillable` | Add `'column->key'` with the arrow |
| Mass assignment throws on `create()` | Neither `$fillable` nor `$guarded` declared | Declare `$fillable` |
| Endpoint writes a field the form never sent | A narrow `$guarded` treated as an allowlist | Switch to `$fillable` |

## Verifying

```bash
# Models that are unguarded or excluded-guard rather than allowlisted
grep -rln "guarded = \[\]" app/Models/
grep -rn 'guarded' app/Models/ | grep -v "\['\*'\]"

# Is the silent-discard switch armed?
grep -rn 'preventSilentlyDiscardingAttributes' app/Providers/
```

The first two lists the models where the enforced allowlist is absent — each one is safe only if
nothing in the call graph populates it from user input, which is a claim about code, not a
property of the model. The third tells you whether a forgotten `$fillable` entry fails at the
write or survives to production. None of it can tell you that the two allowlists agree; that
intersection is only visible in a test that writes every field the endpoint accepts.
