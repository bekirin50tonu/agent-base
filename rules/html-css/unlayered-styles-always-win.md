---
title: "Unlayered styles always beat layered ones, and specificity cannot rescue a layered rule"
rule_id: "RULE-HTML-CSS-001"
category: "correctness"
scope: "frontend"
applies_to: "@layer, cascade layers, layer(), @import, CSS cascade, reset, utilities"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction"
---

# Unlayered styles always beat layered ones, and specificity cannot rescue a layered rule

`@layer` does not decide which styles *apply*. It decides which style wins when two
declarations conflict — and the decision is made before selector weight is ever consulted, so
a more specific rule inside a layer loses to an unlayered one that is less specific and
earlier in the file.

## Why

The mechanism is positional, not a special rule: unlayered declarations are modelled as an
implicit layer declared *after* every named layer.

> Styles declared outside of a layer are treated as being part of an anonymous last declared
> layer.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

> For all origins - user-agent, author, or user - styles can be declared within or outside of
> named or anonymous layers.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

> When declared using layer, layer() or @layer, styles are placed into the specified named
> layer, or into an anonymous layer if no name is provided.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

And the consequence is stated without qualification — position in the file does not matter:

> The declaration defined in a cascade layer, though it may come later in the code, will not
> take precedence either as normal styles in cascade layers have less precedence than normal
> unlayered styles.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

> These layered styles have lower precedence than all normal unlayered styles, which includes
> normal styles from unlayeredStyles.css, moreUnlayeredStyles.css, and the color of p in the
> <style> itself.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

> Even though the red is declared first and has a less specific selector, because unlayered CSS
> takes precedence over layered CSS, the paragraph will be red.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

Specificity only gets consulted *within* the losing side, which is why raising the specificity
of a layered rule is the wrong repair:

> Those declarations are removed from consideration because of origin; normal layered styles
> have less precedence than normal unlayered styles.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

> If, however, the more specific selector :root body p { color: black; } was found in
> unlayeredStyles.css, as both origin and importance have the same precedence, specificity
> would mean the more specific, black declaration would win.
> ([Cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction))

The rule is not "layers are bad". It is that a layer is a *demotion*, and the most common
failure is shipping a component rule unlayered in a stylesheet that was designed around layers.

## Do

- Put **every** rule in a named layer, including your own components. An unlayered rule is the
  highest-precedence rule in the file, not a neutral one.
- Import third-party CSS into a layer so your overrides have somewhere to sit:
  `@import url("bootstrap.css") layer(framework);`
- Declare the layer order **once, at the top**, before any rule is written:
  `@layer reset, framework, base, components, utilities;`
- When an override "does not work", check whether either side is layered **before** touching
  specificity.
- Put `!important` and inline-style behaviour out of scope when diagnosing a layer problem —
  see `RULE-HTML-CSS-003`.

## Don't

- Don't mix layered and unlayered declarations in the same cascade and expect source order to
  decide. It will not.
- Don't fix a losing layered rule by making it more specific. Layer position is resolved first.
- Don't assume `@layer base, components, utilities;` affects anything outside a layer — it only
  orders the layers it names.
- Don't import a vendored stylesheet *after* writing your own layered rules without putting it
  in a layer; `@import` must precede other rules and is easy to place wrong.
- Don't use a layer to "fix" an override that is actually losing because of a specificity
  mistake inside the same layer.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Utility class has no effect on a component | Component rule is unlayered | Put components in a layer |
| Overridden rule still applies | Both sides layered in the wrong order | Declare layer order explicitly |
| Raising specificity changed nothing | Layer position already decided it | Move the rule into a later layer |
| Third-party CSS resists overrides | Imported outside a layer | `@import ... layer(name)` |
| Layer order depends on file order | Layer list declared after use | Declare the full list at the top |

## Verifying

```bash
# 1. Every layer statement in the tree -- the layer list should appear exactly once, first
grep -rn '@layer' --include=*.css --include=*.scss --include=*.less . | head -40

# 2. Layered vs unlayered rule counts. A file with layers and also many unlayered rules
#    is where this defect lives.
grep -rc '@layer' --include=*.css . | grep -v ':0'

# 3. Unlayered rules in a codebase that uses layers at all
grep -rn '@layer' --include=*.css . >/dev/null && \
  grep -rn --include=*.css -E '^\s*[.#a-zA-Z\[][^{]*\{' . | grep -v '@layer' | head -30

# 4. Framework CSS imported without a layer
grep -rn '@import' --include=*.css . | grep -v 'layer('

# 5. Inline styles -- the one thing layers do not outrank
grep -rnE 'style="[^"]*(color|display|position|margin|padding)' --include=*.html --include=*.jsx --include=*.tsx . | head -20
```

What this check cannot see: step 3 flags unlayered rules by shape, but it cannot tell whether a
given unlayered rule *loses* — that depends on what it competes with at run time. Nor can it
detect a layer that was declared but never used, or an `@import` that a bundler (Vite, webpack
with css-loader) inlines at build time, which changes what "imported outside a layer" even
means. The instrument that actually settles it is the browser's own Styles panel: read the
winning rule and check whether the losing one is listed as belonging to a layer.
