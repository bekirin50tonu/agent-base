---
title: "use(promise) Requires a Cached Promise — a New One Every Render Breaks Suspense"
rule_id: "RULE-REACT-002"
category: "correctness"
scope: "all"
applies_to: "Any use of the React 19 use() API, in a Client or Server Component"
last_updated: "2026-09-30"
source: "https://react.dev/reference/react/use"
---

# use(promise) Requires a Cached Promise — a New One Every Render Breaks Suspense

`use` suspends on a Promise *object*, not on a URL. Call `fetch` in render and you get an
infinite fallback. Cache the Promise, not the result.

## Why

The failure is documented with an example marked as wrong:

```js
function Albums() {
  // 🔴 This creates a new Promise on every render
  const albums = use(fetch('/albums'));
}
```

> Promises created during render are recreated on every render, which causes React to show
> the Suspense fallback repeatedly and prevents content from appearing.

And the warning React emits is literally *"A component was suspended by an uncached
promise."* The mechanism is not subtle: Suspense works by unwrapping a Promise React
already holds, reading its settled value synchronously. A Promise React has never seen is
pending by definition, every time.

The fix is to return the *same instance* for the same key:

```js
let cache = new Map();
export function fetchData(url) {
  if (!cache.has(url)) { cache.set(url, getData(url)); }
  return cache.get(url);
}
```

> When use receives the same Promise on a re-render, it reads the already-resolved value
> synchronously without suspending.

The docs are explicit that this is a framework's job, not yours: *"Frameworks typically
provide built-in caching mechanisms. If you don't use a framework, you can use a simple
module-level cache."* In a Next.js App Router app you are already inside such a framework
and should be using its data layer.

## Do

- Pass a Promise created **above** the component — from a parent, a Server Component prop, or
  a framework data layer. The docs' streaming pattern is exactly this: the Server Component
  calls `fetchMessage()` and passes the Promise as a prop; the Client Component calls
  `use(messagePromise)`.
- To refresh the same URL, invalidate the cache entry and start a new fetch **inside a
  `startTransition`**, storing the new Promise in state. The docs note that while the new
  Promise is pending *"React keeps showing the existing content because the update is inside
  a Transition."*
- Preload on interaction. The documented pattern is `onMouseEnter={() => fetchData(...)}` —
  because the Promise is cached, *"the data may already be available by the time the user
  clicks."*
- Read a rejected Promise through an Error Boundary. `use` propagates rejections there
  automatically.

## Don't

- Call `use` inside `try`/`catch`. The docs give the mechanism: *"use throws internally to
  integrate with Suspense, so it cannot be wrapped in try-catch."* The error message you
  will see is `"Suspense Exception: This is not a real error!"`. Use an Error Boundary.
- Read `promise.status` or `promise.value` to skip the call. The docs name this pattern and
  forbid it: *"Bypassing use this way can break React Suspense optimizations and Suspense
  features for React DevTools."* You may call `use(promise)` conditionally; you may not
  conditionally call it *based on the promise itself*.
- Pass an uncached Promise from a Server Component and expect the client to re-read it. The
  constraint on that direction: *"When passing a Promise from a Server Component to a Client
  Component, its resolved value must be serializable."*
- Call `use(context)` in a Server Component — *"Reading context with use is not supported
  in Server Components."*

## Two things `use` is not

**It is not a Hook.** The docs say so directly — *"Despite its name, use is not a Hook"* —
which is why it may be called inside loops and conditionals where `useContext` may not. The
rules of hooks do not apply to it. This is the one place where the usual "only at the top
level" advice is wrong.

**It does not cache for you.** A module-level `Map` is a correctness requirement of the API,
not an optimisation.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Fallback flashes on every re-render, content never appears | New Promise per render | Cache the Promise instance |
| `"Suspense Exception: This is not a real error!"` | `use` inside `try`/`catch` | Error Boundary |
| `"suspended by an uncached promise"` warning | Same as row 1 | Cache the Promise instance |
| DevTools Suspense timings look wrong | Reading `promise.status` directly | Always pass to `use` |

## Verifying

```bash
grep -rn 'use(fetch(' --include=*.tsx src/    # never: uncached by construction
grep -rn 'use(' --include=*.tsx src/ -B3 | grep -n 'try {'   # use inside try-catch
```

The first grep is the one that matters. If it matches, the component has no way to render
its content.

## Version note

Verified against **react@19.3**. The 19.3 `use` reference also documents
`use(browser())` from `react-dom` — *"The component calling use(browser()) must be inside a
`<Suspense>` boundary during server rendering. Without one, server rendering fails."* A
narrow escape hatch for browser-only components, not a general conditional-render tool.
