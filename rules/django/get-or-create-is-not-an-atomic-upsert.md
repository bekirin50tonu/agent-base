---
title: "get_or_create() Is Atomic Only If the Database Enforces Uniqueness"
rule_id: "RULE-DJANGO-004"
category: "correctness"
scope: "backend"
applies_to: "Any code path using get_or_create(), update_or_create(), or select_for_update(); and any test suite running on SQLite"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/ref/models/querysets/"
---

# get_or_create() Is Atomic Only If the Database Enforces Uniqueness

`get_or_create()` reads as an atomic upsert: one call, either the row exists or it gets made. Its
atomicity is conditional on a schema property the method cannot see, and the documentation states
that condition in a warning rather than in the method's signature.

## Why

The conditional is the whole mechanism:

> This method is atomic assuming that the database enforces uniqueness of the keyword arguments
> (see `unique` or `unique_together`). If the fields used in the keyword arguments do not have a
> uniqueness constraint, concurrent calls to this method may result in multiple rows with the same
> parameters being inserted.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

`may result in multiple rows` is the silent failure. There is no exception. `created` is `True` in
both callers. Two rows exist where the data model says one, and the row count is the only place
the truth appears.

Nothing in the call site records the condition. `get_or_create(ref=ref, defaults={...})` reads the
same whether `ref` is `unique=True` or an ordinary `CharField`.

### The algorithm does not validate, and it does not merge defaults on conflict

The documented algorithm shows a plain `save()`:

> The new object will be created roughly according to this algorithm:
>
> ```
> params = {k: v for k, v in kwargs.items() if "__" not in k}
> params.update({k: v() if callable(v) else v for k, v in defaults.items()})
> obj = self.model(**params)
> obj.save()
> ```
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

Two consequences ride along. `obj.save()` does not call `full_clean()`, so no model validation
runs on the created row (see `RULE-DJANGO-005`). And because `defaults` only reaches `save()` on the
create branch, a field left out of `defaults` is not applied on the update branch — the algorithm
described above is the create half.

### select_for_update() fails differently on each backend

The row lock that would make a check-then-insert safe has its own set of conditions, and they are
not the same conditions on every backend:

> Evaluating a queryset with `select_for_update()` in autocommit mode on backends which support
> `SELECT ... FOR UPDATE` is a `TransactionManagementError` error because the rows are not locked
> in that case. If allowed, this would facilitate data corruption and could easily be caused by
> calling code that expects to be run in a transaction outside of one.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

That one is loud. The next sentence is not:

> Using `select_for_update()` on backends which do not support `SELECT ... FOR UPDATE` (such as
> SQLite) will have no effect. `SELECT ... FOR UPDATE` will not be added to the query, and an error
> isn't raised if `select_for_update()` is used in autocommit mode.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

So one line of code is correct on PostgreSQL, raises on MySQL in autocommit, and does nothing on
SQLite. And a test suite is usually SQLite — which is the backend where it silently does nothing.

### The test suite passes anyway, by design

Django wraps each `TestCase` in a transaction, which hides the autocommit error as well:

> Although `select_for_update()` normally fails in autocommit mode, since `TestCase` automatically
> wraps each test in a transaction, calling `select_for_update()` in a `TestCase` even outside an
> `atomic()` block will (perhaps unexpectedly) pass without raising a
> `TransactionManagementError`. To properly test `select_for_update()` you should use
> `TransactionTestCase`.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

The green test suite is therefore evidence about neither the lock nor the constraint.

## Do

- Put the uniqueness in the schema, where the method's atomicity actually comes from:
  ```python
  # Incorrect — atomicity is claimed, nothing enforces it
  class Person(models.Model):
      first_name = models.CharField(max_length=100)
      last_name = models.CharField(max_length=100)

  # Correct — the database is what makes get_or_create atomic
  class Person(models.Model):
      first_name = models.CharField(max_length=100)
      last_name = models.CharField(max_length=100)

      class Meta:
          constraints = [
              models.UniqueConstraint(fields=["first_name", "last_name"], name="person_unique"),
          ]
  ```
- Gate on the return value, not on a preceding `exists()`:
  ```python
  # Incorrect — a check, then a separate create; the gap between them is the bug
  if not Order.objects.filter(ref=ref).exists():
      Order.objects.create(ref=ref, total=0)

  # Correct — one call, and `created` is the only signal that means anything
  order, created = Order.objects.get_or_create(ref=ref, defaults={"total": 0})
  ```
- When the intended key includes a predicate, express it as a partial constraint and match the
  chained `filter()` to it. `get_or_create()` reads its lookup from the chain, so "what the chain
  filters" and "what the database enforces" have to be the same question:
  ```python
  class Order(models.Model):
      tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
      external_id = models.CharField(max_length=64)
      is_active = models.BooleanField(default=True)

      class Meta:
          constraints = [
              models.UniqueConstraint(
                  fields=["tenant", "external_id"],
                  condition=models.Q(is_active=True),
                  name="order_active_external_id_unique",
              ),
          ]

  order, created = Order.objects.filter(is_active=True).get_or_create(
      tenant=tenant, external_id=external_id,
  )
  ```
- Take row locks inside a transaction, and only where the backend implements them:
  ```python
  # Incorrect on SQLite — no lock, no error; wrong outside atomic() everywhere else
  order = Order.objects.select_for_update().filter(ref=ref).first()

  # Correct — the lock needs an enclosing transaction to mean anything
  with transaction.atomic():
      order = Order.objects.select_for_update().filter(ref=ref).first()
  ```

## Don't

- Read `get_or_create()` as an upsert without reading the schema it depends on. The method's
  contract is conditional, and the condition lives in `Meta.constraints`.
- Catch `IntegrityError` and retry as a substitute for the constraint. Without the constraint there
  is no `IntegrityError` to catch, and the retry loop reads as protection while protecting nothing.
- Assume a passing test says anything about locking. `TestCase` hides the autocommit error and
  SQLite ignores the lock — the two failures a locking test would catch are exactly the two the
  default test setup cannot see.
- Assume the create branch describes the update branch. `defaults` reaches `save()` only when the
  row is created; on a found row those keys are not written.
- Reach for an ORM helper to add atomicity. A library-provided upsert is a different implementation
  with a different atomicity story, and Django's warning above is scoped to Django's own method.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Two rows with the same natural key, no error | No uniqueness constraint backing the `get_or_create()` lookup | Add `unique=True` or `UniqueConstraint(fields=[...])` |
| Duplicate appears only after a popular launch | The race needs write concurrency; dev and staging never reach it | Treat any `get_or_create` without a constraint as unproven |
| `TransactionManagementError` in a view | `select_for_update()` outside `transaction.atomic()` | Wrap in `atomic()` |
| No lock, no error, on SQLite | Backends without `SELECT ... FOR UPDATE` ignore it silently | Do not rely on it; enforce with a constraint |
| Locking test passes in CI, fails in production | `TestCase` wraps tests in a transaction | Use `TransactionTestCase` for the locking test |
| Fields from `defaults` not applied on update | `defaults` only applies on the create branch | Pass the values explicitly on update |

## Verifying

```bash
# Model fields with no uniqueness constraint behind get_or_create/update_or_create
grep -rn "get_or_create\|update_or_create" --include=*.py .

# Unique constraints and unique=True actually declared
grep -rn "unique=True\|UniqueConstraint\|unique_together" --include=*.py .

# Locking outside a transaction
grep -rn -B3 "select_for_update" --include=*.py .

# The backend the test suite runs against — the one where locks are ignored
grep -rn "sqlite\|postgres\|mysql" --include=*.py --include=*.toml --include=*.ini --include=*.cfg . | head -20
```

The first command lists every call site; the second lists what the database can catch. Compare them
by hand — a call site with no matching constraint is exactly the failure. No grep here can tell you
whether a `UniqueConstraint` covers the fields the call site actually passes, which is the part
that matters; that is a reading task, not a search.