---
title: "Every number is an IEEE 754 double — integers stop being exact above 2^53 and nothing overflows"
rule_id: "RULE-JAVASCRIPT-006"
category: "correctness"
scope: "all"
applies_to: "Number, IEEE 754, MAX_SAFE_INTEGER, BigInt, money, IDs, coercion, Infinity, NaN"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number"
---

# Every number is an IEEE 754 double — integers stop being exact above 2^53 and nothing overflows

There is no integer type. Every numeric literal, every arithmetic result, every parsed ID is a
64-bit float with a 53-bit mantissa — and the two ways that fails are rounding (silent) and
saturation (also silent).

## Why

MDN's first statement on the `Number` object is that there is no integer:

> A number literal like 37 in JavaScript code is a floating-point value, not an integer. There is no
> separate integer type in common everyday use. (JavaScript also has a BigInt type, but it's not
> designed to replace Number for everyday uses. 37 is still a number, not a BigInt.)
> ([Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number))

The exactness boundary, which is the one that decides whether an ID survives a round trip:

> Integers can only be represented without loss of precision in the range […] 1 to […] 1,
> inclusive (obtainable via Number.MIN_SAFE_INTEGER and Number.MAX_SAFE_INTEGER), because the mantissa
> can only hold 53 bits (including the leading 1).
> ([Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number))

Snowflake IDs, X/Twitter IDs, and 64-bit database primary keys all sit above that boundary, so they
round on the way in. The number you hold is not the number that was parsed, and it is still a
`Number`, so nothing reports the loss.

The overflow direction is the opposite of what most code assumes: past the maximum you get
`Infinity`, not an exception, and the *smallest* magnitudes underflow to `0`:

> The largest value a number can hold is […] × (2 - […] ) (with the exponent being 1023 and the
> mantissa being 0.1111… in base 2), which is obtainable via Number.MAX_VALUE. Values higher than
> that are replaced with the special number constant Infinity.
> ([Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number))

And the coercion table is where the `null`-becomes-`0` family of bugs comes from — it is the same
for array indices, date components, and radixes, and none of it warns:

> Notably, when converted to integers, both undefined and null become 0, because undefined is
> converted to NaN, which also becomes 0.
> ([Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number))

## Do

- Keep 64-bit identifiers as **strings** end to end — from the database driver, through JSON, into
  the form field. A JSON parser turns them into doubles for you if the service does not quote them.
- Use `BigInt` when you genuinely need exact integer arithmetic beyond 2^53, and remember it does not
  mix with `Number`: `1n + 1` throws, and `JSON.stringify` throws on a `BigInt`.
- Assert on the boundary when an ID must be exact: `Number.isSafeInteger(id)` in the deserializer,
  not in every consumer.
- Represent money in integer minor units (cents) as a `Number` within `MAX_SAFE_INTEGER`, or as a
  `BigInt`. Never `0.1 + 0.2`, and never a float that has been through arithmetic.
- Use `Number.isInteger`, `Number.isFinite`, and `Number.isNaN` rather than the global `isNaN`,
  which coerces first and so reports `isNaN("hello") === true`.
- Use `Math.trunc()` to drop a fraction, not `parseInt` — see the `parseInt` rule for why the two
  are not interchangeable.

## Don't

- Don't store a 64-bit ID in a `Number` and expect it back. Above 2^53 it rounds silently and the
  rounded value is a perfectly valid integer, so nothing looks wrong.
- Don't use a float for currency. `0.1 + 0.2 !== 0.3` is specified behaviour, and it accumulates
  through a ledger.
- Don't write `let x = somethingThatMightBeUndefined` and then use `x` as an integer index. `null`
  and `undefined` both become `0`, so the first element is addressed instead of an error being raised.
- Don't expect overflow to throw. Multiplication past the maximum yields `Infinity`, and arithmetic
  on `Infinity` keeps going.
- Don't mix `BigInt` and `Number` in one expression expecting coercion. It is a `TypeError`.
- Don't use the global `isNaN()` as a type check — it stringifies its argument first, so `"hello"`
  is "not a number" by its answer and `[]` is not.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| An ID comes back changed | Above 2^53, rounded on parse | Keep it a string, or use `BigInt` |
| `0.1 + 0.2 !== 0.3` | Binary floating point | Integer minor units |
| First array element read when value was absent | `null`/`undefined` coerce to 0 | Check for absence first |
| A total becomes `Infinity` with no error | Saturation past `MAX_VALUE` | Guard the arithmetic |
| `BigInt` and `Number` mixed throws | No implicit coercion | Convert explicitly at the boundary |
| `isNaN("x")` is true, `isNaN([])` is true | Global `isNaN` coerces | `Number.isNaN(x)` |

## Verifying

```bash
# 1. IDs and money in numeric form -- the two things that must not be doubles
grep -rnE '\b(id|userId|orderId|snowflake|_id)\s*:\s*[0-9]' --include=*.js --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20
grep -rniE '\b(price|amount|total|cost|subtotal)\s*[:=]\s*[0-9]+\.[0-9]' --include=*.js --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 2. Float arithmetic on money-shaped values
grep -rnE '(price|amount|total)\s*[+\-*/]' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 3. Unchecked numeric parsing of anything that could exceed the boundary
grep -rnE '(parseInt|parseFloat|Number)\(' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 4. Coercing isNaN instead of Number.isNaN
grep -rnE '(^|[^.\w])isNaN\(' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 5. Settle it at runtime -- the whole rule in five lines:
#    node -e 'console.log(0.1+0.2, 2**53 === 2**53+1, Number.MAX_SAFE_INTEGER)'
#    node -e 'console.log(Number("9007199254740993"))'      ->  9007199254740992  (rounded)
#    node -e 'console.log(Number(null), Number(undefined), Number([]))'   ->  0 0 0
```

What this check cannot see: step 1 finds numeric-looking IDs and money by shape, but cannot tell
whether a given ID is one of the 64-bit kinds that actually rounds — a small sequential key is a
perfectly good `Number`. Step 3 lists every parse, and most are correct because the input is small.
The instrument that settles it is step 5: round-trip the actual value and read back what came out,
which is the only place a lost digit becomes observable.