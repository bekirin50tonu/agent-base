---
language: "Carbon"
tag: "carbon"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Carbon, PHP date-time and time-mocking assets."
---

# Documentation Hub: Carbon

> **Agent Directive (Phase 4)**: Inspect the target project's `composer.json` and `composer.lock`
> for `nesbot/carbon` (direct or via `laravel/framework`), then grep for `Carbon::setTestNow(`,
> `freezeTime`, `travelTo`, `->addMonth(`, `->add(`, `diffInDays(`, `diffInHours(`,
> `->diffForHumans(`, `->week(`, `isoWeek(`, `Carbon::parse(`, `hasRelativeKeywords`,
> `unserialize(`, `serialize(`, `Carbon::setLocale(`, `->locale(`, and any `'datetime'` or
> `'immutable_datetime'` cast in a model. Match the conditions below to determine which `rules`,
> `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the places where Carbon's defaults are documented, correct, and
> silently not what the author assumed — the global test clock, mutable vs immutable instances,
> signed float differences, month overflow, relative-string parsing, locale vs ISO weeks, moving
> human-readable phrases, untrusted deserialization, and the process-wide translator. No
> `skills` yet.
>
> **Version note**: written against the Carbon 3 documentation. Two version boundaries are
> load-bearing. `diffIn*()` returns **floats** in Carbon 3 where Carbon 2 returned integers, so
> `=== 7` and `int` type hints break on upgrade; the interval-returning variants return
> `CarbonInterval` where they returned a native `DateInterval`. `setTestNow()` stopped carrying a
> timezone in **2.56.0** — before that it forced the mock's timezone onto `Carbon::now()`, so a
> suite asserting hours could differ between machines on the same lockfile. Check the installed
> version before attributing a date defect to application code. There is a separate `docs/laravel.md`
> and `docs/laravel.md` hubs; this one covers the date-time library itself and overlaps with
> those only on Eloquent's date casts.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/carbon/set-test-now-is-a-global-static-mock.md`
  - **Why**: `Carbon::setTestNow()` writes to a static, so every Carbon instance created while it
    is set reads that value — including instances inside vendor packages and framework internals.
    It also mocks relative phrases, so `yesterday` and `'next sunday'` resolve against the mock,
    and a test that aborts before the clear skips the clear entirely. The documented cure is
    `withTestNow()`, which restores on exit. Behaviour changed in 2.56.0, when the mock stopped
    applying its timezone to `Carbon::now()`.
  - **When**: Target project calls `Carbon::setTestNow(` directly, mocks time in a shared-process
    runner, runs queue workers or a test suite that reuses a process, or asserts on `now()`,
    `today`, or a relative phrase.
  - **Target Location**: `docs/rules/set-test-now-is-a-global-static-mock.md`

- **Path**: `rules/carbon/diff-in-returns-signed-floats-since-carbon-3.md`
  - **Why**: Two defaults compound — the comparison date defaults to `now`, and `absolute`
    defaults to `false`, so `diffInDays($end)` looks total and returns a *directed* difference
    that flips sign with argument order. Since Carbon 3 the result is a **float**, so a strict
    `=== 7` comparison is false and passing it to an `int` parameter throws under strict types.
    Neither failure is loud in a suite that compares with `==`.
  - **When**: Target project calls any `diffIn*()` method, computes an age or a duration, or
    compares a difference result against a numeric literal.
  - **Target Location**: `docs/rules/diff-in-returns-signed-floats-since-carbon-3.md`

- **Path**: `rules/carbon/carbon-is-mutable-modifiers-mutate-the-same-instance.md`
  - **Why**: "When you use a modifier on a Carbon instance, it modifies and returns the same
    instance" — so `$b = $a->addDay()` produces one object under two names, and every other
    holder of that reference sees the change. A helper that looks like it returns a value
    (`return $date->startOfDay();`) rewrites its argument. `CarbonImmutable` exists for exactly
    this, and Laravel's default `datetime` cast produces the mutable one.
  - **When**: Target project stores `Carbon` in a model, entity, collection, or long-lived
    service, calls a modifier for its return value, or casts a model attribute as `datetime`
    rather than `immutable_datetime`.
  - **Target Location**: `docs/rules/carbon-is-mutable-modifiers-mutate-the-same-instance.md`

- **Path**: `rules/carbon/add-month-overflows-and-local-overflow-settings.md`
  - **Why**: Carbon "relies on the underlying parent class PHP DateTime behavior. As a result
    adding or subtracting months can overflow" — 31 January plus one month is 3 March, not 28
    February, and the result is a valid date so nothing fails. The difference appears only near a
    month end, so a test written in June never sees it. `addMonthNoOverflow()` clamps, and since
    Carbon 2 the policy is settable per instance.
  - **When**: Target project calls `addMonth(` / `subMonth(`, or computes billing dates, renewal
    dates, retention windows, or any "same day next month" value.
  - **Target Location**: `docs/rules/add-month-overflows-and-local-overflow-settings.md`

- **Path**: `rules/carbon/parse-accepts-relative-strings.md`
  - **Why**: "The string passed to Carbon::parse or to new Carbon can represent a relative time"
    — so untrusted text can resolve relative to `now()` instead of being rejected, inheriting any
    test clock mock as well. Laravel's `date` validation rule accepts these strings, so the
    obvious guard does not catch them. The library ships `hasRelativeKeywords()` for exactly this
    check.
  - **When**: Target project calls `Carbon::parse(` or `new Carbon(` with a variable, takes a date
    from a request, CSV, webhook, or stored filter string, or accepts user-typed dates.
  - **Target Location**: `docs/rules/parse-accepts-relative-strings.md`

- **Path**: `rules/carbon/locale-and-iso-week-methods-are-different-units.md`
  - **Why**: "Week methods follow the rules of the current locale" — with the default `en_US`
    that means Sunday start and the first week containing January 1st — while "ISO methods follow
    the ISO 8601 norm". The two return numbers that are not comparable, and pairing `isoWeek()`
    with the calendar `year()` produces keys that name the wrong year for roughly a week each year
    (`2025-12-29` is `isoWeek()` 1 but `isoWeekYear()` 6).
  - **When**: Target project uses a week number as a key, in a report grouping, an API field, a
    filename, or a comparison against another system's week, or calls `week()` / `weekOfYear`.
  - **Target Location**: `docs/rules/locale-and-iso-week-methods-are-different-units.md`

- **Path**: `rules/carbon/diff-for-humans-shapes-differ-by-which-date-is-greater.md`
  - **Why**: The comparison date "defaults to now() if not specified", and the default mode is
    `DIFF_RELATIVE_AUTO`, so the same stored value renders "2 days from now" today and "1 day
    ago" tomorrow with nothing changing. A phrase that moves is wrong wherever it is persisted —
    a cache entry, a queued email, an audit row — and a test asserting the string races the wall
    clock. `DIFF_RELATIVE_TO_OTHER` with an explicit reference date is direction-stable.
  - **When**: Target project calls `diffForHumans(` and stores, caches, asserts, or emails the
    result, rather than rendering it live.
  - **Target Location**: `docs/rules/diff-for-humans-shapes-differ-by-which-date-is-greater.md`

- **Path**: `rules/carbon/unserialize-untrusted-source-is-unsafe.md`
  - **Why**: The docs state "It's not safe to unserialize() a string coming from an untrusted
    source", and add a Carbon-specific reason: a serialized Carbon carries local settings, so it
    can arrive with custom formats and custom period filters restored — behaviour the application
    never set. `allowed_classes` bounds which classes are built but not what a permitted `Carbon`
    can be configured to do. The realistic exposure is a cache, session, queue payload, or signed
    cookie rather than a request body.
  - **When**: Target project calls `unserialize(`, `fromSerialized(`, or stores a serialised
    Carbon, CarbonInterval, or CarbonPeriod in a cache, session, queue job, or cookie.
  - **Target Location**: `docs/rules/unserialize-untrusted-source-is-unsafe.md`

- **Path**: `rules/carbon/global-translator-changes-third-party-behaviour.md`
  - **Why**: "As those method will change the behavior globally (including third-party libraries
    you may have in your app), it might cause unexpected results" — and the scope is wider than
    text, because the locale also drives week-numbering rules and numeric formatting. A
    per-request `setLocale()` therefore renumbers weeks and reformats numbers in vendor code
    that never mentions Carbon, and in a long-running worker the last request's locale persists.
  - **When**: Target project calls `Carbon::setLocale(` or `setTranslator(`, translates dates by
    request or tenant, or runs a queue worker, Octane, or daemon that handles more than one
    locale.
  - **Target Location**: `docs/rules/global-translator-changes-third-party-behaviour.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/carbon/agent.json`
  - **Why**: Helps with Carbon and PHP date-time tasks, such as freezing time in a test without
    leaking the mock into the rest of the process, choosing between mutable Carbon and
    CarbonImmutable for a stored date, adding a month without overflowing past the end of the
    month, reading diffIn*() results as a signed float rather than a distance, using ISO week
    numbers with an ISO week-year rather than the calendar year, keeping relative phrases and
    locale settings out of stored values, and never unserializing a date from an untrusted source.
  - **When**: Target project depends on `nesbot/carbon` directly or through Laravel, and contains
    any date arithmetic, time mocking, week numbering, or human-readable date output.
  - **Target Location**: `docs/agents/carbon/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/carbon/time-and-test-decisions.md`
  - **Why**: Four questions decide most Carbon defects — which clock, mutable or immutable, which
    unit, which format — and in all four the shipped default answers a question nobody asked. The
    matrix names each default *and* its cost, because the recurring shape is the one from the
    Docker, Node.js and Laravel rounds: the library is correct and the author's model of the
    library is what is wrong. One grep surfaces every decision in the codebase at once.
  - **When**: Target project depends on Carbon and has more than a handful of date call sites, or
    stores dates across a boundary (cache, queue, cookie, API).
  - **Target Location**: `docs/carbon/time-and-test-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.