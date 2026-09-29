---
language: "Java-Spring"
tag: "spring-boot"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for Java / Spring Boot assets."
---

# Documentation Hub: Java-Spring

> **Agent Directive (Phase 4)**: Inspect the target project's build file — `pom.xml` or
> `build.gradle` / `build.gradle.kts` — for `spring-boot-starter-*`, `spring-boot-dependencies`,
> or the `org.springframework.boot` plugin. Match the conditions below to determine which
> `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: this hub lists no Java/Spring assets yet. Phase 1–3 have not produced one. Fetch
> the manifest, find it empty, and report that rather than substituting something from another
> ecosystem.
>
> **Scope**: this hub is Spring Boot. Plain-JDK concerns that are not framework-specific —
> virtual threads, `ExecutorService`, structured concurrency — belong to the `JVM` topic
> (`docs/jvm.md`), not here. A project can match both; judge each entry separately.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
_Empty — no Java/Spring rules have been synthesized._

## 2. Skills (`skills/`)
_Empty — no Java/Spring skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no Java/Spring agents have been synthesized._

## 4. Shared Assets (`shared/`)
_Empty — no Java/Spring-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
