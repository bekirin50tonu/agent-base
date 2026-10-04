---
language: "Testing"
tag: "testing"
ecosystem: "cross-cutting"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for test determinism and flakiness assets."
---

# Documentation Hub: Test Determinism & Flakiness

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies for test frameworks or property-based testing libraries. This hub is **cross-cutting** — it applies regardless of implementation language, so a project can match it alongside its language hub. Judge each entry separately.
>
> **Triggers**: `pytest` in `requirements.txt`/`pyproject.toml`, `@jest/globals` in `package.json`, `testing` crate in `Cargo.toml`, `junit` in `pom.xml`/`build.gradle`, `TestFramework` in `.csproj`, or `go test` usage in Makefile/CI scripts.
>
> **Version note**: these assets were written against pytest 8.x, Hypothesis 6.x, Go 1.22, fast-check 3.x, and proptest 1.x versions. Verify compatibility before applying.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/testing/flake-is-uncontrolled-state-not-bad-timing.md`
  - **Why**: Flaky tests primarily indicate uncontrolled system state, not merely timing issues. Solutions that only slow down tests miss the root cause and create false confidence.
  - **When**: Target project uses pytest, unittest, Jest, JUnit, Go test, or any test framework where flaky tests appear in CI.
  - **Target Location**: `docs/rules/testing/flake-is-uncontrolled-state-not-bad-timing.md`

- **Path**: `rules/testing/seed-derives-from-test-id-not-from-wall-clock.md`
  - **Why**: Test randomization should be based on test identity for reproducibility without manual seed management. Per-test seeding prevents forgotten tests from becoming silently flaky.
  - **When**: Target project uses pytest-randomly or considers implementing per-test seeding strategies for property-based testing.
  - **Target Location**: `docs/rules/testing/seed-derives-from-test-id-not-from-wall-clock.md`

- **Path**: `rules/testing/go-test-cache-reuse-needs-a-closed-flag-set.md`
  - **Why**: Go test cache reuses results only when flags come from a restricted set, making deterministic behavior a protocol property rather than an intention. Ignoring this causes silent test pollution.
  - **When**: Target project uses Go testing and observes inconsistent test results due to flag variations affecting cache behavior.
  - **Target Location**: `docs/rules/testing/go-test-cache-reuse-needs-a-closed-flag-set.md`

- **Path**: `rules/testing/deterministic-ci-and-failure-replay-are-different-knobs.md`
  - **Why**: Deterministic CI (preventing regressions) and failure replay (debugging observed issues) are opposing goals requiring different configuration approaches in property-based testing frameworks.
  - **When**: Target project uses Hypothesis, fast-check, proptest, or similar property-based testing libraries and needs to configure them for CI vs. debugging workflows.
  - **Target Location**: `docs/rules/testing/deterministic-ci-and-failure-replay-are-different-knobs.md`

## 2. Skills (`skills/`)

_Empty — test determinism guidance is delivered as protocol rules; a skill would add nothing the rules do not already route._

## 3. Agents (`agents/`)

_Empty — test determinism guidance is delivered as protocol rules; an agent persona would add nothing the rules do not already route._

## 4. Shared Assets (`shared/`)

_Empty — no shared assets synthesized for this topic yet._

<!-- ASSET_MANIFEST_END -->

---