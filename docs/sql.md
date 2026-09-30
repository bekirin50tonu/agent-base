---
language: "SQL"
tag: "sql"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for SQL assets."
---

# Documentation Hub: SQL

> **Agent Directive (Phase 4)**: Inspect the target project for SQL usage patterns.
> Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.

> **Status**: 3 rules covering NULL semantics in `NOT IN`, the disabled-by-default
> timeout family, and `CREATE INDEX CONCURRENTLY` transaction limits, plus an
> EXPLAIN-first optimization workflow. Sourced against the PostgreSQL current docs.

> **Scope**: This hub covers PostgreSQL databases and SQL usage patterns. Since PostgreSQL is used
> across backend, frontend (via ORMs/dev tools), and data science projects, this
> hub serves as a cross-cutting concern for data access patterns specific to PostgreSQL.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/sql/not-in-null-is-never-true.md`
  - **Why**: PostgreSQL documents that `NOT IN` yields null — not true — when any right-hand row is null or the left-hand expression is null, so the predicate silently filters out every row instead of matching the expected ones.
  - **When**: Target project has `NOT IN` over a subquery or list with a nullable column on either side, or an anti-join pattern.
  - **Target Location**: `docs/rules/sql/not-in-null-is-never-true.md`

- **Path**: `rules/sql/statement-timeout-defaults-to-zero.md`
  - **Why**: PostgreSQL's `statement_timeout`, `lock_timeout`, `transaction_timeout`, and `idle_in_transaction_session_timeout` all default to zero (disabled), so a single pathological query can hold a connection or lock indefinitely.
  - **When**: Target project connects to PostgreSQL and does not explicitly set any of the timeout family in session, role, or database configuration.
  - **Target Location**: `docs/rules/sql/statement-timeout-defaults-to-zero.md`

- **Path**: `rules/sql/create-index-concurrently-cannot-run-in-a-transaction.md`
  - **Why**: A regular `CREATE INDEX` can run inside a transaction block, but `CREATE INDEX CONCURRENTLY` cannot — and the failure modes compound: only one concurrent build per table, an INVALID index if interrupted, no concurrent builds on partitioned tables.
  - **When**: Target project runs PostgreSQL schema migrations under a tool that wraps DDL in transactions, and needs zero-downtime index creation.
  - **Target Location**: `docs/rules/sql/create-index-concurrently-cannot-run-in-a-transaction.md`

## 2. Skills (`skills/`)

- **Path**: `skills/sql/read-plan-before-optimize/SKILL.md`
  - **Why**: An optimization applied without reading the plan first can leave the actual bottleneck untouched or regress other queries. The workflow captures the plan with `EXPLAIN (ANALYZE, BUFFERS)`, checks for red flags, applies one change, and re-verifies — mirroring the `adopt-mypy` idea that the diagnostic output is the work queue.
  - **When**: Target project has slow queries or queries whose performance needs investigation, before indexes are added or queries rewritten.
  - **Target Location**: `docs/skills/sql/read-plan-before-optimize/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/sql/agent.json`
  - **Why**: Helps with SQL-related tasks, such as avoiding N+1 round-trips, setting timeouts, and understanding index usage.
  - **When**: Target project uses a PostgreSQL or SQL database (has migrations, SQL files, or an ORM configured against a relational database).
  - **Target Location**: `docs/agents/sql/agent.json`

## 4. Shared Assets (`shared/`)

_Empty — no SQL specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->