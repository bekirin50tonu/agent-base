---
title: "Carbon — what time is it, and which clock are we on"
category: "architecture"
scope: "backend"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/getting-started/introduction.html"
---

# Carbon — what time is it, and which clock are we on

Four decisions account for most Carbon defects that surface somewhere other than the date code
that caused them. In every one of them the shipped default is a reasonable choice that answers a
question nobody asked.

This sits one level below `RULE-CARBON-001` … `RULE-CARBON-009`, which explain each mechanism.
This matrix is for choosing between them.

## The four questions

1. **Which clock?** `now()` reads the system clock, or a mock if one is set. (`RULE-CARBON-001`)
2. **Mutable or immutable?** `Carbon` returns the same object; `CarbonImmutable` returns a new
   one. (`RULE-CARBON-003`)
3. **Which unit?** "Week" means two things, and `diff*()` is signed where a distance was meant.
   (`RULE-CARBON-006`, `RULE-CARBON-002`)
4. **Which format?** Phrases and week numbers are rendered, not stored — and the locale is
   process-wide. (`RULE-CARBON-007`, `RULE-CARBON-009`)

## The defaults, in one table

| Decision | Shipped default | The default's cost |
|---|---|---|
| `Carbon::now()` source | System clock | Silent if a mock leaked |
| `Carbon::setTestNow()` scope | Global static | Leaks across tests and packages |
| Relative phrases under a mock | Mocked too | A test asserts a fictional clock |
| Mock carries a timezone | Not since 2.56.0 | Two versions, two behaviours |
| `Carbon` mutability | Mutable | A shared reference changes under its owner |
| `CarbonImmutable` | Opt-in | The default type is the mutable one |
| `addMonth()` at month end | Overflows | 31 Jan + 1 month = 3 Mar |
| `addMonthNoOverflow()` | Opt-in | The clamp is not the default |
| `diffIn*()` sign | Signed | A "distance" that is sometimes negative |
| `diffIn*()` type (Carbon 3) | Float | `=== 7` is false; `int` params throw |
| `week()` | Locale rules | `en_US`: Sunday start, Jan 1st |
| `isoWeek()` | ISO 8601 | Opt-in; not the default method |
| ISO week + calendar year | Two different years | 2025-01 is a valid ISO key that is wrong |
| `diffForHumans()` reference | `now()` | The sentence changes as time passes |
| `diffForHumans()` mode | `DIFF_RELATIVE_AUTO` | "ago" / "from now" flips |
| `parse()` input | Relative strings allowed | User text becomes a moving date |
| `unserialize()` of a date | Permitted | Behavioural config restored with values |
| `Carbon::setLocale()` scope | Process-wide | Vendor packages switch language |
| Locale drives week rules | Yes | A locale change renumbers weeks |
| Eloquent `datetime` cast | Mutable | Attributes mutate in place |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Freeze time in a test | `withTestNow()`, `$this->freezeTime()` | `setTestNow()` with no clear | Leaks to the next test |
| Unscoped mock, safely | `try`/`finally` | Bare `setTestNow()` | Leaks on the failure path |
| Move the timezone deliberately | `setTestNowAndTimezone()` | Expecting 2.56.0 to do it | Not supported since 2.56.0 |
| A date in a value object | `CarbonImmutable` | `Carbon` | Shared reference mutates |
| Call `add*()` without side effects | `->copy()->addDay()` | `->addDay()` | Caller's date moves |
| "Same day next month" | `addMonthNoOverflow()` | `addMonth()` | Lands 2–3 days late |
| Spread events deliberately | `addMonth()` | The clamp | Document the intent |
| "How many days apart" | `diffInDays($end, true)` | `diffInDays($end)` | Negative when order flips |
| "How many days until" | `diffInDays($expiry)` | Passing `true` | Loses the direction |
| An integer day count | `(int)` / `round()` cast | The raw float | `TypeError` or truncation |
| A week key leaving the system | `format('o-W')` | `year . '-W' . isoWeek()` | Names the wrong year |
| Locale week numbering | `->locale('en_US')->week()` | Assuming locale | Silent locale dependence |
| A phrase on a live page | `diffForHumans()` default | Pinning it | Nothing — this is the default case |
| A phrase stored or cached | Pass an explicit reference date | Storing `diffForHumans()` | Wrong tomorrow, data unchanged |
| Direction-stable wording | `DIFF_RELATIVE_TO_OTHER` | `DIFF_RELATIVE_AUTO` | "from now" becomes "ago" |
| Text leaving the system | `->locale('xx')` per instance | `Carbon::setLocale()` | Vendor packages switch too |
| Untrusted date text | `hasRelativeKeywords()` guard | `parse()` directly | "next sunday" becomes a date |
| A machine-generated date | `createFromFormat('!Y-m-d', …)` | `parse()` | Format not enforced |
| A date in cache or a cookie | `toIso8601String()` | `serialize()` | Behavioural config restored |
| Immutable model attributes | `immutable_datetime` cast | `datetime` cast | Attribute mutates in place |

## The pattern shared by most of these rows

Many rows above have the same shape, and it is the same shape found in the Docker, Node.js and
Laravel rounds: **the default is documented, correct, and silently not what the author assumed.**

- `setTestNow()` mocks "this test", and mocks the process.
- `Carbon` is "like a value type", and is mutable.
- `addMonth()` is "next month", and can be next-plus.
- `diffInDays()` is "the difference", and is signed.
- `week()` is "the week number", and is locale-defined.
- `parse()` is "parse a date", and accepts a description.
- `setLocale()` is "translate my dates", and renumbers vendor weeks.

In each case the library is right and the author's model of the library is the thing that is
wrong. The question worth asking of a Carbon-heavy codebase is not "is the date correct" but
**"which of these four clocks, units, and renderings did this value come from, and is that still
true where it lands."**

Three habits follow, and none of them needs a code change:

- **Decide mutability per field, not per file.** A `CarbonImmutable` in a domain object costs one
  class name and removes a category of bug that no review step reliably catches.
- **Make every crossing boundary explicit.** ISO strings out, ISO strings in. Relative phrases
  in, an instant out.
- **Pin the clock in tests, and pin nothing else.** A frozen clock turns a class of
  order-dependent failures into something reproducible.

## The one check that answers most of it

```bash
grep -rnE 'Carbon::(setTestNow|setLocale|setTranslator)\(|->(add|sub)Month(?!NoOverflow)|diffIn[A-Za-z]*\(|->week\(|diffForHumans\(|Carbon::parse\(\$|unserialize\(|serialize\(' \
  app/ src/ domain/ tests/ --include='*.php'
```

One grep, and every decision above shows up as a line that has to be justified. The rows worth
reading first are the global calls — they are the ones whose effect reaches code that never
mentions Carbon.

Two follow-ups are worth running before trusting the result:

- **In CI**, run the suite twice with different random orders and fail the build if the second
  run differs. That is the only mechanical check for an unscoped clock or global (`RULE-CARBON-001`).
- **At the boundary**, assert that a date arriving from outside is absolute — `hasRelativeKeywords()`
  on any parsed text (`RULE-CARBON-005`).

## Sources

- [Carbon — Introduction](https://carbon.nesbot.com/guide/getting-started/introduction.html)
- [Carbon — Instantiation](https://carbon.nesbot.com/guide/getting-started/instantiation.html)
- [Carbon — Testing Aid](https://carbon.nesbot.com/guide/getting-started/testing-aid.html)
- [Carbon — Localization](https://carbon.nesbot.com/guide/getting-started/localization.html)
- [Carbon — Weeks](https://carbon.nesbot.com/guide/core-api/weeks.html)
- [Carbon — Difference](https://carbon.nesbot.com/guide/date-time-manipulation/difference.html)
- [Carbon — Difference for Humans](https://carbon.nesbot.com/guide/date-time-manipulation/difference-for-humans.html)
- [Carbon — Addition and Subtraction](https://carbon.nesbot.com/guide/date-time-manipulation/addition-and-subtraction.html)
- [Carbon — Serialization](https://carbon.nesbot.com/guide/advanced-features/serialization.html)

## Version note

Written against the Carbon 3 documentation. Two boundaries are load-bearing and both are
version-gated:

- **`diffIn*()` returns floats in Carbon 3**, where Carbon 2 returned integers. Code written
  against `=== 7` or an `int` type hint works on Carbon 2 and fails on Carbon 3. The
  interval-returning variants return `CarbonInterval` in Carbon 3, where they returned a native
  `DateInterval`.
- **`setTestNow()` stopped carrying a timezone in Carbon 2.56.0.** Before that the mock's
  timezone was applied to `Carbon::now()`, so a suite asserting hours could shift between two
  machines on the same lockfile. `setTestNowAndTimezone()` remains available and is the
  deliberate form.

Both mean the same code can behave correctly on one version and incorrectly on another without
any change of intent — check the lockfile before assuming a date bug is an application bug.
There is a separate `docs/laravel.md` hub; this one covers the date-time
library itself and overlaps with those only on Eloquent's date casts.