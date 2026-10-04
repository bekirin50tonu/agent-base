---
title: "Model.save() Does Not Validate; full_clean() Is a Separate Call Nobody Makes"
rule_id: "RULE-DJANGO-005"
category: "correctness"
scope: "backend"
applies_to: "Any code path that writes a model without going through a ModelForm, admin, or an explicit full_clean() call"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/ref/models/instances/,https://docs.djangoproject.com/en/6.1/ref/models/fields/"
---

# Model.save() Does Not Validate; full_clean() Is a Separate Call Nobody Makes

Django has a complete model validation system — four stages, in a defined order, with a structured
error object. `save()` runs none of it. The documentation says so in a `note` block that sits below
six paragraphs describing validation as though it were automatic.

## Why

The four stages:

> All four steps are performed when you call a model's `full_clean()` method. When you use a
> `ModelForm`, the call to `is_valid()` will perform these validation steps for all the fields that
> are included on the form.
> ([Django 6.1 Model instances](https://docs.djangoproject.com/en/6.1/ref/models/instances/))

The four stages are `Model.clean_fields()` (the individual fields), `Model.clean()` (the model as a
whole), `Model.validate_unique()` (field uniqueness), and `Model.validate_constraints()` (schema
constraints). The order and the reporting behaviour:
> ([Django 6.1 Model instances](https://docs.djangoproject.com/en/6.1/ref/models/instances/))

And the note, which is the actual rule:

> Note that `full_clean()` will not be called automatically when you call your model's `save()`
> method. You'll need to call it manually when you want to run one-step model validation for your
> own manually created models.
> ([Django 6.1 Model instances](https://docs.djangoproject.com/en/6.1/ref/models/instances/))

`full_clean()` runs them in that order and reports all four stages' errors together:

> This method calls `Model.clean_fields()`, `Model.clean()`, `Model.validate_unique()` (if
> `validate_unique` is `True`), and `Model.validate_constraints()` (if `validate_constraints` is
> `True`) in that order and raises a `ValidationError` that has a `message_dict` attribute
> containing errors from all four stages.
> ([Django 6.1 Model instances](https://docs.djangoproject.com/en/6.1/ref/models/instances/))

Which parts a skipped `full_clean()` actually loses depends on which layer was doing the enforcing.
`max_length` and `null=False` are the database's, so an over-long `CharField` does get rejected —
as an `IntegrityError` or driver error, at the database layer, not as a `ValidationError` in the
request. What nothing else covers is `clean()` cross-field logic, `validate_constraints()` for a
`CheckConstraint` the database does not enforce, and `validate_unique()` for a uniqueness rule that
no database constraint backs.

That last one is the sharp edge. `validate_unique()` catches a duplicate that the schema does not:
a `unique=True` that was dropped, a constraint that is `condition`-gated and does not match the row,
or a rule written only in Python. With `save()` alone, nothing stops the duplicate from persisting.

## Do

- Validate, then write — at every boundary that accepts input for a model:
  ```python
  # Incorrect — save() writes it; only the database complains, later, as the wrong error type
  article = Article(title="x" * 5000, slug="dup", status="unknown")
  article.save()               # 200 OK, row written

  # Correct — validate, then write
  from django.core.exceptions import ValidationError

  try:
      article.full_clean()
  except ValidationError as e:
      return JsonResponse({"errors": e.message_dict}, status=400)
  article.save()
  ```
- Push the rule into a constraint when it must hold for every writer, including ones that never run
  your code. `CheckConstraint` costs nothing per row and the database enforces it:
  ```python
  class Article(models.Model):
      class Meta:
          constraints = [
              models.CheckConstraint(condition=~models.Q(status="unknown"), name="article_status_valid"),
          ]
  ```
- Centralise the call if there are many write paths. A `post_save` hook is the one place every
  write already passes through — with the caveat that it fires *after* the row is in the database,
  so a raise there is already too late for the row:
  ```python
  # Correct for bulk paths and scripts — one chokepoint rather than N call sites
  from django.db.models.signals import post_save

  def validate_on_save(sender, instance, **kwargs):
      if not kwargs.get("raw"):        # raw=True is loaddata; the row is not ours to judge
          instance.full_clean()

  post_save.connect(validate_on_save, sender=Article)
  ```
- In a serializer `create()`, validate after constructing but before saving, inside the transaction:
  ```python
  def create(self, validated_data):
      with transaction.atomic():
          obj = Article(**validated_data)
          obj.full_clean()
          obj.save()
          return obj
  ```

## Don't

- Infer that validation runs because it ran in the admin. `ModelForm` and the admin both call
  `full_clean()` for you. Management commands, Celery tasks, data migrations, DRF serializers
  writing to `.save()`, and any `Model(...)` built in a script all bypass it.
- Read a database rejection as validation. An over-long `CharField` surfacing as `IntegrityError`
  means the database caught something `clean_fields()` would have reported as a field error with the
  user's value attached.
- Assume `ModelSerializer` covers the model's stages. DRF validates serializer fields;
  `clean()` and `validate_constraints()` are not part of a `ModelSerializer`'s pipeline, and DRF's
  own docs tell you to call `full_clean()` explicitly for exactly that reason.
- Validate only where a user types. The write paths with no user are the ones that accumulate bad
  rows — imports, webhooks, background jobs.
- Treat `post_save` as a gate rather than a backstop. It is the right chokepoint for *catching*
  invalid rows; it is too late to prevent them, and an exception there leaves the row committed.
- Assume a `CheckConstraint` is enforced by the database. If you declared it `condition`-free and
  the backend supports it, the database enforces it; if you rely on `full_clean()` to check it
  instead, that is a Python rule every other writer can skip.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 200 OK, invalid row persisted | `save()` without `full_clean()` | Validate at the boundary; `CheckConstraint` for the durable rule |
| `IntegrityError` on a field the form rejects cleanly | Database enforcing `max_length`/`null` instead of `clean_fields()` | Call `full_clean()` so the error is a `ValidationError` |
| Duplicate rows the schema allows | `validate_unique()` skipped and no constraint backs the rule | Add a constraint, or validate explicitly |
| A `CheckConstraint` violated by a script | Rule only checked by `full_clean()` in the web path | Move the rule into the database |
| DRF accepts what the model would reject | `ModelSerializer` does not run model stages | Call `full_clean()` in `create()`/`update()` |
| Import writes bad rows silently | No form, no admin, no validation call | Add a `post_save` chokepoint or validate in the command |

## Verifying

```bash
# Every write path that constructs a model and saves it
grep -rn "\.save()" --include=*.py .

# The few places that actually validate
grep -rn "full_clean" --include=*.py .

# Cross-field and constraint rules declared in Python or the schema
grep -rn "def clean\|CheckConstraint\|UniqueConstraint\|validate_unique" --include=*.py .

# Writes that happen without a request in flight
grep -rln "loaddata\|manage.py\|@shared_task\|@app.task" --include=*.py .
```

The first two commands are the ratio that matters: `save()` call sites against `full_clean()` call
sites. Where the first outnumbers the second, validation is not a fact about the code, it is a fact
about whichever handlers happen to exist. No grep can tell you whether a `CheckConstraint` is
enforced by the database or only by a `full_clean()` call on one path — read the constraint
definitions and check for a backend that supports them.