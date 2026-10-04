---
title: "`in` narrowing keeps optional properties in both branches"
rule_id: "RULE-TYPESCRIPT-005"
category: "correctness"
scope: "all"
applies_to: "in operator, narrowing, discriminated unions, optional properties, state machines"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html"
---

# `in` narrowing keeps optional properties in both branches

`in` narrowing partitions a union by *whether a property is present*. A member with an **optional**
property has that property present on both sides, so it survives the narrowing in both branches.
The narrowing looks like it discriminated; it did not.

## Why

The handbook states the behaviour and then shows it with a worked example:

> JavaScript has an operator for determining if an object or its prototype chain has a property with
> a name: the in operator. TypeScript takes this into account as a way to narrow down potential
> types.
> ([Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html))

> To reiterate, optional properties will exist in both sides for narrowing. For example, a human
> could both swim and fly (with the right equipment) and thus should show up in both sides of the
> in check:
> ([Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html))

Read the second one carefully: the handbook is *stating this as correct*, not warning about it. A
`Human` with optional `swim` and `fly` genuinely can satisfy either check, so the compiler keeps it
in both sides.

```typescript
type Fish = { swim: () => void };
type Bird = { fly: () => void };
type Human = { swim?: () => void; fly?: () => void };

function move(animal: Fish | Bird | Human) {
  if ("swim" in animal) {
    animal;      // (parameter) animal: Fish | Human   <- Human survives
  } else {
    animal;      // (parameter) animal: Bird | Human   <- Human survives here too
  }
}
```

The residue is the defect. Code that assumes the check discriminated will call `animal.fly()` on a
member that may still be a `Human` with no `fly` — and the optional property is `() => void | undefined`,
so the call site needs another `!` or `?.` that quietly converts the gap into a `TypeError`.

## Do

- Use a **discriminant** — a required literal-typed property such as `kind: "fish" | "bird" | "human"`
  — when the branches must be mutually exclusive. Discriminant narrowing partitions cleanly.
- Make the property you narrow on **required** on every member of the union if you want `in` to
  discriminate. `swim: () => void` on `Human` removes it from the `false` branch.
- Read the compiler's inline hint in each branch before relying on it. It is authoritative and it
  is right there.
- Reach for a schema validator (zod, valibot) when the object came from outside the program. Its
  discriminated output removes the residue by construction.
- Assert the exhaustive case explicitly with `assertNever(x)` in the default branch, so a new union
  member is a compile error rather than a silently unhandled case.
- Distinguish "may not have this property" from "does not have this property" with two separate
  optionality mechanisms if the distinction matters to your logic.

## Don't

- Don't read an `in` check as a proof of exclusion. It proves presence; the other branch is "not
  proven present", which is weaker.
- Don't build a state machine out of optional-property unions narrowed by `in`. The partition
  never closes, so the number of reachable-but-impossible states is not zero.
- Don't call `animal.fly()` in a branch without checking the inline type hint. It compiles because
  of the optional property, not because the branch guarantees it.
- Don't add `!` to force the call. That converts the residue into a runtime `TypeError` at exactly
  the case the narrowing failed to exclude.
- Don't use `in` as an existence test on a `Record` and expect narrowing to follow. `in` narrows a
  *union*; it does not turn an index access into a defined value (see `RULE-TYPESCRIPT-002`).
- Don't assume two independent `in` checks multiply cleanly — they narrow against the type already
  narrowed, and optional members follow the same rule at each step.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: x.fly is not a function` in an `in` branch | Optional property kept the member | Discriminant, or required property |
| A branch is unreachable in reality but compiles | Residue member in the union | `assertNever` in the default branch |
| Calling an optional method needs `!` | Narrowing did not make it required | Fix the model, not the call site |
| A state machine handles a state it says it excludes | Same | Discriminant property |
| `in` narrowing produces no useful result | Members are all optional for the property | Required or discriminant |

## Verifying

```bash
# 1. `in` narrowing sites -- where the partition is claimed
grep -rnE "['\"]\w+['\"]\s+in\s+\w+" --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -30

# 2. Optional properties in type literals -- the residue producers
grep -rnE '\w+\?\s*:\s*\(' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 3. Discriminants, for contrast -- the clean partition
grep -rnE '\bkind\s*:\s*["'\'']' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -15

# 4. Exhaustiveness assertions -- where the residue would be caught
grep -rn 'assertNever\|: never\|never)' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -10

# 5. Settle it at the compiler -- the whole defect, four lines:
#    type F = { swim: () => void };  type B = { fly: () => void };
#    type H = { swim?: () => void; fly?: () => void };
#    declare function m(a: F | B | H) {
#      if ("swim" in a) { a; /* hover: F | H  <- H survives */ }
#      else            { a; /* hover: B | H  <- H survives */ }
#    }
#    then make swim required on H and watch H leave the else branch.
```

What this check cannot see: steps 1 and 2 find `in` checks and optional properties *separately*,
so they cannot tell you which optional properties belong to the union being narrowed at that site —
the correlation that produces the defect is not visible in either grep alone, and the number of
optional properties in a file says nothing about whether any of them reach an `in` branch. Step 3
finds discriminants but does not verify they are exhaustive or unique across the union. The
instrument that settles it is step 5: hovering the narrowed type in each branch is the only place
the residue is directly observable, and it cannot be inferred from the source text.