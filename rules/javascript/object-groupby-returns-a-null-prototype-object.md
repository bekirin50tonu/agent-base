---
title: "Object.groupBy() returns a null-prototype object, and its keys are string-coerced"
rule_id: "RULE-JAVASCRIPT-008"
category: "correctness"
scope: "all"
applies_to: "Object.groupBy, Map.groupBy, null-prototype object, reduce grouping, key coercion"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy"
---

# Object.groupBy() returns a null-prototype object, and its keys are string-coerced

`Object.groupBy()` replaces the most common `reduce`-based grouping idiom in the language. Its
return value is deliberately not a normal object — MDN states this in the return-value line, not in
the description — and the group key is coerced to a string, so a lookup with the original value
misses.

## Why

The return type is the first fact:

> A null-prototype object with properties for all groups, each assigned to an array containing the
> elements of the associated group.
> ([Object.groupBy()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy))

A null-prototype object has no `hasOwnProperty`, no `toString`, and no `__proto__`. The defensive
call most codebases already write — `Object.prototype.hasOwnProperty.call(obj, key)`, which exists
precisely so the check works regardless of the object's own `hasOwnProperty` — keeps working. But
`obj.hasOwnProperty(key)` throws, and anything that duck-types on
`Object.getPrototypeOf(x) === Object.prototype` rejects the result.

The key coercion is the second edge, and it is what separates this from `Map.groupBy()`:

> Object.groupBy() calls a provided callbackFn function once for each element in an iterable. The
> callback function should return a string or symbol (values that are neither type are coerced to
> strings) indicating the group of the associated element. The values returned by callbackFn are used
> as keys for the object returned by Object.groupBy(). Each key has an associated array containing
> all the elements for which the callback returned the same value.
> ([Object.groupBy()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy))

That string coercion is what MDN then uses to draw the line against this method:

> This method should be used when group names can be represented by strings. If you need to group
> elements using a key that is some arbitrary value, use Map.groupBy() instead.
> ([Object.groupBy()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy))

So `Object.groupBy(xs, x => x.status)` produces the key `"200"` for status `200` and `"false"` for
`false`. They are strings. A later `grouped[x.status]` with the raw number misses with no error.

And the arrays hold the **same references** as the input, not copies:

> The elements in the returned object and the original iterable are the same (not deep copies).
> ([Object.groupBy()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy))

## Do

- Use `Object.groupBy` when the group key is a string or a symbol and you want a plain
  property-keyed result. It is the direct replacement for the accumulator-in-`reduce` idiom.
- Use `Map.groupBy` when the key is an arbitrary value — an object, a number you need to look up by
  value, or anything where string coercion would merge two distinct groups.
- Access the result with bracket notation and `Object.prototype.hasOwnProperty.call(g, key)` if you
  need an own-property check. Both work on a null-prototype object.
- Convert the key to a string at the call site if you want to look it up later: look up `String(key)`,
  not `key`.
- Remember the arrays are the same element references, so mutating an element mutates the input. Copy
  at the boundary if the result escapes.
- Prefer `Object.groupBy` over a hand-rolled `reduce` when the target baseline includes it — the
  built-in has no accumulator-key mangling to get wrong.

## Don't

- Don't call `result.hasOwnProperty(key)`. It throws on a null-prototype object, which is the one
  place the method is *guaranteed* not to exist.
- Don't use `Object.groupBy` and then look up with a raw non-string key. `grouped[200]` misses when
  the key was the number `200`, and the miss looks like "no such group".
- Don't pass the result to code that checks `getPrototypeOf(x) === Object.prototype`, or that calls
  `result.toString()`/`result.constructor`. Spread it (`{ ...grouped }`) if that code needs a normal
  object.
- Don't assume the grouped arrays are copies. They are the original references, so a later mutation
  is visible through both.
- Don't use `Object.groupBy` when group identity must be preserved — two objects that stringify the
  same become one group, because the key is a string.
- Don't assume the method exists. It is recent-baseline; on older engines it is a `TypeError` at the
  call, not a silent absence.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: result.hasOwnProperty is not a function` | Null-prototype object | `Object.prototype.hasOwnProperty.call(g, k)` |
| `grouped[200]` is undefined though the group exists | Key was the string `"200"` | `Map.groupBy`, or look up `String(key)` |
| Two distinct objects landed in one group | Key coerced to a string | `Map.groupBy` |
| A mutation after grouping is visible in the input | Arrays hold the same references | Copy elements if the result escapes |
| Downstream library rejects the object | Duck-types on `Object.prototype` | `{ ...grouped }` |

## Verifying

```bash
# 1. Object.groupBy and Map.groupBy uses
grep -rnE '(Object|Map)\.groupBy' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 2. Hand-rolled reduce grouping that Object.groupBy would replace
grep -rnE '\.reduce\(\s*\(?\s*(acc|groups|result)[^)]*=>\s*\{' --include=*.js --include=*.ts . \
  | grep -v node_modules | head -20

# 3. The method that does not exist on a null-prototype object -- and the one that does
grep -rnE '\.(hasOwnProperty|toString|constructor)\b' --include=*.js --include=*.ts . \
  | grep -v node_modules | head -20

# 4. Lookups on a grouped result with a raw non-string key
grep -rnE 'group(ed|edBy|s)\[[^]]+\.[A-Za-z_$]' --include=*.js --include=*.ts . | grep -v node_modules | head -10

# 5. Settle it at runtime -- both defects, two lines:
#    node -e 'const g=Object.groupBy([1,2,3,4],x=>x%2); console.log(Object.getPrototypeOf(g), typeof g.hasOwnProperty)'
#    ->  null undefined   (so g.hasOwnProperty(k) throws)
#    node -e 'const g=Object.groupBy([{s:200},{s:200}],x=>x.s); console.log(Object.keys(g), g[200], g["200"])'
#    ->  [ "200" ] undefined [...]   (string key, raw lookup misses)
```

What this check cannot see: steps 1–4 find the call sites and the risky method names, but cannot
tell whether a given `hasOwnProperty` is being called on a `groupBy` result or on an ordinary
object — the null-prototype hazard only exists for one of them, and both look identical to a grep.
Step 2 also flags every `reduce` accumulator, most of which group correctly. The instrument that
settles it is step 5: inspect the prototype and try the raw-key lookup, which is the only place both
defects are directly observable.