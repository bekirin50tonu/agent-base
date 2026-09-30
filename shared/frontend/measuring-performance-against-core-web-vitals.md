---
title: "Measuring Frontend Performance Against Core Web Vitals"
category: "performance"
applies_to: "Any web frontend; thresholds and tooling are Chrome/web.dev specific, thresholds apply to all browsers in CrUX"
last_updated: "2026-09-30"
source: "https://web.dev/articles/vitals, https://web.dev/articles/optimize-lcp, https://web.dev/articles/optimize-cls, https://web.dev/articles/inp, https://web.dev/articles/optimize-inp, https://web.dev/articles/font-best-practices, https://nextjs.org/docs/app/guides/lazy-loading"
---

# Measuring Frontend Performance Against Core Web Vitals

Performance work without field data is guessing with extra steps. Core Web Vitals is the
shortest route to knowing whether a page is actually slow for users, and each of the three
metrics decomposes into subparts that name the fix — which is the part most teams skip.

## When to Use

- A performance complaint has no attached measurement, or the team's only data is a Lighthouse
  score from one laptop.
- Someone proposes a bundle-size reduction, a lazy-loading change, or a font change with no
  stated target metric.
- An optimization lands and there is no way to tell whether it helped or was moved work.

## The three metrics and their thresholds

All three are assessed at the **75th percentile of page loads in the field**, segmented by device
class — not as a per-page average, and not from a lab run.

| Metric | Measures | Good | Poor |
|---|---|---|---|
| LCP (Largest Contentful Paint) | loading — time to the largest image or text block in the viewport | ≤ 2.5s | — |
| INP (Interaction to Next Paint) | interactivity — latency of the longest interaction | ≤ 200ms | > 500ms |
| CLS (Cumulative Layout Shift) | visual stability — how much content moved and how far | ≤ 0.1 | > 0.25 |

INP replaced First Input Delay as a Core Web Vital in March 2024. The distinction matters
because FID only ever measured the *first* interaction on a page; INP takes the **longest**
interaction across the whole visit. A page can have a perfect FID and a failing INP — late
interactions are exactly where slow code lives.

## Field before lab, always

web.dev's position on measurement is unambiguous: *"be aware that lab tests alone may not be
entirely representative of what your actual users experience."* Two sources of field data:

- **CrUX** (Chrome User Experience Report) — anonymous aggregates from real Chrome users, free
  and public, surfaced in PageSpeed Insights and in Chrome DevTools' live-metrics view. Where
  traffic is too low for page-level data, PageSpeed Insights falls back to origin-level data.
- **RUM** — your own `web-vitals` library collection via `useReportWebVitals` (Next.js exposes
  this hook) or the equivalent. Needed when CrUX has no data, and it carries attribution
  (which interaction, which element) that CrUX cannot.

The single most useful diagnostic difference web.dev documents is the CLS one: CrUX measures CLS
across the **full life of the page**, while lab tools measure only the initial load. A page can
show 0 in Lighthouse and a poor real-user CLS because a lazy-loaded section below the fold
shifts when it arrives. Transitions on SPAs are a named contributor too — they are counted as
shifts when they exceed the 500ms grace period after a qualifying interaction.

## LCP decomposes into four subparts

This is the part that turns "the page is slow" into an action. LCP is always four things summed,
with no overlap and no gaps:

| Subpart | Share of a well-optimized LCP |
|---|---|
| Time to first byte | ~40% |
| Resource load delay | <10% |
| Resource load duration | ~40% |
| Element render delay | <10% |

The reason this table matters is that **optimizing one subpart can move time to another instead
of reducing LCP at all**. web.dev's worked example: compressing the LCP image to AVIF shortens
resource load duration but does not improve LCP, because the element was hidden until the JS
finished loading — the time simply reappears as element render delay. That is a 20 KB win
reported as a 20 KB win and a flat metric.

The heuristic that follows from the table: *"The vast majority of the LCP time should be spent
loading the HTML document and LCP source. Any time before LCP where one of these two resources
is not loading is an opportunity to improve."* In other words, find the gap in the network
waterfall before you compress anything.

The two subparts named "delay" are the ones to drive toward zero; the other two are network
cost that time cannot remove.

## INP decomposes into three subparts

Total interaction latency is the sum of:

1. **Input delay** — from the interaction until event handlers start, caused by other main-thread
   work: *"possibly caused by factors such as long tasks on the main thread"*, script
   parse/compile/execute, fetch handling, timers.
2. **Processing time** — the event handler callbacks themselves.
3. **Presentation delay** — from the last callback until the browser presents the next frame.

Two consequences for a React codebase. First, only click, tap, and key press count — hover,
zoom, and scroll are not observed, so a metric tuned around hover performance is optimising
something INP does not measure. Second, a single keystroke emits `keydown`, `keypress`, and
`keyup`, and *"The event with the longest duration within the interaction is what contributes
to the interaction's total latency"* — so a debounce on `onChange` does not help if the long
task is somewhere else in the handler chain.

Script evaluation is called out as a specific startup problem: after a file is fetched the
browser still parses, compiles, and executes it, and *"Depending on the size of a script, this
work can introduce long tasks on the main thread."* This is the argument for code splitting, and
it is the strongest one available, because it names the mechanism rather than the practice.

## Code splitting, in the framework's own terms

Next.js documents it plainly: lazy loading *"helps improve the initial loading performance of an
application by decreasing the amount of JavaScript needed to render a route"*, and its reason to
exist is concrete — *"you might want to defer loading a modal until a user clicks to open it."*
That modal is the canonical case, and it maps directly onto
[`modal-and-dialog-patterns.md`](./modal-and-dialog-patterns.md): a dialog that is mounted on
demand does not need its code in the initial bundle.

The mechanics: `next/dynamic` (a composite of `React.lazy` and `Suspense`), with
`{ ssr: false }` for the client-only case. Server Components are already code-split — lazy
loading applies to Client Components. So a `Modal` marked `'use client'` that pulls in an editor
or a chart library is the case where the win is largest.

## Fonts hit two of the three metrics

web.dev separates the two effects and they are worth keeping apart:

- **Delayed text rendering** — *"If a web font has not loaded, browsers typically delay text
  rendering. In many situations, this delays First Contentful Paint (FCP). In some situations,
  this delays Largest Contentful Paint (LCP)."*
- **Layout shifts** — *"The practice of font swapping has the potential to cause layout shifts
  and impact Cumulative Layout Shift (CLS). These layout shifts occur when a web font and its
  fallback font take up different amounts of space on the page."*

The second one is a CLS bug, not an LCP one, and it is fixed with `size-adjust`/metric overrides
on a fallback face — not by loading the font faster. Faster loading narrows the window without
closing it.

One documented misconception is worth repeating because it is very common in review: *"A common
misconception is that a font is requested when a @font-face declaration is encountered. This is
false. By itself, @font-face declaration doesn't trigger font download."* A font is fetched only
if referenced by styling actually used on the page. So the stylesheet is the lever, and
*"removing unused CSS and splitting stylesheets can reduce the number of fonts loaded by a page"*
often beats font-file optimisation.

Third-party font hosts need two `preconnect` hints, because a provider commonly serves
stylesheets and font files from different origins:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

The `crossorigin` one is not optional — *"font files must be sent over a CORS connection"* — and
omitting it is why a correctly-configured preconnect still produces no early connection.

## Usage Example

The measurement loop, in the order that actually works:

```ts
// 1. field data first — Next.js App Router
import { useReportWebVitals } from 'next/web-vitals'

export function WebVitals() {
  useReportWebVitals((metric) => {
    // send to your analytics; metric.name is 'LCP' | 'INP' | 'CLS'
    navigator.sendBeacon('/api/vitals', JSON.stringify(metric))
  })
  return null
}
```

```bash
# 2. confirm the problem is real, not lab-only
#    PageSpeed Insights "Discover" section = CrUX field data for real users

# 3. only then, in the lab, find the subpart
#    DevTools Performance panel → LCP subpart breakdown shows which of the
#    four (TTFB / load delay / load duration / render delay) is the problem
```

The rule that makes step 3 worth doing: **do not optimize a subpart you have not measured.**
An image-format change against a render-delay problem is a bundle-size reduction with no metric
movement and a real maintenance cost.

## Caveats

- **Field data has a floor.** CrUX needs enough traffic for page-level data; below that,
  PageSpeed Insights silently substitutes origin-level numbers, which can hide a single bad
  page. A low-traffic site needs RUM, and RUM needs real sessions — neither is available on day
  one, so the first optimization decisions are made with less evidence than anyone admits.
- **The subpart percentages are guidelines, not budgets.** web.dev says so directly: *"these
  time breakdowns are guidelines, not strict rules"* and warns against converting them to absolute
  millisecond targets. They are for comparison *between* subparts of the same page.
- **CLS is not a time-based metric and has no average form.** It combines shift distance with
  shifted area, which is why "our CLS is 0.05 on average" is not a statement that means anything.
- **This asset does not cover:** bundle analyzer output and tree-shaking verification, SSR
  streaming waterfalls (the server-side half of the request-waterfall problem), edge/CDN
  configuration, `next.config` tuning knobs beyond `optimizePackageImports`, and server-side
  performance of rendering itself. React render cost is a separate axis — see
  [`memoization-has-a-cost.md`](./memoization-has-a-cost.md).
