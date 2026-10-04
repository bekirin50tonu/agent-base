---
title: "A combinator is a relationship, not a separator — a missing space silently changes which elements match"
rule_id: "RULE-HTML-CSS-008"
category: "correctness"
scope: "frontend"
applies_to: "combinators, descendant, child, sibling, compound selectors, :is(), overrides"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators"
---

# A combinator is a relationship, not a separator — a missing space silently changes which elements match

`.card .title` and `.card.title` are two different rules about two different sets of elements.
Neither is a typo the browser reports; both are valid CSS, both look like the same intent, and
one of them matches nothing.

## Why

MDN's definition is about relationships, which is the part that gets skipped when the selector
is treated as a string:

> CSS combinators define relationships between selectors. They allow you to select elements based
> on their relationship to other elements in the document tree.
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

> For example, to style only paragraph elements that are direct children of a `<div>`, you can use
> the child combinator (`>`):
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

There are five, and each is a different relation — which is exactly why picking the wrong one
does not degrade, it re-targets:

> Child combinator (>)
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

> Descendant combinator (" ")
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

> Next-sibling combinator (+)
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

> Column combinator (||)
> ([Combinators](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/Combinators))

The practical failure is in **overrides**, and it is the reason this rule is about relationships
rather than about syntax. A library ships `.btn .label { … }` (descendant). The project ships
`.btn.label { … }` (compound) intending to override it. Both selectors are valid, both are
plausible, and neither applies to the other's nodes — so the library's rule keeps winning and the
override is inert.

## Do

- Read every selector as a set: "elements matching X that are *related to* an element matching Y".
  If the relation is wrong, the set is wrong.
- Prefer an explicit combinator over an implied one when overriding third-party selectors.
- Check the actual DOM shape before writing a descendant selector: is the class on the same
  element or an ancestor?
- Use a class for the override target rather than a deeper chain, when the chain is only there
  to win a specificity fight.
- When a selector "matches nothing", list the elements it *should* match and compare against
  DevTools' matched-rules panel before rewriting.

## Don't

- Don't treat a space as decoration. It is a combinator with real semantics.
- Don't write a deep descendant chain to override a compound selector (or vice versa) and assume
  specificity decides — the sets differ, so specificity never comes into play.
- Don't use `>` in an override unless you have confirmed the target is a *direct* child; an extra
  wrapper div silently breaks it.
- Don't reach for `+`/`~` sibling combinators in component CSS without checking what actually
  follows in the DOM, since component order is often not under your control.
- Don't assume the absence of a combinator means "same element" in every context — inside
  `:is()` and nesting the same characters behave differently.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Override has no effect | Descendant written against a compound selector | Match the library's actual relation |
| Style applies, then breaks when a wrapper is added | `>` assumed a direct child | Use the descendant combinator, or remove the wrapper |
| Selector matches nothing | Class is on an ancestor, not the node | Check the DOM, fix the relation |
| Works alone, fails in a list | One selector in the group is invalid | Split and test each separately |
| Sibling style stops applying after a reorder | `+`/`~` depend on DOM order | Target by class instead |

## Verifying

```bash
# 1. Every combinator in use -- the child (>) and sibling (+) cases are the fragile ones
grep -rnoE '[.#a-zA-Z\[][^,{]*[>+~][^,{]*\{' --include=*.css --include=*.scss . | head -40

# 2. Deep descendant chains in overrides -- the shape that breaks on a wrapper
grep -rnE '\.[a-zA-Z-]+ \.[a-zA-Z-]+ \.[a-zA-Z-]+ \.' --include=*.css --include=*.scss . | head -20

# 3. Column combinator, easy to type by accident
grep -rn '||' --include=*.css --include=*.scss .

# 4. Compound selectors inside functional pseudo-classes -- see RULE-HTML-CSS-002
grep -rnoE ':(is|not|where|has)\([^)]*\)' --include=*.css . | head -20

# 5. Native nesting, where & changes the relation
grep -rnE '^\s+&' --include=*.css --include=*.scss . | head -20

# 6. Settle it per selector in the browser, which is the only place the set is visible:
#    document.querySelectorAll('<selector>').length
```

What this check cannot see: steps 1–5 are all textual and none of them resolve a selector against
the document — they cannot tell whether `.card .title` matches because the relation is right or
because the elements happen to be arranged that way in one page. A selector that matches in the
dev route and matches nothing in production is the same source line in both. The instrument that
settles it is step 6: `querySelectorAll` on the built page, per selector, per route.
