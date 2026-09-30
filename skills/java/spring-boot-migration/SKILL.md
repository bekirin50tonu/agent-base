---
name: spring-boot-migration
description: "Migrate a Spring Boot application across a major version boundary (2.x to 3.x, 3.x to 4.x). Use when upgrading Spring Boot major versions, especially when the jakarta.* namespace migration applies."
version: "1.0.0"
tags:
  - java
  - spring
  - migration
---

# Spring Boot Major Version Migration

A Spring Boot major-version upgrade is not one step. It is a patch-baseline step, a version
jump with dependency coordination, and — only for the 2.x → 3.x boundary — a namespace
migration. Applying them in the wrong order produces build failures, silent runtime issues, or
rework. This skill orders the work so each concern is handled separately, with a validation
gate after each.

## Why

The 2.x → 3.x boundary is the one that carries a namespace change: `javax.*` becomes
`jakarta.*` across the Servlet, Persistence, Validation, and other EE APIs. The 3.x → 4.x
boundary does **not** rename packages — it moves to Jakarta EE 11 versions and removes
features. Treating both migrations as "bump the version and fix compile errors" conflates a
mechanical namespace transformation with a dependency-coordination problem, and the failure
surfaces later at runtime rather than at build time.

## Step 1 — Upgrade to the latest patch of the current minor line

Before crossing a major boundary, move to the newest patch release of the line you are on
(e.g. 2.7.x → 2.7.12, 3.1.x → 3.1.15). This establishes a baseline that already carries every
backward-compatible fix, so a later failure is attributable to the major jump and not to a
missing patch.

**Exit criterion:** the application builds and the test suite is green on the latest patch of
the current minor line, with no new startup deprecation warnings.

## Step 2 — Jump the major version and coordinate dependencies

Update the Spring Boot version to the target major (2.7.12 → 3.0.0, or 3.1.15 → 4.0.0) and
update every Spring Boot–managed dependency per the official migration guide. At this step:

- **2.x → 3.x:** the `jakarta.*` namespace migration is part of the change (Step 3).
- **3.x → 4.x:** Jakarta EE 11 version updates, with no namespace change (Step 4).

**Exit criterion:** the project resolves dependencies and builds against the new major version.

## Step 3 — Namespace migration (`javax.*` → `jakarta.*`), 2.x → 3.x only

Apply the namespace transformation with the Spring Boot Properties Migrator module or
OpenRewrite recipes, then hand-check what automated rewriting misses: string literals, XML
configuration, reflection-based references, and generated sources.

**Exit criterion:** no `javax.` references to migrated EE packages remain, and the test suite
passes on the 3.x line.

## Step 4 — EE dependency coordination, 3.x → 4.x only

Move dependent libraries (Servlet, Validation, JSON, and the rest) to their Jakarta EE 11
versions and review custom code that depended on Jakarta EE 10 behaviour.

**Exit criterion:** all EE dependencies are on Jakarta EE 11 versions and the build succeeds.

## Step 5 — Validate and plan cutover

After each phase, run the full test suite and confirm no startup deprecation warnings. The
test suite is the safety net for both dependency updates and the namespace migration; for the
2.x → 3.x step, a green run is the primary evidence the transformation is complete.

**Exit criterion:** tests pass and the startup log is free of deprecation warnings on the
target line — only then proceed to the next phase.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Build fails immediately after the version jump | Missing dependency updates, or an incomplete `jakarta.*` migration | Re-run the dependency update and check the migration tool's output for skipped files |
| Tests pass but runtime errors appear | A validation gate was skipped, or EE coordination (Step 4) was missed | Reinstate the per-phase gate and run the full suite, not a subset |
| Silent production failures | No deprecation-warning check at startup | Add a startup deprecation scan to CI so the warning is caught before release |

## Verifying

- `grep -rn "javax\." src/` returns nothing after a 2.x → 3.x migration.
- `mvn dependency:tree` (or `gradle dependencies`) shows EE libraries on their Jakarta EE 11
  versions after a 3.x → 4.x migration.
- The application starts with no deprecation warnings on the target line.

## When to stop and escalate

- A third-party dependency has no release on the target line — the migration is blocked until
  it is upgraded, replaced, or vendored.
- Test coverage is too thin to serve as the validation gate — establish coverage before
  crossing the major boundary rather than migrating on manual verification.

## Limits of this skill

- Assumes automated testing exists to act as the per-phase validation gate. Projects without
  sufficient coverage need manual verification, which this skill does not describe.
- Does not go deeper into individual feature removals (Actuator changes and similar) than the
  official migration guides do.
- Does not include version-compatibility matrices for third-party libraries — consult each
  library's own documentation.