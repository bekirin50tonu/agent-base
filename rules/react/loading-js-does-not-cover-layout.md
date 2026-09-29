---
title: "loading.js Wraps page.js but Not the Same Segment's layout — Suspend Closer to the Data"
rule_id: "RULE-REACT-005"
category: "correctness"
scope: "next"
applies_to: "Any Next.js App Router segment using loading.js"
last_updated: "2026-09-30"
source: "https://nextjs.org/docs/app/api-reference/file-conventions/loading"
---

# loading.js Wraps page.js but Not the Same Segment's layout — Suspend Closer to the Data

`loading.tsx` is the coarsest boundary the framework gives you, and it does not wrap the one
file most likely to need it. A layout that reads uncached data blocks navigation with no
fallback at all.

## Why

The file convention page states the hierarchy and the exception in consecutive sentences:

> In the component hierarchy, loading.js wraps not-found.js, page.js, and nested layout.js files
> in a `<Suspense>` boundary. **It does not wrap the layout.js, template.js, or error.js in the
> same segment.**

And the reason, from the fetching-data page:

> Because of this, a layout that accesses uncached or runtime data (e.g. cookies(), headers(),
> or uncached fetches) does not fall back to a same route segment loading.js. Instead, **it
> blocks navigation until the layout finishes rendering.**

This is the "my spinner never shows" bug. There is no spinner to show. The boundary is in the
wrong place, and it is wrong in a way the file tree makes invisible — `loading.tsx` sits right
there next to `layout.tsx`.

## Do

- Put a `<Suspense>` boundary at the component that actually awaits the uncached data, not
  only at the route segment. The docs' own recommendation: *"using `<Suspense>` closer to the
  runtime or uncached data access is recommended."*
- Treat `loading.js` as the coarse first paint, and expect it to cover nothing that a layout
  reads. `cookies()`, `headers()`, and `searchParams` in a layout are the specific triggers.
- Check the layout before assuming the boundary covers it:

```bash
grep -rn 'cookies()\|headers()\|searchParams' app/**/layout.tsx
```

## Don't

- Assume a `loading.tsx` in the same directory covers that directory's `layout.tsx`. It
  covers the *page* and everything below it.
- Read the absence of a fallback as a slow server. It is an unsuspended layout.
- Wrap every component in `<Suspense>` to compensate. React's own position is the opposite —
  see the boundary-granularity note in the failure table.

## The tension to hold onto

React says *"Don't put a Suspense boundary around every component. Suspense boundaries should
not be more granular than the loading sequence that you want the user to experience."*
Next.js says to wrap uncached reads in `<Suspense>`. Both are right about different things:
React is describing *reveal granularity*, Next.js is describing *prerender correctness* — a
read that is not prerenderable must have a fallback somewhere below the shell. Flattening
them into one slogan is how you end up with either a wall of spinners or a route that hangs.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Navigation hangs, no fallback | Layout reads uncached data, `loading.js` doesn't cover it | `<Suspense>` at the reading component |
| Spinner covers content that was already loaded | Boundary too high | Move it down to the awaited read |
| Spinner flashes per field | Boundary per component | One boundary per loading sequence |
| Bots see stale markup | Next.js *"waits for data fetching to finish and sends the fully rendered page instead of streaming it"* | Not a Suspense bug — expected |

## Verifying

```bash
grep -rn 'cookies()\|headers()\|searchParams' app/**/layout.tsx   # unsuspended work in a layout
find app -name 'loading.tsx'                                      # where the boundaries actually are
```

The second command is worth running next to the first. A `loading.tsx` in a segment whose
`layout.tsx` appears in the first command's output is a boundary that will not fire for the
slowest thing in the route.

## Version note

Verified against **Next.js 16.3.7**. Note that bots are handled separately: *"Next.js waits
for data fetching to finish and sends the fully rendered page instead of streaming it
progressively."* Also, a streamed response has already committed its status code, so a
not-found inside a streamed segment arrives as a 200 carrying a noindex meta tag.
