---
title: "Pydantic v2 Drops Unknown Fields by Default; extra='ignore' Permits Everything"
rule_id: "RULE-FASTAPI-003"
category: "api-design"
scope: "backend"
applies_to: "Any Pydantic v2 model used as a FastAPI request body, settings source, or ORM write path"
last_updated: "2026-10-04"
source: "https://docs.pydantic.dev/latest/concepts/models/"
---

# Pydantic v2 Drops Unknown Fields by Default; extra='ignore' Permits Everything

The input boundary has a list of what is acceptable, the list is optional, and the default
behaviour for a field not on it is to drop it silently. That is the same shape as a mass-assignment
allowlist, reached from the other direction.

## Why

> By default, Pydantic models won't error when you provide extra data, and these values will simply
> be ignored:
> ([Pydantic models](https://docs.pydantic.dev/latest/concepts/models/))

```python
from pydantic import BaseModel


class Model(BaseModel):
    x: int


m = Model(x=1, y="a")
assert m.model_dump() == {"x": 1}
```
([Pydantic models](https://docs.pydantic.dev/latest/concepts/models/))

The three settings, and which one is the default:

> The configuration can take three values: `'ignore'`: Providing extra data is ignored (the default).
> `'forbid'`: Providing extra data is not permitted. `'allow'`: Providing extra data is allowed and
> stored in the `__pydantic_extra__` dictionary attribute.
> ([Pydantic models](https://docs.pydantic.dev/latest/concepts/models/))

The direction of the danger is worth stating precisely, because it is unusual: this fails **closed
on data and open on semantics**. A client sending a renamed field gets a `200`, and the value is
gone. No validation error, because the model *is* valid — it simply does not contain what was
sent. A `422` would have caught the rename at deploy time; instead the field arrives as `None`
downstream and the bug surfaces as a report that the form is empty.

Three concrete shapes, in increasing order of how long they take to find:

1. **A client/backend field rename, or a typo.** Validates. Every value arrives as `None`.
2. **A typo in your own schema.** `emial: str`. Every request validates, every value is `None`.
3. **Mass assignment from the raw request.** `User(**payload.model_dump())` is safe for fields the
   API schema does not have — they are simply absent from the dump. The unsafe direction is code
   that spreads the *raw* body instead of the validated model: there, a payload field the ORM model
   has becomes an unexpected write.

This survives review because `extra='ignore'` is genuinely correct for one real case: a newer
client sending a field an older server has not heard of should not fail. The rule is not to flip
the default globally — it is to know which side of that trade each endpoint is on, rather than
inheriting a default you did not choose.

And it compounds with the next failure mode in this family: if the parameter is annotated `dict`,
`extra` never applies at all, because there is no model to configure.

## Do

- Set `extra="forbid"` on request-body models, so an unknown field is a `422`:
  ```python
  class CreateUser(BaseModel):
      model_config = ConfigDict(extra="forbid")

      email: str
      name: str
  ```
- Scale it with a base class — three lines, no dependency, and it is the reason to prefer this over
  any global switch:
  ```python
  class StrictModel(BaseModel):
      model_config = ConfigDict(extra="forbid")

  class CreateUser(StrictModel):
      email: str
      name: str

  # Correct for PATCH — partial by definition; the mistake is requiring every field
  class UpdateUser(StrictModel):
      name: str | None = None
      email: EmailStr | None = None
  ```
- Declare an intentional passthrough as a typed field, so `forbid` can stay on:
  ```python
  # Correct — an untyped passthrough and an unvalidated passthrough are different things
  class CreateWithMetadata(StrictModel):
      email: str
      metadata: dict[str, Any] = {}
  ```
- Always spread the validated model into the ORM, never the raw body. That single habit is what
  keeps a schema/ORM mismatch from becoming an unexpected write.
- Apply the same reasoning to environment-variable sources. A typo'd variable is silently ignored
  there too — see `shared/python/settings-and-secrets.md`.

## Don't

- Inherit `extra='ignore'` without deciding it. It is defensible for forward compatibility and
  indefensible for a write path that drives an ORM insert.
- Expect a project-wide strict mode. Pydantic v2 has no switch that makes every model
  `extra='forbid'` — it is per `model_config`, which is exactly why the base class is the
  recommendation. FastAPI's app-level option covers *query parameters* only, a different surface.
- Treat an unknown-field 422 as a client bug to be silenced. It is the only signal that a rename
  happened; the resolution is a versioned API or explicit mapping at the edge, both of which are
  decisions rather than defaults.
- Generate models from the database and treat the result as an API schema. It inherits the table's
  columns, including ones you never meant to expose — pair it with an explicit allowlist.
- Assume `extra` still applies when a parameter is a `dict` or `Any`. There is no model, so there is
  no `extra` configuration and no validation at all.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 200, but the field is `None` downstream | Client or schema rename, dropped by `extra='ignore'` | `extra="forbid"` |
| Every value arrives empty, no errors | Typo in your own model's field name | Fix the field name; forbid extras so it 422s |
| An unexpected column is written | Raw request body spread into the ORM model | Spread the validated model |
| A 422 on a field the client legitimately added | `forbid` on a forward-compatible endpoint | Accept it explicitly, or version the API |
| An "arbitrary metadata" field rejected | Untyped passthrough relied on `extra='allow'` | Declare `metadata: dict[str, Any]` |
| `extra="forbid"` set but extras still accepted | Parameter annotated `dict` or `Any`, so no model applies | Annotate a real model |

## Verifying

```bash
# Every Pydantic model and the extra setting it carries
grep -rn "class .*(BaseModel)\|extra=" --include=*.py .

# Models with no extra setting at all — these are on the default
grep -rn -A3 "class .*BaseModel.*:" --include=*.py . | grep -v "extra="

# Parameters typed as a bare dict, where extra and validation both stop applying
grep -rn ": *dict\b\|: *Any\b\|Body(" --include=*.py .

# Writes that spread a raw payload rather than the validated model
grep -rn "\*\*request\.\|\*\*payload\|\*\*body" --include=*.py .
```

The first two commands are the audit: a model class with no `extra=` inside it is on `'ignore'`.
The third finds the parameters where no model exists at all, which `extra="forbid"` cannot reach.
The last is the mass-assignment check. None of them tells you whether a model that *does* set
`forbid` is the model actually bound to the endpoint — that is the signature, read.