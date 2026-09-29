---
language: "React-Pnpm-Next"
tag: "next.js"
ecosystem: "frontend"
last_updated: "2026-09-29"
summary: "Routing hub and decision matrix for React / Next.js / pnpm assets."
---

# Documentation Hub: React-Pnpm-Next

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`,
> `pnpm-lock.yaml`). Match the conditions below to determine which `rules`, `skills`, `agents`,
> or `shared` assets to inject.
>
> **Status**: this hub lists no ecosystem-specific assets yet. Phase 1–3 have not produced a
> React asset. Fetch the manifest, find it empty, and report that. Do not substitute an asset
> from another ecosystem — a cross-stack pattern belongs in the generic section below.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
_Empty — no React rules have been synthesized._

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
