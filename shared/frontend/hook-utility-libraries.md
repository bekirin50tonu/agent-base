---
title: "General-Purpose Hook Utility Libraries: What They Cover and What They Do Not"
category: "react-ecosystem"
applies_to: "React 18.3+ and 19.x; SSR frameworks including Next.js App Router"
last_updated: "2026-09-30"
source: "https://ahooks.js.org/hooks/use-request, https://ahooks.js.org/guide/blog/ssr, https://reactuse.com/, https://github.com/juliencrn/usehooks-ts, https://github.com/streamich/react-use, https://registry.npmjs.org/ahooks, https://registry.npmjs.org/react-use, https://registry.npmjs.org/usehooks-ts, https://registry.npmjs.org/@reactuses/core"
---

# General-Purpose Hook Utility Libraries

There are four libraries that answer the same question — "should I write this hook myself?" — and
the honest answer is that three of them solve browser-API plumbing and none of them solve state
architecture. Reaching for one of these instead of a query cache or a store is the most common
misuse, and the reason is that both things are called "hooks".

## When to Use

- Target project has `ahooks`, `react-use`, `usehooks-ts`, or `@reactuses/core` and someone asks
  whether to keep it, or a second one is being added next to it.
- A component hand-rolls a `useEffect` + `addEventListener` pair, a debounce timer, a
  `localStorage` read/write, or a `ResizeObserver` — the cases a library genuinely covers.
- Someone proposes installing a hook library to "simplify state management".

## The four, as measured

Downloads are the npm 30-day window ending 2026-09-28; release dates are the latest version's
publish time.

| Library | Latest | Released | Downloads/mo | React peer | License |
|---|---|---|---|---|---|
| `@tanstack/react-query` (not a hook utility — for contrast) | 5.x | active | 257,163,416 | `^18 \|\| ^19` | MIT |
| `usehooks-ts` | 3.1.1 | 2025-02-05 | 22,307,213 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | MIT |
| `react-use` | 17.6.1 | 2026-06-10 | 13,996,424 | `*` | MIT |
| `ahooks` | 3.10.0 | 2026-09-06 | 3,787,184 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | MIT |
| `@reactuses/core` | 6.5.9 | 2026-09-17 | 1,567,410 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | Unlicense |

`usehooks-ts` is the sharpest illustration of why download count is not a currency signal: it has
the **second-highest** install base of the four and the **longest** gap since last release —
about 20 months at time of writing — with a peer range that already lists React 19. The install
base is historical; the catalogue is what needs a recent commit.

## What the libraries actually cover

The catalogues overlap heavily, which is the useful finding: `useToggle`, `useBoolean`,
`useCounter`, `useDebounce`, `useThrottle`, `usePrevious`, `useLocalStorage`,
`useSessionStorage`, `useEventListener`, `useClickAway`, `useHover`, `useKeyPress`,
`useLongPress`, `useMouse`, `useScroll`, `useInViewport`/`useIntersectionObserver`,
`useMutationObserver`, `useMediaQuery`/`useResponsive`, `useFullscreen`, `useTitle`,
`useFavicon`, `useNetwork`, `useIsomorphicLayoutEffect`, `useLatest`, `useMountedRef` —
every one of the four ships these under a slightly different name.

`ahooks` is the only one of the four with a real opinionated design rather than a catalogue. Its
`useRequest` is an async state machine — `loading` / `data` / `error` with `onBefore` / `onSuccess`
/ `onError` lifecycles, `run` vs `runAsync` (synchronous fire-and-forget vs. a promise you catch),
`manual` opt-in, and polling — and its cache is the part that matters for comparison:

> The content of the same `cacheKey` is shared globally, which will bring the following features:
> Sharing request Promise: Only one of the same `cacheKey` will initiate a request at the same
> time, and the subsequent ones will share the same request Promise.

That is request deduplication by key, plus `staleTime` (freshness window) and `cacheTime`
(eviction) — a deliberate subset of what TanStack Query does, at roughly 1/68th the install
base, and without a documented server-prefetch/hydration path.

`@reactuses/core` is the widest catalogue and the only one with an explicit comparison table of
its own. Two of its claims are worth relaying as claims rather than facts: the "Production Proven
— Used in production by Shopee, PDD, Ctrip, and Bambu Lab" line is self-reported vendor copy with
no linked case study, and its own table marks `react-use` as *"Inactive since 2023"*, which the
registry partly contradicts — `react-use` 17.6.1 published 2026-06-10, and the commit log shows
what those releases are: `renovate[bot]` dependency bumps, last batch 2025-08-13, with the
17.6.1 release itself automated by `semantic-release-bot`. The package is still published; the
hook catalogue is not growing.

## The three categories, and which library owns which

| Category | Example | Owner |
|---|---|---|
| Browser API plumbing | `useEventListener`, `useMediaQuery`, `useFullscreen`, `useLocalStorage` | **any of the four** — pick on catalogue fit and maintenance, not on name |
| Async request lifecycle | `useRequest`, `useSWR` | **TanStack Query**; `ahooks` is a lighter substitute for a project with no SSR |
| Shared UI state | cart open/closed, selected row, wizard step | **a store** — see [`state-and-data-ownership.md`](./state-and-data-ownership.md) |

The first row is a genuine convenience; the last two are not what these libraries are for. The
name collision is the whole failure mode: "let me use a hook for this" and "let me put this in a
hook library" are different requests, and only the first is answered by an install.

## SSR: the constraint that actually decides the pick

`ahooks` documents the two SSR failure modes in a way worth reading in full, because both apply
to any hand-rolled hook too:

1. **DOM/BOM is absent on the server.** `useState(document.visibilityState)` throws
   `document is not defined`. The fix is to move the access inside `useEffect` or gate it with
   an `isBrowser()` check.
2. **`useLayoutEffect` warns on the server** — *"useLayoutEffect does nothing on the server,
   because its effect cannot be encoded into the server renderer's output format."* The
   documented workaround is `const useIsomorphicLayoutEffect = isBrowser() ? useLayoutEffect : useEffect`,
   which `ahooks` notes is *"a hack solution from the community, currently in react-redux,
   react-use, react-beautiful-dnd."*

The third rule is the one that catches people: **a hook that needs a DOM element must accept it
as a function**, not a value. `target: document.getElementById('x')` evaluates during render,
on the server, where the document does not exist. `target: () => document.getElementById('x')`
defers the lookup to the browser. This is a one-token difference that decides whether a
hand-rolled hook is SSR-safe, and it is the single most common SSR bug in hook utilities written
in-house.

## Usage Example

The 20 lines that justify the dependency — the case worth not rewriting:

```ts
// without: ~25 lines of effect, cleanup, and a resize listener
// with: one import
import { useDebounce, useEventListener } from 'ahooks'

function SearchBox() {
  const [term, setTerm] = useState('')
  const debounced = useDebounce(term, { wait: 300 })

  useEventListener('keydown', (e) => {
    if (e.key === 'Escape') setTerm('')
  })
  // ...
}
```

The 20 lines that do **not** justify it:

```ts
// Don't: a query cache already dedupes, caches, and survives navigation
const [user, setUser] = useState(null)
const [loading, setLoading] = useState(false)
useEffect(() => {
  setLoading(true)
  fetch(`/api/users/${id}`).then((r) => r.json()).then(setUser).finally(() => setLoading(false))
}, [id])
```

## Caveats

- **None of the four is a state library.** Every one of them ships a `useToggle`/`useCounter`
  because a counter is a nice demo, not because local `useState` is hard. Pulling shared state
  into a hook library gives you the Context re-render problem with none of the store's
  selector-based subscription — see the linked asset for that argument.
- **The catalogue overlap is the real cost.** All four shipping `useDebounce` means a project
  that adopts one has effectively chosen its `useDebounce` forever, and a second install
  produces two subtly different `useLocalStorage` implementations in one bundle. Adopting one
  is a real decision; adding a second is a bug.
- **Tree-shaking is claimed, not guaranteed.** All four advertise it. It holds only for the ESM
  build under a bundler that respects `sideEffects`, and a single non-shakeable import of a
  barrel file can pull the catalogue in. Verify on a real build before accepting the claim.
- **The `useIsomorphicLayoutEffect` shim is a known community hack**, not an endorsed pattern.
  In an App Router project, `useEffect` is usually the correct choice and the shim is one more
  thing to reason about.
- **This asset does not cover:** virtualization (`react-window`/`react-virtual`, which
  `ahooks` and `@reactuses/core` both wrap), form libraries (React Hook Form), animation
  (Framer Motion), routing data loaders, or web-component wrappers. The optimization axes
  outside React rendering are also still unresearched — see `docs/research-gap-analysis.md`.
