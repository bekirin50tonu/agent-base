---
title: "Suspense Does Not Detect Effect Fetches — Wrap Updates in startTransition"
rule_id: "RULE-REACT-003"
category: "correctness"
scope: "all"
applies_to: "Any <Suspense> boundary whose children trigger async work"
last_updated: "2026-09-30"
source: "https://react.dev/reference/react/Suspense"
---

# Suspense Does Not Detect Effect Fetches — Wrap Updates in startTransition

A Suspense boundary activates on promises React holds, not on requests your code happens to
make. A `useEffect` fetch is invisible to it, so the fallback you wrote never appears — and a
re-render that *does* suspend blows away content the user is already reading.

## Why

The caveat is stated once, in the props reference, and it is the most consequential sentence
on the page:

> **Suspense does not detect when data is fetched inside an Effect or event handler. It only
> activates in the cases listed below.**

The list of what *does* activate a boundary is enumerated: `lazy` code-loading, *"Reading a
Promise with `use`, including data streamed from Server Components or loaded through a
Suspense-enabled framework"*, stylesheets with `precedence`, streaming HTML, and fonts and
images during a `<ViewTransition>` update. An effect-triggered `fetch` is not on it. If you
want Suspense to participate, the promise has to be something React read via `use`.

The second failure is separate and easier to hit. Once content is on screen, a later
suspense replaces it with the fallback again:

> If Suspense was displaying content for the tree, but then it suspended again, the fallback
> will be shown again unless the update causing it was caused by `startTransition` or
> `useDeferredValue`.

That is the "my page flashes back to a spinner when I click" bug. The content was fine; the
update was simply classified as urgent.

## Do

Mark updates that may suspend as non-urgent. The docs' own comment for the line is the
summary of the rule:

```js
function handleNextPageClick() {
  // If this update suspends, don't hide the already displayed content
  startTransition(() => {
    setCurrentPage(currentPage + 1);
  });
}
```

> During a Transition, React will wait until enough data has loaded to prevent an unwanted
> fallback from appearing.

- Expect fallbacks on *newly mounted* boundaries even inside a Transition — that is
  deliberate, and the docs say so: *"any newly rendered Suspense boundaries will still
  immediately display fallbacks to avoid blocking the UI."* This is not the bug.
- Put the promise in the render path (`use`, or a framework data layer) rather than in an
  effect. See RULE-REACT-002 for the caching requirement that comes with it.
- Look for a framework integration first: *"If your router is integrated with Suspense, it
  should wrap its updates into `startTransition` automatically."* In Next.js App Router, this
  is handled; hand-rolled `useState` navigation is where the gap is.

## Don't

- Expect a `<Suspense fallback>` to cover `useEffect(() => fetch(...))`. It will not
  activate — the docs are explicit that only the listed cases trigger it.
- Rely on `startTransition` for an *urgent* update. The docs' boundary: *"React will only
  prevent unwanted fallbacks during non-urgent updates. It will not delay a render if it's the
  result of an urgent update."*
- Assume a fallback is free. React *"reveals suspended content at most once every 300ms,
  measured from the last reveal"*, and boundaries that become ready within that window are
  revealed together. Many independent boundaries therefore appear at once, not staggered —
  usually what you want, but it means a wall of spinners is a single boundary in the wrong
  place, not many in the right one.
- Assume state inside a suspended subtree survives. *"React does not preserve any state for
  renders that got suspended before they were able to mount for the first time."*

## The effect-cleanup consequence

There is a cost to hiding and re-showing, and it is a real one — layout Effects get torn down
and re-fired:

> If React needs to hide the already visible content because it suspended again, it will
> clean up layout Effects in the content tree. When the content is ready to be shown again,
> React will fire the layout effects again.

Layout effects that measure the DOM will run twice per suspend cycle. This is the concrete
reason `startTransition` is a correctness rule and not a polish item: without it, measuring
code re-runs on every update that suspends.

## Verifying

```bash
grep -rn 'useEffect' --include=*.tsx src/ -A6 | grep -B3 'fetch('    # invisible to Suspense
grep -rn 'setState\|set[A-Z]' --include=*.tsx src/ | grep -v startTransition
```

The second grep is noisy on its own — read each hit for "could this update cause a component
below a Suspense boundary to suspend?" If yes, it wants a Transition.

## Version note

Verified against **react@19.3**. The `defer` prop is marked experimental on this page:
*"When true, React may show the fallback first and render or stream children later, even when
nothing in them suspends. Use it for content that is expensive to render."* Do not build on
it in production code yet.
