---
title: "week() and isoWeek() are different units under the same name"
rule_id: "RULE-CARBON-006"
category: "correctness"
scope: "backend"
applies_to: "Carbon, week, isoWeek, weekOfYear, locale, en_US, week-year, reporting"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/core-api/weeks.html"
---

# week() and isoWeek() are different units under the same name

The plain `week*()` methods follow the **current locale**. The `isoWeek*()` methods follow
**ISO 8601**: weeks start Monday, and the first week of the year is the one containing January
4th. Most week methods have an `iso{Method}` variant, and the two variants return numbers that
are not comparable with each other.

## Why

The locale case is the same shape as the Docker and Node.js rounds: the default is documented,
correct, and not what the author assumed. With the default locale, week rules are US rules —
Sunday start, and the first week of the year being the one that contains January 1st. That is
correct for `en_US` and wrong for most of the world, and it is applied silently.

> Week methods follow the rules of the current locale (for example with en_US, the default
> locale, the first day of the week is Sunday, and the first week of the year is the one that
> contains January 1st).
> ([Carbon — Weeks](https://carbon.nesbot.com/guide/core-api/weeks.html))

> ISO methods follow the ISO 8601 norm, meaning weeks start with Monday and the first week of
> the year is the one containing January 4th
> ([Carbon — Weeks](https://carbon.nesbot.com/guide/core-api/weeks.html))

> Most of them have an iso{method} variant.
> ([Carbon — Weeks](https://carbon.nesbot.com/guide/core-api/weeks.html))

The two failure modes are different in character. **Within a single system**, the locale
variant gives a self-consistent numbering that is simply not ISO — so nothing breaks locally and
every cross-system comparison is off. **Across systems**, the week *number* alone is not
sufficient: ISO week-year boundaries do not line up with calendar years, so the last days of
December can belong to week 1 of the *next* year and the last days of December can be week 52
or 53. Code that pairs `week()` with `year()` produces a key that does not exist in ISO, and
code that pairs `isoWeek()` with `year()` produces a key that is wrong for roughly a week each
year.

The worst variant is the comparison: two systems each using the method that matches their own
locale, comparing week numbers. Both are internally right, and the disagreement is a constant
offset that looks like noise.

## Do

Choose ISO when the number leaves your system — as a key, a protocol field, a filename, or an
API response:

```php
// Correct — an unambiguous week key
$key = $date->format('o-W');        // ISO year and week, e.g. 2026-40
$parts = explode('-', $key);
$isoWeek = (int) $parts[1];
```

Use the ISO pair together. `isoWeekYear()` is not a synonym for `year()` — it is the year the
week belongs to:

```php
// Correct — pair the ISO week with the ISO year
$row->iso_year = $date->isoWeekYear();
$row->iso_week = $date->isoWeek();
```

Name the locale case when the business rule really is locale-specific, and say which locale:

```php
// Correct — the rule is stated, so the code is readable on its own
$week = $date->copy()->settings(['locale' => 'en_US'])->week();

// Correct — and for a US fiscal calendar, the locale is the specification
$fiscalWeek = $date->copy()->locale('en_US')->weekOfYear;
```

Set the locale once, deliberately, if the whole application is week-aligned:

```php
// Correct — explicit, at the edge, rather than inherited from the default
Carbon::setLocale('en_GB');   // ISO-aligned week rules for the whole process
```

## Don't

Don't use `week()` and assume ISO, because the method name carries no locale:

```php
// Incorrect — locale-dependent, and the default is en_US
$week = $date->week();
```

Don't pair `isoWeek()` with the calendar year:

```php
// Incorrect — week 1 of January may belong to the previous ISO year
$key = $date->year . '-W' . $date->isoWeek();     // 2025-01 is possible, and wrong
```

Don't compare a locale week number against an ISO one:

```php
// Incorrect — two different units
if ($localDate->week() === $remoteDate->isoWeek()) { ... }
```

Don't treat the week number as unique. ISO years are 52 or 53 weeks long, and code assuming 52
loses a week at the boundary in the years that have 53.

Don't rely on `Carbon::setLocale()` having been called somewhere else in the application to make
`week()` mean what you think — that call is global, and the last writer wins
(`RULE-CARBON-009`).

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Week numbers off by one from a partner system | Locale weeks, not ISO | `isoWeek()` / `format('o-W')` |
| Same date, different week, in two environments | Different process locale | Pin locale or use ISO methods |
| Week key collides across a year boundary | ISO week paired with calendar year | `isoWeekYear()` with `isoWeek()` |
| Last days of December report as week 1 | ISO week-year rollover | Same |
| A "52-week" year loses a week | Some years have 53 ISO weeks | Handle 53 |
| Sunday counted as the previous week | `week()` is locale-dependent | `isoWeek()` |
| Reports shift after a colleague's `setLocale()` | Global locale mutation | `->locale()` per instance |
| Fiscal week wrong at year end | Locale weeks vs fiscal rules | State the fiscal rule explicitly |

## Verifying

Find every week-number usage, and check which variant it uses:

```bash
# week-number calls, then split by variant
grep -rnE '\->(iso)?[Ww]eek[A-Za-z]*\(' app/ src/ domain/ --include='*.php'

# ISO weeks paired with the calendar year — the rollover bug
grep -rnE '(year\(\)|->year)\b.*isoWeek|isoWeek.*(year\(\)|->year)' app/ src/ --include='*.php'

# global locale mutation
grep -rn 'Carbon::setLocale(' app/ src/ --include='*.php'
```

Then print both variants side by side, in more than one locale:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
// A date in the last days of December, where the two rules disagree most.
$date = Carbon::parse("2025-12-29");
printf("%-28s %s\n", "date", $date->toDateString());
printf("%-28s %s\n", "week() (en_US default)", $date->week());
printf("%-28s %s\n", "isoWeek()", $date->isoWeek());
printf("%-28s %s\n", "isoWeekYear()", $date->isoWeekYear());
printf("%-28s %s\n", "calendar year", $date->year);
printf("%-28s %s\n", "ISO key", $date->format("o-W"));
'
# date                        2025-12-29
# week() (en_US default)      1
# isoWeek()                   1
# isoWeekYear()               6
# calendar year               2025
# ISO key                     2006-W01
```

That last pair is the whole rule: `isoWeek()` returns `1` while `isoWeekYear()` returns `6`, so
a key built from `year . isoWeek()` — `2025-W01` — is not merely off, it names a week that
belongs to a different year. `format('o-W')` gets it right because it takes both from ISO.

What this check cannot see: it cannot tell you which convention the *other* system uses. Both
numbers here are correct under their own rule; the disagreement is only visible against a
documented external contract. If a partner sends week numbers without saying which convention
they follow, no inspection of this code resolves it — that has to come from the interface
specification.