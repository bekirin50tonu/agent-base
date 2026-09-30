---
language: "React-Pnpm-Next"
tag: "next.js"
ecosystem: "frontend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for React / Next.js / pnpm assets."
---

# Documentation Hub: React-Pnpm-Next

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`,
> `pnpm-lock.yaml`). Match the conditions below to determine which `rules`, `skills`, `agents`,
> or `shared` assets to inject.
>
> **Status**: rules cover data fetching end to end — where the waterfall comes from, the two
> mechanisms that remove it, and the Effect dependency rules that follow from it. Verified
> against react@19.3 and next@16.3.7. The TypeScript strict-adoption skill is routed here too,
> since every React and Next.js project is a TypeScript project. No `agents` yet.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/react/server-component-data-fetching.md`
  - **Why**: The client/server boundary *creates* the waterfall rather than merely being where
    it shows up: a `useEffect` fetch cannot start until after the component renders, so each
    nested fetch waits on the previous one. Server Components read the data layer directly —
    no API route, no round trip.
  - **When**: Target project uses the App Router or any React Server Components setup, and has
    a component that loads data it did not receive as a prop.
  - **Target Location**: `docs/rules/server-component-data-fetching.md`

- **Path**: `rules/react/use-promise-caching-discipline.md`
  - **Why**: `use` suspends on a Promise *object*, not a URL. `use(fetch(...))` creates a new
    Promise each render, so the Suspense fallback reappears forever and content never
    appears. The promise must be cached, which is a correctness requirement, not tuning.
  - **When**: Target project is on React 19+ and calls `use` with a promise, or has a
    `<Suspense>` boundary around client-side data loading.
  - **Target Location**: `docs/rules/use-promise-caching-discipline.md`

- **Path**: `rules/react/suspense-does-not-detect-effect-fetches.md`
  - **Why**: Suspense activates on promises React holds — `use`, `lazy`, streamed server data —
    and explicitly *not* on an effect or event-handler fetch. So the fallback you wrote never
    appears, and a re-render that does suspend replaces visible content unless the update is
    wrapped in `startTransition`.
  - **When**: Target project wraps client-side data loading in `<Suspense>`, or shows
    fallback flash / spinner flicker on navigation or filter changes.
  - **Target Location**: `docs/rules/suspense-does-not-detect-effect-fetches.md`

- **Path**: `rules/react/effect-dependency-honesty.md`
  - **Why**: Effect dependencies are derived from the code, not chosen. A function created in
    render is a new reference every commit, so putting one in the dependency list re-runs the
    Effect on every commit — and suppressing the linter is the one move that hides it.
  - **When**: Target project has any `useEffect` with a dependency array, or has
    `react-hooks/exhaustive-deps` disabled in its ESLint config.
  - **Target Location**: `docs/rules/effect-dependency-honesty.md`

- **Path**: `rules/react/effect-event-not-dependency-escape-hatch.md`
  - **Why**: React 19.3's `useEffectEvent` lets a callback read the latest committed values
    without re-running the Effect — which is the correct fix for the reconnect/timer-reset
    class of bug, and a wrong fix for a genuinely missing dependency.
  - **When**: Target project is on React 19.3+ and has an Effect that re-subscribes, restarts a
    timer, or re-adds a listener more often than its inputs change.
  - **Target Location**: `docs/rules/effect-event-not-dependency-escape-hatch.md`

- **Path**: `rules/react/await-order-creates-the-waterfall.md`
  - **Why**: Route segments render in parallel by default. A waterfall that survives a Server
    Component migration is almost always two `await`s in sequence in one body — the second
    request has not started yet when the first resolves.
  - **When**: `next` is in `package.json` dependencies, the project uses `app/` (App Router),
    and some component awaits more than one independent data source. **Not** a plain React
    SPA — route-segment parallelism is a Next.js behaviour.
  - **Target Location**: `docs/rules/await-order-creates-the-waterfall.md`

- **Path**: `rules/react/loading-js-does-not-cover-layout.md`
  - **Why**: `loading.tsx` wraps `page.js` and the segments below it, explicitly *not* the same
    segment's `layout.js`. A layout reading `cookies()` or `headers()` therefore blocks
    navigation with no fallback anywhere.
  - **When**: `next` is in `package.json` dependencies, the project uses `app/`, and a
    `layout.tsx` reads `cookies()`, `headers()`, or `searchParams`. Next.js only.
  - **Target Location**: `docs/rules/loading-js-does-not-cover-layout.md`

- **Path**: `rules/react/nextjs-two-caching-models.md`
  - **Why**: Next.js 16 ships two caching models with disjoint opt-ins — `force-cache` in the
    one labelled *Previous Model*, `'use cache'` under `cacheComponents`. Both default to
    "not cached", so a fix written for the wrong model fails silently.
  - **When**: `next` is in `package.json` dependencies and the project touches `force-cache`,
    `'use cache'`, `revalidateTag`, or `revalidatePath`. Next.js only — neither API exists in
    React or in other frameworks.
  - **Target Location**: `docs/rules/nextjs-two-caching-models.md`

## 2. Skills (`skills/`)

- **Path**: `skills/typescript/adopt-strict-checking-gradually/SKILL.md`
  - **Why**: TypeScript 6.0 makes `strict` `true` by default, so the gradual path is now an opt-*out* and a 5.x-era migration plan walks backwards. Gives the documented order (`noImplicitAny` first, chosen for error locality rather than severity), the `ts5to6` codemod for 6.0's mechanical adjustments, and the `rootDir` default change that surfaces with no error message pointing at it. Also why `checkJs` has no reachable exit criterion.
  - **When**: Target project has a `tsconfig.json` and is enabling strict checking, adding `noImplicitAny` or `checkJs`, or upgrading into TypeScript 6.0+ and seeing errors it did not ask for. Applies to plain React, Next.js, and NestJS projects alike.
  - **Target Location**: `docs/skills/typescript/adopt-strict-checking-gradually/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/typescript/agent.json`
  - **Why**: Helps with TypeScript-related tasks, such as adopting strict checking and other TypeScript best practices.
  - **When**: Target project has a `tsconfig.json`.
  - **Target Location**: `docs/agents/typescript/agent.json`

## 4. Shared Assets (`shared/`)
- **Path**: `shared/frontend/atomic-design.md`
  - **Why**: The five-stage model for placing UI components — atoms, molecules, organisms, templates, pages — as a decision aid for where a new component belongs and whether one already exists.
  - **When**: Target project builds a UI component hierarchy, a design system, or a feature from reusable components.
  - **Target Location**: `docs/frontend/atomic-design.md`

- **Path**: `shared/frontend/modal-and-dialog-patterns.md`
  - **Why**: `<dialog>` is Baseline widely available and `showModal()` hands you the top layer,
    focus containment, and Escape handling that modal libraries used to reimplement badly — but
    not scroll locking, focus *return*, or light-dismiss, which are exactly the three that get
    missed. Includes the WAI-ARIA APG requirements (`aria-modal`, `aria-labelledby` to a visible
    title, a close control inside the tab sequence), when `createPortal` is still the right tool,
    and why `show()` is not a substitute for `showModal()`.
  - **When**: Target project renders any overlay — a modal, a confirm dialog, a drawer, or a
    lightbox — or a review asks whether a modal traps focus correctly.
  - **Target Location**: `docs/frontend/modal-and-dialog-patterns.md`

- **Path**: `shared/frontend/memoization-has-a-cost.md`
  - **Why**: React documents that it throws away the `useMemo` cache in development and when a
    component suspends during initial mount, which makes manual memoization a performance-only
    tool — a cached value that is load-bearing for correctness means you picked the wrong hook.
    Covers the rules-of-hooks constraints that make suppressing `exhaustive-deps` the one move
    that hides a real bug, a table for choosing between `useState`/`useRef`/`useCallback`/
    `useEffectEvent`, and the argument that most `useMemo` arguments are really a missing
    server-state cache.
  - **When**: Target project has `useMemo`, `useCallback`, or `React.memo` in its code, has
    `react-hooks/exhaustive-deps` disabled, or is deciding whether to hand-write memoization on
    React 19.
  - **Target Location**: `docs/frontend/memoization-has-a-cost.md`

- **Path**: `shared/frontend/http-client-interceptors-and-retries.md`
  - **Why**: Four concerns — auth attachment, error normalisation, retry policy, and cancellation
    — get reimplemented badly in every hand-rolled `fetch` wrapper. Covers the interceptor
    ordering asymmetry (requests in registration order, responses reversed) that makes a rejecting
    response interceptor swallow every handler after it, the retry rule that only
    idempotent-or-keyed requests on 429/5xx/network errors are worth retrying, why backoff without
    jitter synchronises clients into a storm, and the axios version pinning (1.20.0 and 0.34.0 are
    both live, both carrying recent prototype-pollution fixes that touch interceptor-returned
    config).
  - **When**: Target project has `axios` as a dependency, more than one call site for the same
    API, or a `fetch` wrapper under five files.
  - **Target Location**: `docs/frontend/http-client-interceptors-and-retries.md`

- **Path**: `shared/frontend/state-and-data-ownership.md`
  - **Why**: The choice between `useState`, Context, a store, and a query cache is a question of
    who owns the value's lifetime, not of preference. Covers the three-owner table with what each
    one invalidates, why Context's "re-renders all consumers" makes it a lane for rarely-changing
    data only, why a store without selectors is the same bug in quieter form, and React's own
    position that Effects are the wrong tool for transforming data for render.
  - **When**: Target project has `zustand`, `redux`, `jotai`, or `recoil` as a dependency, is
    deciding where a new piece of state should live, or hand-rolls `useEffect` + `fetch` +
    `loading` + `error` in more than one component.
  - **Target Location**: `docs/frontend/state-and-data-ownership.md`

- **Path**: `shared/frontend/hook-utility-libraries.md`
  - **Why**: Four libraries answer "should I write this hook myself?" and three of them solve
    browser-API plumbing only — the failure mode is reaching for one to solve state
    architecture, which is a different question with the same name. Covers the four measured
    against install base, release recency, and React peer range; the catalogue overlap that makes
    adopting one a decision and adding a second a bug; `ahooks`' `useRequest` cache as the
    designed-subset alternative to a query library; and the SSR rules that decide whether a
    hand-rolled hook is safe at all.
  - **When**: Target project has `ahooks`, `react-use`, `usehooks-ts`, or `@reactuses/core` as a
    dependency, is considering adding one, or a component hand-rolls an event listener, a
    debounce timer, or a `localStorage` read/write.
  - **Target Location**: `docs/frontend/hook-utility-libraries.md`

- **Path**: `shared/frontend/measuring-performance-against-core-web-vitals.md`
  - **Why**: Performance work without field data is guessing. Gives the three Core Web Vitals
    thresholds at the 75th percentile, and the decomposition that turns "slow" into an action:
    LCP's four subparts and the trap that optimizing one shifts time into another, INP's three
    subparts with the long-task mechanism that justifies code splitting, and the two distinct
    font failures — delayed render (LCP) and swap-induced layout shift (CLS, fixed with
    `size-adjust`, not faster loading). Also the lab-versus-field difference on CLS, which is why
    a Lighthouse 0 can coexist with poor real-user CLS.
  - **When**: Target project reports a performance problem, proposes a bundle or lazy-loading
    change with no target metric, has a Lighthouse score as its only evidence, or ships a
    third-party font, an on-demand modal, or a large Client Component.
  - **Target Location**: `docs/frontend/measuring-performance-against-core-web-vitals.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
