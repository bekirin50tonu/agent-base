---
title: "Request Scope Bubbles Up the DI Tree — One Request-Scoped Provider Bubbles Its Dependents"
rule_id: "RULE-NESTJS-001"
category: "correctness"
scope: "all"
applies_to: "Any provider or controller in a Nest application"
last_updated: "2026-09-30"
source: "https://docs.nestjs.com/fundamentals/injection-scopes"
---

# Request Scope Bubbles Up the DI Tree

`Scope.REQUEST` is not a property of one class. It is a property of the whole subtree hanging
*above* it, and it propagates upward, not downward.

## Why

The docs state the direction explicitly, and the direction is the opposite of what most people
assume:

> The REQUEST scope bubbles up the injection chain. A controller that depends on a
> request-scoped provider is itself request-scoped.

The worked example in the docs is a three-node chain, `CatsController <- CatsService <-
CatsRepository`. Make `CatsService` request-scoped and only that node plus the controller become
request-scoped — `CatsRepository` stays a singleton, because nothing in its dependencies changed.
**Scope flows from the dependency to the dependent, never the reverse.** A singleton service
that happens to be consumed by a request-scoped controller stays a singleton instance; the
controller is what gets rebuilt.

The cost is described in the *Durable providers* section with a concrete number:

> having at least one request-scoped provider (injected into the controller instance, or deeper,
> into one of its providers) makes the controller request-scoped as well. The controller must
> then be recreated (instantiated) for each individual request and garbage-collected afterward.
> For, say, 30k requests in parallel, there are 30k ephemeral instances of the controller (and
> its request-scoped providers).

So the failure mode is not "the one class I marked is slow." A single `Scope.REQUEST` on a
low-level provider — a `Repository`, a tenant-aware `DataSource`, a `Logger` — silently
re-instantiates the controller and every service above it, on every request, forever.

The most dangerous case is the common one: a request-scoped `DataSource` that reads the tenant
off the request and picks a connection. Everything depends on it, so everything becomes
request-scoped, and the whole application's object graph is rebuilt per request. The docs
propose durable providers for this exact shape, and say plainly that the strategy does not scale
to many tenants.

## Do

- Audit with a real grep, not a reading of the `scope:` options. The flag that matters is
  `Scope.REQUEST` anywhere in `src/`, and the answer you want is *which controllers end up
  request-scoped as a result*:

```bash
grep -rn 'Scope.REQUEST\|scope: *Scope' --include=*.ts src/
```

- Keep the default singleton scope unless the provider genuinely needs a per-request
  instance. The docs' own recommendation is unambiguous: *"Singleton scope is recommended for
  most use cases"* and *"Unless a provider must be request-scoped, we strongly recommend using
  the default singleton scope."*
- If a provider needs one *value* from the request — user, tenant, locale, trace id — do not
  make it request-scoped. Use `AsyncLocalStorage`; see
  `rules/nestjs/prefer-async-local-storage-over-request-scope.md`.
- Remember `REQUEST` is itself request-scoped and infects everything that injects it. The docs
  are precise: *"Any provider that relies on a request-scoped provider automatically adopts
  request scope, and this behavior cannot be changed."*

## Don't

- Inject `@Inject(REQUEST)` into a shared service to read a header. That one injection
  request-scopes every consumer of that service, transitively, with no opt-out.
- Put `Scope.REQUEST` on a low-level provider (repository, connection, cache) hoping the effect
  stops at the class itself. It does not; it stops at the top of the tree.
- Mark a controller request-scoped to "get access to the request." Same infection, and now
  the controller is rebuilt on every route it declares.
- Use request-scoped providers in a WebSocket gateway. The docs call this out specifically:
  *"WebSocket gateways should not use request-scoped providers, because they must act as
  singletons. Each gateway encapsulates a real socket and cannot be instantiated multiple
  times. The same limitation applies to some other providers, like Passport strategies or Cron
  controllers."* A gateway that violates this is a runtime crash, not a slowdown.
- Assume `TRANSIENT` behaves like `REQUEST` in the tree. The docs distinguish them:
  transient dependencies **do not** pull the consumer up, because the consumer still holds one
  reference to a provider that is itself the thing being rebuilt. If you want the consumer
  rebuilt too, mark it `TRANSIENT` explicitly.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Controller instance count equals request count | Something in the tree is `Scope.REQUEST` | Grep for `Scope.REQUEST`, remove or convert to ALS |
| Latency ~5%+ above baseline with no obvious hotspot | Request scope on a widely-depended-on provider | Move to `AsyncLocalStorage`; see the ALS rule |
| Gateway or cron provider throws or loses state | Request-scoped provider in a must-be-singleton component | Keep gateway, Passport strategy, and cron providers singleton |
| Multi-tenant app slow at ~5% or more | Request-scoped tenant `DataSource` rebuilding the graph | Durable providers per tenant, or ALS-based tenant store |

## Verifying

The docs give a number to check against rather than a linter:

> A properly designed application that uses request-scoped providers should not see latency
> increase by more than **~5%**.

Benchmark before and after. If the delta exceeds that, the tree is larger than you think — the
infection is upward, so the count of controllers that became request-scoped is the number to
report, not the count of classes you marked.
