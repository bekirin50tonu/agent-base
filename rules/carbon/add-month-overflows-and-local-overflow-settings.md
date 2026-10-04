---
title: "addMonth() overflows into the next month; overflow is per-instance"
rule_id: "RULE-CARBON-004"
category: "correctness"
scope: "backend"
applies_to: "Carbon, addMonth, addMonths, monthOverflow, settings, billing cycles, renewals"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/date-time-manipulation/addition-and-subtraction.html"
---

# addMonth() overflows into the next month; overflow is per-instance

Carbon inherits PHP's `DateTime` month arithmetic, and that arithmetic overflows: "31 January +
1 month" is "3 March", because there is no "31 February". Since Carbon 2 the behaviour is
configurable **per instance** rather than only globally.

## Why

The overflow is silent and lands on a valid date, so nothing fails. Billing, renewals, retention
windows, and "same day next month" reports are all built on `addMonth()` and all get a date that
is a month and two days later without saying so. The value is not out of range — it is in range,
which is why it survives review and reaches a customer.

> Carbon relies on the underlying parent class PHP DateTime behavior. As a result adding or
> subtracting months can overflow, example:
> ([Carbon — Addition and Subtraction](https://carbon.nesbot.com/guide/date-time-manipulation/addition-and-subtraction.html))

> Since Carbon 2, you can set a local overflow behavior for each instance:
> ([Carbon — Addition and Subtraction](https://carbon.nesbot.com/guide/date-time-manipulation/addition-and-subtraction.html))

The asymmetry is what makes it hard to spot by reading. `addMonthNoOverflow()` clamps to the last
valid day of the target month, so "31 January + 1 month" is "28 February" — the expected answer.
`addMonth()` overflows to "3 March". Same method family, same argument, same intent, a two-to-three
day difference that only appears for dates near the end of a month. A test written in June
never sees it; a production renewal on the 31st does.

The per-instance setting exists so that the policy can live with the object:

```php
$dt = CarbonImmutable::create(2017, 1, 31, 0);
$dt->settings(['monthOverflow' => false]);
```

That form is worth reading carefully — `settings()` returns the instance, so whether the overflow
policy takes effect depends on whether you used the returned value. It is the same mutable/
immutable distinction as `RULE-CARBON-003`, one level down.

Subtraction overflows the same way in reverse: "31 March - 1 month" goes to "3 March", not
"28 February".

## Do

Name the policy at every call site that means "the same day next month":

```php
// Correct — clamp to the last valid day of the month
$renewsAt = Carbon::parse('2026-01-31')->addMonthNoOverflow();   // 2026-02-28

// Correct — the explicit form reads as a decision, not a typo
$renewsAt = $subscription->startedAt->copy()->addMonthNoOverflow();
```

Set the policy once at the point where the date is constructed, if the whole domain wants one
policy:

```php
// Correct — policy attached to the instance
$dt = CarbonImmutable::create(2017, 1, 31, 0)->settings(['monthOverflow' => false]);
echo $dt->addMonth();   // 2017-02-28
```

When *overflow* is the intent — spreading load, generating an ordered schedule — say so
explicitly rather than relying on the default:

```php
// Correct — overflow is the documented, chosen behaviour here
$shipAt = $order->placedAt->copy()->addMonth();   // deliberate, and commented as such
```

Add the boundary month to the test set, not a convenient one:

```php
// Correct — the month-end cases are the ones that matter
$cases = ['2026-01-31', '2026-01-30', '2026-02-28', '2024-02-29'];
foreach ($cases as $start) {
    $this->assertSame(
        Carbon::parse($start)->startOfMonth()->addMonthNoOverflow()->toDateString(),
        Billing::nextDueDate(Carbon::parse($start))->toDateString(),
    );
}
```

## Don't

Don't use `addMonth()` where the business rule is "the same day next month":

```php
// Incorrect — 2026-01-31 becomes 2026-03-03
$due = $invoice->issuedAt->copy()->addMonth();
```

Don't compute a period end by adding months in a loop:

```php
// Incorrect — each iteration compounds the previous overflow
for ($i = 0; $i < 12; $i++) {
    $months[] = $start->copy()->addMonth($i);   // 2026-01-31 -> 2026-03-03
}
```

Don't assume `settings(['monthOverflow' => ...])` is global. It is not; it is a property of the
instance it was called on and its descendants. An instance built elsewhere in the code path has
the PHP default.

Don't hand-roll the clamp as `$date->day(min($date->day, $date->daysInMonth))` when the library
has `addMonthNoOverflow()`. The hand-rolled version breaks on the *first* of the month after the
clamp, and on leap years, and it does not respect an overflow policy already set on the instance.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Renewal 2–3 days late | `addMonth()` overflowed | `addMonthNoOverflow()` |
| Billing period ends on the 3rd | Same, compounding over a loop | Clamp per period, not iteratively |
| Wrong date only for end-of-month starts | Overflow is date-dependent | Test the 28th/29th/30th/31st |
| Policy set but has no effect | `settings()` result discarded, or a different instance | Use the returned instance |
| Works in dev, differs in prod | Leap year, or a different overflow policy per instance | Pin the policy, test February |
| `31 March - 1 month` lands on 3 March | Subtraction overflows too | `subMonthNoOverflow()` |
| Manual clamp breaks on the 1st | Clamp applied after the shift | Use the library method |

## Verifying

Find every month arithmetic call, and check which policy each one uses:

```bash
# month arithmetic, policy unnamed
grep -rn '\->\(add\|sub\)Month' app/ src/ domain/ --include='*.php' \
  | grep -v 'NoOverflow'

# overflow policy set anywhere
grep -rn "monthOverflow\|settings(\[" app/ src/ domain/ --include='*.php'
```

Then check the actual boundary behaviour rather than assuming it:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
$start = Carbon::parse("2026-01-31");
printf("addMonth:            %s\n", $start->copy()->addMonth()->toDateString());
printf("addMonthNoOverflow:  %s\n", $start->copy()->addMonthNoOverflow()->toDateString());
printf("sub from 31 March:   %s\n", Carbon::parse("2026-03-31")->subMonth()->toDateString());
printf("leap 29 Feb +1:      %s\n", Carbon::parse("2024-02-29")->copy()->addMonth()->toDateString());
'
# addMonth:            2026-03-03
# addMonthNoOverflow:  2026-02-28
# sub from 31 March:   2026-03-03
# leap 29 Feb +1:      2026-03-29
```

Any expected value in the application that disagrees with these four lines is carrying the
overflow, and should say which behaviour it wants.

What this check cannot see: it cannot tell you whether overflowing is right for your domain. A
scheduling system that deliberately spreads events across months *wants* the default. The check
only shows which policy each call site has; whether that policy matches the business rule is a
question about the rule, not the code, and the honest fix is to make the choice explicit at the
call site rather than to argue for one globally.