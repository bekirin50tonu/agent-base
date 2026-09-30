---
title: "Reading a Request Value Does Not Require Request Scope — Use AsyncLocalStorage"
rule_id: "RULE-NESTJS-002"
category: "performance"
scope: "all"
applies_to: "Any provider that needs the current user, tenant, locale, or trace id"
last_updated: "2026-09-30"
source: "https://docs.nestjs.com/recipes/async-local-storage"
---

# Reading a Request Value Does Not Require Request Scope

Most request-scoped providers exist for one reason: to read a value that belongs to the current
request. That reason does not require a request-scoped provider. `AsyncLocalStorage` gives the
same value with every provider left a singleton.

## Why

The NestJS injection-scopes chapter names this pattern directly, in the performance section:

> Many providers are request-scoped only to read a value that belongs to the current request:
> the authenticated user, the tenant, or a locale. For that, a per-request store based on
> `AsyncLocalStorage` keeps every provider a singleton and works the same way in HTTP handlers,
> microservice message handlers, and queue jobs.

The phrase that decides the trade-off is *keeps every provider a singleton*. The alternative —
request scope — does not read a value; it **rebuilds the object graph** so that the value can
be passed as a constructor dependency. That is why `Scope.REQUEST` bubbles upward and takes
controllers with it (see `rules/nestjs/request-scope-bubbles-up-the-di-tree.md`). ALS inverts
the cost: the store is created once per request, and every consumer stays a cached singleton.

The recipe chapter frames the same choice as an alternative rather than a workaround:

> This can serve as an alternative to REQUEST-scoped providers, avoiding some of their
> limitations.

### The transport gap, and how the three options differ

This is the part that decides which option to pick, and it is not stated as a table anywhere —
it has to be read out of the coverage claims.

| Option | HTTP | Microservice messages | Queue jobs (BullMQ) | Cron | Owns the store |
|---|---|---|---|---|---|
| Hand-rolled ALS + middleware | yes | no | no | no | yes |
| `nestjs-cls` (`ClsModule`) | yes | yes | yes | yes | yes |
| `@nestjs/observe` `TracerService` | yes | yes | yes | yes | no — SDK owns it |

A hand-rolled `AsyncLocalStorage` wired through `consumer.apply(...).forRoutes('*path')` is
middleware, and middleware is the HTTP path only. The docs make the limitation explicit when
introducing the Observe SDK, whose store *"exists wherever the SDK traces an operation: HTTP and
GraphQL requests, gRPC and @nestjs/microservices messages, and background work such as BullMQ
consumers and cron runs"*, and note that this is *"the practical difference from a hand-rolled,
middleware-based implementation, which only covers HTTP."*

So: single-transport HTTP service → hand-rolled ALS is the smallest correct thing. Anything with
workers, queues, or cron → `ClsModule` or the Observe SDK, because a hand-rolled store silently
returns `undefined` off the HTTP path.

## Do

- Mount the store at the earliest point in the request, so everything downstream can read it.
  Middleware is that point, and the docs say so: *"Since middleware is the first thing a
  request hits, this makes the store available in all enhancers and the rest of the system."*
- Type the store. The recipe warns that the technique *"inherently obscures the code flow (by
  creating implicit context), so use it responsibly, and especially avoid creating contextual
  'God objects'."* A typed interface is the cheapest guard against the God object.
- In unit tests, mock `ClsService` away entirely — it is just a provider. When an integration
  test needs the real thing, wrap the call: `cls.runWith({ userId: 42 }, () => service.call())`.
  This is documented, so a test that reaches for `Test.createTestingModule` gymnastics instead
  is reinventing something that has a one-liner.
- With the Observe SDK, use `TracerService.getAttribute()` / `setAttribute()` rather than
  injecting the raw `AsyncLocalStorage` instance the module also exports. `getAttribute()`
  returns `undefined` for a key never set; `currentTraceId()` returns `null` outside a traced
  context. **The two differ on purpose** — `getAttribute()` *throws* outside a traced context.

## Don't

- Reach for `Scope.REQUEST` to get `req.user`, then wonder why every controller is
  instantiated per request. That is the same bug with a slower spelling.
- Hand-roll ALS with middleware in an app that has a queue or a cron job. The store will be
  absent there and `getStore()` returns `undefined` — a `TypeError` on a property read, at
  runtime, in the worker.
- Pass the store values down as function parameters "just to be safe." That defeats the entire
  point; the recipe names explicit threading as the alternative ALS exists to avoid.
- Treat `getAttribute()` returning `undefined` and `currentTraceId()` returning `null` as
  inconsistency to work around. Both are documented, deliberate choices.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: Cannot read properties of undefined` in a queue consumer | Hand-rolled middleware ALS does not cover non-HTTP transports | `ClsModule.forRoot({ middleware: { mount: true } })` or the Observe SDK |
| Controller instantiated once per request | Request scope used to read one value | Move the value into an ALS store, drop the scope |
| Works in integration tests, breaks in prod | Test wrapped with `cls.runWith`, prod path unwrapped | Mount middleware / `ClsModule` at app level, not per-test |
| Implicit context is hard to follow | Untyped, unbounded store | Declare the store interface; keep it to request attributes, not domain state |

## Verifying

```bash
# Every request-scope declaration, and what it drags upward with it
grep -rn 'Scope.REQUEST' --include=*.ts src/

# Confirm the store is mounted on every transport you actually run
grep -rn 'ClsModule\|AsyncLocalStorage\|ObserveModule' --include=*.ts src/
```

If the first grep returns hits and the second shows no store, the code is using the expensive
mechanism for the cheap problem.
