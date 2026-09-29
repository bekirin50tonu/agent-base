---
language: "Python"
tag: "python"
ecosystem: "backend"
last_updated: "2026-09-29"
summary: "Routing hub and decision matrix for Python assets."
---

# Documentation Hub: Python

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`pyproject.toml`,
> `requirements.txt`). Match the conditions below to determine which `rules`, `skills`,
> `agents`, or `shared` assets to inject.
>
> **Status**: this hub lists no Python-specific assets yet. Phase 1–3 have not produced a
> Python asset. Fetch the manifest, find it empty, and report that rather than substituting
> something from another ecosystem.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
_Empty — no Python rules have been synthesized._

## 2. Skills (`skills/`)
_Empty — no Python skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no Python agents have been synthesized._

## 4. Shared Assets (`shared/`)
_Empty — no Python-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
