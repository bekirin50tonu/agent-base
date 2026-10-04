---
title: "Assignability is checked against the declared type, not the observed one"
rule_id: "RULE-TYPESCRIPT-004"
category: "correctness"
scope: "all"
applies_to: "control flow analysis, narrowing, let, const, closure capture, mutation tracking"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html"
---

# Assignability is checked against the declared type, not the observed one

Control-flow analysis narrows what a variable *is* at each point, but it does not narrow what may
be *assigned* to it. Assignment is always validated against the declared type. So after narrowing a
`string | number` down to `number`, you can still assign a string to it — and the compiler accepts
it.

## Why

The handbook's own example names the rule:

> Notice that each of these assignments is valid. Even though the observed type of x changed to
> number after our first assignment, we were still able to assign a string to x. This is because
> the declared type of x - the type that x started with - is string | number, and assignability is
> always checked against the declared type.
> ([Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html))

This splits what most people assume is one mechanism into two. Narrowing is a *read* property that
follows control flow; assignability is a *write* property that does not. Two different rules, and
the second one is the one that produces silent failures.

```typescript
let x = Math.random() < 0.5 ? 10 : "hello world!";   // x: string | number
x = 1;
console.log(x);                                      // narrowed to number
x = "goodbye!";                                      // STILL VALID — checked against the union
x = true;                                            // error: not part of the declared type
```

`const` is the fix on the read side: a `const` declaration's declared type *is* its narrowest form,
so the write hole does not exist. But `const` does not help a value that is mutated indirectly, or
one whose alias escapes into a closure:

```typescript
// The closure-capture shape this enables: narrow now, assign later, no error
function f(items: string[] | null) {
  if (!items) return;
  const snapshot = items;      // snapshot: string[]
  return () => items.length;  // reads whatever `items` is at call time
}
```

`items` was narrowed by the guard, `snapshot` captured that narrowed view — but neither is a copy.
A later assignment inside the function, or a reassignment of a captured binding before the closure
runs, changes what both read. This is the mechanism behind stale-value bugs that carry a clean type.

## Do

- Use `const` unless you have a specific reassignment to make, and make it in the same scope where
  the reasoning is visible.
- Re-declare rather than re-assign when a variable's type should change: a fresh `const` has a
  fresh declared type, which closes the hole.
- Assume a narrowing holds only for as long as no assignment can occur — treat any narrowing
  followed by a function boundary as suspect.
- Capture a narrowed value in a `const` at the point of narrowing, and pass *that* to a closure, if
  you mean to close over the narrowed type.
- Read the compiler's inline annotation (the grey `(parameter) x: number` hint) as describing what
  may be **read** there — not what may be written.
- Use a discriminant property for state machines rather than union-of-literals plus reassignment.

## Don't

- Don't read narrowing as a constraint on assignment. It is not, and the union you declared is the
  real write surface.
- Don't let a `let` be narrowed in one function and reassigned in another, expecting the narrowing
  to follow. It is tracked per control-flow path, and only until an assignment.
- Don't assume a value captured in a closure is frozen at capture time. Only `const` on a primitive
  gives that.
- Don't rely on `const` to help with object property mutation — `const obj` freezes the binding, not
  `obj`'s fields.
- Don't treat the observed type shown in an editor as the type other code sees. It is path-specific.
- Don't mutate a parameter that a caller also holds; reassignment is allowed by the declared type,
  so the caller sees the new value with no signal.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A value read as `number` becomes a string downstream | Assignability checked against declared union | `const` + re-declare, or a discriminant |
| Closure sees a stale or unexpected value | Captured binding mutated after capture | Capture into a fresh `const` |
| Reassignment "shouldn't have compiled" | It was within the declared union | Narrow the declared type |
| A function param mutates and the caller is surprised | Parameters are mutable if declared so | `Readonly` params, or don't mutate |
| Type hint disagrees with what a caller can pass | Hint describes the read path | Check the declared type |

## Verifying

```bash
# 1. `let` bindings -- the write surface this rule widens
grep -rnE '^\s*let ' --include=*.ts --include=*.tsx . | grep -v node_modules | head -30

# 2. Narrowing followed by reassignment in the same function -- the exact pattern
grep -rnE '^\s*let .*=.*\|' --include=*.ts --include=*.tsx . | grep -v node_modules \
  | head -20

# 3. Reassigned parameters
grep -rnE '^\s*function \w+\([^)]*\b(\w+)\s*:\s*[A-Za-z]' --include=*.ts . \
  | grep -v node_modules | head -10

# 4. Closures capturing a narrowed binding
grep -rnE '=>.*\b\w+\.(length|map|filter|forEach)\b' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -15

# 5. Settle it at the compiler -- the whole defect, three lines:
#    declare let x: string | number = 1;
#    x = 1;          // ok
#    const y = x;    // y: number  (narrowed read)
#    x = "s";        // STILL OK -- declared type is the union
#    x = true;       // error TS2322 -- outside the union
```

What this check cannot see: steps 1–4 find the *syntactic* preconditions — a `let`, a closure, a
parameter — and all of them are legitimate in correct code, so the greps produce mostly false
positives. They cannot tell whether the value is actually reassigned after being captured, or
whether the union is wide because the code genuinely handles several cases. Nothing in the source
records that a read at line 40 and a write at line 41 are inconsistent; the compiler permits both.
Step 5 is the only place the asymmetry is directly observable, and even it demonstrates the
permission rather than a defect — deciding whether that permission matters requires knowing whether
the union was meant to be narrow.