---
title: "`strictNullChecks` decides whether `null` is a value at all"
rule_id: "RULE-TYPESCRIPT-003"
category: "correctness"
scope: "all"
applies_to: "strictNullChecks, strict, null, undefined, Partial, optional properties"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html"
---

# `strictNullChecks` decides whether `null` is a value at all

Whether `null` and `undefined` participate in the type system is not a stylistic preference — it
is a switch. With `strictNullChecks` off they are assignable to a property of *any* type, so every
nullability annotation in the codebase becomes decorative. Turning the flag off does not weaken the
checker; it removes the question.

## Why

The handbook states the dependency, then the consequence:

> How these types behave depends on whether you have the strictNullChecks option on.
> ([Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html))

> With strictNullChecks off, values that might be null or undefined can still be accessed normally,
> and the values null and undefined can be assigned to a property of any type. This is similar to
> how languages without null checks (e.g. C#, Java) behave. The lack of checking for these values
> tends to be a major source of bugs; we always recommend people turn strictNullChecks on if it's
> practical to do so in their codebase.
> ([Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html))

"a major source of bugs" is the handbook's own judgement. The flag is part of `strict`, but it is
also meaningful alone, and the trap is that adopting `strict: false` to pick up one other setting
silently turns this off too.

```typescript
// With strictNullChecks off — this assignment is legal and both fields are optional
interface Config { host: string; port: number }
const cfg: Config = { host: "localhost" };   // no error; port is undefined

// With strictNullChecks on — the annotation is enforced, or must be declared
interface Config { host: string; port: number }
const cfg: Config = { host: "localhost" };   // error: port is missing
const partial: Partial<Config> = { host: "localhost" };  // the honest type
```

Note that the off-case produces a `Config` whose `port` is `undefined` while its type says
`number`. Nothing in the type describes that state, so no consumer of `cfg` can defend against it.

## Do

- Keep `strict: true` in the base `tsconfig.json`, and set `strictNullChecks: true` explicitly even
  under `strict` so the value is visible where someone reads it.
- Turn it on per-package when the codebase is not ready, rather than leaving it off globally. The
  error count is the cost, and it falls at package boundaries where you can fix at design points.
- Model a genuinely optional field as optional (`port?: number`) or `Partial<T>`, instead of
  declaring it `number` and relying on the flag being off.
- Use `null` and `undefined` deliberately as distinct states, and document which one a field means.
  The compiler will make you choose.
- Run `tsc --noEmit --strict` in CI on a codebase that has not migrated, to measure the remaining
  gap rather than assume it.
- Prefer explicit `undefined` over `null` for "absent" unless the domain distinguishes them, and
  pick one per field.

## Don't

- Don't set `strict: false` to pick up a single compiler option. Every flag under `strict` switches
  back off with it, silently.
- Don't read `strictNullChecks: false` as "fewer type errors". It means the compiler stopped asking
  whether a value is there — the errors moved to runtime, unchanged in number.
- Don't annotate a field `T` when it can be absent, on the assumption that the flag is off. The
  annotation is a claim about the value, and it is wrong regardless of what the checker enforces.
- Don't assume a `!` is meaningful while the flag is off — see `RULE-TYPESCRIPT-009`; the
  assertion is what re-enables the check for that expression.
- Don't rely on `?.` as a fix for a wrong type. Optional chaining handles the read, not the wrong
  annotation behind it.
- Don't add `| undefined` to a field merely to silence an error. Ask whether the field is genuinely
  absent at runtime; if it never is, the annotation is the defect.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `undefined` where the type says `T` | Flag off; annotation unchecked | `strictNullChecks: true` |
| A required field silently missing | Same, on an object literal | Turn on the flag; model with `Partial<T>` |
| Hundreds of errors on enabling strict | Flag was never on | Migrate per package |
| `TypeError` on a field the types call mandatory | Annotation never enforced | Turn it on; fix the boundary |
| A `| null` union behaves as if null were impossible | Flag off | Same; the union is not being checked |

## Verifying

```bash
# 1. The flag itself, and the strict bundle that carries it
grep -rnE '"strict(NullChecks)?"' --include=tsconfig*.json --include=*.json . \
  | grep -v node_modules | head

# 2. `strict: false` anywhere -- the multi-flag trap
grep -rn '"strict":\s*false' --include=tsconfig*.json --include=*.json . \
  | grep -v node_modules | head

# 3. Fields typed `T` that are assigned from possibly-absent sources
grep -rnE '\?\.\s*$|\?\.\w+' --include=*.ts --include=*.tsx . | grep -v node_modules | head -20

# 4. Optional and Partial, for contrast -- the honest annotations
grep -rnE '\?:|Partial<' --include=*.ts --include=*.tsx . | grep -v node_modules | head -15

# 5. Settle it at the compiler -- the whole defect, two lines:
#    npx tsc --noEmit --strictNullChecks false
#    then in a scratch file:
#    interface C { port: number }
#    const c: C = {} as any as C;
#    declare const p: number;
#    const cfg: { port: number } = { port: p };
#    // flag off: no error.  flag on: error TS2322 (or the null-specific diagnostic).
```

What this check cannot see: step 1 and 2 read configuration files, and configuration is not what
the compiler necessarily used — `tsc` accepts explicit flags on the command line, IDEs inject their
own, and a build tool may synthesise a config that no file in the tree contains. So a green grep
here does not prove the flag was off at compile time. Step 3 finds optional chaining but cannot
tell a use that guards a genuinely-absent value from one compensating for a wrong annotation
downstream. The instrument that settles it is step 5: the same assignment compiling under one flag
and failing under the other is the only direct observation of what the switch actually controls.