---
language: "JavaScript"
tag: "js"
ecosystem: "frontend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for JavaScript / TypeScript assets."
---

# Documentation Hub: JavaScript

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`,
> `pnpm-lock.yaml`). Match the conditions below to determine which `rules`, `skills`, `agents`,
> or `shared` assets to inject.
>
> **Scope**: this hub is the JavaScript *language* — the semantics every JavaScript and TypeScript
> program runs on regardless of framework. It does **not** cover the runtime (`rules/nodejs/`),
> the type system (`skills/typescript/`, `docs/typescript.md`), or any framework
> (`docs/react.md`, `rules/nestjs/`). A project can match several; judge each entry separately. If
> the defect is "the framework did not do what its documentation says", it is not this hub.
>
> **Overlap**: the TypeScript strict-adoption skill is routed here *and* from
> `docs/react.md`, deliberately — a non-React TypeScript project should not have to
> resolve the React hub to reach it. The skill file is one; a manifest may point at it
> from more than one hub.
>
> **Status**: nine rules covering the places where the language is correct and the author's model
> of it is wrong — a hoisted `var` that satisfies an initialization guard, a default `sort()`
> comparator that orders numbers as strings, a shallow `Object.freeze()` sold as immutability, an
> equality model that treats four algorithms as a spectrum, `||` discarding a legitimate `0` or
> `''`, a 64-bit ID stored in a double that rounds silently, `parseInt()` used as a validator,
> `Object.groupBy()` returning a null-prototype object with string-coerced keys, and a
> `Promise.all()` rejection that does not cancel what is still in flight. No new `skills` and no
> `shared` assets yet.
>
> **Version note**: written against MDN's current JavaScript documentation. Two rules touch recent
> baseline APIs (`Object.groupBy`, and `Map.prototype.getOrInsert` referenced in the report that
> produced them) — `Object.groupBy` is not present on older engines and its absence is a `TypeError`
> at the call rather than a silent fallback. The remaining seven are long-standing behaviours that
> have not changed.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/javascript/var-hoists-the-declaration-not-the-value.md`
  - **Why**: Hoisting moves the *declaration* to the top of the scope and leaves the *value*
    behind, so `typeof x !== 'undefined'` is satisfied by a variable that was never assigned — the
    guard meant to exclude exactly that case. Block constructs that scope `let` do not scope `var`,
    so `for (var i = ...)` leaks and a `case` declaring `var` leaks into the function. Neither is
    visible at the call site, and duplicate declarations are legal even in strict mode.
  - **When**: Target project contains `var` at all, especially inside `if`/`for`/`try`/`switch`, a
    chained `var x = y = 1`, or a `typeof x === 'undefined'` initialization guard.
  - **Target Location**: `docs/rules/javascript/var-hoists-the-declaration-not-the-value.md`

- **Path**: `rules/javascript/sort-without-a-comparator-sorts-strings.md`
  - **Why**: The default comparator stringifies and compares UTF-16 code units, so `[80, 9].sort()`
    is `[80, 9]` — ascending and wrong, with no error. Separately, a comparator returning a boolean
    (`(a, b) => a.id > b.id`) type-checks against the historical signature and its behaviour is
    *undefined*, not merely misordered — anti-symmetry is broken the moment the two orderings return
    the same value.
  - **When**: Target project calls `.sort()`, particularly with no comparator, or with a comparator
    that returns a boolean or a conditional `1 : 0`.
  - **Target Location**: `docs/rules/javascript/sort-without-a-comparator-sorts-strings.md`

- **Path**: `rules/javascript/object-freeze-is-shallow.md`
  - **Why**: `freeze()` applies to one property set and stops there, so a frozen object's nested
    values still mutate — and the documented failure is "either silently or by throwing", meaning
    the same call throws in a module and is a no-op in a sloppy-mode script. Getter/setter pairs
    keep working and `#private` fields are not properties at all, so neither is covered by the
    freeze.
  - **When**: Target project calls `Object.freeze` as an immutability guarantee, ships any
    non-module script, or hands frozen state across a boundary.
  - **Target Location**: `docs/rules/javascript/object-freeze-is-shallow.md`

- **Path**: `rules/javascript/the-four-equality-algorithms-are-not-a-spectrum.md`
  - **Why**: There are four algorithms, not three, and `Object.is` is not "stricter" than `===` —
    it differs in two directions at once (`NaN` equal, `-0` distinct). The fourth, `SameValueZero`,
    is what `includes()` and Map/Set key comparison use and it has no callable API, so `[NaN]`
    yields three different answers from `includes`, `indexOf`, and `===` with nothing thrown.
  - **When**: Target project uses `==`, reaches for `Object.is` to fix a `===` surprise, uses
    `indexOf` as a membership test, or compares objects structurally with `===` or
    `JSON.stringify`.
  - **Target Location**: `docs/rules/javascript/the-four-equality-algorithms-are-not-a-spectrum.md`

- **Path**: `rules/javascript/or-coerces-falsy-values-that-are-valid.md`
  - **Why**: `||` coerces its left operand to a boolean, so a legitimate `0`, `''`, or `NaN` is
    discarded — `count || 1` turns a real zero into one. `??` tests only `null` and `undefined`,
    which is why it exists, and mixing it with `||` without parentheses is a *syntax error* — the
    one place this family fails loudly instead of shipping a wrong value.
  - **When**: Target project uses `||` to default a number, string, array, or boolean — the
    canonical `port || 3000`, `label || 'N/A'`, `items || []` shapes.
  - **Target Location**: `docs/rules/javascript/or-coerces-falsy-values-that-are-valid.md`

- **Path**: `rules/javascript/numbers-are-ieee-754-doubles.md`
  - **Why**: Every number is an IEEE 754 double with a 53-bit mantissa and no integer type, so a
    64-bit ID or a Snowflake rounds silently on the way in and the rounded value is still a valid
    integer. Overflow yields `Infinity` rather than an error, underflow yields `0`, and `null` and
    `undefined` both coerce to `0` in every integer position — array indices and date components
    included.
  - **When**: Target project stores 64-bit identifiers, Twitter/X or Snowflake IDs, or money in a
    JavaScript number, or parses untrusted input into one.
  - **Target Location**: `docs/rules/javascript/numbers-are-ieee-754-doubles.md`

- **Path**: `rules/javascript/parseint-stops-at-the-first-invalid-character.md`
  - **Why**: `parseInt` does not validate — it parses the longest valid prefix and returns it, so
    `parseInt("12abc")` is `12` and `parseInt("1e3", 10)` is `1`. Every validation branch written
    around it returns a plausible number instead of failing. The radix is also not always 10:
    only `0x` is a recognised prefix, so `parseInt("0b101")` is not 5.
  - **When**: Target project calls `parseInt` on a route parameter, query value, form field, or any
    external input; or uses it to truncate a number it already has.
  - **Target Location**: `docs/rules/javascript/parseint-stops-at-the-first-invalid-character.md`

- **Path**: `rules/javascript/object-groupby-returns-a-null-prototype-object.md`
  - **Why**: `Object.groupBy()` returns an object with **no prototype**, so `result.hasOwnProperty`
    throws while the defensive `Object.prototype.hasOwnProperty.call(g, k)` still works — and its
    keys are string-coerced, so `grouped[200]` misses a group keyed by the number `200`. Both are
    stated in the return-value line rather than the description, and `Map.groupBy` is the documented
    answer when the key is not a string.
  - **When**: Target project uses `Object.groupBy`/`Map.groupBy`, or still hand-rolls
    `reduce`-based grouping that the built-in replaces.
  - **Target Location**: `docs/rules/javascript/object-groupby-returns-a-null-prototype-object.md`

- **Path**: `rules/javascript/promise-all-rejects-fast-and-discards-the-rest.md`
  - **Why**: A `Promise.all` rejection rejects the returned promise and **nothing else** — the other
    operations continue to run and their results are unreachable, so a write the caller believes was
    rolled back actually commits and the retry re-does every operation rather than the failed one.
    Only the first failure is named; later ones surface as unhandled rejections. Promises have no
    cancellation protocol of their own, so fixing it means an `AbortController` per operation.
  - **When**: Target project wraps writes — batch imports, N notifications, N records — in
    `Promise.all`, or has fetches without an `AbortSignal` that outlive the component.
  - **Target Location**: `docs/rules/javascript/promise-all-rejects-fast-and-discards-the-rest.md`

## 2. Skills (`skills/`)

- **Path**: `skills/typescript/adopt-strict-checking-gradually/SKILL.md`
  - **Why**: Provides a gradual migration path to strict TypeScript checking, helping teams
    adopt stricter type safety without blocking development on immediate breaking changes.
  - **When**: Target project uses TypeScript and wants to incrementally increase type
    checking strictness (e.g., moving from `noImplicitAny: false` to `true`).
  - **Target Location**: `docs/skills/typescript/adopt-strict-checking-gradually/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/javascript/agent.json`
  - **Why**: Helps with JavaScript tasks where the language is behaving exactly as specified and
    the author's model of it is wrong — reading a hoisted `var` as assigned because `typeof x`
    did not throw, leaving a numeric sort to its default string comparator, treating a shallow
    `Object.freeze()` as an immutability guarantee, reaching for `Object.is` as "the strictest" when
    it is off the equality spectrum and `SameValueZero` has no API, defaulting a count or empty
    string with `||` instead of `??`, storing a 64-bit ID in a double that silently rounds above
    2^53, using `parseInt()` as a validator, calling `hasOwnProperty` on a null-prototype
    `Object.groupBy()` result, and assuming a `Promise.all()` rejection cancelled what was still in
    flight.
  - **When**: Target project is written in JavaScript or TypeScript and contains `var`, `.sort(`,
    `Object.freeze`, `Object.is`, `||` defaults, numeric 64-bit IDs, `parseInt`, `Object.groupBy`,
    or `Promise.all`. Runtime-level concerns belong to `docs/nodejs.md` and framework concerns to
    their own hub.
  - **Target Location**: `docs/agents/javascript/agent.json`

## 4. Shared Assets (`shared/`)

_None yet._

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.