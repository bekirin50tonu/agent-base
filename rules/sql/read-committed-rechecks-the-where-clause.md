---
title: "READ COMMITTED Rechecks the WHERE Clause"
rule_id: "RULE-SQL-004"
category: "correctness"
scope: "all"
applies_to: "PostgreSQL"
last_updated: "2026-10-01"
source: "https://www.postgresql.org/docs/current/transaction-iso.html"
---

# READ COMMITTED Rechecks the WHERE Clause
In PostgreSQL's READ COMMITTED isolation level (the default), each SQL statement sees a fresh snapshot of the database. However, when executing an UPDATE or DELETE, the statement first finds matching rows using the WHERE clause against the snapshot, then rechecks the WHERE clause against the current versions of those rows before modifying them. This means a concurrent transaction that changes a row so it no longer matches the WHERE clause will cause the UPDATE/DDELETE to skip that row, rather than mistakenly modifying it.

## Why
READ COMMITTED prevents dirty reads by ensuring each query sees only committed data as of the start of the query. For SELECT statements, this is straightforward — the snapshot is taken at statement start and used throughout. For UPDATE and DELETE, the process is more nuanced:
1. Take a snapshot at statement start.
2. Find all rows matching the WHERE clause using that snapshot.
3. For each candidate row, lock it and recheck the WHERE clause against its current version.
4. If the row still matches, proceed with the update/delete; if not, skip it.

This recheck prevents a classic lost-update anomaly where two concurrent transactions might both read the same value, update it based on that read, and one overwrites the other's result. However, it also means that UPDATE and DELETE statements can be affected by concurrent modifications in ways that SELECT statements are not — a row that matched when the snapshot was taken might not match by the time it's processed.

## Do
- Understand that in READ COMMITTED, UPDATE and DELETE statements are not simply "take snapshot, modify matching rows" — they include a recheck step.
- Design idempotent update logic where possible, so that reapplying the same update is safe.
- Consider using SELECT FOR UPDATE or stronger isolation levels if you need to guarantee that the set of rows you read is the set you will modify.
- Use application-level retry logic for transactions that depend on specific row states being present.
- Monitor for unexpected zero-row updates when you expected rows to be modified — this often indicates concurrent modification affecting the WHERE clause recheck.
- When doing read-modify-write patterns, consider wrapping the entire operation in a transaction with appropriate isolation (e.g., REPEATABLE READ or SERIALIZABLE) if the recheck behavior is problematic.
- Remember that INSERT statements do not have this recheck behavior — they only check for constraint violations at commit time.

## Don't
- Don't assume that an UPDATE will affect all rows that matched the WHERE clause when the statement started — concurrent changes can cause rows to be skipped.
- Don't rely on READ COMMITTED to prevent all concurrency anomalies — it allows non-repeatable reads and phantom reads.
- Don't confuse the statement-level snapshot in READ COMMITTED with transaction-level snapshots in higher isolation levels.
- Don't expect BEFORE UPDATE triggers to see the same row version that the WHERE clause matched — they see the current version when the trigger fires.
- Don't forget that the recheck only applies to the WHERE clause — other conditions (like JOIN clauses) are evaluated only against the initial snapshot.
- Don't assume that READ COMMITTED provides any write-write conflict prevention beyond the basic lock-on-update mechanism.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| UPDATE affects zero rows despite matching rows existing at statement start | Concurrent transaction modified rows so they no longer match WHERE clause | Use stronger isolation or application locking if exact row set is required |
| Inconsistent row counts in batch updates | Some rows skipped due to WHERE clause recheck failing | Consider transaction boundaries or repeatable reads for batch operations |
| Lost updates despite READ COMMITTED | Two transactions read, modify, and write based on stale data | Use application-level versioning or SELECT FOR UPDATE |
| Phantom rows appearing in repeated SELECT statements | Non-repeatable reads allowed in READ COMMITTED | Use REPEATABLE READ or SERIALIZABLE if phantom reads are unacceptable |
| UPDATE affecting unexpected rows due to join conditions | Join evaluated against snapshot, not current data | Understand that only WHERE clause gets rechecked; joins use initial snapshot |