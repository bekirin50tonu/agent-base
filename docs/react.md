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
> against react@19.3 and next@16.3.7. No `skills` or `agents` yet.

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
_Empty — no React skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no React agents have been synthesized._

## 4. Shared Assets (`shared/`)
- **Path**: `shared/design-patterns-library.md`
  - **Why**: Design patterns, atomic design methodology, and stack-agnostic anti-patterns.
  - **When**: Target project builds any UI component hierarchy.
  - **Target Location**: `docs/design-patterns.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
