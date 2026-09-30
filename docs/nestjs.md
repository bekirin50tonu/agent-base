---
language: "NestJS"
tag: "nestjs"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for NestJS assets."
---

# Documentation Hub: NestJS

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`
> for `@nestjs/core`; a `tsconfig.json` alone means TypeScript but not necessarily Nest).
> Match the conditions below to determine which `rules`, `skills`, `agents`, or `shared`
> assets to inject.
>
> **Status**: four rules, all from the injection-scope cluster. Phase 2 research on NestJS
> request lifetimes is complete; other NestJS topics are not yet covered. Report the gap rather
> than substituting something from another ecosystem.
>
> **Scope**: these rules are about provider lifetime in a Nest application — a Node.js
> single-process framework. They assume the default `NestFactory.create()` HTTP server and do
> not cover GraphQL resolvers or microservice transports except where noted.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/nestjs/request-scope-bubbles-up-the-di-tree.md`
  - **Why**: `Scope.REQUEST` propagates from a dependency to its dependents, so one flag on a
    low-level provider silently re-instantiates the controller and every service above it on
    every request. The failure is invisible in the class you edited.
  - **When**: Target project has `@nestjs/core` and registers `@Injectable()` classes as
    providers. Apply even if no `Scope.REQUEST` is present today — this is the rule that
    explains a future one.
  - **Target Location**: `docs/rules/nestjs/request-scope-bubbles-up-the-di-tree.md`

- **Path**: `rules/nestjs/prefer-async-local-storage-over-request-scope.md`
  - **Why**: The most common reason to add request scope is reading one value — user, tenant,
    locale. `AsyncLocalStorage` provides it with every provider left a singleton. Choosing
    between hand-rolled ALS, `nestjs-cls`, and the Observe SDK requires knowing which
    transports each covers; a middleware-based store covers HTTP only.
  - **When**: Target project has `@nestjs/core` **and** either reads request-derived values in a
    shared service, or already uses `AsyncLocalStorage` / `nestjs-cls` / `@nestjs/observe`. The
    transport-coverage table is the reason to inject this even when ALS is already in use.
  - **Target Location**: `docs/rules/nestjs/prefer-async-local-storage-over-request-scope.md`

- **Path**: `rules/nestjs/singletons-are-safe-until-you-mutate-one.md`
  - **Why**: Node has no per-request thread, so the usual shared-mutable-state race cannot
    happen — but request state written into a singleton still leaks, silently into the next
    request. This is the first-principles justification for the default scope, and the reason
    the ~5% latency rule is not the thing to worry about.
  - **When**: Target project has `@nestjs/core` and any singleton provider holding mutable
    instance state. That is the default posture, so it applies to essentially every Nest
    application.
  - **Target Location**: `docs/rules/nestjs/singletons-are-safe-until-you-mutate-one.md`

- **Path**: `rules/nestjs/must-be-singleton-providers.md`
  - **Why**: The docs mark gateways, Passport strategies, and cron controllers as structurally
    unable to be request-scoped — a gateway encapsulates a real socket and cannot be
    instantiated multiple times. Violating it is a runtime failure, not the bounded ~5%
    latency the general scope rule accepts.
  - **When**: Target project has `@nestjs/core` **and** uses `@WebSocketGateway`,
    `PassportStrategy(...)`, or `@Cron(...)`. Skip if none is present — the rule is specific to
    these three component kinds.
  - **Target Location**: `docs/rules/nestjs/must-be-singleton-providers.md`

## 2. Skills (`skills/`)
- **Path**: `skills/nestjs/request-scope-to-als-migration/SKILL.md`
  - **Why**: A repeatable sequence for the most common NestJS performance defect — turning
    `Scope.REQUEST` that exists only to read a value into an `AsyncLocalStorage` store. Orders
    the work so the structural blockers (gateways, strategies, cron) are found before the
    optimisation, and makes the transport decision explicit, since a middleware-based store
    covers HTTP only and fails silently in a worker.
  - **When**: Target project has `@nestjs/core` and either uses `Scope.REQUEST` /
    `@Inject(REQUEST)`, or has regressed in latency after a feature that added a
    request-scoped provider. The skill's Step 1 greps and exits early when neither is present,
    so it is safe to inject into a clean Nest project — but do not inject it "just in case" for
    a project with no request scoping.
  - **Target Location**: `docs/skills/nestjs/request-scope-to-als-migration/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/nestjs/agent.json`
  - **Why**: Helps with NestJS-related tasks, such as request scope migration and other NestJS best practices.
  - **When**: Target project has `@nestjs/core`.
  - **Target Location**: `docs/agents/nestjs/agent.json`

## 4. Shared Assets (`shared/`)
_Empty — no NestJS specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
