---
title: "The Return Annotation Is the Output Allowlist; Without One, Every Attribute Ships"
rule_id: "RULE-FASTAPI-002"
category: "security"
scope: "backend"
applies_to: "Any FastAPI endpoint that returns a database model, a dict built from one, or any object with attributes; and any endpoint whose response shape is asserted only as a subset"
last_updated: "2026-10-04"
source: "https://fastapi.tiangolo.com/tutorial/response-model/"
---

# The Return Annotation Is the Output Allowlist; Without One, Every Attribute Ships

A FastAPI endpoint with no return annotation is not untyped — it is **unfiltered**. `jsonable_encoder`
walks whatever object you hand it and serialises every attribute it finds, so the response shape is
whatever the object's class happens to contain today.

## Why

The return type does four jobs. The fourth is the one with a security consequence:

> FastAPI will use this return type to: **Validate** the returned data. If the data is invalid (e.g.
> you are missing a field), it means that your app code is broken, not returning what it should,
> and it will return a server error instead of returning incorrect data. This way you and your
> clients can be certain that they will receive the data and the data shape expected. Add a **JSON
> Schema** for the response, in the OpenAPI path operation. This will be used by the **automatic
> docs**. It will also be used by automatic client code generation tools. **Serialize** the returned
> data to JSON using Pydantic, which is written in **Rust**, so it will be **much faster**. But most
> importantly: It will **limit and filter** the output data to what is defined in the return type.
> This is particularly important for **security**, we'll see more of that below.
> ([FastAPI response model](https://fastapi.tiangolo.com/tutorial/response-model/))

Validation, schema, and serialisation are the three most visible jobs, which is why the fourth gets
skipped. But an endpoint with no declared return type gets none of them — it is not that FastAPI
validated and found nothing to filter, it is that there was no filter to run.

The docs' own example of the failure is a model reused across two operations:

> Here we are declaring a `UserIn` model, it will contain a plaintext password
> ([FastAPI response model](https://fastapi.tiangolo.com/tutorial/response-model/))

> Now, whenever a browser is creating a user with a password, the API will return the same password
> in the response.
> ([FastAPI response model](https://fastapi.tiangolo.com/tutorial/response-model/))

> But if we use the same model for another path operation, we could be sending our user's passwords
> to every client.
> ([FastAPI response model](https://fastapi.tiangolo.com/tutorial/response-model/))

The systematic version is worse than that example, because it needs no mistake at all: return the
ORM object directly. It is correct on day one, and it leaks a new column every time the schema
grows. No schema diff, no failing test, no OpenAPI change — the generated client types are unchanged
because there was no declared type to change.

### The second failure arrives while fixing the first

Adding `response_model=Item` to an endpoint that returns a `dict` assembled from several models
silently **drops every key the model does not declare**. The endpoint keeps working, keeps returning
200, and returns less than it did. Nothing warns, because the filtering is the documented
behaviour — it is the same mechanism, pointed at a different mistake.

## Do

- Declare a response model that exists to be the allowlist, separate from the ORM model:
  ```python
  class UserOut(BaseModel):
      model_config = ConfigDict(from_attributes=True)

      id: int
      name: str

  # Correct — the annotation is both the schema and the allowlist
  @app.get("/users/{uid}", response_model=UserOut)
  def get_user(uid: int, db: Session = Depends(get_db)):
      return db.get(User, uid)
  ```
  `from_attributes=True` is required because the object is an ORM instance rather than a dict;
  Pydantic v2 will not read attributes off an arbitrary object without it.
- Assert the exact key set in a test. This is what makes the allowlist survive future columns, and
  it is one line — cheaper than any dependency:
  ```python
  def test_get_user_response_shape(client):
      body = client.get("/users/1").json()
      assert set(body) == {"id", "name"}    # exact set, not a subset check
  ```
- When `response_model` filters away a key you needed, add the key to the model. That is the
  mechanism working, and the fix is a declaration you can review.
- Use one input model and one output model per resource even when they are identical today. The
  split is what makes "which fields leave the process" a question with an answer.

## Don't

- Return a database model without a response model. Not "today's model has no secrets" — the
  failure mode is a column added for an unrelated reason, so the real question is whether adding
  one requires remembering this endpoint.
- Assert response shape as a subset (`assert "id" in body`). A subset assertion passes for ever,
  which is precisely the property that makes it useless here.
- Assume an explicit `dict` return is the same protection. The dict literal is the allowlist and it
  is reviewed — but nothing catches a key added to that literal later, the endpoint is still
  `Any` in OpenAPI, and generated clients are still untyped.
- Use the input model as the response model because the fields match. That is the docs' example of
  the leak, not a shortcut past it.
- Reach for a code generator to solve this. A generated `FromAttribute` wrapper derives from the ORM
  model and inherits every field, so it reproduces the leak unless someone deletes columns by hand.
  `sqlmodel` genuinely collapses the input/output split, at the cost of coupling `response_model`
  filtering to table columns — a real trade, not a free win.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A new column appears in responses with no deploy diff | Endpoint returns the ORM object with no `response_model` | Declare a dedicated output model |
| Password or internal field in a response | Input model reused as the response model | Separate `UserIn` from `UserOut` |
| Response silently lost keys after adding `response_model` | Filtering dropped undeclared keys | Declare them in the response model |
| OpenAPI types are `Any` and generated clients are untyped | No return annotation, or a plain `dict` | Annotate with the output model |
| A generated model leaks fields anyway | It inherits the ORM model's fields | Write the output model by hand |
| A leak reaches production despite tests | Tests assert a subset of the response | Assert the exact key set |

## Verifying

```bash
# Route handlers with no return annotation — the endpoints with no allowlist
grep -rn -A2 "@app\.\(get\|post\|put\|patch\|delete\)(" --include=*.py . | grep "^\S*-\s*\(async \)\?def "

# Returns of a database model or ORM object
grep -rn "return db\.\|return session\.\|\.all()\|\.first()" --include=*.py .

# Response shapes asserted as a subset rather than an exact set
grep -rn "assert.*in .*\.json()\|assert.*\.keys()" --include=*.py .

# Output models, and whether they are distinct from the input models
grep -rn "class .*(BaseModel)" --include=*.py .
```

The first command is the audit: every hit is an endpoint whose response shape is decided by whatever
object it happens to return. The fourth tells you whether there is even a model to point
`response_model` at. Neither grep can tell you whether a declared model matches the data being
returned — a response model that omits a field is invisible to both.