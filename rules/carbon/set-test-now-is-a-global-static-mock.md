---
title: "setTestNow() mocks the whole process, not the test"
rule_id: "RULE-CARBON-001"
category: "correctness"
scope: "backend"
applies_to: "Carbon, CarbonImmutable, PHPUnit, Pest, setTestNow, withTestNow, date_default_timezone_set"
last_updated: "2026-10-04"
source: "https://carbon.nesbot.com/guide/getting-started/testing-aid.html"
---

# setTestNow() mocks the whole process, not the test

`Carbon::setTestNow()` writes to a static. Every Carbon instance created while it is set —
including instances created inside vendor packages, inside framework internals, and inside jobs
the test did not know it triggered — reads that value. The mock covers relative phrases too, so
`yesterday` and `'next sunday'` resolve against the mock as well. `withTestNow()` is the scoped
form and restores the previous value when the closure returns.

## Why

The scoping does not read as scoping. `Carbon::setTestNow('2026-01-01');` followed by an
assertion looks like it configures that one test, and locally it behaves that way — the test file
is usually the only Carbon user in a small script. It stops behaving that way as soon as the
process does anything else: a queued job dequeued by the same worker, a package that
constructs dates internally, a second test class in the same process that ran earlier and
did not clear.

> Allow you to set a Carbon instance (real or mock) to be returned when a "now" instance is
> created. The provided instance will be used when retrieving any relative time from Carbon
> (now, today, yesterday, next month, etc.)
> ([Carbon — Testing Aid](https://carbon.nesbot.com/guide/getting-started/testing-aid.html))

> Relative phrases are also mocked according to the given "now" instance.
> ([Carbon — Testing Aid](https://carbon.nesbot.com/guide/getting-started/testing-aid.html))

The failure is silent in both directions. Tests that mock the clock and leak it into a later
test produce a later test that fails on an unrelated assertion, or passes for the wrong reason —
and the two only disagree on the run where ordering happened to differ. A test that aborts
between `setTestNow()` and the clear skips the clear entirely, so the leak is *most* likely
exactly when the test was already failing.

There is a second, older global here. Before Carbon 2.56.0 the mock forced the mocked
instance's timezone onto `Carbon::now()`, so a test asserting an hour could shift by the
difference between the mock's timezone and `date_default_timezone_get()`. That behaviour is
fixed and documented as fixed — it is listed here because the version boundary is the reason a
suite can behave differently on two machines with the same lockfile:

> Since Carbon 2.56.0, setTestNow() no longer impact the timezone of the Carbon::now()
> instance you'll get. This was done because in real life, Carbon::now() returns a date with
> the timezone from date_default_timezone_get(). And tests should reflect this.
> ([Carbon — Testing Aid](https://carbon.nesbot.com/guide/getting-started/testing-aid.html))

## Do

Scope the mock to the code that needs it:

```php
// Correct — scoped, restores on exit even if the body throws
Carbon::withTestNow('2026-01-01 12:00:00', function () use ($service) {
    expect($service->expiresAt())->toEqual(Carbon::parse('2026-02-01'));
});
```

Use the framework's own scoped helper where one exists — Laravel's `$this->travelTo()`,
`$this->freezeTime()` and `$this->travelBack()` all manage the mock's lifetime for you and
leave it cleared on teardown.

When the unscoped form is genuinely needed, make the clear unconditional:

```php
// Correct — the clear runs on the failure path too
Carbon::setTestNow('2026-01-01 12:00:00');
try {
    $expiry = $service->expiresAt();
} finally {
    Carbon::setTestNow();   // always clear it!
}
```

Reach for `setTestNowAndTimezone()` only when moving the timezone *is* the intent — that is
what makes it a separate method rather than the default:

```php
// Correct — the mock and the default timezone move together, deliberately
Carbon::setTestNowAndTimezone('2026-01-01 12:00:00', 'Europe/Istanbul');
```

## Don't

Don't leave the mock set across a test boundary:

```php
// Incorrect — global; leaks into any other test in this process
public function testExpiry(): void
{
    Carbon::setTestNow('2026-01-01');
    // if this test fails here, the mock stays set for the rest of the run
    $this->assertSame('2026-02-01', $this->service->expiresAt()->toDateString());
}
```

Don't combine an unscoped mock with a parallel or shared worker. A worker that handles more
than one job carries the mock from job one into job two.

Don't assume a mock set in `setUp()` reaches a job. If the queue runs in a separate process,
`setTestNow()` in the test process does not affect it at all — the job's `now()` is real, and
the assertion in the test is about a value the job never computed.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Test passes alone, fails in the suite | Mock leaked from an earlier test | `withTestNow()`, or clear in `tearDown()` |
| Assertion about `now()` is off by a day | Mock still set from an aborted test | `try`/`finally`, or framework `freezeTime()` |
| Test's mock does not affect the code under test | Code runs in another process | Inject the clock, or pass the timestamp explicitly |
| Hour assertions shift between machines | Pre-2.56.0 mock carried a timezone | Pin Carbon ≥ 2.56.0 |
| A relative string resolves to the wrong day | Relative phrases follow the mock | Assert against an explicit instant |
| Every later test in the class fails together | One unscoped `setTestNow()` with no clear | Find the missing clear, not the later failures |

## Verifying

Find unscoped mocks, and find any test that sets the clock without clearing it:

```bash
# unscoped calls, which must each have a matching clear somewhere in the file
grep -rn 'Carbon::setTestNow(' tests/ --include='*.php' | grep -v 'setTestNowAndTimezone'

# the clear itself
grep -rn 'Carbon::setTestNow();' tests/ --include='*.php'
```

The check that actually catches the leak is a determinism check — run the suite with the
process state forced to a fixed order, and again with a seed that reorders it:

```bash
php artisan test --order-by=random --random-order-seed=4321
```

Run it a few times with different seeds. A suite whose results depend on the seed has an
unscoped clock, a shared static, or a global that survives teardown — and the clock is the
first thing to rule out.

What this check cannot see: it cannot tell you *which* static leaked, only that something did.
If the reordering run is unstable and there is no unscoped `setTestNow()` in `tests/`, the
remaining suspects are other Carbon globals — `setLocale()`, `setTranslator()`, and the
translator instance itself — or framework-level state. Carbon also mocks relative phrases,
so a green suite under a leaked mock can still be asserting against a fictional clock; the
only complete check is that no test relies on `now()` without pinning it.