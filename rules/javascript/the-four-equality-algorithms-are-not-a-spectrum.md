---
title: "The four equality algorithms are not a strictness spectrum, and SameValueZero has no API"
rule_id: "RULE-JAVASCRIPT-004"
category: "correctness"
scope: "all"
applies_to: "==, ===, Object.is, SameValueZero, NaN, includes, indexOf, deep equality"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness"
---

# The four equality algorithms are not a strictness spectrum, and SameValueZero has no API

Most codebases treat `==`, `===`, and `Object.is()` as three points on a line from loose to strict,
and reach for the next one when the previous surprises them. That model is wrong, and the reason is
`NaN` — plus a fourth algorithm you cannot call at all.

## Why

MDN states the failure of the spectrum model directly:

> However, this way of thinking implies that the equality comparisons form a one-dimensional
> "spectrum" where "totally strict" lies on one end and "totally loose" lies on the other. This model
> falls short with Object.is, because it isn't "looser" than double equals or "stricter" than triple
> equals, nor does it fit somewhere in between (i.e., being both stricter than double equals, but
> looser than triple equals).
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

There are four algorithms, not three, and the fourth is the one that bites:

> They correspond to three of four equality algorithms in JavaScript:
> IsLooselyEqual: ==
> IsStrictlyEqual: ===
> SameValue: Object.is()
> SameValueZero: used by many built-in operations
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

`SameValueZero` is what the search and key-comparison built-ins use, and it is not callable:

> Same-value-zero only differs from strict equality by treating NaN as equivalent, and only differs
> from same-value equality by treating -0 as equivalent to 0. This makes it usually have the most
> sensible behavior during searching, especially when working with NaN. It's used by
> Array.prototype.includes(), TypedArray.prototype.includes(), as well as Map and Set methods for
> comparing key equality.
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

So three built-ins on the same array give three answers about the same element — `[NaN].includes(NaN)`
is `true`, `[NaN].indexOf(NaN)` is `-1`, and `NaN === NaN` is `false` — with no error anywhere.

The gap that silently fails data-layer tests is that none of these compare structure:

> Note that the distinctions between these all have to do with their handling of primitives; none of
> them compares whether the parameters are conceptually similar in structure. For any non-primitive
> objects x and y which have the same structure but are distinct objects themselves, all of the above
> forms will evaluate to false.
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

> Comparing the contents of distinct objects or arrays recursively is called deep equality.
> JavaScript does not provide a general deep comparison operator; libraries and host APIs can provide
> comparison utilities with different rules.
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

And MDN's own recommendation is to *stop* reaching for `Object.is`, because surrounding arithmetic
can flip the sign of a zero:

> If your use case does not require this, it is suggested to avoid Object.is and use === instead.
> Even if your requirements involve having comparisons between two NaN values evaluate to true,
> generally it is easier to special-case the NaN checks (using the isNaN method available from
> previous versions of ECMAScript) than it is to work out how surrounding computations might affect the
> sign of any zeros you encounter in your comparison.
> ([Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness))

## Do

- Default to `===`. It is the only one that does no coercion, and it is what almost every comparison
  in a codebase actually means.
- Use `Object.is` only when you specifically need `NaN` to equal `NaN` or `-0` to differ from `0` —
  and remember the MDN caveat about sign-flipping zeros.
- Special-case `NaN` explicitly instead of reaching for `Object.is`: `Number.isNaN(x)` for the
  number case, and `x === x` is never the right test.
- Use `Array.prototype.includes` for "does this list contain it", not `indexOf`, whenever the element
  may be `NaN`. `indexOf` cannot find it.
- For structural comparison, use a library (`node:assert`'s `deepStrictEqual` in tests,
  Vitest/Jest matchers, or a dedicated deep-equal package) and pick one rule set. Different
  libraries treat `undefined` keys, key order, and `Map`/`Set` contents differently.
- Remember Map and Set keys already use `SameValueZero`: a `NaN` key is findable, and `-0` and `0` are
  the same key.

## Don't

- Don't use `==`. Its coercion rules (documented separately) are a table of cases, not a gradient,
  and `null == undefined` being true is more useful than the string/number coercions are.
- Don't reach for `Object.is` as "the strictest one" when `===` surprises you. It is off the axis:
  it is stricter about `NaN` and *looser* about `-0` than `===`.
- Don't write a `SameValueZero` helper as though there were a built-in. There is no
  `Object.sameValueZero`, and a hand-rolled one has to handle both halves.
- Don't expect any of the four to compare structure. `{a:1} === {a:1}` is `false`, and that is
  specified behaviour, not a bug to work around with `JSON.stringify`.
- Don't use `indexOf` for NaN membership checks — it returns `-1` and there is no error to notice.
- Don't assume a test library's deep-equal means the same thing as another library's.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `includes` finds it, `indexOf` does not | `includes` uses `SameValueZero`, `indexOf` uses `===` | Use `includes` for membership |
| `Object.is` disagrees with `===` on `-0` | `SameValue` distinguishes signed zeros | Use `===` unless sign matters |
| Two structurally identical objects compare unequal | No operator compares structure | Deep-equal from a library |
| `==` passes but `===` fails on number/string | Loose equality coerces | Use `===`; convert deliberately |
| A deep-equal assertion fails on `undefined` keys | Libraries differ on that rule | Pick one library and one rule set |
| Map key found under `NaN` but `===` says no | Map keys use `SameValueZero` | Use `map.has(NaN)`, not `===` |

## Verifying

```bash
# 1. Loose equality -- every site is a coercion decision
grep -rnE '[^=!<>]==[^=]|[^=!<>]!=[^=]' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -vE '==' | head -30

# 2. Object.is and SameValue reach -- each needs a reason
grep -rn 'Object.is' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 3. indexOf used as a membership test where the element may be NaN
grep -rnE '\.indexOf\([^)]*\)\s*[!<>=-]=?\s*-1' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 4. Structural comparison via JSON -- key order and undefined both bite
grep -rnE 'JSON\.stringify\([^)]*\)\s*===?\s*JSON\.stringify' --include=*.js --include=*.ts . | grep -v node_modules

# 5. Settle it in the runtime -- the three answers, in one line each:
#    node -e 'console.log([NaN].includes(NaN), [NaN].indexOf(NaN), NaN === NaN)'   ->  true -1 false
#    node -e 'console.log(Object.is(-0, 0), -0 === 0)'                             ->  false true
#    node -e 'console.log({a:1} === {a:1})'                                        ->  false
```

What this check cannot see: steps 1–4 find comparisons by operator, but whether `==` is correct at a
site is a data question — `if (x == null)` is the intended "null or undefined" idiom, and step 1
flags it identically to a real coercion bug. Step 3 flags every `indexOf` guard, most of which are
fine because the element is never `NaN`. The instrument that settles it is step 5: print the three
answers rather than reasoning about which algorithm is which.