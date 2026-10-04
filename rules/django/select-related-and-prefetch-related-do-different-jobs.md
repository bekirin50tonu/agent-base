---
title: "select_related() and prefetch_related() Do Different Jobs, and the Wrong One Is Not an Error"
rule_id: "RULE-DJANGO-002"
category: "performance"
scope: "backend"
applies_to: "Any loop or serializer that walks a foreign key, one-to-one, or many-to-many relationship from a QuerySet"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/ref/models/querysets/,https://raw.githubusercontent.com/django/django/6.1/django/db/models/query.py"
---

# select_related() and prefetch_related() Do Different Jobs, and the Wrong One Is Not an Error

Django's lazy foreign-key loading makes an unoptimised loop not an error — it is N+1 queries, and
nothing in the response says a second query happened. The two eager-loading calls are not
interchangeable, and choosing the wrong one is either a no-op or a performance cliff with no error
at any point.

## Why

Django's own example of the failure is the clearest statement of it in the Python documentation:

> The problem with this is that every time Pizza.__str__() asks for self.toppings.all() it has to
> query the database, so Pizza.objects.all() will run a query on the Toppings table for every item
> in the Pizza QuerySet.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

The mechanism statement is what separates the two calls:

> ``select_related`` works by creating an SQL join and including the fields of the related object in
> the ``SELECT`` statement. For this reason, ``select_related`` gets the related objects in the same
> database query. However, to avoid the much larger result set that would result from joining
> across a 'many' relationship, ``select_related`` is limited to single-valued relationships -
> foreign key and one-to-one.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

> prefetch_related, on the other hand, does a separate lookup for each relationship, and does the
> ‘joining’ in Python.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

Three distinct silent outcomes:

1. **`prefetch_related()` on a forward FK does two queries instead of one.** It works, it is
   correct, and it is strictly more expensive than `select_related()` for exactly that relation.
   Nothing warns you.
2. **`select_related()` on a nullable FK that is `NULL` returns `None`.** No exception. The
   template renders an empty string, the branch takes the falsy path, and the bug surfaces as a
   missing name in a rendered page rather than as a query error.
3. **`select_related()` and `defer()`/`only()` combine silently.** Deferred fields are populated by
   a hidden query on attribute access, so a "one query" request becomes N+1 again — and the
   queryset still *looks* correctly annotated.

Django 6.1 adds a fourth, and it is new in this version:

> Calling select_related() with no arguments is deprecated, and support for it will be removed in
> Django 2028. Specify the fields to fetch instead.
> ([Django 6.1 QuerySet API](https://docs.djangoproject.com/en/6.1/ref/models/querysets/))

Code written against the "fetch everything" idiom is on a removal clock, and the horizon is
**2028**, not the next major. The deprecation also only fires for Django's own internal call sites
— `query.py` passes `skip_name_prefixes=("django.db.models",)` so the framework does not warn
itself — so application call sites get the warning, and only in 6.1.

## Do

- Match the tool to the relationship's cardinality. Forward FK and one-to-one are single-valued, so
  a join is right:
  ```python
  # Correct — the FK is single-valued, so a join is the right tool
  for entry in Entry.objects.select_related("blog"):
      print(entry.blog.title)     # one query total
  ```
- Use `prefetch_related` for many-to-many and reverse FK, where a join would explode the result set:
  ```python
  # Correct — two queries regardless of row count
  for pizza in Pizza.objects.prefetch_related("toppings"):
      print(pizza)
  ```
- Assert the query count in a test. `assertNumQueries` is the only instrument that sees this, and it
  only sees it if you remember to use it:
  ```python
  with self.assertNumQueries(2):
      list(Pizza.objects.prefetch_related("toppings"))
  ```
- Handle the `None` from a nullable joined FK explicitly rather than letting a falsy check absorb it.
- Pass explicit field names to `select_related()`. It is required from Django 2028 and it documents
  what the one query is actually fetching.

## Don't

- Reach for `prefetch_related` on a forward FK because you learned it on a many-to-many. It works,
  costs an extra query per request, and reports nothing.
- Reach for `select_related` on a many-to-many. That one at least raises `FieldError` at queryset
  construction — it is the direction that fails loudly.
- Trust a queryset that combines `select_related()` with `only()`/`defer()`. The deferred field is
  a hidden query on access, so the N+1 returns while the queryset still reads as optimised.
- Add a queryset-rewriting library. They infer the joins, and the inference is a second source of
  truth no test covers.
- Read a clean query count in local development as evidence. `django-debug-toolbar` shows the count
  per request; it does not tell you which access caused it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Page is slow, no error, response time scales with row count | N+1 from lazy FK access in a loop or serializer | `select_related` for single-valued, `prefetch_related` for many |
| Two queries where one was expected | `prefetch_related` used on a forward FK | `select_related("field")` |
| A name renders as blank for some rows only | Nullable FK joined via `select_related` returns `None` | Handle `None`; do not let a falsy branch absorb it |
| Query count regresses after an unrelated change | `only()`/`defer()` added alongside `select_related()` | List the needed fields in `select_related`, drop the deferral |
| `RemovedInDjango...Warning` in CI | Argument-less `select_related()` | Pass the field names |

## Verifying

```bash
# Argument-less select_related — deprecated in 6.1, removed in 2028
grep -rn "select_related()" --include=*.py .

# The two eager-loading calls on the same queryset
grep -rn "prefetch_related\|select_related" --include=*.py . | grep -v "select_related(\""

# Query-count assertions: are there any?
grep -rn "assertNumQueries\|CaptureQueriesContext" --include=*.py .
```

The third command is the one that matters. If it returns nothing, this rule has no enforcement in
the project at all: nothing counts queries, so nothing notices when one is added. The greps cannot
tell you whether a `select_related` field is a forward FK or a reverse one — that distinction needs
the model definition, and it is the whole decision.
