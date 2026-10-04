---
title: "parseInt() parses the longest valid prefix instead of validating, and its radix is not always 10"
rule_id: "RULE-JAVASCRIPT-007"
category: "correctness"
scope: "all"
applies_to: "parseInt, radix, Number, BigInt, Math.trunc, scientific notation, validation"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt"
---

# parseInt() parses the longest valid prefix instead of validating, and its radix is not always 10

`parseInt()` does not check whether its input is a number. It parses the longest valid prefix and
returns that — so the validation path you wrote never fails, and the number you get back was never
in the input.

## Why

The specification of the behaviour is the whole defect:

> If parseInt encounters a character in the input string that is not a valid numeral in the specified
> radix, it ignores it and all succeeding characters and returns the integer value parsed up to that
> point. For example, parseInt("2", 2) returns NaN because 2 is not a valid numeral in the binary
> number system. Likewise, although 1e3 technically encodes an integer (and will be correctly parsed
> to the integer 1000 by parseFloat()), parseInt("1e3", 10) returns 1, because e is not a valid
> numeral in base 10. Because . is not a numeral either, the return value will always be an integer.
> ([parseInt()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt))

So `parseInt(userInput)` on `"12abc"` is `12`, on `"12.9"` is `12`, on `" 12 "` is `12`, and on
`"1e3"` is `1`. Every one of those is a validation branch that returns a plausible number instead of
failing, and the caller has no signal that anything was discarded.

Scientific notation is the case that catches people, and MDN names the correct tool:

> Because large numbers use the e character in their string representation (e.g., […] ), using
> parseInt to truncate numbers will produce unexpected results when used on very large
> or very small numbers. parseInt should not be used as a substitute for Math.trunc().
> ([parseInt()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt))

The radix is the second half, and the common assumption — "it defaults to 10" — is wrong in the one
direction that matters:

> Note: Other prefixes like 0b, which are valid in number literals, are treated as normal digits by
> parseInt(). parseInt() does not treat strings beginning with a 0 character as octal values either.
> The only prefix that parseInt() recognizes is 0x or 0X for hexadecimal values — everything else is
> parsed as a decimal value if radix is missing. Number() or BigInt() can be used instead to parse
> these prefixes.
> ([parseInt()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt))

> Be careful — this does not always default to 10! The description below explains in more detail what
> happens when radix is not provided.
> ([parseInt()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt))

## Do

- Use `Number(value)` to convert a string you already know is numeric. It rejects `"12abc"` with
  `NaN` instead of returning `12`, and it handles scientific notation.
- Use `Number.isNaN(Number(value))` or `Number.isFinite` to test, rather than checking the truthiness
  of a `parseInt` result — because `"0"` is falsy as a string and `0` is falsy as a number.
- Pass the radix explicitly whenever it is 16 or a base other than 10: `parseInt(hex, 16)`. It is
  self-documenting and immune to the inference rules.
- Use `Math.trunc(number)` when you want to drop a fraction from something that is already a number.
  That is what `parseInt` is mistaken for.
- Validate the shape before converting when the input is user-supplied: a regex or `Number.isFinite`
  on the converted value, and an explicit error when it fails.
- Use `BigInt()` for integer strings beyond `Number.MAX_SAFE_INTEGER`, rather than `parseInt`, which
  will round.

## Don't

- Don't use `parseInt()` as a validator. It succeeds on almost everything, and the success is silent.
- Don't use `parseInt(userInput)` with no radix and no validation on a route parameter, query value,
  or form field — that is the shape that produces `parseInt("12abc") === 12`.
- Don't use `parseInt` to truncate a number. `parseInt(1.9)` goes through string conversion first and
  `Math.trunc(1.9)` is what you meant.
- Don't assume the radix defaults to 10 for every input. `parseInt("0b101")` is not 5, and
  `parseInt("010")` is not 8.
- Don't write `if (parseInt(x))` as a presence check. It is false for `0`, `NaN`, and `""` alike.
- Don't parse IDs with `parseInt`. A 64-bit ID silently rounds — see the `Number` rule.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `parseInt("12abc")` is 12, validation passed | Longest-valid-prefix parse | `Number(x)` and check `isFinite` |
| `parseInt("1e3")` is 1 | `e` is not a base-10 numeral | `Number(x)` or `parseFloat(x)` |
| `parseInt("0b101")` is not 5 | Only `0x` is a recognised prefix | `Number(x)`, or parse base 2 explicitly |
| `parseInt("010")` is not 8 | Leading zero is not octal here | Pass the radix |
| A `0` value treated as absent | `0` is falsy | Check `!== null` / `isNaN`, not truthiness |
| An ID came back changed | Rounded above `MAX_SAFE_INTEGER` | Keep it a string |

## Verifying

```bash
# 1. Every parseInt in the project
grep -rn 'parseInt(' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx --include=*.jsx . \
  | grep -v node_modules | head -30

# 2. parseInt with no radix, on anything that came from outside the module
grep -rnE 'parseInt\(\s*[A-Za-z_$][A-Za-z0-9_$.]*(\[[^]]*\])?\s*\)' --include=*.js --include=*.ts . \
  | grep -v node_modules | head -20

# 3. parseInt used where a number is already in hand -- the Math.trunc confusion
grep -rnE 'parseInt\(\s*[0-9]' --include=*.js --include=*.ts . | grep -v node_modules | head -10

# 4. Truthiness used as the validation result
grep -rnE 'if\s*\(\s*!?\s*(parseInt|Number|parseFloat)\(' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 5. Settle it at runtime -- every case in the rule, one line:
#    node -e 'console.log(parseInt("12abc"), parseInt("12.9"), parseInt("1e3"), parseInt("0b101"), parseInt("010"))'
#    ->  12 12 1 0 10
#    node -e 'console.log(Number("12abc"), Number("1e3"), Number.isFinite(Number("12abc")))'
#    ->  NaN 1000 false
```

What this check cannot see: steps 1–4 find `parseInt` by call shape, but whether the omission is a
defect depends on the input — `parseInt("42", 10)` is correct and `parseInt(routeParam)` is not, and
both look the same to a grep. Step 4 in particular flags every truthiness check, most of which are
correct because the value is never `0`. The instrument that settles it is step 5: run both the
`parseInt` and the `Number` form on the real input and compare, which is the only place the discarded
suffix becomes visible.