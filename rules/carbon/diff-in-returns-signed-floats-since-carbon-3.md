---
title: "diffIn*() returns a signed float, not a distance"
rule_id: "RULE-CARBON-002"
category: "correctness"
scope: "backend"
applies_to: "Carbon, diffInDays, diffInSeconds, diffInHours, diffInMinutes, absolute option, Carbon 2 and 3"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/date-time-manipulation/difference.html"
---

# diffIn*() returns a signed float, not a distance

`diffInDays()` and the rest of the `diffIn*()` family return a **signed** difference by default
and, since Carbon 3, return a **float**. Two defaults compound: the comparison date defaults to
`now`, and `absolute` defaults to `false`. A call with one argument reads as "how far apart are
these" and returns a directed difference whose sign depends on which instance the method was
called on.

## Why

The signature hides the sign. Both arguments are optional, so `diffInDays($end)` looks total —
and it is not, because the same method returns `7` and `-7` depending on argument order. The
asymmetry matters most where the argument is supplied by a caller rather than the author: a
helper that computes "days until" and a helper that computes "days since" are the same call
with the arguments swapped, and swapping them silently inverts the result rather than raising.

> All can take 2 optional arguments: date to compare with (if missing, now is used instead),
> and an absolute boolean option (false by default), it returns negative value when the instance
> the method is called on is greater than the compared date (first argument or now).
> ([Carbon — Difference](https://carbon.nesbot.com/guide/date-time-manipulation/difference.html))

The Carbon 3 return type change is the harder half, because it breaks code that worked:

> Since Carbon 3, they are deprecated as diffIn*() already return floating number, and integer
> values from it can easily be obtained with an explicit cast (int)
> ([Carbon — Difference](https://carbon.nesbot.com/guide/date-time-manipulation/difference.html))

A `===` comparison against an integer literal now fails; a value passed to a function typed
`int` throws a `TypeError` under strict types; a value stored in a DB integer column is
truncated by the driver rather than rejected. None of these are loud in a test that compares
with `==`, which is why the whole family tends to be written that way.

The truncation is not always wrong — a fractional day count usually *should* truncate — but it
is wrong where the code assumes the library already rounded, and it is wrong in the direction
the language chooses, which is toward zero for a negative value.

## Do

State the sign you mean. Pass `true` for distance, `false` for a directed difference:

```php
// Correct — distance, order-independent
$days = $start->diffInDays($end, true);

// Correct — directed, and the name says so
$daysUntilExpiry = Carbon::now()->diffInDays($expiry);   // negative once expired
```

Cast deliberately, at the boundary, and say which direction you round:

```php
// Correct — explicit cast, so the library's return type is not leaking into your domain
$wholeDays = (int) $start->diffInDays($end, true);

// Correct — when truncation toward zero would be wrong
$seconds = (int) round($start->diffInSeconds($end, true));
```

Guard float comparisons:

```php
// Correct — compare with a tolerance, not identity
if ($start->diffInSeconds($end) === 0.0) { ... }          // fine: exact float zero
if ($start->diffInDays($end) === 1) { ... }                // Incorrect: int literal vs float
```

## Don't

Don't call the family with one argument expecting a magnitude:

```php
// Incorrect — negative when $start is after $end
$days = $start->diffInDays($end);
```

Don't compare the result against an integer with a strict operator:

```php
// Incorrect — false on Carbon 3, true on Carbon 2
if ($date->diffInDays($now) === 7) { ... }
```

Don't use the return value where an integer is required without casting:

```php
// Incorrect — TypeError under strict_types, silent truncation otherwise
function ageInDays(Carbon $birth): int { return $birth->diffInDays(); }
```

Don't assume `diffIn*()` and the interval-returning variants agree. Since Carbon 3 the interval
methods return a `CarbonInterval` where they previously returned a native `DateInterval`;
anything type-hinting `DateInterval` still works, but anything comparing class names or
serialising the result changes shape across the version boundary.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "Days until expiry" is negative past the date | Signed default | `diffInDays($expiry)` returns a signed value; invert deliberately |
| Distance flips when arguments are swapped | Signed default | Pass `true` for `absolute` |
| `=== 7` never true | Float return in Carbon 3 | Compare as float, or cast first |
| `TypeError: Argument #1 must be of type int` | Float into an `int` parameter | Cast at the call site |
| DB integer column stores a rounded-down value | Driver truncation | Round in PHP before writing |
| Negative duration rounds toward zero | Language truncation | `round()` instead of `(int)` |
| Works on Carbon 2, fails on Carbon 3 | Float return | Cast at the boundary |
| `DateInterval` type checks fail | Now a `CarbonInterval` | Update the type hint and class checks |

## Verifying

Find every call site and check that each one says what it means:

```bash
# one-argument calls: every one is a signed difference
grep -rn 'diffIn[A-Za-z]*(\s*[^,)]*)\s*;' app/ src/ --include='*.php' | grep -v ', *\(true\|false\)'

# strict comparisons against int literals — these break under Carbon 3
grep -rn 'diffIn[A-Za-z]*([^)]*)\s*===\s*[0-9]' app/ src/ --include='*.php'

# int-typed parameters receiving a diff
grep -rn 'function .*: *int' app/ src/ --include='*.php' | grep -i diff
```

Then pin the actual behaviour rather than reading it off the call site:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
$start = Carbon::parse("2026-01-31 00:00:00");
$end   = Carbon::parse("2026-03-03 00:00:00");
var_dump($start->diffInDays($end));              // signed
var_dump($start->diffInDays($end, true));        // absolute
var_dump($start->diffInHours($end));             // float in Carbon 3
var_dump(gettype($start->diffInHours($end)));    // "double"
'
```

The same calls with the arguments swapped should be the negatives of the originals — if they
are not, something downstream has already normalised the sign.

What this check cannot see: it cannot tell you whether a negative result is a bug or the
intended answer. `diffInDays()` returning `-1` is correct for "days since" and wrong for
"days until", and no static check distinguishes the two because the call site does not record
which question was being asked. That has to be settled by reading the caller; the mechanical
check only tells you the sign is unguarded, which is the part that is always wrong.