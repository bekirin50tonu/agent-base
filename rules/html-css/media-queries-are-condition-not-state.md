---
title: "Media queries test the user environment, not application state — a state-driven rule belongs in a class or a container query"
rule_id: "RULE-HTML-CSS-009"
category: "correctness"
scope: "frontend"
applies_to: "@media, prefers-color-scheme, prefers-reduced-motion, container queries, matchMedia, responsive design"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries"
---

# Media queries test the user environment, not application state — a state-driven rule belongs in a class or a container query

`@media` evaluates a closed set of environment values: viewport, orientation, pointer and hover
capability, color scheme, print. Nothing in that set describes the application's own state. A
query that asks "is the menu open" is not a slow query — it is an unevaluable one, and it fails
without an error.

## Why

MDN defines the module by its inputs:

> The CSS media queries module enables testing and querying of viewport values and browser or
> device features, to conditionally apply CSS styles based on the current user environment.
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

> In CSS, use the `@media` at-rule to conditionally apply part of a style sheet based on the
> result of a media query.
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

The re-evaluation boundary is documented too, and it is what produces the silent version of the
bug — results change on *environment* events, and nothing else notifies you:

> Testing media queries Describes how to use media queries in your JavaScript code to determine
> the state of a device, and to set up listeners that notify your code when the results of media
> queries change (such as when the user rotates the screen or resizes the browser).
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

MDN names the correct substitute directly, and the distinction is **scope**, not timing: a media
query measures the viewport, a container query measures the element the rule applies to.

> When designing reusable HTML components, you may also use container queries, which allow you to
> apply styles based on the size of a containing element rather than the viewport or other device
> characteristics.
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

Two more facts worth carrying: the query is a *stylesheet* concern and also has a JS surface
(`matchMedia`, which must be paired with a listener to stay current), and the level-4
deprecations mean a media feature copied from an old tutorial may not exist.

> Media queries are used in the CSS `@media` rule and other contexts and languages such as HTML
> and JavaScript.
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

> Note: CSS media queries level 4 deprecated three `@media` descriptors: `device-aspect-ratio`,
> `device-height`, and `device-width`.
> ([Media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries))

## Do

- Use `@media` for environment facts the user controls outside the page: viewport size,
  orientation, `prefers-reduced-motion`, `prefers-color-scheme`, `hover`, `pointer`, print.
- Use a class or `data-*` attribute for application state — the menu being open, a panel being
  expanded, a theme toggle having been clicked.
- Use a container query when the right answer depends on the component's own width rather than
  the viewport's. This is what makes a component reusable across layouts.
- In JavaScript, treat `matchMedia(...)` as a *snapshot*: read `.matches` for the initial
  decision and attach a `change` listener, or you will miss the first transition.
- Prefer a user-overridable preference (`prefers-color-scheme` plus a manual override class)
  over either alone.

## Don't

- Don't put a state class inside a `@media` block expecting the state to drive it. The query
  cannot see the class; the class cannot be read by the query.
- Don't use `matchMedia` once at load and store the result as if it were a value that updates.
- Don't branch component CSS on viewport width when the component's width is what actually
  determines the layout — that is the container-query case.
- Don't use the deprecated `device-width`, `device-height` or `device-aspect-ratio` descriptors
  copied from older tutorials.
- Don't write a media query to detect a state the user can only reach by clicking in your own UI.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Rule never applies when the state changes | Query tests environment, not state | Move to a class |
| Component misbehaves at the same viewport in two layouts | Viewport query used for a component | Container query |
| Theme ignores a manual toggle | Only `prefers-color-scheme` used | Add an override class, default it from the query |
| Layout breaks on rotate, JS state stale | `matchMedia` read once, no listener | Attach a `change` listener |
| Old tutorial's query silently ignored | Deprecated descriptor | Use the level-4 feature |

## Verifying

```bash
# 1. Every media query in the project
grep -rn '@media' --include=*.css --include=*.scss --include=*.less . | head -40

# 2. matchMedia read once vs listened to -- the JS half of the same rule
grep -rn 'matchMedia' --include=*.js --include=*.ts --include=*.jsx --include=*.tsx --include=*.vue .

# 3. Deprecated descriptors copied from old tutorials
grep -rnE 'device-width|device-height|device-aspect-ratio' --include=*.css --include=*.scss .

# 4. Container queries, if any -- the correct tool for component scope
grep -rn '@container\|container-type\|container-name' --include=*.css --include=*.scss .

# 5. State that is *almost* being done with a media query: viewport branches near a class toggle
grep -rnE 'prefers-reduced-motion|prefers-color-scheme|hover:|pointer:' --include=*.css . | head -20

# 6. Settle it in the browser: window.matchMedia(query).matches, and whether a change listener exists
```

What this check cannot see: step 1 lists queries but cannot tell which of them were *meant* to
test application state — that intent is invisible in CSS, and a query that reads fine may have
been written against a state the author later removed. Step 2 finds `matchMedia` but not whether
the result is read inside a listener, which is the actual defect. The instrument that settles it
is step 6: evaluate the query in the browser and confirm a listener exists for every query the JS
depends on.
