---
title: "the global translator is process-wide, so setLocale() reaches vendor code"
rule_id: "RULE-CARBON-009"
category: "architecture"
scope: "backend"
applies_to: "Carbon, setLocale, setTranslator, TranslatorInterface, diffForHumans, isoFormat, week numbering"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/getting-started/localization.html"
---

# the global translator is process-wide, so setLocale() reaches vendor code

`Carbon::setLocale()` changes a static. Every Carbon instance in the process — including
instances inside vendor packages, framework internals, and jobs the application did not
instantiate — formats its output in the new locale. The documentation names the blast radius
directly and recommends per-instance locales instead.

## Why

The call reads as configuring this application and reaches everything in it, including code with
its own translation decisions that never asked Carbon to speak a particular language.

> As those method will change the behavior globally (including third-party libraries you may
> have in your app), it might cause unexpected results
> ([Carbon — Localization](https://carbon.nesbot.com/guide/getting-started/localization.html))

> You should rather customize translation using custom locales as in the example above.
> ([Carbon — Localization](https://carbon.nesbot.com/guide/getting-started/localization.html))

The scope is wider than it first appears because the locale is not only text. Carbon's locale
drives **week numbering rules** (`RULE-CARBON-006`), number and date **formatting conventions**,
and the grammar `diffForHumans()` chooses (`RULE-CARBON-007`). A locale change therefore alters
numeric output, not only strings — which is why a library that computes with dates can behave
differently in a request that changed the locale, without any of its own code differing.

The ordering problem makes this intermittent rather than constant. The last `setLocale()` to run
before a given read wins, so the result depends on which service provider, boot order, or
middleware segment ran first. Two requests handled by the same worker can differ, and a
long-running worker — queue, Octane, a daemon — can hold a locale set by an earlier request.

`setTranslator()` replaces the translator object itself, and has a documented interface
requirement:

> You can also use an other translator with Carbon::setTranslator($custom) as long as the
> given translator implements Symfony\Component\Translation\TranslatorInterface
> ([Carbon — Localization](https://carbon.nesbot.com/guide/getting-started/localization.html))

A custom translator that does not implement it is not a configuration option that degrades —
it is a wrong type at the point Carbon relies on the interface.

## Do

Set the locale on the instance whose output you are rendering:

```php
// Correct — scoped to this call, nothing global changes
$label = $date->locale('tr')->diffForHumans();
$formatted = $date->locale('tr')->isoFormat('D MMMM YYYY');
```

Where an instance needs several locales at once, carry the locale with the data rather than
mutating global state:

```php
// Correct — the locale travels with the request
return new InvoiceView(
    issuedAt: $invoice->issuedAt->locale($request->user()->locale),
);
```

Set the process locale once, deliberately, if the whole application is single-locale:

```php
// Correct — one global decision, made explicitly at boot
Carbon::setLocale('en_GB');
// and the classes that read it
Illuminate\Support\Facades\Date::use(Carbon\CarbonImmutable::class);
```

When a whole subtree needs one locale, use `settings()`, which returns the instance:

```php
// Correct — a local override, applied to a value you own
$localised = Carbon::parse($stored)->settings(['locale' => 'de_AT']);
```

Pass a translator only when you are certain it implements the interface, and pass it the same
scoped way:

```php
// Correct — explicit, and typed against the required interface
$translator = new class implements Symfony\Component\Translation\TranslatorInterface { /* ... */ };
Carbon::setTranslator($translator);   // only if this process is genuinely single-locale
```

## Don't

Don't set the global locale to serve one response:

```php
// Incorrect — every package's dates switch language for this request
Carbon::setLocale('tr');
return view('orders.index', ['orders' => $orders]);
```

Don't assume vendor code is unaffected. A payment provider or a PDF library formatting dates
with Carbon changes language under a locale switch you made for your own page.

Don't rely on boot order to pick the locale. Two providers both calling `setLocale()` leaves the
second one's value in place, and which is second is not something the code states.

Don't mutate a long-running worker's locale per job without restoring it:

```php
// Incorrect — job 1's locale is still set when job 2 runs
public function handle(): void
{
    Carbon::setLocale($this->tenant->locale);
    // ... no restore
}
```

Don't pass a translator that does not implement `TranslatorInterface`, in the belief that it
will fall back to the default. Carbon relies on the interface at the point it calls it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Vendor package output changes language | Global `setLocale()` | `->locale()` per instance |
| Week numbers differ between requests | Locale drives week rules | Use `iso*` methods, or pin locale |
| Correct in dev, different on one server | Boot order decides the last writer | Set it once, explicitly |
| Worker output depends on the previous job | Locale not restored in a long process | Restore in `finally`, or use per-instance locale |
| `setTranslator` ignored or fatal | Wrong interface | Implement `TranslatorInterface` |
| Only some dates are Turkish | Instances created before the switch | Set at boot, not per request |
| Numbers formatted differently | Locale changes numeric convention | Pin the format, not the locale |
| Snapshot tests flip between runs | Locale is process state | Pin locale in the test harness |

## Verifying

Find every global mutation, and every place an instance-local one is needed instead:

```bash
# global mutations — each one is process-wide
grep -rnE 'Carbon::(setLocale|setTranslator|setTestNow)\(' app/ src/ config/ bootstrap/ --include='*.php'

# per-instance usage, which is the pattern to prefer
grep -rnE '\->locale\(|\->settings\(' app/ src/ --include='*.php'

# locales configured as a framework setting rather than in code
grep -rnE "'locale'|\"locale\"" config/ app/ --include='*.php'
```

Then show the reach, including the parts that are not text:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;

$date = Carbon::parse("2026-01-04 12:00:00");   // a Sunday in ISO week 1

foreach (["en_US", "de_AT", "tr"] as $locale) {
    $local = $date->copy()->locale($locale);
    printf("%-6s week=%-3d isoWeek=%-3d  diff=%-14s  %s\n",
        $locale,
        $local->week(),
        $local->isoWeek(),
        $local->copy()->diffForHumans(Carbon::parse("2026-03-01")),
        $local->isoFormat("D MMMM"));
}
'
# en_US  week=1   isoWeek=1   diff=2 months ago    Sunday, January 4th
# de_AT  week=1   isoWeek=1   diff=vor 2 Monaten    Sonntag, Jänner 4
# tr     week=1   isoWeek=1   diff=2 ay önce        Pazar, Ocak 4
```

Note `isoWeek` does not move — it is ISO, by definition — while the wording does. Anything that
computes with the locale-dependent method is affected by the same global switch.

What this check cannot see: it cannot tell you which locale *should* apply to a given string.
Setting Turkish at boot for a single-locale application is correct and not a defect; setting it
per-request is a defect even with the same call. The check finds the process-wide mutations and
shows what each locale produces — the judgement about which of them are intended has to come
from the application's own translation requirements.