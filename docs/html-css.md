---
language: "HTML/CSS"
tag: "html-css"
ecosystem: "frontend"
last_updated: "2026-10-04"
summary: "Routing hub for HTML and CSS: the cascade rules (@layer, specificity, !important), the layout properties that silently re-root a subtree, shorthand resets, and the browser-native behaviours that accept what you meant to reject."
---

# Documentation Hub: HTML/CSS

> **Agent Directive (Phase 4)**: Inspect the target project for CSS cascade structure — grep
> for `@layer`, `@import`, `!important`, `:is(`, `:not(`, `:where(`, `:has(`, `transform`,
> `filter`, `backdrop-filter`, `will-change`, `contain:`, `position: fixed`, `@media`,
> `@container`, `matchMedia`, `pattern=`, `required`, `multiple`, and `localStorage`. Then
> check for shorthand declarations (`margin:`, `padding:`, `background:`, `font:`, `all:`)
> inside override blocks. Match the conditions below to determine which `rules`, `skills`,
> `agents`, or `shared` assets to inject.
>
> **Scope**: this hub is HTML and CSS — the stylesheet and the platform behaviour it runs on.
> It does **not** cover the framework around them: Tailwind's `@layer` directive order, CSS
> Modules scoping, styled-components' specificity handling, and component-library conventions
> live with their own tools, and a JS framework's rendering is not this hub. A project can
> match both; judge each entry separately. If the defect is "the framework did not do what its
> documentation says", it is not this hub.
>
> **Status**: nine rules, covering the places where the browser is correct and the author's
> model of it is wrong — a layer order that silently inverts, a specificity that lives inside a
> pseudo-class's arguments, an `!important` that outranks the whole application, an ancestor's
> `transform` that re-roots every positioned descendant, a shorthand that resets the longhands
> you omitted, and three platform behaviours (`required` + `multiple`, `localStorage`
> synchrony, media queries) that accept what you meant to reject. No `skills` and no `shared`
> assets yet.
>
> **Version note**: written against MDN's current CSS documentation, which was restructured
> recently — CSS cascade pages moved from `CSS_cascade/*` to `Guides/*`, and HTML element
> references from `Element/<name>` to `Reference/Elements/<name>`. Every URL here reflects that
> layout; older URLs in tutorials and blog posts may 404. Two behaviours are baseline and not
> new: `@layer` and container queries are shipping, but `:is()`/`:not()`/`:has()` specificity
> and the containing-block list (including `backdrop-filter` and `contain`) have been stable for
> years, so a project on any modern browser is affected. MDN itself notes browser
> inconsistencies for `perspective` and `filter` in containing-block formation — the two rules
> that depend on it (`004`) say so and give a check that does not rely on that behaviour.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/html-css/unlayered-styles-always-win.md`
  - **Why**: An unlayered declaration always beats a layered one, regardless of specificity or
    source order — unlayered styles are an implicit layer declared *last*. The repair is never
    "raise the specificity": layer position is resolved before selector weight is consulted, so
    the common fix changes nothing and the real cause (a component rule shipped unlayered in a
    layered codebase) stays invisible.
  - **When**: Target project uses `@layer`, `layer()`, or `@import ... layer(...)` **and** has
    any CSS outside a layer, or ships a utility/component library that declares layers.
  - **Target Location**: `docs/rules/html-css/unlayered-styles-always-win.md`

- **Path**: `rules/html-css/pseudo-class-specificity-is-the-highest-argument.md`
  - **Why**: `:is()`, `:not()` and `:has()` are not pseudo-classes for specificity — their weight
    is the *highest* of their arguments, so one stray `#id` inside a list silently promotes the
    whole rule above anything it was meant to sit beside. `:where()` is the inverse and always
    0-0-0, which makes it the only way to add a matching selector without adding weight. The
    selector looks zero-weight in the source and is not.
  - **When**: Target project uses `:is(`, `:not(`, `:has(` or `:where(` in a stylesheet, or uses
    CSS nesting, which behaves the same way.
  - **Target Location**: `docs/rules/html-css/pseudo-class-specificity-is-the-highest-argument.md`

- **Path**: `rules/html-css/important-reverses-the-cascade.md`
  - **Why**: `!important` moves a declaration into a pass that runs in **reverse** order, so it
    outranks every normal rule no matter how specific or how late, and within that pass the usual
    tiebreak applies. One `!important` in a vendored sheet silently defeats the entire
    application stylesheet, and stacking a second one to beat it — the reflex fix — makes the
    maintenance worse without making the CSS correct.
  - **When**: Target project contains `!important` in any stylesheet, or imports third-party CSS
    (Bootstrap, normalize.css, a component library) that is not inside a cascade layer.
  - **Target Location**: `docs/rules/html-css/important-reverses-the-cascade.md`

- **Path**: `rules/html-css/containing-block-changes-with-transform-and-filter.md`
  - **Why**: An absolutely-positioned element resolves against the nearest ancestor that forms a
    containing block, and `transform`, `filter`, `backdrop-filter`, `perspective`,
    `will-change` and `contain` all form one — silently, for the whole subtree. The idiomatic
    `transform: translateZ(0)` / `will-change: transform` GPU hint therefore re-roots every
    `position: fixed` and percentage-sized descendant beneath it, and nothing in DevTools
    suggests why.
  - **When**: Target project has `position: fixed` or percentage-sized `position: absolute`
    elements **and** any of `transform`, `filter`, `backdrop-filter`, `perspective`,
    `will-change`, `contain: paint/layout/strict/content` on an ancestor.
  - **Target Location**: `docs/rules/html-css/containing-block-changes-with-transform-and-filter.md`

- **Path**: `rules/html-css/shorthand-properties-reset-omitted-longhands.md`
  - **Why**: A shorthand sets *every* longhand it covers — the omitted ones to the shorthand's
    default value, which is often not the property's initial value. `background: none` resets the
    colour, `font: …` resets `font-variant`/`font-size-adjust`/`font-stretch`, and because the
    reset is a declaration it competes in the cascade: that is why a longhand
    `background-color: red` in an override can lose to an earlier `background: url(…)`.
  - **When**: Target project uses shorthand properties (`margin`, `padding`, `background`,
    `font`, `border`, `all`) anywhere near override blocks, or a component's property "disappears"
    when an unrelated property on it changes.
  - **Target Location**: `docs/rules/html-css/shorthand-properties-reset-omitted-longhands.md`

- **Path**: `rules/html-css/native-form-validation-is-attribute-driven.md`
  - **Why**: Browser constraint validation is attribute semantics, not a type check, and its
    edges accept silently: `multiple` + `required` makes an **empty** list valid, an invalid
    `pattern` is ignored *completely* rather than failing, and validation runs only on
    user-initiated changes — so a value your JS set is never checked. The form submits, no
    console message appears, and only the server catches it.
  - **When**: Target project has an HTML form with `required`, `pattern`, `min`/`max`,
    `type="email"|"url"|"number"`, or `multiple`, and does not duplicate the constraints
    server-side.
  - **Target Location**: `docs/rules/html-css/native-form-validation-is-attribute-driven.md`

- **Path**: `rules/html-css/local-storage-is-synchronous-and-per-origin.md`
  - **Why**: `localStorage` is a synchronous, per-origin dictionary: every `getItem`/`setItem`
    blocks the main thread, and it is keyed by origin — a bundle on a different subdomain starts
    from an empty store with no error. In a private window it behaves like `sessionStorage`, so
    an app treating it as durable persistence writes successfully and loses the data on close.
  - **When**: Target project uses `localStorage` or `sessionStorage` — especially for payloads
    larger than a feature flag, writes on `visibilitychange`/`beforeunload`, or state meant to be
    shared across subdomains.
  - **Target Location**: `docs/rules/html-css/local-storage-is-synchronous-and-per-origin.md`

- **Path**: `rules/html-css/selector-chains-can-be-ambiguous.md`
  - **Why**: A combinator is a relationship, not a separator: `.card .title` (descendant) and
    `.card.title` (compound) target different sets, both are valid CSS, and neither errors. The
    failure mode is overriding a third-party selector with the wrong relation — the library's
    rule keeps winning and the override is inert, with two plausible-looking selectors in review.
  - **When**: Target project overrides third-party or component-library selectors, or has a
    selector that matches in development and matches nothing in production (an extra wrapper
    element).
  - **Target Location**: `docs/rules/html-css/selector-chains-can-be-ambiguous.md`

- **Path**: `rules/html-css/media-queries-are-condition-not-state.md`
  - **Why**: `@media` tests the *user environment* — viewport, orientation, pointer, hover,
    colour scheme, print — a closed set that cannot see application state, and it re-evaluates
    only on environment events. A query meant to track "is the menu open" is unevaluable rather
    than slow; the substitute is a class, or a container query when the real question is the
    component's width rather than the viewport's.
  - **When**: Target project uses `@media`, `matchMedia`, or component CSS that branches on
    viewport width; or reads `matchMedia(...)` once at load without a `change` listener.
  - **Target Location**: `docs/rules/html-css/media-queries-are-condition-not-state.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/html-css/agent.json`
  - **Why**: Helps with HTML/CSS tasks where the browser is correct and the author's model of it
    is wrong — deciding whether an override is losing to a layer or to specificity, moving a
    `:not(#id)` back to `:where()` so a selector stops carrying weight it never meant to, replacing
    a stacked `!important` with a layer instead of another escalation, portalling a `fixed`
    overlay out of a subtree that a `transform` re-rooted, writing longhands in an override so a
    shorthand cannot reset them, checking an empty `required multiple` submit and an invalid
    `pattern` that silently disables validation, and moving a large synchronous `localStorage`
    payload to IndexedDB.
  - **When**: Target project ships CSS or HTML and contains `@layer`, `!important`,
    `:is(`/`:not(`/`:where(`, `transform`, `filter`, `will-change`, `position: fixed`,
    `@media`, `pattern=`, `required`, or `localStorage`. Framework-level styling (Tailwind layer
    order, CSS Modules, styled-components) belongs to that tool, not to this hub.
  - **Target Location**: `docs/agents/html-css/agent.json`

## 4. Shared Assets (`shared/`)

_None yet._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
