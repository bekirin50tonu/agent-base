---
title: "var hoists the declaration but not the initializer, and block statements do not scope it"
rule_id: "RULE-JAVASCRIPT-001"
category: "correctness"
scope: "all"
applies_to: "var, hoisting, function scope, redeclaration, typeof, globals"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var"
---

# var hoists the declaration but not the initializer, and block statements do not scope it

`var` is often described as function-scoped, which is true and mostly harmless. The two failures
are quieter than that: hoisting moves the *declaration* to the top of the scope while leaving the
*value* behind, and blocks that look like scopes are not.

## Why

MDN separates the halves, and the second one produces a wrong answer rather than an error:

> Only a variable's declaration is hoisted, not its initialization. The initialization happens only
> when the assignment statement is reached. Until then the variable remains undefined (but declared):
> ([var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var))

> Here, x and y are declared before any code is executed, but the assignments occur later. At the
> time x = y is evaluated, y exists so no ReferenceError is thrown and its value is undefined. So,
> x is assigned the undefined value. Then, y is assigned the value "A".
> ([var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var))

So a guard written as `if (typeof x !== 'undefined')` is satisfied by a variable that was never
assigned, and code below the declaration runs with `undefined` rather than failing at the point of
mistake.

Block constructs compound it — the constructs that scope `let` and `const` do nothing for `var`:

> Importantly, other block constructs, including block statements, try...catch, switch, headers of
> one of the for statements, do not create scopes for var, and variables declared with var inside
> such a block can continue to be referenced outside the block.
> ([var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var))

Two further properties make this quiet rather than loud. Redeclaration is legal and keeps the value,
so a bad merge resolves without any diagnostic:

> Duplicate variable declarations using var will not trigger an error, even in strict mode, and the
> variable will not lose its value, unless the declaration has an initializer.
> ([var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var))

And the chained form does not declare what it appears to:

> Be careful of the var x = y = 1 syntax — y is not actually declared as a variable, so y = 1 is an
> unqualified identifier assignment, which creates a global variable in non-strict mode.
> ([var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var))

## Do

- Use `let` or `const`. `const` for bindings that are never reassigned; it is not "more strict"
  `let`, it is a different declaration with the same scoping rules and a reassignment error.
- Declare a variable before its first read in the same block, so the reader does not have to know
  about hoisting to find the value.
- Treat `typeof x === 'undefined'` as a check on *assignment*, not on *declaration*. If a variable
  must not be set yet, it must be in a scope that has not run — a function parameter or a module
  import, not a hoisted `var`.
- Use `const` inside `for (const x of xs)` so the loop variable cannot leak past the loop.
- Let the linter own this: `no-var` in ESLint catches every `var` in a modern codebase.

## Don't

- Don't use `typeof x !== 'undefined'` as an initialization guard. It is true for a hoisted `var`
  that was never assigned, which is the exact case you were trying to exclude.
- Don't declare `var` inside `if`, `for`, `while`, `try`, `catch`, or `switch` and expect it to be
  confined there. `for (var i = 0; ...)` leaks `i`; a `case` declaring `var` leaks into the function.
- Don't write `var x = y = 1` expecting two declarations. Only `x` is declared, and `y` becomes an
  implicit global outside strict mode.
- Don't rely on a duplicate `var` being caught. It is not an error in any mode, including strict.
- Don't reason about a `var`'s value from its declaration site — its scope starts at the top of the
  function, not the top of the block.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A guard passes on a variable that was never assigned | `typeof x` cannot see that only the declaration was hoisted | Declare before use, or use a parameter/module import |
| Loop counter visible after the loop | `var` in a `for` header is function-scoped | `for (const x of xs)` or `let i` |
| `ReferenceError: x is not defined` never fires | The hoisted declaration makes the name exist | The name always exists; check the value instead |
| Merge conflict resolved silently, code reads the wrong value | Duplicate `var` is legal and keeps the value | `const`/`let`; turn on `no-var` |
| Unexpected global in sloppy mode | `var x = y = 1` leaves `y` unqualified | Declare both |

## Verifying

```bash
# 1. Every var in the project -- the candidates. Zero is the target.
grep -rnE '(^|[^A-Za-z0-9_$.])var[[:space:]]+[A-Za-z_$]' \
  --include=*.js --include=*.mjs --include=*.cjs --include=*.jsx --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -40

# 2. var declared inside a block or a loop header -- the leaks
grep -rnE '^\s*(if|for|while|switch|try|catch)\s*\(?.*\{?[[:space:]]*var[[:space:]]' \
  --include=*.js --include=*.mjs --include=*.ts . | grep -v node_modules | head -20
grep -rnE 'for\s*\(\s*var ' --include=*.js --include=*.ts . | grep -v node_modules

# 3. The chained form that declares only the first name
grep -rnE '(^|[^A-Za-z0-9_$.])var[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=' \
  --include=*.js --include=*.ts . | grep -v node_modules

# 4. typeof-guards that mean "assigned?" but read as "declared?"
grep -rnE "typeof [A-Za-z_$][A-Za-z0-9_$.]*\s*[!=]==?\s*['\"]undefined['\"]" \
  --include=*.js --include=*.ts . | grep -v node_modules | head -20

# 5. Settle it in the runtime: does the name exist before its declaration line?
#    node -e 'function f(){ console.log(typeof x); var x = 1; } f()'   ->  "undefined"
```

What this check cannot see: steps 1–4 find `var` by shape, but the actual defect is only a defect
when a *reader* of that function has to know about hoisting to understand it — and intent is not
in the text. Step 4 in particular lists every `typeof` guard, most of which are correct, because
whether the variable can be unassigned depends on the caller, not the guard. The instrument that
settles it is step 5: run the function and read the name before its declaration line, which is the
only place the hoisted value is observable.