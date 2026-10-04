---
title: "The non-null assertion `!` changes no runtime behaviour"
rule_id: "RULE-TYPESCRIPT-009"
category: "correctness"
scope: "all"
applies_to: "non-null assertion, as, type assertion, optional chaining, Map.get, DOM queries"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html"
---

# The non-null assertion `!` changes no runtime behaviour

`!` and `as` are type-level only. The handbook is explicit that they remove `null` and `undefined`
from a type without performing any check — and that they do not change what the code does at
runtime. A `!` is a claim, never a guard.

## Why

The handbook states both halves — what it removes, and what it does not do:

> TypeScript also has a special syntax for removing null and undefined from a type without doing any
> explicit checking. Writing ! after any expression is effectively a type assertion that the value
> isn't null or undefined
> ([Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html))

> Just like other type assertions, this doesn't change the runtime behavior of your code, so it's
> important to only use ! when you know that the value can't be null or undefined.
> ([Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html))

That is why `!` is the correct tool in exactly one place — immediately after a check the compiler
cannot see — and the wrong tool everywhere else. Everywhere else it converts a compile error you
*would have received* into a `TypeError` you *will* receive, at runtime, in production, from input
you did not control.

```typescript
// The documented hazard — no check was performed
function liveDangerously(x?: number | null) {
  console.log(x!.toFixed());   // no error; throws if x is actually null
}
```

```typescript
// The documented use — the check happened, the compiler just cannot see it
const el = document.getElementById("root");
if (el === null) throw new Error("missing #root");
el.classList.add("ready");   // narrowed by the guard above

// Correct — use the assertion only where a real check precedes it
const user = map.get(id);
if (!map.has(id)) throw new Error(`unknown id ${id}`);
console.log(user!.name);       // sound: has() proved presence
```

The `map.get` case is the honest one, and it is worth being precise about why: `Map.get` returns
`T | undefined` even though `has` already proved the key exists, and the compiler cannot connect
the two calls. The assertion documents a fact established thirty characters earlier.

## Do

- Use `!` only where a check the compiler cannot see has just proven the value is present —
  `Map.get` after `has`, a validated DOM node, a value a framework guarantees.
- Prefer a real narrowing construct where one exists. `arr.at(0) ?? fallback`, `?.`, or an `if`
  guard all carry the intent into runtime; `!` does not.
- Write the guard in the same expression or the line above, so the claim is verifiable by reading
  two lines rather than by running the program.
- Prefer `assert()` helpers (`assert(x !== null)`) in debug builds when the value comes from a
  source you do not fully control — they narrow the type *and* throw with a message.
- Use `as` where the type is being *corrected* (an untyped library payload you have validated), and
  `!` where a *value* is being asserted present. They are the same mechanism with different intents.
- Review every `!` in a diff. It is a short, high-signal list: each one is an unchecked runtime
  claim, and the count is the metric.

## Don't

- Don't use `!` on a function parameter or an external input. That is a `TypeError` waiting for the
  first request that supplies null.
- Don't use `!` to silence a genuine error. The compiler is reporting that the value may be absent;
  the fix is to handle the absence, not to assert it is not there.
- Don't reach for `!` when `strictNullChecks` is off — see `RULE-TYPESCRIPT-003`. With the flag off
  the assertion re-enables checking for that expression only, so it looks like a fix for a problem
  the flag caused.
- Don't assume `!` on an index access proves bounds. `arr[i]!` asserts non-nullish, not in-range;
  bounds come from `noUncheckedIndexedAccess` (see `RULE-TYPESCRIPT-002`).
- Don't use `!` inside a chained expression where the guard is further up the chain — the claim gets
  separated from its evidence during review.
- Don't assume an assertion is safe because tests pass. Tests exercise the paths they cover; the
  failure is in the ones they do not.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: Cannot read properties of null` | `!` on a value that was absent | Handle the absence; assert only after a real check |
| Error only in production, not tests | External input reached the assertion | Validate at the boundary |
| `Cannot read properties of undefined (reading 'x')` | `arr[i]!` — in-range was assumed | Bounds check, or `noUncheckedIndexedAccess` |
| `!` needed after enabling strict flags | The flag was the fix | Re-check the model, not the call site |
| Guard removed in a refactor, `!` kept | Assertion outlived its evidence | Remove both together |

## Verifying

```bash
# 1. Non-null assertions -- the rule's own subject, ordered by file
grep -rnE '[A-Za-z_$)\]]!\s*[.;)\[]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -30

# 2. `as` assertions at trust boundaries, the sibling mechanism
grep -rnE '\bas\s+(unknown|any|[A-Z]\w*)' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 3. Assertions without a nearby guard -- the pattern that actually breaks
grep -rnE '[A-Za-z_$)\]]!\s*[.;)\[]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -vE 'if|assert|guard|has\(' | head -20

# 4. Real narrowers, for contrast -- these carry intent to runtime
grep -rnE '\?\.|\?\?|\bat\(|assert\(' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -15

# 5. Settle it at the runtime -- the whole defect, three lines:
#    npx tsc --strict --noEmit   # compiles clean
#    node -e 'const x = null; try { console.log(x!.toFixed()) } catch (e) { console.log(e.constructor.name) }'
#    -> TypeError     (the compiler said nothing, and said nothing at runtime either)
```

What this check cannot see: step 1 finds every `!` and cannot tell one supported by a guard three
lines above from one standing alone — the evidence is usually in a different statement than the
claim, and grep sees them independently. Step 3's exclusion list is a heuristic: a guard phrased any
other way (`if (x == null) return`, a helper named `mustBe`), or one in a different function that
assumed by contract, still shows up as an unguarded assertion. The instrument that settles it is
step 5, and it settles only the mechanism: it proves that the compiler and the runtime both stay
silent, which is the rule's claim. Whether a *specific* assertion is sound is a question about that
program's invariants, and no grep over source text can answer it.