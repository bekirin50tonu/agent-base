---
title: "`any` is assignable in both directions, so it is not a type"
rule_id: "RULE-TYPESCRIPT-001"
category: "correctness"
scope: "all"
applies_to: "any, unknown, type assertion, JSON.parse, unchecked return types"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/type-compatibility.html"
---

# `any` is assignable in both directions, so it is not a type

`any` is the most permissive type in TypeScript and the only one that erases checking in both
directions at once. One `any` in a return type makes everything downstream of it unchecked, and the
loss is invisible: nothing is red, nothing is logged, the build passes.

## Why

The handbook defines unsoundness as the property this produces:

> TypeScript's type system allows certain operations that can't be known at compile-time to be
> safe. When a type system has this property, it is said to not be "sound".
> ([Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html))

And then states the specific asymmetry that separates `unknown` from `any`:

> Everything is assignable to itself.
> any and unknown are the same in terms of what is assignable to them, different in that unknown is
> not assignable to anything except any.
> ([Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html))

Read that twice. `unknown` and `any` are identical **inbound** — anything can be assigned to
either. They differ **outbound**: `unknown` cannot be assigned to anything except `any` (and
itself), so it is inert until you narrow it. `any` is inert in neither direction, which is what
makes it contagious. Assign `any` to a variable and every property access on it type-checks,
including the ones you misspelled.

```typescript
// Incorrect — `any` erases checking in both directions at once
function parse(input: string): any {
  return JSON.parse(input);   // no error, anywhere downstream
}
const user = parse(raw);      // user: any
user.name.typo.still.compiles // every property access succeeds

// Correct — `unknown` is equally permissive inbound and inert outbound
function parse(input: string): unknown {
  return JSON.parse(input);
}
const user = parse(raw);             // user: unknown
if (typeof user === "object" && user !== null && "name" in user) {
  console.log(user.name);            // narrowed before use
}
```

`JSON.parse` is the single most productive source of `any` in a codebase, and it is the return
type of a *standard library* function, so it arrives without anyone writing `: any`.

## Do

- Type every value that crosses a trust boundary as `unknown`, and narrow before use. This costs
  three lines and removes the entire class.
- Treat `any` in a **return** position as a defect, not a convenience. An `any` return propagates
  to every caller; an `any` parameter usually does not escape.
- Annotate `JSON.parse` results as `unknown` at the call site rather than letting the return type
  flow on.
- Use a schema validator (zod, valibot) at the boundary where the value enters, and let it produce
  the type. That is a stronger guarantee than narrowing by hand, because it fails loudly.
- Run the `noImplicitAny` check for *implicit* `any`. This rule is about *explicit* `any`, which
  that flag does not catch.
- Prefer `unknown` in generic positions (`T extends unknown`) so callers cannot widen your API.

## Don't

- Don't use `any` as an escape hatch when the compiler is right. The error is information; `any`
  deletes it.
- Don't annotate a return type as `any` "temporarily" — nothing marks the temporary, and every
  caller inherits it.
- Don't write `as any` to silence a mismatch between a domain type and a library type. That
  converts a compile error into a runtime one at the boundary where you can least afford it.
- Don't use `any` for "I haven't decided the shape yet." Use `unknown` and narrow, or an empty
  interface with a TODO.
- Don't accept `any` in a public API — it makes the whole downstream graph unchecked.
- Don't assume `any` is caught by lint. `@typescript-eslint/no-explicit-any` exists but must be
  enabled; the compiler never errors on explicit `any`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A misspelled property access compiles | Value is `any` | `unknown` + narrowing at the boundary |
| A whole module has no errors after one edit | `any` in an upstream return type | Trace the return type; annotate it `unknown` |
| `JSON.parse` result silently malformed | Return type is `any` | Cast to `unknown`, then validate |
| A type error reappears as a `TypeError` in production | `as any` on a boundary | Validate instead of asserting |
| Lint passes but nothing is type-safe | `no-explicit-any` not enabled | Enable the rule; see Verifying step 3 |

## Verifying

```bash
# 1. Explicit `any` in type positions -- the rule's own subject
grep -rnE ':\s*any\b|<any>|as any|Array<any>|any\[\]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -30

# 2. JSON.parse without an `unknown` annotation at the call site
grep -rn 'JSON.parse(' --include=*.ts --include=*.tsx . | grep -v node_modules \
  | grep -v 'as unknown' | head -20

# 3. Is the lint rule that catches #1 actually enabled?
grep -rn 'no-explicit-any' --include=*.json --include=*.js --include=*.cjs . \
  | grep -v node_modules | head -5

# 4. `any` in a return position -- the contagious position
grep -rnE '\)\s*:\s*any\b' --include=*.ts --include=*.tsx . | grep -v node_modules | head -20

# 5. Settle it at the compiler -- the whole defect, two lines:
#    npx tsc --noEmit --strict 2>&1 | head
#    then in a scratch file:
#    declare const a: any;  a.typo.nested.deeper.compiles   // no error
#    declare const u: unknown;  u.typo                      // error TS18046
```

What this check cannot see: steps 1, 2 and 4 find `any` by name, so they cannot tell an `any` that
came from a deliberate boundary decision from one that arrived by accident through
`JSON.parse` or an untyped third-party package — they find both identically. Step 3 tells you
whether the rule is configured, not whether it passes. The instrument that settles it is step 5:
`unknown` failing where `any` succeeds is the only direct observation of the difference, and a
grep cannot observe a difference in what compiles.