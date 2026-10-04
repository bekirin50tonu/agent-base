---
title: "A shorthand sets the longhands you omitted to the shorthand's default, not to their initial value"
rule_id: "RULE-HTML-CSS-005"
category: "correctness"
scope: "frontend"
applies_to: "margin, padding, background, font, border, flex, grid, animation, all, reset"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Shorthand_properties"
---

# A shorthand sets the longhands you omitted to the shorthand's default, not to their initial value

A shorthand is not "set only what I wrote". Every longhand it covers is set — the ones you
omitted to the shorthand's *default value*, which is often not the property's *initial value*.
The distinction is the whole bug.

## Why

The definition is stated in exactly those words:

> A value which is not specified is set to a default value defined by the shorthand, which may
> differ from the property's initial value.
> ([Shorthand properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Shorthand_properties))

> For example, the CSS background property is a shorthand property that's able to define the
> values of background-color, background-image, background-repeat, and background-position.
> ([Shorthand properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Shorthand_properties))

And the consequence is easy to get backwards — `background: none` does not leave the colour
alone, it *resets* it:

> This will not set the color of the background to red but to the default value for
> background-color, which is transparent.
> ([Shorthand properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Shorthand_properties))

The `font` shorthand is the documented example of three longhands being reset by omission:

> This shorthand declaration is actually equivalent to the longhand declarations above plus
> font-variant: normal, font-size-adjust: none, and font-stretch: normal.
> ([Shorthand properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Shorthand_properties))

So `font: 16px/1.4 system-ui` does not "inherit" the other font properties — it sets them. And
because the reset is a *declaration*, it competes in the cascade like any other: a
`background: url(...) no-repeat` earlier in the file beats a later `background-color: red` not
because red is less specific but because the shorthand re-declared `background-color` as part of
a reset.

## Do

- Use longhand properties in **overrides**. A `background-color: red` in an override block will
  never lose to a shorthand in a way you can reason about by specificity alone.
- When you must use a shorthand, write the longhands you mean to keep, explicitly.
- Prefer a reset stylesheet that sets everything once at `0-0-0`, then treat shorthands as
  opt-in per component.
- Remember `all` is the extreme case: `all: unset` / `all: revert` touches every property,
  including ones you did not know the element had.
- When a component "loses" a property it did not appear to set, look for a shorthand in a more
  specific rule.

## Don't

- Don't use `background: none` to clear only an image — it resets the colour, position, repeat,
  attachment, clip and origin too.
- Don't assume `font:` inherits `font-variant` / `font-stretch` / `font-size-adjust`. It
  overwrites them.
- Don't write `margin: 0 auto` in an override expecting `margin-top` from the base rule to
  survive. It is reset to `0` by the shorthand's own value.
- Don't mix a shorthand and a longhand for the same property group in one rule and expect
  partial application.
- Don't use `all: unset` on a component to "normalise" it without knowing it resets inherited
  typography as well.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `background-color` in an override does nothing | A shorthand in another rule re-declared it | Use longhands in overrides |
| `font-stretch`/`font-variant` reset by a `font:` rule | `font` shorthand resets omitted longhands | Write the longhands explicitly |
| Vertical margin from a base rule disappears | `margin: 0 auto` reset `margin-top` | Longhands in the override |
| Padding on one side vanishes | `padding: …` shorthand with fewer values | Declare all four sides |
| Component loses inherited font settings | `all: unset` reset them | Scope the reset, or use `revert` |

## Verifying

```bash
# 1. Shorthand declarations in the project -- the candidates
grep -rnE '^\s*(margin|padding|background|font|border|flex|grid|animation|transition|all|inset|overflow|gap|place-items|place-content)\s*:' \
  --include=*.css --include=*.scss --include=*.less . | head -50

# 2. The most common offender specifically
grep -rn 'background:\s*\(none\|transparent\|0\|initial\)' --include=*.css --include=*.scss .

# 3. font shorthands -- each one resets three longhands by omission
grep -rnE '^\s*font\s*:' --include=*.css --include=*.scss . | grep -v 'font-' | head -20

# 4. Shorthand and longhand for the same property group in the same rule -- the reset is invisible here
grep -rnE '^\s*(background|margin|padding|font)\s*:.*;' --include=*.css . \
  | grep -E '(background|margin|padding|font)-(color|top|right|bottom|left|size|stretch|variant|style|position|repeat|origin|clip|attachment)\s*:' | head -20

# 5. The nuclear option
grep -rnE '\ball\s*:\s*(unset|revert|initial|inherit)' --include=*.css --include=*.scss .

# 6. Settle it per element in the browser -- what the shorthand actually resolved to
#    getComputedStyle(el) for each longhand in the group
```

What this check cannot see: steps 1–5 find shorthands by shape but cannot tell which longhands
they reset, because that depends on the property's own grammar — `background` covers eight
longhands, `margin` covers four, and no grep can parse which values were present. Step 4 is a
heuristic that catches only same-rule mixing. The instrument that settles it is step 6: reading
the computed value of each longhand in the group on the rendered element, which is the only place
the reset is visible as a value.
