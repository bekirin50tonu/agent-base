---
title: "sort() with no comparator sorts strings, and a comparator that breaks anti-symmetry is undefined behaviour"
rule_id: "RULE-JAVASCRIPT-002"
category: "correctness"
scope: "all"
applies_to: "Array.prototype.sort, comparator, compareFn, stability, in-place mutation"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort"
---

# sort() with no comparator sorts strings, and a comparator that breaks anti-symmetry is undefined behaviour

`Array.prototype.sort()` has a default comparator and it is the wrong one for numbers. Separately,
the comparator you supply can be *outside the specification* rather than merely wrong — and both
failures produce an array that looks sorted.

## Why

The default is a string comparison, so a numeric sort is ascending and still incorrect:

> If compareFn is not supplied, all non-undefined array elements are sorted by converting them to
> strings and comparing strings in UTF-16 code units order. For example, "banana" comes before
> "cherry". In a numeric sort, 9 comes before 80, but because numbers are converted to strings, "80"
> comes before "9" in the Unicode order. All undefined elements are sorted to the end of the array.
> ([Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort))

`[80, 9].sort()` is `[80, 9]` — unchanged, ascending, wrong. No error, no empty result, no wrong
length.

The comparator case is a different class of defect. `(a, b) => a.id > b.id` type-checks under the
historical signature, because a boolean is assignable where a number is expected. What it produces
is not "a wrong order" but behaviour the specification declines to define:

> If a comparing function does not satisfy all of purity, stability, reflexivity, anti-symmetry, and
> transitivity rules, as explained in the description, the program's behavior is not well-defined.
> ([Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort))

The property a boolean comparator breaks first is anti-symmetry — `compare(a, b)` and
`compare(b, a)` must return opposite values, and a boolean returns the same one both ways:

> A comparator conforming to the constraints above will always be able to return all of 1, 0, and -1,
> or consistently return 0. For example, if a comparator only returns 1 and 0, or only returns 0 and
> -1, it will not be able to sort reliably because anti-symmetry is broken. A comparator that always
> returns 0 will cause the array to not be changed at all, but is reliable nonetheless.
> ([Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort))

Two further edges on the same page. The sort is **in place** and returns the same array, so
`const sorted = arr.sort()` mutates `arr` as a side effect of a call that reads as pure. And the
sort is *generic* — it only requires a `length` and integer-keyed properties:

> The sort() method is generic. It only expects the this value to have a length property and
> integer-keyed properties.
> ([Array.prototype.sort()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort))

## Do

- Always pass a comparator to `.sort()`. There is no default that is right for numbers, dates, or
  mixed input.
- Return a **number** from the comparator: negative, zero, or positive. `(a, b) => a - b` for
  numbers, and for objects compare a key explicitly rather than using `>`.
- Use `localeCompare` for human-facing string order: `xs.sort((a, b) => a.name.localeCompare(b.name))`.
- Copy before sorting if the caller must not see the mutation: `[...xs].sort(cmp)`.
- Sort by an explicit key when the elements are objects, so the comparison reads as data, not as
  operator trivia.
- Note stability in the version you target: it has been guaranteed since ES2019, so equal elements
  keep their relative order on any current engine.

## Don't

- Don't call `.sort()` with no arguments on anything that might contain numbers. The result is a
  string order that is correct-looking and wrong.
- Don't write a comparator that returns a boolean (`>`, `<`, `>=`). This is the undefined-behaviour
  case, not a subtly wrong order — the result can differ between engines and between runs.
- Don't write a comparator that returns only `1` and `0`, or only `0` and `-1`. Anti-symmetry is
  broken and the sort is unreliable.
- Don't treat `.sort()` as pure. It mutates the receiver, and `const sorted = arr.sort()` mutates
  `arr` while appearing to produce a new array.
- Don't rely on pre-ES2019 unstable ordering for equal elements; the guarantee now exists, so code
  that depends on the old order is depending on something no current engine provides.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Numbers in "wrong" order but plausible | Default comparator stringified them | Pass `(a, b) => a - b` |
| Sort result differs between engines or runs | Comparator violates purity/anti-symmetry | Return a number, not a boolean |
| `sort()` returns everything unchanged | Comparator always returned 0 | Return `-1`/`0`/`1` |
| An array changed after a "read-only" call | `sort()` mutates in place and returns the receiver | Copy first, or stop sorting the shared array |
| Strings ordered by code unit rather than by locale | Default comparator, or explicit `<` | `localeCompare` |

## Verifying

```bash
# 1. Every sort call and whether it has a comparator
grep -rnE '\.sort\(' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx --include=*.jsx . \
  | grep -v node_modules | grep -v 'sort((.*)=>' | head -30

# 2. Comparators returning a boolean rather than a number -- the undefined-behaviour case
grep -rnE '\.sort\(\s*\(?[A-Za-z_$, ]*\)?\s*=>\s*[^;]*(>=|<=|>|<)' \
  --include=*.js --include=*.ts --include=*.tsx . | grep -v node_modules | head -20

# 3. Comparators that cannot return all three signs
grep -rnE '\.sort\(\s*\(?[A-Za-z_$, ]*\)?\s*=>\s*[^;]*(===|==)\s*[^;]*\?\s*1\s*:\s*0' \
  --include=*.js --include=*.ts . | grep -v node_modules

# 4. sort() assigned as if it produced a new array
grep -rnE '(const|let|var)\s+[A-Za-z_$]+\s*=\s*[A-Za-z_$.\[\]]+\.sort\(' \
  --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 5. Settle it at runtime -- both defects are one line each:
#    node -e 'console.log([80,9].sort())'                     ->  [ 80, 9 ]
#    node -e 'console.log([3,1,2].sort((a,b)=>a>b))'          ->  order is not defined by the spec
#    node -e 'const a=[3,1,2]; const b=a.sort(); console.log(b===a)'
```

What this check cannot see: steps 1–4 are syntactic and cannot tell a comparator that is correct
from one that merely looks like a comparator — `cmp` named and defined elsewhere is invisible to
step 2, and a comparator returning a number can still be wrong for the data (ascending where
descending was meant). Step 5 is the instrument that settles it: print the actual order rather
than reasoning about it.