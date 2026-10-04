---
title: "A transform, filter or contain on an ancestor silently re-forms the containing block of every positioned descendant"
rule_id: "RULE-HTML-CSS-004"
category: "correctness"
scope: "frontend"
applies_to: "position: absolute/fixed, transform, filter, backdrop-filter, perspective, will-change, contain, percentages"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block"
---

# A transform, filter or contain on an ancestor silently re-forms the containing block of every positioned descendant

An absolutely-positioned element does not position itself against its parent's content box. It
positions itself against the nearest ancestor that forms a containing block — and `transform`,
`filter`, `backdrop-filter`, `perspective`, `will-change` and `contain` all form one, silently,
for the whole subtree.

## Why

The default case is the one most people carry in their head, and it is only the *first* rule:

> If the position property is absolute, the containing block is formed by the edge of the
> padding box of the nearest ancestor element that has a position value other than static
> (fixed, absolute, relative, or sticky).
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

The second rule overrides the first, and it is keyed on properties that have nothing to do with
layout:

> If the position property is absolute or fixed, the containing block may also be formed by the
> edge of the padding box of the nearest ancestor element that has any of the following: A
> filter, backdrop-filter, transform, perspective, rotate, scale, or translate value other
> than none.
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

Two more do it, and both are declared rather than obvious — `will-change` is the dangerous one,
because it exists precisely to *pre-emptively* create the effect:

> A will-change value containing a property for which a non-initial value would form a
> containing block (e.g., filter or transform).
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

> A contain value of layout, paint, strict or content (e.g., `contain: paint;`).
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

Every percentage the descendant computes changes with it — that is the actual failure surface:

> Percentage values that are applied to the width, height, padding, margin, and offset
> properties of an absolutely positioned element (i.e., which has its position set to absolute
> or fixed) are computed from the element's containing block.
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

And MDN flags that even the specified behaviour is not uniform:

> Note: There are browser inconsistencies with perspective and filter contributing to containing
> block formation.
> ([Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block))

## Do

- Keep `transform`, `filter` and `will-change` off any ancestor of a `position: fixed` or
  `position: absolute` element whose size is percentage-based. Portals exist for this.
- When a `fixed` overlay must cover the viewport, render it into a portal at the document root,
  not inside a transformed subtree.
- Treat `will-change: transform` as a *layout-affecting* declaration, not a performance hint —
  it changes where descendants resolve against.
- Put the containing block boundary somewhere deliberate: an explicitly positioned wrapper is
  better than an incidental `filter`.
- When a modal or dropdown "jumps" after a scroll-linked or hover animation is added, check for
  a `transform` on the ancestor chain before anything else.

## Don't

- Don't add `transform: translateZ(0)` or `will-change: transform` to a root/app wrapper "for
  GPU acceleration" if fixed-position children live inside it. It re-roots them.
- Don't assume `position: fixed` means viewport-relative. It means viewport-relative *unless* an
  ancestor forms a containing block.
- Don't debug this with `getBoundingClientRect()` alone — the value will be correct and
  *relative to the wrong box*.
- Don't use `filter: blur(0)` as a no-op reset. It is not a no-op; it forms a containing block.
- Don't set `contain: paint` on a scroll container whose absolutely-positioned children rely on
  the viewport.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `position: fixed` overlay covers only part of the screen | Ancestor has `transform`/`filter`/`will-change` | Portal to the document root |
| `height: 100%` resolves to a small box | Containing block is a transformed ancestor | Make the boundary explicit or portal |
| Dropdown scrolls with its parent instead of the page | `position: absolute` under a containing block | Move it out, or set the boundary |
| Works in Chrome, off by a few px in Firefox | Documented perspective/filter inconsistency | Avoid relying on either for the boundary |
| Percentage padding resolves unexpectedly | Computed from the re-formed block | Compute against an explicitly sized parent |

## Verifying

```bash
# 1. Properties that silently form a containing block, anywhere in the tree
grep -rnE '(transform|filter|backdrop-filter|perspective|rotate|scale|translate|will-change|contain)\s*:' \
  --include=*.css --include=*.scss --include=*.vue --include=*.jsx --include=*.tsx . \
  | grep -vE 'transform-origin|transition|animation' | head -40

# 2. will-change specifically -- it is pre-emptive and therefore invisible in the result
grep -rn 'will-change' --include=*.css --include=*.scss . | head -20

# 3. contain: paint / layout / strict / content
grep -rnE 'contain:\s*(paint|layout|strict|content)' --include=*.css . | head -20

# 4. The GPU-acceleration idiom that causes this
grep -rnE 'translateZ\(0\)|translate3d|will-change:\s*transform' --include=*.css . | head -20

# 5. Fixed-position elements -- each one is only viewport-relative if its chain is clean
grep -rnE 'position:\s*fixed' --include=*.css --include=*.scss . | head -30

# 6. Confirm in the browser, per element: this is the check that actually settles it
#    document.querySelector('.overlay').offsetParent
```

What this check cannot see: steps 1–5 are independent greps and they do not compute ancestry —
they list every declaration and every fixed element in the project, and the defect is the
*relationship* between a declaration on one element and a positioned descendant of it. Nothing
in the source says which is which. MDN's own note that browser behaviour is inconsistent here
means a passing check is not a passing render either. The instrument that settles it is step 6,
read per element in the browser: a non-null `offsetParent` where the CSS implies the viewport is
the defect, stated plainly.
