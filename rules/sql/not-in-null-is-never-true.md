---
title: "NOT IN with Nulls Is Never True"
rule_id: "RULE-SQL-001"
category: "correctness"
scope: "all"
applies_to: "PostgreSQL"
last_updated: "2026-09-30"
source: "https://www.postgresql.org/docs/current/functions-subquery.html"
---

# NOT IN with Nulls Is Never True

In SQL, the `NOT IN` predicate returns `null` (not `true`) if the subquery contains any `null` values, or if the left-hand expression evaluates to `null`. This can lead to unexpected results when checking for absence.

## Why

The SQL standard defines `NOT IN` as true only when all comparisons are true and no operand is null. If any value in the subquery is null, the result is null, not false. This trips up developers who expect `WHERE col NOT IN (SELECT ...)` to behave like a simple absence check.

## Do

- Use `NOT EXISTS` for anti-join patterns when nulls might be present in the subquery.
- Ensure the subquery cannot return null by adding `WHERE col IS NOT NULL` inside the subquery if you must use `NOT IN`.
- Check that the left-hand column is constrained `NOT NULL` if you know the subquery is clean.

## Don't

- Assume `NOT IN` behaves like `NOT ( ... IN ... )` when nulls are possible.
- Use `NOT IN` with nullable columns without verifying the subquery is null-free.
- Rely on `NOT IN` for performance-critical anti-joins without checking the execution plan.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Query returns zero rows when rows should be excluded | Subquery contains a null, making `NOT IN` evaluate to unknown | Rewrite using `NOT EXISTS` or filter nulls from subquery |
| Unexpected null results in boolean columns | Left-hand expression is null, causing `NOT IN` to yield null | Ensure the column is `NOT NULL` or use `COALESCE` |
| Performance degradation due to sequential scan | Planner cannot optimize `NOT IN` with potential nulls | Use `NOT EXISTS` which allows efficient anti-join strategies |

## Verifying

- Run `EXPLAIN` on a query with `NOT IN` and a nullable subquery column; observe that the plan may resort to a filter rather than a hash anti-join.
- Insert a null into the subquery source and confirm the query returns no matches (or null) instead of the expected rows.
- Test with `WHERE 1 NOT IN (SELECT NULL::int)`; the result should be null, not false.