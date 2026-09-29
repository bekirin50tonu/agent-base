---
title: "Next.js Has Two Coexisting Caching Models — Name Which One Before Writing the Rule"
rule_id: "RULE-REACT-007"
category: "correctness"
scope: "next"
applies_to: "Any Next.js App Router project asserting or relying on a caching default"
last_updated: "2026-09-30"
source: "https://nextjs.org/docs/app/guides/caching-without-cache-components"
---

# Next.js Has Two Coexisting Caching Models — Name Which One Before Writing the Rule

"Next.js caches fetches" is false in 16.3.7. There are two models with different opt-in
mechanisms, one of them explicitly labelled *Previous Model*. Any guidance that does not name
the model is stale by construction.

## Why

The two coexist and are not interchangeable.

**Model A — the previous one.** Fetch is uncached by default, and caching is opt-in per
request:

> By default, fetch requests are not cached. You can cache individual requests by setting the
> cache option to `force-cache`.

The opt-in set is `cache: 'force-cache'`, `next: { revalidate: n }`, `next: { tags: [...] }`,
`unstable_cache(fn, keys, { tags, revalidate })`, and segment config. Invalidation is
`revalidateTag` / `revalidatePath`.

**Model B — Cache Components**, gated behind `cacheComponents: true`, and expressed with a
directive rather than a fetch option:

> The `use cache` directive caches the return value of async functions and components.

Its own guidance inverts Model A's default in an important case:

> For components that fetch data from an asynchronous source such as an API, a database, or any
> other async operation, and require fresh data on every request, **do not use `'use cache'`**.
> Instead, wrap the component in `<Suspense>` and provide a fallback UI. The fallback ships
> with the prerendered shell while the async work runs at request time.

So in Model B, fresh data is the answer and the fallback is the mechanism — the opposite of
the instinct Model A trains. There is also a runtime-data variant, `"use cache: private"`, that
*"gives a lifetime to a function that reads cookies, headers, or searchParams directly, so it
can be included in a prefetch."*

The opt-in mechanisms are **disjoint**. `force-cache` and `'use cache'` do not talk to each
other. Both models currently default to "not cached," which is exactly why the difference is
easy to miss and expensive to discover late.

## Do

- Name the model in the sentence. "Next.js does not cache fetches by default" is true; "use
  `force-cache` to fix the stale data" is a Model A fix that silently does nothing under
  `cacheComponents: true`.
- Check which model the project is on before recommending a caching change:

```bash
grep -rn 'cacheComponents' next.config.* ; grep -rn "'use cache'\|force-cache" app/ next.config.*
```

- Pair every cache directive with a cache life. The docs recommend it: *"We recommend pairing
  every cache directive with a cacheLife. Without one, the implicit default profile applies."*
- Keep React's `cache` distinct from both. *"React will invalidate the cache for all memoized
  functions for each server request"* — it is request-scoped memoization, not a persistent
  cache, and it exists so a preload can be reused by its consumer (RULE-REACT-006).

## Don't

- Assume `'use cache'` is available because the docs mention it. It requires
  `cacheComponents: true`.
- Reach for `'use cache'` to fix a per-request-fresh read. The docs name that as the case
  where you must not.
- Treat `force-cache` and `'use cache'` as spellings of one thing. Different model, different
  opt-in, different invalidation.
- Look for a React `cacheTag`. There isn't one. It is a Next.js API from `next/cache`,
  alongside `cacheLife` and `revalidateTag`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Data never revalidated, `force-cache` set | Model B project | `'use cache'` + `cacheLife` |
| `'use cache'` ignored | `cacheComponents` not enabled | Enable it or use Model A |
| Stale data on a page that must be fresh | Cached a per-request read | `<Suspense>` + fetch at request time |
| Deduped within a request, not across | React `cache` used as a persistent cache | `revalidateTag` / `revalidatePath` |

## Verifying

```bash
grep -rn 'cacheComponents' next.config.* 2>/dev/null
grep -rn "'use cache'\|force-cache\|unstable_cache" app/ 2>/dev/null
grep -rn 'revalidateTag\|revalidatePath' --include=*.ts --include=*.tsx . 2>/dev/null
```

A project using both `'use cache'` and `force-cache` is mixing models, which is a decision
rather than a mistake — but it should be a deliberate one.

## Version note

Verified against **Next.js 16.3.7**. The URL `nextjs.org/docs/app/guides/caching`
**redirects** to `caching-without-cache-components`, whose title is *"Caching and
Revalidating (Previous Model)"*. The label is the point: this is the model Next.js is
migrating away from, and advice built on it has a shelf life.
