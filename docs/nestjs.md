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
> **Status**: this hub lists no NestJS-specific assets yet. Phase 1–3 have not produced a
> NestJS asset. Fetch the manifest, find it empty, and report that rather than substituting
> something from another ecosystem.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
_Empty — no NestJS rules have been synthesized._

## 2. Skills (`skills/`)
_Empty — no NestJS skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no NestJS agents have been synthesized._

## 4. Shared Assets (`shared/`)
_Empty — no NestJS-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
