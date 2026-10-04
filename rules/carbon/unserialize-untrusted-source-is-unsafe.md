---
title: "never unserialize() a Carbon from an untrusted source"
rule_id: "RULE-CARBON-008"
category: "security"
scope: "backend"
applies_to: "Carbon, CarbonInterval, CarbonPeriod, fromSerialized, unserialize, allowed_classes, caches, queues"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/advanced-features/serialization.html"
---

# never unserialize() a Carbon from an untrusted source

`unserialize()` — and `Carbon::fromSerialized()`, which wraps it — of a string from an untrusted
source is unsafe. The documentation says so directly. Carbon's payload carries not only values
but *behavioural configuration*, which is restored along with them.

## Why

PHP's `unserialize()` instantiates arbitrary classes and invokes their magic methods on the
way, which is why the language offers `allowed_classes` as a mitigation. Carbon's documentation
adds a reason specific to itself: the serialized form encodes local settings, so the payload is
not inert data even when every class in it is benign.

> It's not safe to unserialize() a string coming from an untrusted source, the Carbon objects
> (Carbon, CarbonInterval, CarbonPeriod, etc.) can be customized via their local settings in
> many ways
> ([Carbon — Serialization](https://carbon.nesbot.com/guide/advanced-features/serialization.html))

> (Custom formats, custom filters on the periods), hence when building those objects from a
> serialized string, it can have any values (unvalidated) and even behavioral customizations.
> ([Carbon — Serialization](https://carbon.nesbot.com/guide/advanced-features/serialization.html))

The second point is the one that turns this from a generic PHP warning into a Carbon-specific
trap. A `CarbonPeriod` rebuilt from a string can carry custom filters — closures that were
serialised with it — and a `Carbon` can carry a custom format. The object reconstitutes with
behaviour the application never set and cannot see. `allowed_classes` does not help, because
`Carbon` itself is on the allow-list.

`fromSerialized()` passes options straight through, so `allowed_classes` is available — as the
documentation notes:

> You can pass options to Carbon::fromSerialized the same way as you can with unserialize
> ([Carbon — Serialization](https://carbon.nesbot.com/guide/advanced-features/serialization.html))

That makes it an *available mitigation*, not a safe default. It restricts which classes may be
instantiated; it does not stop a legitimate `Carbon` from arriving with settings attached.

The realistic exposure is not a request body. It is the places a serialised date legitimately
lives: a cache entry, a session, a queue payload, a signed cookie, a database column written by
an older deploy. Each is a place where "we wrote it ourselves" is true until one of them sits
behind something an attacker can write to — a shared cache namespace, a queue message another
tenant produced, a log shipped from elsewhere.

## Do

Store and transport the string form, and re-parse on the way in:

```php
// Correct — a date is a string, so it crosses the boundary as a string
Cache::put('invoice:due:' . $id, $dueAt->toIso8601String(), $ttl);

$dueAt = Carbon::parse(Cache::get('invoice:due:' . $id));
```

Where a serialised form is genuinely needed — preserving a `CarbonPeriod` with its filters —
constrain it at both ends:

```php
// Correct — only the expected classes, on the way out and on the way in
$serialised = CarbonPeriod::create('2026-01-01', 7)->toIso8601String();
Cache::put('runs:' . $id, $serialised, $ttl);

$period = CarbonPeriod::create(Cache::get('runs:' . $id));

// If a serialised payload is unavoidable, restrict the classes explicitly
$carbon = Carbon::fromSerialized($payload, ['allowed_classes' => [Carbon::class]]);
```

Treat the payload as untrusted anyway, and authenticate the store that holds it:

```php
// Correct — a signed cookie cannot be rewritten by the client
$value = $request->cookie('as_of');
$raw = CookieValue::get($value);   // signature checked before use
$date = Carbon::parse($raw);
```

## Don't

Don't `unserialize()` anything that came from outside the process:

```php
// Incorrect — request body straight into object construction
$date = Carbon::fromSerialized($request->input('date'));
$date = unserialize($cacheValue);            // same hazard, PHP-wide
```

Don't use `unserialize()` as a convenient way to store a date:

```php
// Incorrect — a serialised object where a string would do
Cache::put('due:' . $id, serialize($dueAt), $ttl);
```

Don't rely on `allowed_classes` alone to make an untrusted payload safe. It bounds which
classes are built; it does not bound what a permitted class can be configured to do. Carbon's
own documentation points at the behavioural customizations as the reason the warning exists.

Don't trust a queue payload because your own producer wrote it. In a multi-tenant or
multi-service queue, "we wrote it" is a property of the routing key, not a guarantee about the
bytes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `__wakeup` fires on an unexpected class | Unrestricted `unserialize` | `allowed_classes`, or don't unserialize |
| Period behaviour differs after a cache round-trip | Custom filters restored from the payload | Store the definition, not the object |
| Object rejects `json_decode` | Assume a serialised date is JSON-safe | `toIso8601String()` at the boundary |
| Works until another tenant writes the key | Shared cache namespace | Prefix per tenant, or sign the value |
| Gated by `__PHP_Incomplete_Class` | `allowed_classes` already applied | Same; the mitigation was present |
| A queue job behaves differently in production | Payload carries local settings | Rebuild from a definition |
| Cookie-based preference rejected by the server | Signed payload tampering | Verify the signature first |

## Verifying

Find every deserialisation path, including the ones not spelled `unserialize`:

```bash
# direct calls
grep -rnE '\bunserialize\s*\(|fromSerialized\(|::fromSerialized' app/ src/ domain/ config/ --include='*.php'

# cache, session and queue payloads that hold objects rather than scalars
grep -rnE '(Cache::|->put\(|session\(|Session::)' app/ src/ --include='*.php' | grep -i 'date\|carbon\|period\|interval'

# what gets stored: serialise of a date object
grep -rn 'serialize(' app/ src/ --include='*.php'
```

Then confirm what the string form round-trips cleanly, which is the replacement:

```bash
php -r '
require "vendor/autoload.php";
use Carbon\Carbon;
use Carbon\CarbonPeriod;

$at = Carbon::parse("2026-01-31 12:00:00", "Europe/Istanbul");
echo $at->toIso8601String(), PHP_EOL;

$period = CarbonPeriod::create("2026-01-01", "2026-01-05");
echo $period->toIso8601String(), PHP_EOL;

$round = Carbon::parse($at->toIso8601String());
printf("equal: %s  tz preserved: %s\n",
    var_export($round->eq($at), true),
    var_export($round->tzName === $at->tzName, true));
'
# 2026-01-31T12:00:00+02:00
# 2026-01-01/2026-01-05
# equal: true  tz preserved: true
```

What this check cannot see: it cannot tell you which of the deserialisation sites are actually
reachable by an attacker. `unserialize()` on a value that only ever comes from the application's
own cache is a different risk from the same call on a request body, and the grep does not
distinguish them — it finds the call sites, and the reachability is a property of who can write
to that store. The mitigating question for each hit is "who can write this value", not "is this
value validated".