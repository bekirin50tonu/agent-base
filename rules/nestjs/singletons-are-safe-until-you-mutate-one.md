---
title: "Singletons Are Safe Because Node Is Single-Threaded — Until You Store Request State In One"
rule_id: "RULE-NESTJS-003"
category: "correctness"
scope: "all"
applies_to: "Any singleton provider holding mutable instance state"
last_updated: "2026-09-30"
source: "https://docs.nestjs.com/fundamentals/injection-scopes"
---

# Singletons Are Safe Because Node Is Single-Threaded — Until You Store Request State In One

There is no per-request thread, so a shared instance cannot be torn by a concurrent caller the
way it could in a servlet container. What *can* still go wrong is request state written into a
singleton, and it is not a race — it is a leak that outlives the request.

## Why

The injection-scopes chapter opens by making the safety claim and then naming the exact
boundary:

> If you come from a different programming language background, you might be surprised to learn
> that in Nest, almost everything is shared across incoming requests: a connection pool to the
> database, singleton services with global state, and so on. Node.js doesn't follow the
> multi-threaded stateless request/response model, in which every request is processed by a
> separate thread. Using singleton instances is therefore fully safe in Nest applications.

Read to the end of the paragraph, because the *however* is the rule:

> However, there are edge cases where a request-based lifetime is the desired behavior, e.g.,
> per-request caching in GraphQL applications, request tracking, and multi-tenancy.

The reason a singleton is safe is that it is not *given* a request to hold. The moment a
provider is handed per-request data — a user, a tenant, an accumulating buffer, a memo keyed on
an argument — the safety argument no longer applies, and it fails differently: there is no
concurrency to lose the race to, so the last write simply wins and the next request reads the
previous request's value.

The failure is silent in the way that only shared-lifetime bugs are. Request A's tenant leaks
into request B's query, and the reproduction is "it only happens on the second request" — the
classic fingerprint of state held on a singleton.

## Do

- Keep request *scoped* things on the request: the ALS store, the `REQUEST` object, per-request
  caches. If it varies per request, it does not belong in a constructor field of a singleton.
- Use a `Map` or `Set` on a singleton only for genuinely shared data, and know it is unbounded
  unless you bound it. Node is single-threaded, so a plain object is a correct structure here —
  it is the lifetime that matters, not the container.
- For a per-request cache, use request scope or an ALS-held cache, both of which are documented
  uses of a request-based lifetime.
- Treat a `currentUser`, `currentTenant`, or `tenantId` field on an `@Injectable()` class as a
  finding. There is a documented mechanism for exactly that value, and it is not a field.

## Don't

- Store the current user, tenant, or request id in a singleton field. Request B reads request
  A's value, and the stack trace points at the field, not at the request that wrote it.
- Assume `implements OnModuleInit` makes a singleton request-safe. It initialises once, which
  is the opposite of once-per-request.
- Hold a growing array or map of per-request data on a singleton "for metrics." There is no
  concurrent writer to evict the old entry, and no GC that can see it.
- Treat the singleton default as a decision to revisit. It is the documented recommendation:
  *"Singleton scope is recommended for most use cases... an instance can be cached, and its
  initialization occurs only once, during application startup."*

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Second request sees the first request's user/tenant | Per-request value on a singleton field | Move the value into an ALS store or request scope |
| Memory grows with request count, no leak in business logic | Unbounded map/array on a singleton | Bound it, or move per-request entries into the request |
| Intermittent wrong-tenant data, hard to reproduce | Same, masked by cache and timing | Test two requests in sequence — it reproduces reliably |
| Slow first request only | Provider doing async work in its constructor | Singleton initialises once at startup; do it in `onModuleInit` |

## Verifying

```bash
# Suspect per-request state on long-lived providers
grep -rn 'this\.\(currentUser\|currentTenant\|tenantId\|requestId\|user\) *=' --include=*.ts src/
```

The strongest check is a two-request test — issue two requests with different tenants and
assert the second does not see the first's data. Single-request tests cannot catch this class of
bug at all, which is why it survives review.
