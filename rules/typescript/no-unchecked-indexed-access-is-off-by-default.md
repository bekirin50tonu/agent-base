---
title: "`noUncheckedIndexedAccess` is off by default, so `arr[0]` is typed as present"
rule_id: "RULE-TYPESCRIPT-002"
category: "correctness"
scope: "all"
applies_to: "noUncheckedIndexedAccess, array index access, Record lookup, bounds checking, tsconfig"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/compiler-options.html"
---

# `noUncheckedIndexedAccess` is off by default, so `arr[0]` is typed as present

Indexed access on an array or a `Record` yields `T`, not `T | undefined`, unless
`noUncheckedIndexedAccess` is turned on — and it is **off** by default. A bounds check written for
a type error therefore compiles clean, and an out-of-range read becomes `undefined` at runtime with
no diagnostic.

## Why

The compiler options reference gives the option's entire effect in one line:

> Add undefined to a type when accessed using an index.
> ([tsc CLI Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html))

And records its default as `false`. That single word is the whole defect. The type `T[]` and the
value `[] | T[]` are described identically by the compiler unless the flag is on, so a read that
can return `undefined` is typed as `T`. This is the strictest kind of silent failure: not a wrong
value, but a value the compiler has *promised exists*.

```typescript
// Without the flag — compiles, and is undefined at runtime on a short array
function first(items: string[]): string {
  return items[0];
}

// With the flag — the compiler forces the check you actually needed
function first(items: string[]): string | undefined {
  return items[0];
}
```

```jsonc
// tsconfig.json — opt in; the safe form is not the default form
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true
  }
}
```

The same trap covers `Record<K, V>` and tuple-free destructuring, and it is the mechanism behind a
large share of `TypeError: Cannot read properties of undefined` reports that arrive with a fully
clean type-check.

## Do

- Set `noUncheckedIndexedAccess: true` in the base `tsconfig.json` for any project that indexes into
  arrays or records. It is the safe form; leaving it off is a choice, and an undocumented one.
- Add `| undefined` to any function that returns an index read, and handle the undefined at the
  call site with a guard or a default.
- Prefer `arr.at(0)` for the "may be absent" read — it returns `T | undefined` regardless of the
  flag, so it documents the intent locally.
- Use destructuring defaults (`const [first = fallback] = items`) where an absent first element
  has a sensible fallback.
- Use `for...of`, `entries()`, or `.map`/`.forEach` instead of a manual `for (let i = 0; i < n; i++)`
  counter — the iterator forms do not need a bounds check to be type-safe.
- Reach for `at()` over `arr[arr.length - 1]` for the last element; the `-1` case returns
  `undefined` and is easy to miss in review.

## Don't

- Don't assume an array index access is bounds-checked. It is not, by default, in either
  direction — `arr[-1]` is also typed `T`.
- Don't write a manual bounds check that exists only to satisfy a linter when the type system
  already claims the value is present — the check is a no-op that documents a misunderstanding.
- Don't use `arr[0]` as a "safe default" in a parser, decoder, or route handler where the input is
  externally controlled.
- Don't index a `Record<string, T>` and treat a missing key as a `T`. That is the same defect with
  a different container.
- Don't disable the flag to make an error go away. The error is real; turning the flag off makes the
  compiler stop telling you about it.
- Don't assume `as T` on an index read is safe — it is the same claim as `!` (see
  `RULE-TYPESCRIPT-009`) and carries the same runtime hazard.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: Cannot read properties of undefined` with a clean build | `arr[i]` typed `T`, returned `undefined` | Enable the flag; handle `undefined` |
| A "guaranteed" element missing after a filter | `filter` does not narrow the array type | Re-narrow, or use a type predicate |
| `arr[-1]` compiles | No negative-index check, by default | Enable the flag; use `at(-1)` |
| `Record` lookup returns a phantom value | Same flag, different container | Enable the flag |
| Turning on the flag produces hundreds of errors | It was never on; code was never checked | Enable per-package, fix at boundaries |

## Verifying

```bash
# 1. Is the flag set anywhere? -- the question the whole rule turns on
grep -rn 'noUncheckedIndexedAccess' --include=tsconfig*.json --include=*.json . \
  | grep -v node_modules | head

# 2. Direct index reads that assume presence -- including negative indices
grep -rnE '\w\[(-?[0-9]+|[a-z_$][a-zA-Z0-9_$]*)\]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -vE '\]\s*[),;]' | head -30

# 3. Reads on possibly-undefined collections, the shape that produces the runtime error
grep -rnE '\w+\??\.\w+\[[^]]+\]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 4. The safe idiom, for contrast
grep -rnE '\.at\(' --include=*.ts --include=*.tsx . | grep -v node_modules | head -10

# 5. Settle it at the compiler -- the whole defect, two lines:
#    npx tsc --noEmit --strict
#    then in a scratch file, with the flag OFF:
#    declare const xs: string[];
#    const a: string = xs[0];      // no error  -> the compiler promised presence
#    with the flag ON:
#    const b: string = xs[0];      // error TS2532/TS18048: possibly undefined
```

What this check cannot see: step 1 answers whether the flag is configured, not whether it is
actually taking effect — a `tsconfig.json` that sets it can be overridden by a nearer config, a
`tsc` invocation with explicit flags, or a build tool that supplies its own compiler options, and
no grep sees which one won. Steps 2 and 3 find *every* index read and cannot tell an
`arr[0]` that is guaranteed by an earlier length check from one that is not, so both the safe and
unsafe forms look identical. The instrument that settles it is step 5: compile the same line with
the flag off and on. That difference is the defect, and it is only observable in the compiler's
verdict, not in the source text.