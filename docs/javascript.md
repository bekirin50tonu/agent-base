---
language: "JavaScript"
tag: "js"
ecosystem: "frontend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for JavaScript / TypeScript assets."
---

# Documentation Hub: JavaScript

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`,
> `pnpm-lock.yaml`). Match the conditions below to determine which `rules`, `skills`, `agents`,
> or `shared` assets to inject.
>
> **Overlap**: the TypeScript strict-adoption skill is routed here *and* from
> `docs/react.md`, deliberately — a non-React TypeScript project should not have to
> resolve the React hub to reach it. The skill file is one; a manifest may point at it
> from more than one hub.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

_Empty — no JavaScript-specific rules have been synthesized yet._

## 2. Skills (`skills/`)

- **Path**: `skills/typescript/adopt-strict-checking-gradually/SKILL.md`
  - **Why**: Provides a gradual migration path to strict TypeScript checking, helping teams
    adopt stricter type safety without blocking development on immediate breaking changes.
  - **When**: Target project uses TypeScript and wants to incrementally increase type
    checking strictness (e.g., moving from `noImplicitAny: false` to `true`).
  - **Target Location**: `docs/skills/typescript/adopt-strict-checking-gradually/SKILL.md`

## 3. Agents (`agents/`)

_Empty — no JavaScript agents have been synthesized yet._

## 4. Shared Assets (`shared/`)
_Empty — no JavaScript specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.