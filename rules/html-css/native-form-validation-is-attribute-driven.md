---
title: "Native constraint validation is attribute-driven, and its silent edges let a required field submit empty"
rule_id: "RULE-HTML-CSS-006"
category: "correctness"
scope: "frontend"
applies_to: "input, required, multiple, pattern, min, max, type=email/url/number, constraint validation, forms"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email"
---

# Native constraint validation is attribute-driven, and its silent edges let a required field submit empty

Browser validation is a set of attribute semantics, not a type check. Several of those
semantics accept a value the author did not intend to accept, and they accept it without any
error — no console message, no red border, no exception.

## Why

The `multiple` + `required` combination is the load-bearing one, and MDN states it as a
property of the attribute rather than of the validation:

> However, if you add the `multiple` attribute, a list of zero email addresses (an empty
> string, or one which is entirely whitespace) is a valid value. In other words, the user does
> not have to enter even one email address when `multiple` is specified, regardless of the value
> of `required`.
> ([The Input Label Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email))

The constraint's scope is also narrower than "the form":

> If and only if the `multiple` attribute is specified, the value can be a list of properly-formed
> comma-separated email addresses.
> ([The Input Label Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email))

An invalid `pattern` is not a validation failure — it is no validation at all, which is why a
typo in a regex silently disables the check:

> If the specified pattern is not specified or is invalid, no regular expression is applied and
> this attribute is ignored completely.
> ([The Input Label Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email))

And validation is event-scoped, so it does not run for values your own code set:

> Constraint validation is only applied when the value is changed by the user.
> ([The Input Label Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email))

One more, the most common regex mistake — the delimiters:

> No forward slashes should be specified around the pattern text.
> ([The Input Label Element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/email))

## Do

- Treat native validation as a **first-line** guard for the user, never as the boundary. Validate
  the same constraints on the server, from the same table of rules.
- If a field must contain at least one value, do not rely on `required` alone with `multiple` —
  check the length on submit.
- Write a test that submits an empty `multiple` field, and one that submits a value your JS set
  programmatically.
- Keep `pattern` values free of `/` delimiters, and treat a `pattern` you cannot re-derive as a
  typo risk.
- Use `type` attributes for what they actually validate (`email`, `url`, `number` are *shapes*,
  not semantics), and put the real rules in the server.

## Don't

- Don't assume `required` means "must be non-empty" when `multiple` is present.
- Don't set a field's value in JS and expect the browser to complain about it. It will not be
  validated until a user changes it.
- Don't rely on an invalid `pattern` failing closed. It fails *open* — the attribute is ignored.
- Don't assume `type="email"` rejects a plausible-looking string. It checks shape, not
  deliverability, and it is permissive about what counts as a domain.
- Don't use `type="number"` as a range guarantee; `min`/`max` are separate attributes and are
  not enforced on programmatic values.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Required multi-value field submits empty | `multiple` makes an empty list valid | Server-side length check |
| An invalid email passes the browser | Shape-only validation | Server-side validation |
| A `pattern` that "does nothing" | Invalid regex, attribute ignored | Fix or drop the pattern |
| Pre-filled invalid value is submitted | Validation runs only on user change | Validate on submit |
| Regex never matches | Slashes included in `pattern` | Remove the delimiters |
| `min`/`max` bypassed by JS-set value | Not validated until user input | Validate in the handler |

## Verifying

```bash
# 1. Fields whose emptiness is a real risk: required + multiple
grep -rnE 'required' --include=*.html --include=*.jsx --include=*.tsx --include=*.vue . \
  | grep -i 'multiple\|multi'

# 2. Every pattern attribute -- check each one compiles and has no / delimiters
grep -rnoE 'pattern="[^"]*"' --include=*.html --include=*.jsx --include=*.tsx --include=*.vue .

# 3. Type attributes in use: what shape is being claimed?
grep -rhoE 'type="(email|url|number|tel|date|datetime-local|month|time)"' \
  --include=*.html --include=*.jsx --include=*.tsx --include=*.vue . | sort | uniq -c | sort -rn

# 4. novalidate on a form -- validation deliberately off, client-side only
grep -rn 'novalidate' --include=*.html --include=*.jsx --include=*.tsx .

# 5. Programmatic value assignment -- the path constraint validation does not cover
grep -rnE '\.(value|setAttribute)\s*=|\.value\s*=' --include=*.jsx --include=*.tsx --include=*.vue . | head -20

# 6. Prove the empty-submit case in the browser, not by reading the markup:
#    form.requestSubmit() on a required+multiple field with an empty value
```

What this check cannot see: step 2 finds `pattern` attributes but cannot tell you whether the
regex is *valid* — an invalid one is silently ignored by the browser, which is the defect, and
only a compile tells you. Step 5 finds assignments but not whether the assigned value ever
reaches a submit without a user edit. And none of it can tell you what the server does with the
result, which is the boundary that actually matters. The instrument that settles the browser half
is step 6: `form.requestSubmit()` from script, which runs validation on values no user touched.
