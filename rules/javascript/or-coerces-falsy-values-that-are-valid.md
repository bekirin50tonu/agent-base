---
title: "|| discards 0, '' and NaN, which are valid data — ?? discards only null and undefined"
rule_id: "RULE-JAVASCRIPT-005"
category: "correctness"
scope: "all"
applies_to: "||, ??, nullish coalescing, default values, optional chaining, precedence"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing"
---

# || discards 0, '' and NaN, which are valid data — ?? discards only null and undefined

`||` is a boolean operator being used as a default-value operator. It coerces its left operand to a
boolean before deciding, so every falsy value that is nonetheless meaningful data is thrown away.
The two operators are not "loose vs strict" versions of each other — they test different sets.

## Why

MDN states the failure in the parameter's own documentation:

> However, due to || being a boolean logical operator, the left-hand-side operand was coerced to a
> boolean for the evaluation and any falsy value (including 0, '', NaN, false, etc.) was not
> returned. This behavior may cause unexpected consequences if you consider 0, '', or NaN as valid
> values.
> ([Nullish coalescing operator (??)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing))

The cases that reach production are unglamorous and constant: `count || 1` turns a legitimate
`count: 0` into `1`; `value || 'N/A'` turns an empty-but-valid string into `'N/A'`; `enabled ||
true` is fine while `enabled || false` is not, and the difference is invisible because both read
as "defaulting a boolean".

`??` is the operator that tests the narrower set — `null` and `undefined` only, so `0`, `''`, and
`NaN` survive. It has one sharp edge, and it is the one place this family fails **loudly**, which
makes it the safer of the two:

> It is not possible to combine either the AND (&&) or OR operators (||) directly with ??. A syntax
> error will be thrown in such cases.
> ([Nullish coalescing operator (??)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing))

> Instead, provide parenthesis to explicitly indicate precedence:
> ([Nullish coalescing operator (??)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing))

## Do

- Use `??` whenever the fallback is a *default for absent data* — anything where `0`, `''`, or `false`
  is a legitimate value. That is most config, count, name, and query-parameter handling.
- Use `||` when you genuinely mean "any falsy value is unacceptable here" — a required string where
  empty should fall back, or a boolean where `false` should be replaced.
- For parameters and destructuring defaults, write `= default` in the signature. `{ port = 3000 }`
  applies the default only when the value is `undefined`, which is the narrow semantics you almost
  always want.
- Pair with optional chaining so the whole expression handles absence: `user?.name ?? 'anonymous'`.
- Write the intent in the variable name — `count ?? 1` reads as "count, or one if absent", and the
  next reader does not have to re-derive the operator's truth table.

## Don't

- Don't use `||` to default a number, a string, or an array. `count || 1`, `label || 'none'`,
  `items || []` all discard valid data; use `??`.
- Don't use `enabled || true` as a default. It is a no-op for `true` and turns a real `false` into
  `true` — the exact value you meant to preserve.
- Don't mix `??` with `||` or `&&` without parentheses. It is a syntax error, so unlike its
  neighbours it fails at parse time rather than shipping wrong.
- Don't reach for `||` because `??` looks unfamiliar. The one place `||` is clearly correct is when
  falsy-and-absent are the same thing to you, and that decision belongs in the code where the value
  arrives.
- Don't chain `a || b || c` as a general fallback ladder if any of them can be `0` or `''` — the
  first falsy one wins, and that is not the first *absent* one.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A count of 0 became 1 | `||` discarded a falsy number | `count ?? 1` |
| An empty string became a placeholder | `||` discarded `''` | `label ?? 'none'` |
| A `false` flag came back `true` | `enabled \|\| true` overwrote it | `enabled ?? true`, or just `enabled` |
| Empty list replaced by a new array each call | `items \|\| []` | `items ?? []`, hoisted to a constant |
| Syntax error near `??` and `\|\|` | Mixing requires parentheses | `a ?? (b \|\| c)` |

## Verifying

```bash
# 1. || used as a default -- the whole candidate set
grep -rnE '\|\|\s*(\[|"|'"'"'|[0-9]|true|false)' --include=*.js --include=*.mjs --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -40

# 2. The specific numbers and strings that are valid-but-falsy
grep -rnE '\|\|\s*[0-9]+' --include=*.js --include=*.ts . | grep -v node_modules | head -20
grep -rnE '\|\|\s*(true|false)\b' --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 3. Default parameters (narrow, correct) versus || defaults in the body (broad, often wrong)
grep -rnE '^\s*(function|const|let|var).*\(\s*\{[^}]*=[^}]*\}|[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*[^,)]*\)\s*(=>|\{)' \
  --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 4. ?? mixed with || or && without parentheses -- would be a syntax error, so this is
#    only informative for the sibling case: ?? inside a || chain, which parses differently
grep -rnE '\|\|[^;]*\?\?' --include=*.js --include=*.ts . | grep -v node_modules | head -10

# 5. Settle it at runtime -- one line, both operators:
#    node -e 'console.log(0||1, 0??1, ""||"x", ""??"x", false||true, false??true)'
#    ->  1 0 x x true false
```

What this check cannot see: steps 1–2 flag every `||`, and most are correct — `||` is the right
operator when falsy-and-absent mean the same thing, which the text cannot tell you. Step 2 in
particular flags `port || 8080`, which is fine if 0 is not a valid port and a bug if it is. The
instrument that settles it is step 5: evaluate both operators on the actual value, which is the only
place the discarded falsy value becomes visible.