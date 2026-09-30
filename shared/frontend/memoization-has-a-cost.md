---
title: "Memoization Has a Cost, and React Throws the Cache Away Anyway"
category: "performance"
applies_to: "React 18.3+ and 19.x, including Next.js App Router"
last_updated: "2026-09-30"
source: "https://react.dev/reference/rules/rules-of-hooks, https://react.dev/reference/react/useMemo"
---

# Memoization Has a Cost, and React Throws the Cache Away Anyway

`useMemo`, `useCallback`, and `React.memo` each buy a comparison and store a value. React also documents that it discards the cache in development, and when a component suspends during initial mount. That makes manual memoization a *performance-only* tool — if a cached value is load-bearing for correctness, you have the wrong hook.

## When to Use

- A React component re-renders measurably often with expensive children or an expensive derived value.
- A review questions whether a `useMemo` is earning its keep.
- The project is on React 19 and is considering manual memoization as a strategy.

## Usage Example

### The rules of Hooks are not negotiable

React is direct: *"Don't call Hooks inside loops, conditions, nested functions, or try/catch/finally blocks. Instead, always use Hooks at the top level of your React function, before any early returns."* And: *"You can only call Hooks while React is rendering a function component."*

Hooks are position-dependent — the dispatcher reads a cursor into the fiber's hook list, so a conditional call desynchronises every hook after it, not just that one. The `eslint-plugin-react-hooks` rule is the enforcement mechanism; disabling `react-hooks/exhaustive-deps` removes the only tool that catches the class of bug the rules exist to prevent.

### What the cache is actually worth

React's `useMemo` documentation states the eviction conditions directly:

> "In development, React throws away the cache when you edit the file of your component. Both in development and in production, React will throw away the cache if your component suspends during the initial mount. […] This should be fine if you rely on useMemo solely as a performance optimization. Otherwise, a state variable or a ref may be more appropriate."

The consequences follow:

- **`useMemo` is not a correctness boundary.** A suspended mount re-runs the factory. If the factory closes over a mutable, it observes a different world than the caller expected.
- **`useCallback` is a referential-stability tool, not a speed tool.** It exists so a value can go in a dependency array or be passed to a `memo` child without causing churn. Wrapping a trivial function buys an allocation and a comparison.
- **Every dependency you list is a cost.** A `useMemo` with three deps compares three values each render to maybe skip a calculation. If the calculation is cheap, this is a net loss.

```jsx
// earns it: expensive derivation, over a big collection
const visibleTodos = useMemo(() => filterTodos(todos, tab, query), [todos, tab, query]);

// does not: an array literal that only feeds a child that is not memoized
const style = useMemo(() => ({ opacity: isOpen ? 1 : 0 }), [isOpen]); // usually a plain object
```

### Choosing the right primitive for the state you have

| The state is | Use | Not |
|---|---|---|
| A value you want stable identity for | `useState` or a `useRef` (both survive cache eviction predictably) | `useMemo` |
| An expensive derived value | `useMemo` with **all** dependencies listed | Recomputing inline in a hot render |
| A function that must not break a dep array | `useCallback` — or `useEffectEvent` on React 19.3+ for "read the latest value" | A stale-closure workaround that also disables `exhaustive-deps` |
| Server data | A server-state cache (see below) | `useEffect` + `useState` + a manual `loading` flag |
| Whether the compiler can do it | Nothing, if you enable React Compiler | Hand-written `memo`/`useMemo`/`useCallback` |

The one thing worth internalising: **`useEffectEvent` is not `useCallback`.** It exists to read the latest committed value *without* adding a dependency — which is the correct fix for a reconnect/timer-reset loop and the wrong fix for a genuinely missing dependency. Choosing wrong there produces an Effect that silently reads stale values forever.

### Server state is the largest un-memoized cost

Most `useMemo` arguments are a symptom: the same `useEffect` + `fetch` + `loading` + `error` shape copy-pasted into every component, each with its own cache, its own waterfall, and its own stale window. A server-state cache (TanStack Query or SWR) dedupes in-flight requests across the tree, refetches on focus, and survives navigation. It replaces the boilerplate rather than memoizing around it.

Client-only state that genuinely belongs to the client — a UI toggle, a wizard step, an open/closed flag — is fine in `useState` or a store. The split to hold: **data that has a lifetime the server owns** goes in the server cache; **state that only exists because a human is looking at the screen** goes in a hook or a store.

## Caveats

- **React Compiler changes the recommendation, and this asset does not resolve whether it is on.** The compiler automates memoization at build time, which is the strongest argument for *not* hand-writing `memo`/`useMemo`/`useCallback` in new code. The documentation is organised under a `React Compiler` section with a Working Group, incremental-adoption and debugging guides — the surface area suggests active development. I could not verify its release-candidate/stable status from the pages I loaded: `/reference/react-compiler`, `/learn/react-compiler-introduction`, and `/reference/react-compiler/installation` all returned **404** on react.dev as of 2026-09-30, and the live docs report **React v19.3**. Verify the compiler's status against the React release notes and the Working Group before adopting or dropping manual memoization as a project policy.
- **The "suspends during initial mount" eviction applies in production too**, per the quoted text. Any `useMemo` whose result must be stable across a suspending mount is relying on undefined behaviour.
- The exact performance delta of adding a `useMemo` is not characterised in this asset. Measure with React DevTools' Profiler before and after; do not adopt memoization on suspicion.
- `React.memo` and `useMemo` are independent: `memo` skips the render, `useMemo` skips a calculation inside a render you already paid for. Shipping a `memo` child whose props are all recreated per render is the most common way `memo` silently does nothing.