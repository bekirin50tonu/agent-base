---
title: "Sequential await Inside One Component Is the Waterfall — Start Requests, Then Await"
rule_id: "RULE-REACT-006"
category: "performance"
scope: "next"
applies_to: "Any component with more than one independent data request"
last_updated: "2026-09-30"
source: "https://nextjs.org/docs/app/getting-started/fetching-data"
---

# Sequential await Inside One Component Is the Waterfall — Start Requests, Then Await

Route segments already render in parallel. The leak is almost always `await` ordering inside a
single component body.

## Why

The framework's own diagnosis is precise, and it is *not* the client/server boundary:

> By default, layouts and pages are rendered in parallel. So each segment starts fetching data
> as soon as possible. **However, within any component, multiple async/await requests can still
> be sequential if placed after the other.** For example, getAlbums will be blocked until
> getArtist is resolved.

The consequence follows from when a request starts:

> Requests begin as soon as fetch is called.

So this is a waterfall:

```ts
const artist  = await getArtist(id);   // request 1 starts, we block here
const albums  = await getAlbums(id);   // request 2 has not started yet
```

and this is not — same two requests, same total data, concurrent:

```ts
const albumsPromise = getAlbums(id);   // both start now
const artistPromise = getArtist(id);
const [artist, albums] = await Promise.all([artistPromise, albumsPromise]);
```

The second read in the first version waits for the first *and* for a network round trip that
did not need to wait for anything.

## Preloading: starting earlier than the consumer needs

The framework names the technique — the request starts before the component that needs it:

> When a component renders after other blocking work, its data request starts late even if the
> request inputs are already available. **Preloading starts the request earlier so it can run
> in parallel with that work and avoid a request waterfall.**
>
> To preload data, call the data-fetching function without `await` before blocking work, then
> call the same function in the component that consumes the result.

That last sentence has a hard requirement attached, and skipping it is the bug:

> The data-fetching function **must deduplicate matching calls** so the component can reuse the
> request started during preloading.

Without deduplication the preloading component and the consuming component each start their
own request — the same work twice, and a genuine problem rather than the illusion of one.

## Do

- Start every independent request before awaiting any of them. `Promise.all` over already-
  started promises, or the `use` pattern from RULE-REACT-002 where the promise is cached.
- Co-locate related reads in one server component so they issue together.
- Preload with the same function you later consume, and confirm that function dedupes.
- Use `Promise.allSettled` when one failure should not sink the batch — the docs note that
  *"If one request fails when using `Promise.all`, the entire operation will fail."*

## Don't

- Read a waterfall as a server-performance problem. If a component awaits two independent
  things in sequence, the second request began late by construction, regardless of how fast
  the server is.
- Preload inside a loop or a component that renders many times. The dedupe requirement makes
  this safe for correctness, not free.
- Assume segments serialize. The opposite is the default: *"each segment starts fetching data
  as soon as possible."* Look inside one component before suspecting the route.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Second fetch is always slow, first is not | Sequential `await` | Start both, then `Promise.all` |
| Duplicate DB hits after adding preload | Fetch function doesn't dedupe | Memoise per request |
| One failing child blanks the page | `Promise.all` | `Promise.allSettled` |
| Waterfall across nested components | Child fetches in its own body | Hoist reads to the parent |

## Verifying

```bash
grep -rn 'await' --include=*.tsx app/ -A1 | grep -B1 'await'   # two awaits in a row
grep -rn "await .*;" app/**/*.tsx | awk -F: '{print $1}' | uniq -c | sort -rn | head
```

The first is the direct signal. Two consecutive `await` statements in one function body, with
no relationship between what they await, is the pattern.

## Version note

Verified against **Next.js 16.3.7**. React's own `cache` is the same idea from the other
side — *"React will invalidate the cache for all memoized functions for each server request"*,
and *"cache is for use in Server Components only."* It is request-scoped memoization, not a
persistent cache, and it is what makes a preload reusable by the consumer.
