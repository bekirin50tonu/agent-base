---
name: read-plan-before-optimize
description: "Read the execution plan before optimizing SQL queries. Use when you notice slow queries, before adding indexes, or when query performance degrades."
version: "1.0.0"
tags:
  - sql
  - performance
  - explain
---

# Read the Execution Plan Before Optimizing SQL Queries

## Why

Optimizing SQL queries without examining the execution plan is like changing parts in an engine without diagnostics. You might speed up a query that was already fast, miss the real bottleneck, or even make performance worse. The `EXPLAIN` output shows how PostgreSQL intends to run your query, revealing sequential scans, missing indexes, inefficient joins, and unexpected row counts. Making this step a habit ensures your optimizations target the actual problem.

## Step 0 — Enable timing and consider auto-explain

If you are working in a development environment, turn on timing and consider enabling `auto_explain` for problematic queries.

```sql
\timing on
-- Optionally load auto_explain for logging slow queries
-- shared_preload_libraries = 'auto_explain' (in postgresql.conf)
-- Then set:
-- auto_explain.log_min_duration = '500ms'
-- auto_explain.log_analyze = true
```

**Exit criterion:** You can see query timing in your client, and `EXPLAIN` runs without error.

## Step 1 — Identify the slow query

Locate the query you want to optimize. Check:
- Application logs for slow query warnings.
- `pg_stat_statements` for queries with high total time.
- Your monitoring dashboard for spikes in query latency.

**Exit criterion:** You have the exact SQL text and can run it in a console against a representative database.

## Step 2 — Run EXPLAIN (ANALYZE, BUFFERS)

Execute the query with `EXPLAIN (ANALYZE, BUFFERS)` to get actual run times and buffer usage.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... ;
```

If the query modifies data, wrap it in a transaction and roll back, or use a copy of the data.

**Exit criterion:** You have the query plan with actual rows, loops, and I/O statistics.

## Step 3 — Check for red flags

Scan the plan for:
- **Sequential scans** on large tables when an index scan is expected.
- **Hash joins** or **nested loops** with high row counts that suggest missing join conditions.
- **Filter** conditions applied after a sequential scan (indicating the index isn't being used).
- **Unexpected row counts** (e.g., the planner estimated 10 rows but got 10,000).
- **Repetition** of the same subplan multiple times (possible N+1).

**Exit criterion:** You have identified at least one operation that seems inefficient or unexpected.

## Step 4 — Form a hypothesis and apply one change

Based on the red flag, decide on one change:
- Add an index (`CREATE INDEX CONCURRENTLY` if in production).
- Rewrite the query to improve join order or eliminate unnecessary tables.
- Adjust `WHERE` clauses to make them sargable.
- Consider materializing a subquery with a CTE or temporary table.

Apply the change, being mindful of production safety (use `CONCURRENTLY` for indexes, test in a staging environment first).

**Exit criterion:** The change is applied and the database is ready for testing.

## Step 5 — Re-run EXPLAIN to verify

Run `EXPLAIN (ANALYZE, BUFFERS)` again on the same query (or a representative sample).

Compare:
- Total execution time (should be lower).
- Buffer hits vs. reads (more hits is better).
- The plan shape (e.g., a sequential scan turned into an index scan).
- Row counts at each stage (should match expectations more closely).

**Exit criterion:** The query runs faster and the plan shows the intended optimization (e.g., an index scan replacing a sequential scan).

## Step 6 — Monitor for regression

After deploying the change:
- Check that the query's average time in `pg_stat_statements` improves.
- Watch for any increase in errors or warnings related to the change.
- Ensure the plan remains stable over time (planner doesn't flip back due to data changes).

If the plan regresses, repeat from Step 2 with the new data distribution.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Query time did not improve after adding an index | The index columns do not match the `WHERE` or `JOIN` conditions, or the table is too small | Verify the index matches the query predicates; consider a multicolumn index or adjusting the query |
| Plan shows an index scan but performance worsened | The index is not selective (many rows match) or the table is cached, making sequential scan faster | Consider whether the index is needed; maybe a different query rewrite is better |
| EXPLAIN times out or errors due to locks | The query is blocked by a long-running transaction | Identify and terminate the blocking transaction, or set a statement timeout |
| After optimization, another query slowed down | The new index increases write overhead or changes the planner's choices for other queries | Evaluate the index's overall impact; maybe adjust the index or use a filtered index |

## Verifying

- Use `EXPLAIN` on a variety of parameter values to ensure the plan is stable (consider `EXPLAIN` with different constants).
- Check that the index is being used: `SELECT * FROM pg_stat_user_indexes WHERE relname = 'your_table' AND indexrelid = 'your_index'::regclass;`
- If using `auto_explain`, confirm that slow-query logs now show the improved plan.

## Limits of this skill

- Does not cover optimizer hints (PostgreSQL does not support them directly; use `pg_hint_plan` if needed).
- Does not address issues caused by outdated statistics—run `ANALYZE` if you suspect bad plans.
- Does not replace query rewriting for logical errors (e.g., missing `DISTINCT` causing duplicates).
- Assumes you can run `EXPLAIN` on the query in isolation; some queries depend on session state or temporary tables.