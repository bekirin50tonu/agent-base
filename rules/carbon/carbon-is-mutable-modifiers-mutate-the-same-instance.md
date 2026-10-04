---
title: "Carbon is mutable: a modifier returns the same object, not a copy"
rule_id: "RULE-CARBON-003"
category: "correctness"
scope: "backend"
applies_to: "Carbon, CarbonImmutable, addDay, startOfDay, subMonths, value objects, entity boundaries"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/getting-started/introduction.html"
---

# Carbon is mutable: a modifier returns the same object, not a copy

Every modifier on `Carbon` — `addDay()`, `startOfDay()`, `subMonths()`, `setTime()` — modifies
the receiver **and returns that same instance**. `$b = $a->addDay();` produces one object under
two names. `CarbonImmutable` returns a new instance instead, which is the only difference
between the two classes.

## Why

The assignment is the trap. `$copy = $original->addMonth()` reads as producing a copy, and it
produces an alias. Nothing about the line says otherwise: there is no clone, no new object, no
indication that `$original` moved. This is not a Carbon quirk being careless — it is the
documented, intended difference between the two classes, and `CarbonImmutable` exists precisely
because the mutable one is the default.

> When you use a modifier on a Carbon instance, it modifies and returns the same instance, when
> you use it on CarbonImmutable, it returns a new instance with the new value.
> ([Carbon — Introduction](https://carbon.nesbot.com/guide/getting-started/introduction.html))

The blast radius is whoever else holds the reference, and that is usually code that never
called the modifier. A date stored on a model instance, passed by reference into a helper,
captured in a collection, or held by a long-lived service object gets mutated out from under
its owner. The classic version is a "normalize to midnight" helper that looks like it returns a
value but instead rewrites the caller's field:

```php
// Incorrect — $invoice->issuedAt is now midnight, not what the caller passed
public function dayOf(Carbon $date): Carbon
{
    return $date->startOfDay();
}
```

It returns correctly. It also changes `$date`. The caller has no way to tell, because the
return value is indistinguishable from a copy-returning helper.

The second failure mode is quieter still: nothing throws, the value is simply wrong later, in a
different file, and the only evidence is the mutated value. This is the same class as a mutable
default argument or a shared buffer — the alias is invisible until the day it matters.

## Do

Use `CarbonImmutable` as the type in anything that stores a date. It costs one class name and
removes the whole category:

```php
// Correct — no call site can mutate another's date
final class Invoice
{
    public function __construct(
        public readonly CarbonImmutable $issuedAt,
    ) {}
}
```

When the type is fixed as `Carbon` and a modifier is needed, take an explicit copy first:

```php
// Correct — copy() before mutating, so the intent is visible at the call site
$expiry = Carbon::parse($invoicesAt)->copy()->addMonth();
```

Never rely on a modifier for its return value unless the caller wanted the mutation too:

```php
// Correct — mutation is the point, and the name says so
$date->startOfDay();          // mutates in place, returns the same object for chaining

// Correct — a fresh value, leaving the input alone
$day = $date->copy()->startOfDay();
```

Prefer `CarbonImmutable` inside value objects and collections, and reserve mutable `Carbon`
for the boundary where a third-party API hands you a mutable object you do not own.

## Don't

Don't assume a modifier produces a copy:

```php
// Incorrect — $original and $next are the same object
$original = Carbon::parse('2026-01-31');
$next = $original->addMonth();
echo $original->format('Y-m-d');   // "2026-03-03", not "2026-01-31"
```

Don't mutate a date you did not create:

```php
// Incorrect — rewrites the caller's field as a side effect of asking a question
$model->updated_at = $model->created_at->startOfDay();
```

Don't store `Carbon` in a long-lived collection or static and mutate it later:

```php
// Incorrect — every later reader sees the mutated value
private array $timestamps = [];

public function remember(Carbon $at): void
{
    $this->timestamps[] = $at->copy()->startOfDay();   // copy() is what makes this safe
}
```

Don't assume immutability because the framework returns Carbon. Laravel's date casting produces
mutable `Carbon` by default; `immutable_date` / `immutable_datetime` casts, or
`Date::use(CarbonImmutable::class)`, are what change that.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A value changed with no code near it that assigned it | Shared reference mutated | `CarbonImmutable` as the field type |
| A "normalizer" helper alters its argument | Modifier used for its return value | `copy()` first |
| Date drifts earlier each time a loop runs | Loop variable is the same object | `copy()` per iteration, or immutable |
| Two collection entries share one instant | Stored reference, mutated once | Copy on insert |
| Eloquent attribute mutates unexpectedly | `datetime` cast is mutable | `immutable_datetime` |
| Static cached date shifts after a test | Global holds a mutable instance | Store `CarbonImmutable` |
| Overriding a model attribute "fights" the next read | `setRawAttributes` handed a mutable object | Convert at the boundary |

## Verifying

Find every place a mutable `Carbon` is stored or passed where it could be mutated later:

```bash
# properties, parameters and collection pushes holding a mutable date
grep -rnE '(public|private|protected|function [a-zA-Z]+\().*\$[a-zA-Z]+ *\??[:=] *\(?Carbon\b' \
  app/ src/ domain/ --include='*.php'

# modifiers whose return value is discarded, i.e. deliberate mutation
grep -rn '\->\(add\|sub\|startOf\|endOf\|set[A-Z]\)[A-Za-z]*(.*);' app/ src/ --include='*.php' \
  | grep -v '= *\$\|return \|->copy()'

# mutable Eloquent casts
grep -rn "'date'\|'datetime'\|'immutable_" app/Models --include='*.php'
```

The decisive test is aliasing — assert that the source is unchanged after a modifier call:

```php
<?php
require 'vendor/autoload.php';
use Carbon\Carbon;

$original = Carbon::parse('2026-01-31');
$next     = $original->addMonth();

printf("aliased:     %s\n", var_export($original === $next, true));
printf("original:    %s\n", $original->format('Y-m-d'));
printf("immutable:   %s\n", Carbon\CarbonImmutable::parse('2026-01-31')
    ->addMonth()->format('Y-m-d'));
// aliased:     true
// original:    2026-03-03
// immutable:   2026-02-28
```

Note the last line: `CarbonImmutable::addMonth()` clamps overflow to 28 February while the
mutable one does not, so swapping the class also changes month arithmetic — see
`RULE-CARBON-004`.

What this check cannot see: it cannot tell you whether a given mutation is wanted. The same
`->startOfDay()` is a bug in a getter and the entire point in a normalisation step. It also
cannot see aliasing through a serializer, an ORM identity map, or a container singleton — the
object graph, not the call sites, is where a shared reference becomes visible.