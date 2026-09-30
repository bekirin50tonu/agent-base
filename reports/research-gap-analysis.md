# Research Gap Analysis (verified against disk)

Method: for each item the user requested, grep `rules/ shared/ docs/ skills/` and open the
matching asset file. Claims below cite the file that proves them. Anything unproven is a gap.

## Covered — evidence-backed

| Request | Evidence on disk |
|---|---|
| Idempotency keys | `rules/idempotency/idempotency-keys-are-client-generated-and-scoped.md` |
| Correlation | `rules/observability/correlation-ids-are-just-trace-ids-plus-propagated-fields.md` |
| Queue-based systems | `rules/messaging/at-least-once-is-the-guarantee-you-get.md` + `concurrent-workers-need-a-real-claim-strategy.md` |
| Redis/message brokers | Redis Streams 8.6 idempotent production cited in `at-least-once…`; `BRPOP`, Kafka, RabbitMQ quorum queues named across messaging rules |
| Distributed systems | Durable execution, dual-write, vertical slice, service-extraction, microservices-vs-monolith rules in `rules/architecture/` |
| Modal systems | `shared/frontend/modal-and-dialog-patterns.md` — `<dialog>` baseline, focus return, Escape stacking, WAI-ARIA APG |
| Axios best practices | `shared/frontend/http-client-interceptors-and-retries.md` — interceptors, retries, and the v1.20.0 prototype-pollution caveat |
| Token/JWT systems | `rules/auth/pin-the-expected-jwt-algorithm-and-key-set.md` (RFC 8725: alg pinning, `kid` injection, `jku`/`x5u` SSRF, mutual-exclusivity per `typ`, `clockTolerance`) + `prefer-cookies-or-a-bff…` (RFC 10017: BFF vs token-mediating backend, `__Host-` cookies) |
| Modularity approaches | `rules/architecture/microservices-vs-monolith-approaches.md`, `extract-a-service-only-for-a-named-trigger.md` |
| Hook usage guidance | `shared/frontend/memoization-has-a-cost.md` — rules-of-hooks, dependency honesty |
| Optimization (memoization axis) | same file — `useMemo`/`useCallback`/`React.memo` as performance-only tools |
| GitHub research (4 phases) | `reports/github-ecosystem-research.md` |
| Hook libraries | `shared/frontend/hook-utility-libraries.md` — ahooks / react-use / usehooks-ts / @reactuses/core measured on install base, release recency, and React peer range; `ahooks` `useRequest` cache as the designed-subset alternative to a query library |
| Client state management | `shared/frontend/state-and-data-ownership.md` — three-owner table, the store-without-selectors trap, per-request `QueryClient` on the server |
| Optimization (bundle / fonts / web vitals) | `shared/frontend/measuring-performance-against-core-web-vitals.md` — LCP's four subparts, INP's three, CLS lab-vs-field, font loading vs font swap |
| Redis as a data store | `shared/backend/redis-as-a-cache.md` — `maxmemory` defaults, eviction policy selection, `INFO` diagnosis, `KEYS` vs `SCAN`, tracking vs Pub/Sub |

## Real gaps (found by grep, not by reflection)

### 1. ~~Hook libraries — compared to nothing~~ CLOSED 2026-09-30
Was: a single passing mention of TanStack Query / SWR (`memoization-has-a-cost.md:61`), zero
hits for `ahooks` / `usehooks-ts` / `rooks`, no comparison axis in any asset. Now researched
through Camofox against four live npm registries plus each library's own docs, and shipped as
`shared/frontend/hook-utility-libraries.md`.

### 2. ~~Optimizasyon araştırması — one axis only~~ CLOSED 2026-09-30 (partial)
The render/memoization axis was already covered by `memoization-has-a-cost.md`. The other axes
are now `shared/frontend/measuring-performance-against-core-web-vitals.md`: bundle/code-splitting
(Next.js `next/dynamic` and the modal case), image and font payloads, and web-vitals measurement.
**Still not covered:** build-tooling config (Vite/Webpack/Turbopack specifics) and the server-side
half of SSR streaming waterfalls. Both are recorded in that asset's Caveats.

### 3. ~~Client state management — zero coverage~~ CLOSED 2026-09-30
Was: `zustand | jotai | recoil | redux` → 0 hits across `rules/ shared/ docs/ skills/`. Now
`shared/frontend/state-and-data-ownership.md`, sourced from react.dev, the Zustand docs, and
TanStack Query's SSR guide.

### 4. ~~Redis as a data store (non-queue use)~~ CLOSED 2026-09-30
Was: Redis appeared only as queue backing (Streams, `BRPOP`, `INCR`) and as the idempotency-slot
store. Now `shared/backend/redis-as-a-cache.md`, routed from `docs/sql.md` alongside the query
and index rules it pairs with.

## Verdict

All four gaps identified on 2026-09-30 are closed. The two that closed partially are recorded as
such above, and the residue is written into each asset's own Caveats rather than left implicit.

The remaining known-uncovered items, all recorded in the assets that name them:

- Build-tooling config (Vite / Webpack / Turbopack) beyond Next.js `next/dynamic`
- The server-side half of SSR streaming waterfalls (the React half is covered by
  `react/await-order-creates-the-waterfall.md`)
- Cache stampedes / thundering herd on a single expiring hot key
- React-use's `rooks` and a head-to-head of Zustand vs Redux vs Jotai vs Recoil beyond the
  three-owner framing

None of these was in the original request list. They are the natural next phase, not unfinished
scope.
