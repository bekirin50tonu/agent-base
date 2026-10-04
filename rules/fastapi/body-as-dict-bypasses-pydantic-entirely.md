---
title: "A Body Parameter Typed dict Skips Pydantic, the Schema, and the Allowlist"
rule_id: "RULE-FASTAPI-004"
category: "api-design"
scope: "backend"
applies_to: "Any FastAPI path operation whose body parameter is annotated dict, dict[str, Any], or Any; and any -> dict return annotation"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/fastapi/fastapi/master/fastapi/dependencies/utils.py,https://fastapi.tiangolo.com/tutorial/body/"
---

# A Body Parameter Typed dict Skips Pydantic, the Schema, and the Allowlist

The `extra='forbid'` allowlist has a bypass, and the bypass is a one-word type annotation. Nothing
warns, and the docs mention `dict` only as an editor inconvenience you can live without.

## Why

FastAPI decides whether a parameter is a body field by asking whether its annotation is scalar:

```python
        elif not field_annotation_is_scalar(annotation=type_annotation):
            field_info = params.Body(annotation=use_annotation, default=default_value)
        else:
            field_info = params.Query(annotation=use_annotation, default=default_value)
```
([FastAPI `dependencies/utils.py`](https://raw.githubusercontent.com/fastapi/fastapi/master/fastapi/dependencies/utils.py))

`dict` is not a scalar, so `dict` is accepted as a perfectly ordinary body field. The docs frame the
cost in terms of tooling you give up:

> In your editor, inside your function you will get type hints and completion everywhere (this
> wouldn't happen if you received a `dict` instead of a Pydantic model)
> ([FastAPI request body](https://fastapi.tiangolo.com/tutorial/body/))

What you actually give up is larger, and the docs list the benefits you forfeit:

> Generate JSON Schema definitions for your model, you can also use them anywhere else you like if it
> makes sense for your project.
> ([FastAPI request body](https://fastapi.tiangolo.com/tutorial/body/))

> Those schemas will be part of the generated OpenAPI schema, and used by the automatic
> documentation UIs.
> ([FastAPI request body](https://fastapi.tiangolo.com/tutorial/body/))

So, concretely, what stops happening:

1. **Validation.** `dict[str, Any]` accepts any JSON object — no type check, no required field, no
   coercion, no length limit.
2. **The write allowlist.** `extra` is a *model* config. With a `dict` there is no model, so there is
   nothing to forbid and nothing to ignore. The whole question is gone (see `RULE-FASTAPI-003`).
3. **The OpenAPI schema.** The schema for `dict[str, Any]` is a bare object with no properties.
   Generated clients get `Any` and validation becomes the client's problem.
4. **The output allowlist, symmetrically.** A `-> dict` return annotation gives you no filter either;
   `jsonable_encoder` serialises whatever is in the dict.

The result is an endpoint that is fully documented in OpenAPI, fully typed in the sense that mypy
is satisfied, and validates nothing on either side.

### The distinction that matters in review

**Is the shape unknown, or is the shape just not written down yet?** If the second, a `dict`
annotation converts a compile-time gap into a runtime gap, and it will still be there in a year.
`payload: dict[str, Any]` is idiomatic enough to pass review without anyone asking the question.

There is a security variant worth naming: a `dict` fed into something that does `payload["role"] =
"admin"` or `Model(**payload)` accepts every extra field the client sent. On a target model with
`extra="forbid"` that would have been a `422`. With a `dict` there is no model to forbid it — this is
exactly the path `extra` exists to close.

## Do

- Write the model. It is a dozen lines and no dependency, and it recovers all four of the above:
  ```python
  class CreateOrder(BaseModel):
      model_config = ConfigDict(extra="forbid")

      sku: str
      quantity: int = Field(ge=1)
      notes: str | None = None

  # Correct — validates, documents, and forbids unknown fields
  @app.post("/orders")
  def create_order(payload: CreateOrder):
      return OrderService.create(payload)
  ```
- When the shape really is arbitrary, keep the model and declare the parts you know — this is
  strictly better than a bare `dict`:
  ```python
  class WebhookEnvelope(BaseModel):
      model_config = ConfigDict(extra="allow")   # explicit, and now a decision

      event: Literal["order.created", "order.cancelled"]
      id: str

  @app.post("/webhooks")
  def receive(payload: WebhookEnvelope):
      ...   # payload.event and payload.id are typed; payload.model_extra is not
  ```
- Use a discriminated union on the discriminating field when a partner's payload varies per event
  type. That covers the last case where a bare `dict` would win, and it is typed.
- Validate a payload you only have as a dict — at a non-FastAPI boundary — with Pydantic's
  `TypeAdapter`. It ships with Pydantic, so this is still no new dependency:
  ```python
  adapter = TypeAdapter(list[Order])
  orders = adapter.validate_python(raw)
  ```

## Don't

- Annotate `dict` or `Any` to avoid writing a model. That is the common case and the reason this
  annotation exists in a codebase; the shape is not unknown, it is just unwritten.
- Treat "internal only" as a reason. The endpoint is internal until the first consumer appears, and
  by then the generated client types are `Any` and nobody remembers.
- Assume `extra="forbid"` on a downstream model still protects you. It protects against unknown
  *fields on a model*; a raw dict arriving at `Model(**payload)` is expanded into that model, and
  the constraint applies only once a model is involved at the boundary.
- Rely on `-> dict` as an output declaration. It is not a filter — it is an instruction to serialise
  the dict as-is.
- Install a code generator as a permanent build step to solve this. Generating request models from
  a sample payload is useful for *migration* — and its own risk is that it infers types from one
  example, so an `id` that is sometimes an int becomes a field that 422s in production. Writing the
  model is faster at any realistic number of endpoints.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Endpoint is fully documented and validates nothing | Body annotated `dict` / `dict[str, Any]` | Declare a model |
| Generated client types are `Any` | No properties in the schema for a bare object | Declare a model |
| Client sends a renamed field, gets 200, value gone | No model, so no `extra` config exists | Declare a model with `extra="forbid"` |
| `extra="forbid"` present but extras accepted | The parameter is a `dict`, so no model is bound | Annotate a real model |
| A required field arrives missing | No required-field check without a model | Declare the field as required |
| A `422` in production on a field that "is always a string" | A generator inferred the type from one sample | Review generated types; write them by hand |

## Verifying

```bash
# Body parameters typed as a bare dict or Any — no model, so no validation
grep -rn ": *dict\[\?[^)]*Any\]\?\|: *Any\b" --include=*.py .

# Return annotations that declare no output model
grep -rn "^\s*\(async \)\?def .*) *-> *dict\b" --include=*.py .

# Endpoints that should have a model but declare none
grep -rn -A3 "@app\.\(post\|put\|patch\)(" --include=*.py . | grep "payload\|body"

# The models that do exist, for comparison
grep -rn "class .*(BaseModel)" --include=*.py .
```

The first and second commands are the audit — each hit is a boundary where validation, the schema,
or the allowlist silently does not apply. The fourth shows what a real model looks like in this
codebase, which is the fastest way to tell whether the others are an oversight or a convention.
Nothing here tells you whether a declared model matches what a caller actually sends.