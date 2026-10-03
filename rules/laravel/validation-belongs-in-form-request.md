---
title: "Validation Belongs in a FormRequest So the Action Method Has One Job"
rule_id: "RULE-LARAVEL-005"
category: "architecture"
scope: "backend"
applies_to: "Any inbound HTTP action that validates input, and any queued job whose handle() holds domain logic"
last_updated: "2026-10-03"
source: "https://github.com/alexeymezenin/laravel-best-practices,https://gist.github.com/jpswade/4c57a7caf7b2e130109579255538960e"
---

# Validation Belongs in a FormRequest So the Action Method Has One Job

The rule is that an action method should read as a single statement. In Laravel the enforcement
mechanism is a `FormRequest`, because it moves validation *and* authorization out of the controller
before the method body is entered.

## Why

The failure is not "the controller is too long". It is that the controller holds two kinds of
knowledge — *what shape the input must have* and *what the action should do* — and mixes them at
the point where the input is still untrusted. Every `if ($request->has(...))` branch is a decision
about input shape made by code whose job is a business action.

A `FormRequest` inverts the order. The input is validated and authorized before the controller
method is entered, so the body can assume a typed, authorized shape: `authorize()` returns the
policy decision, `rules()` returns the shape, and the controller is left with the action.

The naming rule is what actually keeps the codebase coherent. A form request is named for **one
operation** — `StoreOrderRequest`, `UpdateOrderRequest` — never for the entity it validates.
`UserFormRequest` invites a `$scenario` discriminator and becomes a switchboard over operations;
naming by operation makes the create and update variants siblings, which is what lets their rules
diverge where they genuinely differ. They always do: `password` is required on create and optional
on update.

The same principle appears on the queue side of the same codebase. The operator-supplied
`jpswade` gist (trust 0.85 — attributed opinion, not framework fact) puts it this way:

> ### Handle methods should contain very little code
>
> Both jobs and commands there are `handle()` functions. These should contain as little logic as
> possible, think of them as similar to controllers, they should be lightweight.
> ([jpswade gist](https://gist.github.com/jpswade/4c57a7caf7b2e130109579255538960e))

That is the job-side instance of the controller-side rule. A `handle()` holding domain logic is a
controller with the one saving grace removed — it has no request object to validate against, so
the logic is harder to test and harder to find, not easier.

## Do

- Validate and authorize in a request class named for the operation:
  ```php
  namespace App\Http\Requests;

  use Illuminate\Foundation\Http\FormRequest;

  class UpdateOrderRequest extends FormRequest
  {
      public function authorize(): bool
      {
          return $this->user()->can('update', $this->route('order'));
      }

      public function rules(): array
      {
          return [
              'status' => ['required', Rule::enum(OrderStatus::class)],
              'items'  => ['sometimes', 'array'],
              'items.*.sku' => ['required_with:items', 'string', 'exists:products,sku'],
          ];
      }
  }
  ```
  leaving the controller method as the action alone:
  ```php
  public function update(UpdateOrderRequest $request, Order $order)
  {
      $order->update($request->validated());
      return OrderResource::make($order);
  }
  ```
- Give `authorize()` a real policy call. Returning `true` unconditionally moves the decision
  somewhere else or nowhere, and a FormRequest that authorizes nothing is worse than no FormRequest
  because it looks checked.
- Keep `handle()` to coordination — fetch, delegate, dispatch — and push domain logic into an action
  class that takes typed arguments and no job instance.

## Don't

- Inline `$request->validate()` "because the endpoint is small." The inline form is correct at 30
  lines and unmanageable at 200, and nothing in the code marks the crossing. Teams that adopt
  "FormRequest when non-trivial" re-decide per endpoint forever, and record the decision nowhere.
- Name the class after the entity (`UserFormRequest`) or after the form (`UserForm`). Both invite a
  scenario discriminator; name the operation.
- Assume moving logic to a service makes inline validation fine. It is the same separation — logic
  moved out, validation left in, and the `Request` still reaches the method.
- Treat `authorize() { return true; }` as a placeholder you can leave. It is a decision, and it is
  the one the FormRequest exists to make explicit.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Controller grows a validation preamble before the action | Validation inlined rather than extracted | Extract to a request class named for the operation |
| One `UserFormRequest` with a `$scenario` switch | Named for the entity instead of the operation | Split into `StoreUserRequest` / `UpdateUserRequest` |
| Authorization bug reaches production | `authorize()` returns `true` | Delegate to the policy |
| Job logic untestable without a queue | Domain logic lives in `handle()` | Move it to an action class taking typed arguments |

## Verifying

```bash
# Controllers that still validate inline
grep -rn 'validate(' app/Http/Controllers/
# Request classes named after an entity rather than an operation
ls app/Http/Requests/
# Jobs whose handle() is long enough to hold logic
grep -rn -A 25 'function handle' app/Jobs/ | grep -c ''
```

The first grep finds inlined validation; the second is a naming review. The third is a rough size
signal only — it cannot tell logic from coordination, and that distinction is the part worth
reading.
