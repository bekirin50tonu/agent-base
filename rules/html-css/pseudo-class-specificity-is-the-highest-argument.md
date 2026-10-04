---
title: ":is(), :not() and :has() take the highest specificity of their arguments, and :where() takes none"
rule_id: "RULE-HTML-CSS-002"
category: "correctness"
scope: "frontend"
applies_to: ":is(), :not(), :has(), :where(), specificity, selector lists, nesting"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity"
---

# :is(), :not() and :has() take the highest specificity of their arguments, and :where() takes none

A functional pseudo-class is not a pseudo-class as far as specificity is concerned. Its weight is
its argument's weight — the highest one if there are several — so the selector's specificity is
not something you can read off its own shape.

## Why

The pseudo-class contributes nothing; the selector inside it contributes everything:

> The `:not()`, `:is()`, `:has()` and CSS nesting exceptions are discussed below.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> The `:is()`, `:not()`, `:has()` and CSS nesting exceptions The matches-any pseudo-class `:is()`,
> the relational pseudo-class `:has()`, and the negation pseudo-class `:not()` are not considered
> as pseudo-classes in the specificity weight calculation.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> Like nesting, the `:is()`, `:has()`, and negation (`:not()`) pseudo-classes themselves add
> no weight.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

The weight comes from the *most specific* selector in the list, not from the pseudo-class and not
from the first argument:

> The specificity weight of each comes from the selector parameter in the list of selectors
> with the highest specificity.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> Note that in the above CSS pairing, the specificity weight provided by the `:is()`, `:has()`
> and `:not()` pseudo-classes is the value of the selector parameter, not of the pseudo-class.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

`:where()` is the deliberate inverse, and it is the only way to add a selector that matches
without adding weight:

> The `:where()` exception The specificity-adjustment pseudo-class `:where()` always has its
> specificity replaced with zero, 0-0-0.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> The universal selector (`*`) and the pseudo-class `:where()` and its parameters aren't
> counted when calculating the weight so their value is 0-0-0, but they do match elements.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> You can also include the id or any part of a selector as a parameter in the `:where()`
> specificity-adjustment pseudo class if you need to make a selector more specific but don't
> want to add any specificity at all.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

The failure is quiet because the selector looks zero-weight and is not. `:not(.btn)` reads like
a class-level guard and is; `:not(#app .btn)` carries an ID because of one argument that nobody
thinks of as a specificity declaration.

## Do

- Use `:where()` for the arguments you added only to broaden the match — a reset, a base rule, a
  low-priority default. It matches everything and weighs nothing.
- Use `:is()` deliberately, and check what the *highest* argument costs you before writing it.
- Read a selector's specificity by expanding it mentally: `:is(.a, #b) .c` is `1-1-0`.
- Prefer a class over `:is()`/`:not()` gymnastics when the intent is simply "override".
- Treat an inline list of alternatives as a specificity decision, not a readability one.

## Don't

- Don't put an ID inside `:not()` or `:is()` casually. `:not(#x)` silently promotes the whole
  rule above anything you meant it to sit beside.
- Don't assume `:is(.a, .b)` is class-level. It is the highest of its arguments, and one bad
  argument poisons the list.
- Don't use `:where()` expecting it to make a rule *win*. It can only ever be 0-0-0; it wins by
  losing loudly — nothing beats it except specificity from elsewhere.
- Don't rely on `:not()` with no argument list to reset specificity. It has no such effect.
- Don't mix `:is()` and `:where()` in one selector expecting uniform weight. Each is evaluated
  on its own arguments.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Override loses to a rule that looks simpler | An ID inside `:is()`/`:not()` | Expand the selector and re-weight it |
| Base rule beats a component rule | The base rule used `:where()` correctly | Expected; layer the components instead |
| A "zero-weight" selector outranks everything | `:not()` argument contains an ID | Move the ID out or use `:where()` |
| Adding a class to `:is()` changed nothing | Another argument is already higher | Remove the higher argument |
| Reset applies to everything with no intent | `:is()` list was written for readability | Split into `:where()` + explicit rules |

## Verifying

```bash
# 1. Functional pseudo-classes that can move specificity
grep -rnE ':(is|not|has|where)\(' --include=*.css --include=*.scss --include=*.less . | head -40

# 2. The dangerous case: an ID inside a functional pseudo-class. This is the silent one.
grep -rnE ':(is|not|has|where)\([^)]*#[A-Za-z]' --include=*.css --include=*.scss . 

# 3. Compare the two idioms side by side -- how many of each does the project use?
echo "is/has/not: $(grep -rcE ':(is|not|has)\(' --include=*.css . | awk -F: '{s+=$2} END {print s+0}')"
echo "where:      $(grep -rcE ':where\(' --include=*.css . | awk -F: '{s+=$2} END {print s+0}')"

# 4. :is() lists -- check every argument, not the first one
grep -rnoE ':is\([^)]*\)' --include=*.css . | head -20

# 5. Native nesting, which behaves the same way -- the nested selector list takes the highest
grep -rnE '^\s+&?[.#:a-zA-Z]' --include=*.css . | head -20
```

What this check cannot see: step 2 finds IDs written literally inside a pseudo-class, but the
weight also arrives through *nesting* and through a selector list that is itself passed to
`:is()` — neither is a literal `#` on the same line. And the defect only manifests when two
rules actually compete: a rule carrying a stray ID that nothing contests is invisible. The
instrument that settles it is the browser, which computes and displays the resolved value.
