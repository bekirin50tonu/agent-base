---
language: ".NET/C#"
tag: "csharp"
ecosystem: "backend"
last_updated: "2026-09-29"
summary: "Routing hub and decision matrix for .NET / C# assets."
---

# Documentation Hub: .NET/C#

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`*.csproj`,
> `*.sln`). Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.
>
> **Status**: this hub lists no .NET-specific assets yet. Phase 1–3 have not produced a .NET
> asset. Fetch the manifest, find it empty, and report that rather than substituting
> something from another ecosystem.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
_Empty — no .NET rules have been synthesized._

## 2. Skills (`skills/`)
_Empty — no .NET skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no .NET agents have been synthesized._

## 4. Shared Assets (`shared/`)
_Empty — no .NET-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
