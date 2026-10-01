---
title: "Identifier and Key Naming Conventions"
category: "conventions"
applies_to: "Any project with source files, JSON payloads, or config keys — any language"
last_updated: "2026-10-01"
source: "https://peps.python.org/pep-0008/, https://jsonapi.org/recommendations/, https://learn.microsoft.com/en-us/dotnet/standard/language-independence, https://doc.rust-lang.org/reference/identifiers.html, https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/general-naming-conventions"
---

# Identifier and Key Naming Conventions

There is a common house rule — "identifiers and dict keys must be English" — that is usually
enforced for the wrong reason and relaxes for the wrong one. The standards do not agree on it,
and the disagreement is informative. Read the rule below instead: it is stricter than the house
rule where the standards are strict, and it stops short of a prohibition that two of three
languages explicitly decline to make.

## The rule

> **Identifiers and data keys are ASCII, NFC-normalized, and read as English words. Abbreviations
> and domain terms are fine. Non-ASCII is a deliberate exception requiring a reason, not a
> default.**

Three separable constraints, often conflated:

| Constraint | Status | Why |
|---|---|---|
| ASCII-only | Project policy (PEP 8 `MUST`); *not* a language rule | Interop with FFI/ABI and tooling that assumes ASCII |
| NFC-normalized | Language requirement (CLS Rule 10) | Two spellings of one name must not be two identifiers |
| English words | Project policy (PEP 8 `SHOULD`) | Searchability and review across locales |

The failure mode is assuming one implies the others. In Rust, `Москва` is a *valid identifier*
and the only ASCII restriction is on ABI-facing surfaces. In .NET, CLS does not require ASCII at
all — it requires NFC. Treating "keep it English" as a language rule produces code that a
reviewer cannot distinguish from a language-level violation, and misses the NFC bug entirely.

## What the standards actually say

**Python** states the policy most directly, and attaches a scope limit that is easy to miss:

> All identifiers in the Python standard library MUST use ASCII-only identifiers, and SHOULD
> use English words wherever feasible (in many cases, abbreviations and technical terms are
> used which aren't English). Open source projects with a global audience are encouraged to
> adopt a similar policy.
> — https://peps.python.org/pep-0008/

The parenthetical matters: "wherever **feasible**", with abbreviations and technical terms named
as legitimate exceptions. This is a project-level policy for a globally-distributed library, not
a language constraint — and the source explicitly invites outside projects to adopt it.

**Rust** shows what a language that thinks this through looks like. Non-ASCII identifiers are
allowed; ASCII is required only where a non-ASCII name would break a boundary the compiler
cannot police:

> Identifiers are restricted to the ASCII subset of XID_Start and XID_Continue in the following
> situations: `extern crate` declarations, external crate names referenced in a path, module
> names loaded from the filesystem without a `path` attribute, `#[no_mangle]` attributed items,
> item names in `extern` blocks.
> — https://doc.rust-lang.org/reference/identifiers.html

The signal: the restriction is tied to **surfaces other tools read**, not to the notion of
English. A crate name becomes a filename on disk; a `#[no_mangle]` symbol becomes a linker
symbol. Those break on non-ASCII. A local variable named `персистент` breaks nothing.

**.NET's CLS** does something no other source here does, and it is the constraint most often
missed:

> Identifiers shall be in the canonical format defined by Unicode Normalization Form C. For CLS
> purposes, two identifiers are the same if their lowercase mappings are the same. That is, for
> two identifiers to be considered different under the CLS they shall differ in more than simply
> their case.
> — https://learn.microsoft.com/en-us/dotnet/standard/language-independence

NFC means `café` must be encoded one way. The decomposed form (`e` + U+0301 combining acute) and
the composed form (U+00E9) are different byte sequences that a reader sees as identical and a
compiler sees as two different names. This is a real defect, and "keep it ASCII" prevents it
only incidentally — by banning the character rather than normalizing the spelling.

**JSON:API** covers the data-key half, and gives the reason for its rules in a way that
generalizes past APIs:

> The specification places certain hard restrictions on how members (i.e., keys) in a JSON:API
> document may be named. To further standardize member names, **which is especially important
> when mixing profiles authored by different parties**, the following rules are also recommended:
>
> - Member names SHOULD be camel-cased (i.e., `wordWordWord`)
> - Member names SHOULD start and end with a character "a-z" (U+0061 to U+007A)
> - Member names SHOULD contain only ASCII alphanumeric characters
> — https://jsonapi.org/recommendations/

Read the reason: this is not about the server's language. A `dict` key is a **wire-format
artifact shared between a producer and a consumer written by different people in different
locales**. That is the same interop argument as the Rust ABI case, and it is the actual basis
for the rule — not an assumption that the reader speaks English.

## Do

- **Normalize any identifier containing a non-ASCII character to NFC before saving.** A file
  edited on macOS (NFD by default) and the same file edited on Linux (NFC) can produce two
  distinct names for the same symbol, and the resulting bug reads as a phantom.
- **Keep names ASCII on any surface another tool reads**: crate/module names on disk, FFI and
  `extern` symbols, environment variables, CLI flags, URL path segments, and database column
  names consumed by a BI tool.
- **Follow the ecosystem's own casing convention, not a universal one.** `camelCase` in JSON,
  `snake_case` in Python and Go, `PascalCase` for types in most languages. JSON:API's `camelCase`
  is an API convention, not a universal one — the word "camelCase" appears in it as a
  *recommendation for interop*, not a correctness rule.
- **Prefer the word that matches the domain glossary** even if it is shorter in characters but
  longer to read. .NET's guideline is explicit:
  > ✔️ DO favor readability over brevity. The property name `CanScrollHorizontally` is better
  > than `ScrollableX` (an obscure reference to the X-axis).
  > — https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/general-naming-conventions
- **Write non-ASCII identifiers in English** even where the language allows anything. The point
  is not the language accepting it; it is that a mixed-language codebase raises the cost of
  every search, every `grep`, and every cross-team review.

## Don't

- **Don't treat "identifiers must be English" as a language rule.** It is a project policy, and
  it has an explicit exception clause. Writing it as a hard language prohibition is wrong in
  Rust and .NET, and hides the NFC requirement, which is the actual technical constraint.
- **Don't use non-ASCII on ABI or filesystem surfaces**, even in a language that allows it
  generally. This is the one case where a non-ASCII name is a defect rather than a preference.
- **Don't use `_`, `-`, or punctuation in identifiers** in languages where it is avoidable.
  Note this is .NET guidance, not universal — Go and Rust use underscores as a matter of course.
  Apply it where the ecosystem does not have a stronger convention.
- **Don't invent a key's case to match its current content.** A `dict` key is a contract. If a
  field changes from `null` to an object, the key stays the same.
- **Don't use abbreviations that are not universally understood.** `GetWindow` over `GetWin`.
  But do not stretch this into forbidding domain terms — `id`, `url`, `oauth`, `uuid` are
  standard and spelled in ASCII.

## Homoglyphs are a different problem — do not conflate them

The searchable literature on "non-ASCII in identifiers" is dominated by **Trojan Source** and
related confusable-character research, and those results are about something else entirely. A
homoglyph is a character from another script that *renders identically* to a Latin letter —
Cyrillic `а` (U+0430) for Latin `a`, or `ⅼ` for `l`. The attack is that a reviewer reading
the code sees `ⅼnternals` as `Internals`, or a patch's `аssign` is read as `assign`.

This is **not** about a non-English identifier. `Москва` is not a homoglyph attack; it is
announced, visible, and harmless. A Cyrillic `а` inside an otherwise-English word is.

Keeping identifiers in English does nothing against this — the attacker's identifier *is*
English-looking. The mitigations are different ones: source-level confusable detection, linters
that flag mixed-script identifiers, and Unicode `Script` property checks. If a project has a
homoglyph problem, this rule is the wrong tool for it, and treating the two as one produces a
rule that looks thorough and protects nothing.

## Code example

```python
# Don't: two visually identical names, two different identifiers
café = compute()          # NFC  — U+00E9
café = compute()          # NFD  — 'e' + U+0301. A different variable.

# Do: ASCII name, normalized
customer_name = compute()

# Do: non-ASCII where the domain demands it and the surface is safe
# (a local variable in a language that permits it — allowed, but why bother)
```

```jsonc
// Don't: key casing drifts with content; hyphen needs escaping in a URL path
{ "data": { "user_id": 1 }, "Data": null, "meta-data": {} }

// Do: stable, ASCII, starts and ends a-z (JSON:API member rules)
{ "data": { "userId": 1 }, "meta": { "data": null } }
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `UnboundLocalError` on a name that visibly exists | NFD/NFC split — two spellings, two identifiers | Normalize to NFC in the editor and pre-commit |
| FFI build fails on an otherwise-valid symbol | Non-ASCII in an `extern`/`#[no_mangle]` surface | Restrict to ASCII on ABI surfaces only |
| Lookup by `dict` key fails across services | Key casing or encoding differs per producer | Fix the key once at the contract, not per call site |
| A review comment says "rename this to English" with no other reason | The rule was applied as a language rule | It is project policy — the exception clause is real |
| A homoglyph slips through review | Confusable-character attack, not a language issue | Mixed-script linter, not a naming policy |

## Verifying

```bash
# Non-ASCII anywhere in identifiers or string keys (adjust per language)
grep -rPn '[^\x00-\x7F]' --include='*.py' --include='*.go' --include='*.ts' src/ | head -20

# Find NFC/NFD split pairs: two files whose only difference is Unicode form
# macOS ships NFD; Linux NFC. This is the most common way the bug appears.
git grep -Pn '[^\x00-\x7F]' -- '*.cs' '*.java' '*.ts' | head
```

If the first command returns nothing, the project already satisfies the ASCII half. If the
second returns a *pair* of lines that look identical, that is the NFC bug and it is worth
fixing before anything else in this document.
