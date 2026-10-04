---
title: "!important reverses the cascade order, so one stray important defeats every later normal rule"
rule_id: "RULE-HTML-CSS-003"
category: "correctness"
scope: "frontend"
applies_to: "!important, cascade order, origin, inline styles, third-party CSS, Bootstrap"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity"
---

# !important reverses the cascade order, so one stray important defeats every later normal rule

`!important` is not a higher weight on the same scale. It moves the declaration into a separate
pass that runs in **reverse** order — so inside that pass, a *lower*-specificity declaration beats
a higher one, and it outranks every normal rule no matter how specific or how late.

## Why

The interaction with specificity is explicit:

> Although technically, `!important` has nothing to do with specificity, it interacts directly
> with specificity and the cascade. It reverses the cascade order of stylesheets.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

Within the important pass, the normal tiebreak applies *within* a layer and origin, so the
surprising part is that stacking more `!important` on top is not what you want — removing the
stray one is:

> When conflicting declarations from the same origin and cascade layer with the `!important`
> flag are applied to the same element, the declaration with a greater specificity is applied.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> CSS declarations marked as important override any other declarations within the same cascade
> layer and origin.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

Inline styles are the one thing a normal declaration cannot reach, and `!important` is the only
way past them:

> The only way to override inline styles is by using `!important`.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> Inline styles added to an element (e.g., `style="font-weight: bold;"`) always overwrite any
> normal styles in author stylesheets, and therefore, can be thought of as having the highest
> specificity.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

MDN's guidance is not "never use it" but "use it for one thing, and say why":

> Using `!important` to override specificity is considered a bad practice and should be avoided
> for this purpose.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> Instead of using `!important` to override foreign CSS (from external libraries, like Bootstrap
> or normalize.css), import the third-party scripts directly into cascade layers.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

> If you must use `!important` in your CSS, comment your usage so future code maintainers know
> why the declaration was marked important and know not to override it.
> ([Specificity](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Specificity))

The realistic damage is a single `!important` inside a vendored sheet: it is not the sheet that
is weak, it is the one declaration, and it silently outranks the entire application stylesheet.

## Do

- Treat an `!important` in third-party CSS as read-only, and override it with a **layer**, not
  with another `!important`. See `RULE-HTML-CSS-001`.
- Use `!important` deliberately for exactly what MDN sanctions: overriding an inline style, and
  utility escapes such as `!important` accessibility overrides.
- Comment every `!important` you write, saying what it beats and why it cannot be removed.
- Reach for `@layer` or a design-token indirection before you reach for `!important`.
- If a style must win unconditionally across the whole app, set it as a custom property or a
  variable on the root and let components consume it — one decision point instead of N
  escalations.

## Don't

- Don't add a second `!important` to beat a first one from your own code. That is a fight you
  will lose on maintenance, not on the cascade.
- Don't use `!important` to win against your own more specific rule. The specificity is wrong;
  the escalation hides that instead of fixing it.
- Don't strip `!important` from a third-party sheet you do not control. Re-layer it instead.
- Don't sprinkle `!important` as a "guarantee" for a design token. It guarantees the token
  cannot be re-themed.
- Don't assume an `!important` declaration is *weaker* because its selector is class-level. The
  reverse order is the whole point.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| App styles cannot override a vendor rule | Vendor `!important` | Import the vendor sheet into a layer |
| Utility class ignored | An earlier `!important` on the same property | Remove it or layer the utilities last |
| Two overrides, only the less specific one applies | Both important, order within the pass | Delete the stray one; do not stack more |
| Theme switching needs `!important` everywhere | Token applied directly instead of via a variable | Switch the variable at `:root` |
| Fix "works" only until the next library upgrade | `!important` added to fight specificity | Use `@layer` |

## Verifying

```bash
# 1. Every !important in project code, with the comment MDN requires
grep -rn '!important' --include=*.css --include=*.scss --include=*.less . | head -40

# 2. Important declarations that are NOT commented -- these are the unexplained ones
grep -rn '!important' --include=*.css --include=*.scss . | grep -v '/\*' | grep -v '^\s*//'

# 3. Third-party sheets shipped locally, which is where the dangerous ones live
find . -path ./node_modules -prune -o -name '*.css' -print | xargs grep -ln '!important' 2>/dev/null \
  | grep -vE 'src/|app/|styles/'

# 4. Inline styles -- the only thing that needs !important to override
grep -rnE 'style="' --include=*.html --include=*.jsx --include=*.tsx --include=*.vue . | wc -l
grep -rnE 'style="' --include=*.jsx --include=*.tsx . | head -10

# 5. Layers as the alternative -- is the project using them at all?
grep -rn '@layer\|@import.*layer(' --include=*.css . | head -10
```

What this check cannot see: step 1 finds the declarations but not which ones actually *win* —
that depends on what competes with them, and a grep cannot resolve the cascade. Steps 3 and 4
are also shape-only: a vendored file under `src/` (a copied Bootstrap, say) looks like project
code, and an inline style set through a CSS-in-JS library will not appear in the markup at all.
The instrument that settles it is the browser's computed-style panel, which shows the winning
declaration and marks it as important.
