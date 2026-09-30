---
title: "Server State, Client State, and Where a Store Belongs"
category: "state-management"
applies_to: "React 18.3+ and 19.x, including Next.js App Router"
last_updated: "2026-09-30"
source: "https://react.dev/reference/react/hooks, https://react.dev/learn/you-might-not-need-an-effect, https://react.dev/learn/passing-data-deeply-with-context, https://zustand.docs.pmnd.rs/getting-started/introduction, https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr, https://www.patterns.dev/react/react-2026/"
---

# Server State, Client State, and Where a Store Belongs

Choosing between `useState`, Context, Zustand, and TanStack Query is not a preference question. Each
owns a different thing, and the common failure is picking by familiarity rather than by what the
data *is*. The decision is a function of one question: **who owns the lifetime of this value?**

## When to Use

- A project is adding a global store, or already has one and is unsure what belongs in it.
- A component needs the same data in several places and someone is reaching for Context.
- A reviewer asks why server data is in a store rather than a query cache.
- `package.json` carries `zustand`, `redux`, or `jotai`, and the split is undocumented.

## Usage Example

### The three owners

| Owner | Holds | Lifetime | Invalidated by |
|---|---|---|---|
| `useState` / `useReducer` | a value only this component's render depends on | the component's mount | nothing external |
| Context | a value that is *rarely* changing and needed deep in the tree | the provider's mount | the provider re-renders |
| A store (Zustand, Redux, Jotai) | UI state shared across unrelated components, with no fetch | until explicitly reset | an action |
| A query cache (TanStack Query, SWR) | anything the server owns | until `staleTime` / garbage collection | refetch, invalidation, focus |

React's own guidance on Context is the tiebreaker for its lane: context updates re-render **all**
consumers, so it is *"best for relatively static or infrequently updated data (like theme, user
auth info, etc.)"* — and for anything more dynamic, a dedicated state library is the better fit.
That is why "put the shopping cart in Context" is the wrong move: the cart changes on every click,
so every consumer re-renders on every click.

### The three-line store

Zustand's model is a hook, not a component, so there is no provider and no context boundary to
thread through the tree. The store *is* the hook, and each component subscribes to the slice it
reads — which is why a component that selects only `bears` does not re-render when
`increasePopulation` changes:

```ts
import { create } from 'zustand'

const useCart = create((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
}))

// re-renders only when `items` changes, not on every store write
function CartCount() {
  const count = useCart((s) => s.items.length)
  return <span>{count}</span>
}
```

Note what the selector is doing. `useCart((s) => s.items)` without a selector, or with a selector
that returns a fresh object (`s => ({ a: s.a, b: s.b })`), re-renders on every store write — the
same class of bug as the Context one it was meant to escape. **A store without selectors has
replaced Context's problem with a quieter version of it.**

### What does not belong in either

React is direct about the effect-shaped alternative: *"You don't need Effects to transform data
for rendering… This is inefficient. When you update the state, React will first call your component
functions… Then React will run your Effects. If your Effect also immediately updates the state,
this restarts the whole process from scratch!"* And on events: *"By the time an Effect runs, you
don't know what the user did… handle user events in the corresponding event handlers."*

So: filter a list by deriving it during render, not by storing the filtered copy in state and
updating it from an effect. Compute `items.filter(...)` inline. If that is measurably too slow,
`useMemo` it — which is the separate argument in
[`memoization-has-a-cost.md`](./memoization-has-a-cost.md).

The same rule kills the most common server-state mistake. `useEffect` + `fetch` + `loading` +
`error`, copy-pasted into every component, is not a pattern that needs a store to fix — it is a
pattern a query cache replaces, because the cache dedupes in-flight requests across the tree and
survives navigation.

## Caveats

- **A query cache does not remove itself after a framework's first paint.** TanStack Query's SSR
  guide is explicit that with SSR you set `staleTime` above zero *"to avoid refetching immediately
  on the client"* — meaning the client cache starts empty and refetches unless you prefetch on the
  server and hydrate. Dropping the server-prefetch/hydration step turns a 0-byte client refetch
  into a duplicate round trip on every navigation.
- **The per-request `QueryClient` is not optional.** The same guide shows `makeQueryClient()`
  called fresh whenever `environmentManager.isServer()` is true, and a cached `browserQueryClient`
  on the client. A single module-level client shared across requests shares its cache *between
  users* — one user's data served to another.
- **`patterns.dev/react/react-2026` is dated.** It labels itself 2026 but describes React 19/20 as
  "upcoming" and Next.js 13/14 Turbopack as beta. Its state-management guidance is still sound;
  its version claims are not. Cited here for the layer-by-layer framing, not for version currency.
- **Redux is not a default and not dead.** The same source describes it as concentrated in large
  apps with genuinely complex transitions, and notes the ecosystem settled on `useSyncExternalStore`
  for lighter stores. Redux earns its place when you want middleware, time-travel devtools,
  undo/redo, or framework-agnostic consumers — not because a store exists.
- **This asset does not cover:** form libraries (React Hook Form + Zod), virtualization for long
  lists (`react-window`), routing, or build tooling. The request that prompted this file asked about
  hook *libraries*; that turned out to be two different questions — "which general-purpose hook
  utility library" (`ahooks`, `usehooks-ts`, ReactUse) and "which state/data library". This file
  answers the second. The first has **no asset** and no research behind it; see
  `docs/research-gap-analysis.md`.
