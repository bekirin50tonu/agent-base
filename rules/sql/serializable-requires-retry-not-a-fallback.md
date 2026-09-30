---
title: "SERIALIZABLE Requires Retry, Not a Fallback"
rule_id: "RULE-SQL-005"
category: "correctness"
scope: "all"
applies_to: "PostgreSQL"
last_updated: "2026-10-01"
source: "https://www.postgresql.org/docs/current/transaction-iso.html"
---

# SERIALIZABLE Requires Retry, Not a Fallback
PostgreSQL's SERIALIZABLE isolation level uses predicate locking to prevent write skews and other serialization anomalies. When a serialization failure occurs, the database returns SQLSTATE 40001, and the application must retry the entire transaction from the start. Attempting to catch and ignore the error, or to continue with partial work, leads to incorrect behavior because the transaction's effects are not applied atomically.

## Why
SERIALIZABLE provides the strongest isolation guarantee in PostgreSQL: it prevents dirty reads, non-repeatable reads, phantom reads, and write skews. It does this by tracking predicates (conditions in WHERE clauses) and locking them to prevent concurrent transactions from creating conflicting outcomes.

When two concurrent transactions would create a serialization anomaly (e.g., both try to insert a row with the same unique key, or both read a summary and update based on it), the SERIALIZABLE detector will allow one to commit and force the other to abort with a serialization failure.

Key points:
- The failure is reported as SQLSTATE 40001 with the message "could not serialize access due to concurrent update".
- No partial effects of the transaction are applied — the transaction is rolled back entirely.
- The application must retry the transaction from the beginning; any work done in the aborted transaction must be discarded.
- Retrying immediately usually works because the conflicting transaction has already committed and released its locks.
- The retry count should be limited to avoid infinite loops in case of persistent conflicts.

## Do
- Always check for SQLSTATE 40001 (or the corresponding error code in your driver) when committing a transaction under SERIALIZABLE.
- Implement a retry loop that re-executes the entire transaction from the start when a serialization failure occurs.
- Limit the number of retries (e.g., 5 attempts) to avoid livelock; consider exponential backoff between attempts.
- Ensure that the transaction logic is idempotent or safe to retry — retrying should not cause unintended side effects.
- Use SERIALIZABLE only when you need to prevent write skews or other complex anomalies; for simpler cases, READ COMMITTED or REPEATABLE READ may suffice.
- Monitor serialization failure rates via `pg_stat_database` or extensions like `pg_stat_statements` to detect excessive contention.
- Consider using explicit locking (e.g., `SELECT FOR UPDATE`) or application-level serialization if retry overhead is too high.

## Don't
- Don't treat SQLSTATE 40001 as a transient error that can be safely ignored — ignoring it means the transaction's effects are lost, potentially breaking invariants.
- Don't attempt to continue with partial work after a serialization failure; the transaction must be rolled back and retried.
- Don't assume that SERIALIZABLE prevents all concurrency issues without any application logic — it still requires proper transaction boundaries.
- Don't use SERIALIZABLE for read-only transactions unless you need to protect against phantom reads in a write-heavy workload; REPEATABLE READ may be sufficient and have lower overhead.
- Don't forget that the retry must start from the very beginning of the transaction; you cannot retry from a middle point.
- Don't rely on application-level retry without verifying that the serialization failure is indeed due to a conflict (check the error code).

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Transaction silently fails to apply changes | SQLSTATE 40001 caught and ignored; transaction rolled back but application continues | Check for serialization errors and implement retry logic |
| Infinite retry loop under high contention | Persistent conflicts causing repeated serialization failures | Add retry limit and exponential backoff; consider reducing transaction scope or using locking |
| Partial transaction effects applied after failure | Attempting to commit or continue after rollback | Ensure transaction is fully rolled back; retry from start |
| High latency due to frequent retries | Many transactions aborting due to conflicts | Analyze workload; consider lower isolation levels or application-level conflict detection |
| Missed anomalies despite SERIALIZABLE | Transaction not actually running in SERIALIZABLE (default is READ COMMITTED) | Explicitly set isolation level via `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` or connection configuration |