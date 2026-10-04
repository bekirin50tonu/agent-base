---
title: "parse() accepts relative strings, so user input becomes a moving target"
rule_id: "RULE-CARBON-005"
category: "security"
scope: "backend"
applies_to: "Carbon, parse, hasRelativeKeywords, strtotime, user input, query filters, import jobs"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/getting-started/instantiation.html"
---

# parse() accepts relative strings, so user input becomes a moving target

`Carbon::parse()` — like `strtotime()` under it — accepts *relative* expressions: `'next sunday'`,
`'tomorrow'`, `'first day of next month'`, `'last year'`. A string reaching `parse()` from a
user, a CSV column, a webhook body, or a query parameter becomes a date resolved against the
current moment rather than a rejected input.

## Why

The API does not distinguish "parse this date" from "compute a date from this description", so
the caller inherits both. Neither call fails, and neither is obviously wrong in a test — the
parse succeeds and produces a valid `Carbon`. What changes is *when* it is valid: the result is
correct at the moment of the call and different tomorrow.

> The string passed to Carbon::parse or to new Carbon can represent a relative time (next
> sunday, tomorrow, first day of next month, last year)
> ([Carbon — Instantiation](https://carbon.nesbot.com/guide/getting-started/instantiation.html))

Two properties make this worse than a parsing quirk. First, the relative resolution is against
`now()`, so it inherits any clock mock in the test suite — the same input yields a different
value under `setTestNow()`, which means a test can pass against a fictional clock while
production resolves to a real one. Second, the accepted grammar is PHP's, not yours: it is far
larger than any application intends to allow, and it is not something you can enumerate.

The security angle is narrow but real. Where the string is used to build a query filter, a
retention cutoff, or a report range, an attacker-supplied `'next monday'` or `'last friday'`
selects a window the application never validated, and the widening is silent. Where the string is
stored and parsed later — a scheduled job re-parsing its own stored string — the stored value
quietly drifts every time it is read.

## Do

Reject relative strings at the trust boundary, using the check the library provides:

```php
// Correct — the boundary decides, not the parse
public function __invoke(Request $request): JsonResponse
{
    $raw = $request->string('as_of');

    if (Carbon::hasRelativeKeywords((string) $raw)) {
        throw ValidationException::withMessages([
            'as_of' => 'Use an absolute date, e.g. 2026-01-31.',
        ]);
    }

    return response()->json(['as_of' => Carbon::parse((string) $raw)->toDateString()]);
}
```

Parse to a canonical format at the boundary and store that, so later reads are stable:

```php
// Correct — store an absolute instant, not the user's phrasing
$row->as_of = Carbon::parse($raw)->toDateTimeString();
```

When a relative expression *is* the feature — a scheduling UI that accepts "next friday" —
resolve it once, immediately, and store the result:

```php
// Correct — resolve at the edge, persist the answer
$runAt = Carbon::parse($userTyped)->toDateTimeString();
$this->jobs->schedule($runAt);   // the job never parses user text again
```

Pin the format when the input is machine-generated rather than human-typed:

```php
// Correct — an explicit format cannot mean "next sunday"
$date = Carbon::createFromFormat('!Y-m-d', $row['date']);
```

## Don't

Don't pass untrusted text straight to `parse()`:

```php
// Incorrect — "next sunday" silently becomes a date relative to now
$date = Carbon::parse($request->input('date'));
```

Don't rely on validation catching it. Laravel's `date` rule accepts relative strings, so
`'next sunday'` passes `validate(['date' => 'date'])`.

Don't store the raw string and parse it on each read:

```php
// Incorrect — drifts every time it is parsed
return $report->date_filter;   // a string like "last friday"

foreach ($reports as $report) {
    $report->period = Carbon::parse($report->date_filter);   // different each run
}
```

Don't assume `parse()` failing means the input is invalid — it means the input was unparseable.
Values that parse to something you did not intend are the ones that reach production.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Same input yields different dates on different days | Relative resolution against `now` | `hasRelativeKeywords()` guard |
| Test passes, production picks a different day | Clock mock changes the relative base | Assert against an explicit instant |
| Report window widens unexpectedly | User string parsed into a filter | Validate the range after parsing |
| Value drifts when re-read from storage | Raw string stored, parsed per read | Store the resolved instant |
| `date` validation rule does not help | It accepts relative strings | Explicit keyword check |
| Data from 2009 appears in a report | `'last year'` accepted | Reject relative keywords on write |
| Two workers resolve the same field differently | Each parsed at its own `now` | Resolve once, persist |

## Verifying

Find every parse call that can receive text:

```bash
# parse() on anything variable
grep -rn 'Carbon::parse(\$' app/ src/ domain/ --include='*.php'
grep -rnE '->parse\(\$|Carbon::parse\(\$[a-z]' app/ src/ --include='*.php'

# new Carbon(...) with a variable constructor argument
grep -rnE 'new Carbon\(\$[a-z]' app/ src/ --include='*.php'
```

Then check what the parser actually accepts, at the boundary you intend to enforce:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
$cases = ["2026-01-31", "next sunday", "last year", "tomorrow",
          "first day of next month", "+1 week", "now", "@1700000000"];
foreach ($cases as $c) {
    printf("%-26s relative=%-5s -> %s\n",
        $c,
        var_export(Carbon::hasRelativeKeywords($c), true),
        Carbon::parse($c)->toDateTimeString());
}
'
# 2026-01-31               relative=false  -> 2026-01-31 00:00:00
# next sunday              relative=true   -> 2026-10-11 00:00:00
# last year                relative=true   -> 2025-10-04 00:00:00
# tomorrow                 relative=true   -> 2026-10-05 00:00:00
# first day of next month  relative=true   -> 2026-11-01 00:00:00
# +1 week                  relative=true   -> 2026-10-11 00:00:00
# now                      relative=true   -> 2026-10-04 09:32:00
# @1700000000              relative=false  -> 2023-11-14 22:13:20
```

Every row marked `relative=true` is a string your boundary must decide about. The list is
larger than it looks — `now`, `+1 week` and the `@` timestamp all pass or fail differently than
a date regex would suggest.

What this check cannot see: it cannot tell you which of these the application means to accept.
`hasRelativeKeywords()` answers "can this string be relative", not "should this string be
relative" — a scheduling feature legitimately accepts `next sunday`, and a report filter
legitimately does not. The check locates every parse site that *could* be handed a moving
target; deciding which ones are allowed to is a product decision, and the guard belongs at
whichever boundary actually owns that answer.