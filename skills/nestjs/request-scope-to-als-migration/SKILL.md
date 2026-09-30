---
name: request-scope-to-als-migration
description: "Migrate NestJS Scope.REQUEST providers to AsyncLocalStorage. Use when Scope.REQUEST or @Inject(REQUEST) appears in a Nest app, when it is slow, or when user/tenant/locale is read deep in a service."
version: "1.0.0"
tags:
  - nestjs
  - performance
  - dependency-injection
---

# Migrate NestJS Request Scope to AsyncLocalStorage

A workflow for the most common NestJS performance defect: `Scope.REQUEST` applied to read one
value, which rebuilds the object graph on every request to carry that value.

Every step below traces to `docs.nestjs.com/fundamentals/injection-scopes` and
`docs.nestjs.com/recipes/async-local-storage`. The rules this workflow applies are
`rules/nestjs/request-scope-bubbles-up-the-di-tree.md` and
`rules/nestjs/prefer-async-local-storage-over-request-scope.md`.

## When to run this

- `Scope.REQUEST` appears anywhere in `src/`
- A provider injects `@Inject(REQUEST)` / `@Inject(CONTEXT)`
- A provider reads a current user, tenant, or locale
- Response times regress after a feature added "just one request-scoped provider"

## Step 1 — Find every scope declaration

```bash
grep -rn 'Scope.REQUEST\|Scope.TRANSIENT\|scope: *Scope' --include=*.ts src/
grep -rn '@Inject(REQUEST)\|@Inject(CONTEXT)' --include=*.ts src/
```

Two lists, and the second is the one that usually matters more. Injecting `REQUEST` is how a
request-scoped node gets created in the first place.

**If both greps are empty, stop.** The default scope is singleton and that is the documented
recommendation. There is nothing to migrate.

## Step 2 — Classify each hit: lifetime or value?

For each request-scoped provider, answer one question: does it need a **new instance per
request**, or does it need to **read a value from the current request**?

| Needs a new instance (keep request scope) | Needs a value (migrate) |
|---|---|
| Per-request mutable buffer or cache | current user / principal |
| Per-request accumulator (metrics, batch) | current tenant |
| Holds a resource tied to one request | current locale, currency, timezone |
| | trace id, correlation id |

The docs name the right-hand column directly: *"Many providers are request-scoped only to read a
value that belongs to the current request: the authenticated user, the tenant, or a locale."*

A provider that only reads is a candidate. A provider that accumulates is not.

## Step 3 — Check the blast radius before changing anything

Scope bubbles **upward**. The number of request-scoped classes you marked is not the cost — the
number of controllers that became request-scoped because of them is.

Walk up from each hit through its dependents. In `CatsController <- CatsService <-
CatsRepository`, making `CatsService` request-scoped makes the controller request-scoped and
leaves `CatsRepository` a singleton. Anything above the hit is affected; nothing below it is.

Record the count. You need a before/after number, because the docs give a threshold:

> A properly designed application that uses request-scoped providers should not see latency
> increase by more than **~5%**.

## Step 4 — Check for the structural blockers first

Some providers cannot be request-scoped at all, and if any is in the dependency chain, migrating
it is a prerequisite rather than an optimisation:

```bash
grep -rln '@WebSocketGateway\|PassportStrategy(\|@Cron(' --include=*.ts src/
```

> WebSocket gateways should not use request-scoped providers, because they must act as
> singletons. Each gateway encapsulates a real socket and cannot be instantiated multiple times.
> The same limitation applies to some other providers, like Passport strategies or Cron
> controllers.

A request-scoped provider reachable from any of these is a live bug, not a slow path. Fix that
first.

## Step 5 — Choose the store by transport

This is the decision that is not documented as a comparison, and it is the one that causes the
worst failure mode — `getStore()` returning `undefined` inside a worker, at runtime.

| Transports your app actually runs | Choose | Why |
|---|---|---|
| HTTP only | hand-rolled `AsyncLocalStorage` + middleware | smallest correct thing, no dependency |
| HTTP + microservices / queues / cron | `nestjs-cls` (`ClsModule.forRoot`) | multi-transport mount options |
| Already using `@nestjs/observe` | `TracerService` | SDK already owns a per-operation store |

The distinction is real. A hand-rolled store is mounted as middleware, and middleware is the
HTTP path only — the docs call it *"the practical difference from a hand-rolled,
middleware-based implementation, which only covers HTTP."* If the app has a BullMQ consumer or a
`@Cron()` job, an HTTP-only store will read `undefined` there.

## Step 6 — Mount the store

Hand-rolled ALS, from the recipe:

```ts
// als.module.ts — provide the instance once, as a value provider
@Module({
  providers: [{ provide: AsyncLocalStorage, useValue: new AsyncLocalStorage() }],
  exports: [AsyncLocalStorage],
})
export class AlsModule {}
```

```ts
// app.module.ts — middleware is the first thing a request hits
configure(consumer: MiddlewareConsumer) {
  consumer
    .apply((req, res, next) => {
      this.als.run({ userId: req.headers['x-user-id'] }, () => next());
    })
    .forRoutes('*path');
}
```

> Since middleware is the first thing a request hits, this makes the store available in all
> enhancers and the rest of the system.

Type the store. The docs warn that ALS *"inherently obscures the code flow (by creating implicit
context), so use it responsibly, and especially avoid creating contextual 'God objects'."* A typed
interface is the cheapest guard.

## Step 7 — Rewrite the consumer, then drop the scope

Remove `scope: Scope.REQUEST` from the migrated provider and read the store instead of injecting
`REQUEST`. Then re-run Step 1 — the win only materialises when *nothing* in the chain above it is
still request-scoped.

```bash
grep -rn 'Scope.REQUEST\|@Inject(REQUEST)' --include=*.ts src/
```

If this is non-empty, the tree is still being rebuilt per request and the migration bought
nothing.

## Step 8 — Verify

```bash
# 1. Scope is gone from the migrated path
grep -rn 'Scope.REQUEST' --include=*.ts src/

# 2. Store is mounted on every transport you run
grep -rn 'ClsModule\|AsyncLocalStorage\|ObserveModule' --include=*.ts src/

# 3. Benchmark delta is under the documented ~5% ceiling
```

Then write the test that a single-request test cannot produce: **two requests with different
tenants, asserting the second does not see the first's data.** Singleton state leaks on the
second request, by construction — this is the bug class that survives review because the
unit tests pass.

## Testing the migrated code

`ClsService` is an ordinary injectable, so unit tests mock it away entirely:

```ts
const module = await Test.createTestingModule({
  providers: [CatsService, { provide: CatsRepository, useValue: mockRepo }],
  imports: [ClsModule],  // static import: provides ClsService, sets up no store
}).compile();
```

For an integration test that needs the real store, wrap the call rather than re-implementing the
setup — this is documented:

```ts
const cat = await cls.runWith({ userId: 42 }, () => service.getCatForUser());
```

With the Observe SDK the contract differs and the difference is deliberate: `getAttribute()`
**throws** outside a traced context, while `currentTraceId()` returns `null`. Guard accordingly.

## When to stop and escalate

Two cases the ALS migration does not solve:

- **Many tenants with isolated connection pools.** The docs propose durable providers with a
  `ContextIdStrategy` that maps each tenant to a long-lived DI sub-tree, and warn: *"This
  strategy is not ideal for applications with a large number of tenants."* Tenants get a
  sub-tree; requests do not.
- **A provider that genuinely needs per-request mutable state.** A request-scoped accumulator is
  the correct use of `Scope.REQUEST`, and the ~5% budget covers it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError` reading `undefined` in a queue consumer | HTTP-only store, worker has no store | `ClsModule.forRoot` or the Observe SDK |
| No latency change after migrating | Something above is still request-scoped | Re-run Step 7's grep |
| Second request sees the first's tenant | Remaining singleton field, not a scope issue | Step 8's two-request test |
| Socket connects, handler never fires | Step 4 blocker, still request-scoped | Return to Step 4 |
