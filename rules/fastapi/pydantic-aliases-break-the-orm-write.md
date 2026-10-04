---
title: "A Validated Model Fills Field Names, Not Aliases; Model(**dump) Then Writes Nothing"
rule_id: "RULE-FASTAPI-007"
category: "correctness"
scope: "backend"
applies_to: "Any Pydantic v2 model declaring alias, validation_alias, or serialization_alias; any model_dump() spread into an ORM constructor or a Pydantic model; any code carried over from v1 using populate_by_name"
last_updated: "2026-10-04"
source: "https://docs.pydantic.dev/latest/concepts/alias/,https://docs.pydantic.dev/latest/concepts/fields/"
---

# A Validated Model Fills Field Names, Not Aliases; Model(**dump) Then Writes Nothing

Pydantic v2 has three separate alias settings, they default in opposite directions, and the
combination that reaches an ORM constructor is the one where the mistake does not raise. Validation
fills the **alias**; serialisation emits the **field name** unless told otherwise. `model_dump()` is
serialisation, so the dict it returns is keyed by field name — which is exactly what the ORM wants,
and exactly what breaks the moment one of the three settings is flipped.

## Why

The inbound and outbound directions use different names, and the defaults disagree:

> When validating data, you can enable population of attributes by attribute name, alias, or both.
> By default, Pydantic uses aliases for validation. Further configuration is available via:
> `ConfigDict.validate_by_alias`: `True` by default `ConfigDict.validate_by_name`: `False` by
> default
> ([Pydantic alias](https://docs.pydantic.dev/latest/concepts/alias/))

There are three ways to declare the names, and they apply to different directions:

> For validation and serialization, you can define an alias for a field. There are three ways to
> define an alias: `Field(alias='foo')` `Field(validation_alias='foo')`
> `Field(serialization_alias='foo')` The `alias` parameter is used for both validation and
> serialization. If you want to use different aliases for validation and serialization respectively,
> you can use the `validation_alias` and `serialization_alias` parameters, which will apply only in
> their respective use cases.
> ([Pydantic fields](https://docs.pydantic.dev/latest/concepts/fields/))

And the outbound direction defaults the other way:

> Note that the `by_alias` keyword argument defaults to `False`, and must be specified explicitly to
> dump models using the field (serialization) aliases.
> ([Pydantic fields](https://docs.pydantic.dev/latest/concepts/fields/))

That last sentence is the whole rule. A model declared `customer_id: int = Field(alias="customerId")`
accepts `Order(customerId=5)`, and its attribute is `customer_id`. `model_dump()` then returns
`{"customer_id": 5}` — which is correct, and is why the obvious code works. It stays correct until
someone adds `model_config = ConfigDict(serialize_by_alias=True)` to make one endpoint's response
match the incoming naming, and now the same `model_dump()` returns `{"customerId": 5}`, which is a
`TypeError` at the ORM constructor — loud, and the lucky case.

The silent case needs one more ingredient. With `validation_alias` only, `alias_priority` decides
which name wins, and a model-level `serialize_by_alias` changes the dump for **every** field at once:

> At the same time, the `validation_alias` will have priority over `alias` for validation, and
> `serialization_alias` will have priority over `alias` for serialization.
> ([Pydantic fields](https://docs.pydantic.dev/latest/concepts/fields/))

So the same two-line change turns a working write into one of three outcomes depending on which
booleans are set: correct, `TypeError`, or — when `extra="ignore"` is in play and the ORM constructor
accepts a `**kwargs` it does not recognise — a row written with the field absent and the ORM default
(`None`, `0`, `""`) filled in. Three booleans, three behaviours, none of them consistent with the
previous deploy.

### The v1 name is the usual way in

`populate_by_name=True` is Pydantic v1's setting for this. In v2 it is not a config key at all, so
setting it is not an error — it is collected into the model config and ignored. The model then runs
with v2 defaults, and the code that read correct under v1 does something else under v2. The check is
one grep, and it is the highest-value grep in this rule.

## Do

- Keep aliases on the wire model and use a separate internal model for the write. One model cannot be
  both "accepts the client's naming" and "produces the ORM constructor's kwargs" without
  configuration, and the configuration is what fails:
  ```python
  class OrderIn(BaseModel):                     # wire shape, alias lives here
      model_config = ConfigDict(populate_by_name=True)
      customer_id: int = Field(validation_alias="customerId")

  class OrderCreate(BaseModel):                 # internal shape, no aliases at all
      customer_id: int
      total_cents: int

  @app.post("/orders", response_model=OrderOut)
  def create_order(payload: OrderIn, db: Session = Depends(get_db)):
      data = OrderCreate(**payload.model_dump())   # explicit, and the assert below holds
      order = OrderORM(**data.model_dump())
      db.add(order)
      db.commit()
      return order
  ```
  Two models for one resource is duplication, and it is the price of not making the persistence
  write depend on a serialisation setting.
- When a model genuinely needs both directions, set both settings explicitly on it and on nothing
  else, so the reason is visible at the class:
  ```python
  class Order(BaseModel):
      model_config = ConfigDict(validate_by_alias=True, validate_by_name=True)
      customer_id: int = Field(validation_alias="customerId")
  ```
- Assert the dumped keys in a test. This is what catches a later `serialize_by_alias` before it
  reaches a row:
  ```python
  def test_order_write_shape():
      assert set(OrderIn(customerId=5).model_dump()) == {"customer_id"}
  ```
- Assert on the **persisted** value when a field has an ORM default, because "the write succeeded"
  and "the write stored what was sent" are different claims:
  ```python
  db.add(order); db.commit(); db.refresh(order)
  assert order.customer_id == 5     # not just order.id is not None
  ```

## Don't

- Carry `populate_by_name` across from v1. In v2 it is an unknown key, silently ignored, and the
  model runs on defaults you did not choose.
- Use the same `model_dump()` for the ORM write and for the API response. They are two call sites
  with two different required shapes, and `by_alias` is a per-call argument precisely because they
  differ.
- Set `serialize_by_alias=True` at the app or model level to "make output match input". It changes
  every dump from that model, including the ones feeding constructors and log lines.
- Spread a dump into an ORM model that takes `**kwargs`. That turns a `TypeError` — the outcome you
  want — into a row with a default-filled column.
- Assume a `TypeError` is the failure mode. It is the best one. The silent outcomes are a
  `NULL`/default column and a downstream consumer reading `None` where the value was sent.
- Use `sqlmodel` to collapse the two models. Its `Field` is Pydantic's `Field`, so the alias
  behaviour is identical rather than solved; what it removes is the duplication, at the cost of
  coupling the API schema to table columns — which is the leak `RULE-FASTAPI-002` describes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError` at `OrderORM(**model.model_dump())` | `serialize_by_alias=True` changed the dump keys | Dump without `by_alias` for the write |
| Column is `NULL`/`0`/`''` after a "successful" create | Alias dump silently dropped the field | Persisted-value assertion; explicit internal model |
| `populate_by_name=True` has no effect | v1 key, ignored by v2 | `validate_by_name=True` |
| Model rejects its own field name | `validate_by_name` is `False` by default | Set `validate_by_name=True` if the name must be accepted |
| Response keys changed after an unrelated edit | Model-level `serialize_by_alias` | `by_alias=True` per response call site |
| Test passes, integration write is wrong | Test asserted the model, not the row | Assert after `refresh()` |

## Verifying

```bash
# The v1 key, which v2 ignores — the single highest-value check in this rule
grep -rn "populate_by_name" --include=*.py .

# Every alias declaration
grep -rn "alias=\|Alias(" --include=*.py .

# Dumps feeding a constructor rather than a response — these are the write paths
grep -rn "\*\*.*model_dump\|\*\*payload\.model_dump\|\*\*data\.model_dump" --include=*.py .

# Model-level settings that change every dump from that model
grep -rn "serialize_by_alias\|validate_by_alias\|validate_by_name\|by_alias=" --include=*.py .
```

The first command finds the settings that are doing nothing. The second and fourth show every place
the three booleans are decided, which is a small enough set to read in full and to review on
purpose. The third is the audit — every hit is a write whose field names are decided by a
serialisation setting rather than by the model. Nothing here can tell you whether a dumped key
matches the ORM column it is meant to fill; that is the model definition.