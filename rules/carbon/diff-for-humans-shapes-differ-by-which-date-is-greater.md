---
title: "diffForHumans() rewrites itself around now(), so its output is not comparable"
rule_id: "RULE-CARBON-007"
category: "correctness"
scope: "backend"
applies_to: "Carbon, diffForHumans, DIFF_RELATIVE_TO_OTHER, DIFF_RELATIVE_ABSOLUTE, now, caching, snapshots"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/date-time-manipulation/difference-for-humans.html"
---

# diffForHumans() rewrites itself around now(), so its output is not comparable

`diffForHumans()` chooses its wording from which date is greater. A past value against the
default `now` reads "1 month ago"; a future value reads "1 month from now". The comparison date
defaults to `now()`, so the same method returns a different sentence for a stored value as time
passes, without any input changing.

## Why

The output is a human-readable phrase, and a phrase that depends on `now()` cannot be stored,
cached, diffed, or asserted against. This is the same shape as the mocked clock in
`RULE-CARBON-001`, seen from the other side: there the clock was pinned by a test and leaked;
here the clock moves on its own and the result moves with it.

> The lone argument for the function is the other carbon instance to diff against, and of
> course it defaults to now() if not specified
> ([Carbon — Difference for Humans](https://carbon.nesbot.com/guide/date-time-manipulation/difference-for-humans.html))

The mode is selectable, and the default is the one that produces the moving text:

> To get modifiers ago or from now, carboninterface::diff_relative_to_other to get the
> modifiers before or after or carboninterface::diff_relative_auto (default mode) to get the
> modifiers either ago/from now
> ([Carbon — Difference for Humans](https://carbon.nesbot.com/guide/date-time-manipulation/difference-for-humans.html))

Under `DIFF_RELATIVE_AUTO` a value two days in the future says "2 days from now" today and "1
day ago" tomorrow, with no change to the stored record. That matters wherever the phrase is
persisted — a rendered email, a cached API response, an audit row, a search index document — and
wherever it is compared: a test asserting the string has a race with the wall clock.

The grammar also depends on the parts option, so two calls that look identical can differ in
granularity:

> You may pass a number between 1 and 6 as a 4th parameter to get the difference in multiple
> parts (more precise diff)
> ([Carbon — Difference for Humans](https://carbon.nesbot.com/guide/date-time-manipulation/difference-for-humans.html))

Note the 4th parameter: with the second argument given, the granularity is positional and
third. A call passing one argument cannot pass the parts count at all, so the two shapes of the
same call are not interchangeable.

## Do

Resolve the phrase at the moment of display, and store the data it came from:

```php
// Correct — the phrase is a rendering, never a stored value
return view('invoice', [
    'issuedAt' => $invoice->issuedAt,          // the Carbon
    'age'      => $invoice->issuedAt->diffForHumans(),   // computed at render time
]);
```

For text that must be stable — an email body, a report cell, an audit log — pass the comparison
date explicitly and pin the mode, so the sentence depends only on its inputs:

```php
// Correct — direction-independent, and both inputs are explicit
$label = $invoice->issuedAt->diffForHumans(
    $reportGeneratedAt,
    \Carbon\CarbonInterface::DIFF_RELATIVE_TO_OTHER,
);

// Correct — "before" / "after" rather than "ago" / "from now"
$label = $invoice->issuedAt->diffForHumans(
    $reportGeneratedAt,
    \Carbon\CarbonInterface::DIFF_RELATIVE_ABSOLUTE,
);
```

Ask for the parts explicitly rather than accepting the single-unit default:

```php
// Correct — "1 year 2 months" instead of "1 year"
$label = $date->diffForHumans(null, ['parts' => 2]);
```

Assert on the data, not the phrase. When a test must pin the clock, pin it and say so:

```php
// Correct — deterministic, and the mock is scoped
Carbon::withTestNow('2026-10-04 12:00:00', function () use ($date) {
    $this->assertSame('1 month ago', $date->diffForHumans());
});
```

## Don't

Don't store or cache the phrase:

```php
// Incorrect — the stored string is wrong the next day, with no data changing
$invoice->age_label = $invoice->issuedAt->diffForHumans();
```

Don't assert on the phrase without pinning the clock:

```php
// Incorrect — depends on when the suite runs
$this->assertSame('2 days ago', $date->diffForHumans());
```

Don't assume the sentence direction tells you the sign of the underlying difference — it tells
you which side of `now()` the value is on, which is a different question when the comparison
date is not `now()`.

Don't mix a two-argument call with a parts count positionally without checking the signature:

```php
// Incorrect — 'parts' is in the options array, not the positional arguments
$date->diffForHumans($other, CarbonInterface::DIFF_RELATIVE_AUTO, 2);
```

Don't rely on the English wording for a value that leaves the system. The phrase is localised —
a global `setLocale()` changes it for every consumer at once (`RULE-CARBON-009`).

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Cached label becomes wrong | Phrase stored, computed once | Store the date, render at use |
| Test passes locally, fails in CI | Phrase depends on `now()` | Pin with `withTestNow()`, or assert on data |
| "2 days from now" became "1 day ago" | Value crossed `now()` | Pin mode and comparison date |
| Email says "from now", sent after the date | Rendered at queue time | Pass an explicit reference date |
| Audit log entries inconsistent | Phrase persisted | Store instants and diffs, not text |
| Unexpected granularity | Default is one part | Pass `['parts' => 2]` |
| Wording changes for unrelated users | Global locale | `->locale()` per instance |
| Direction wording wrong for an audit | `DIFF_RELATIVE_AUTO` around `now()` | `DIFF_RELATIVE_TO_OTHER` |

## Verifying

Find phrases that are persisted or compared:

```bash
# every diffForHumans call site
grep -rn 'diffForHumans(' app/ src/ domain/ resources/ --include='*.php'

# ones assigned somewhere — the ones that will be persisted or cached
grep -rnE '(=|=>|:)\s*[^=]*diffForHumans\(' app/ src/ domain/ --include='*.php' \
  | grep -v 'return \|=> *\$[a-z]*->diffForHumans.*\)$' | head -20

# phrase literals in tests, which race the wall clock
grep -rnE "assert.*'[0-9]+ (second|minute|hour|day|week|month|year)s? (ago|from now)'" tests/
```

Then show the drift directly, by rendering the same stored value at two reference times:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
use Carbon\CarbonInterface;

$stored = Carbon::parse("2026-09-04 12:00:00");   // a fixed record

foreach (["2026-10-01 12:00:00", "2026-10-05 12:00:00"] as $renderedAt) {
    $at = Carbon::parse($renderedAt);
    printf("rendered %s -> default: %-16s to-other: %s\n",
        $renderedAt,
        $stored->diffForHumans($at),
        $stored->diffForHumans($at, CarbonInterface::DIFF_RELATIVE_TO_OTHER));
}
'
# rendered 2026-10-01 12:00:00 -> default: 3 weeks from now  to-other: 3 weeks before
# rendered 2026-10-05 12:00:00 -> default: 1 day ago         to-other: 1 day before
```

The second column changes sign of meaning between the two renders; the third does not. That is
the whole rule — anything that gets stored, compared, or asserted needs the third.

What this check cannot see: it cannot tell you whether a moving phrase is acceptable. For a
value rendered on a live dashboard the default is exactly right, and pinning it would be the
bug. The check identifies phrases whose meaning depends on render time; whether that is a
defect is a question about where the string ends up, and the two cases above — a cache and a
live page — want opposite answers from identical code.