---
title: "CREATE INDEX CONCURRENTLY Cannot Run in a Transaction Block"
rule_id: "RULE-SQL-003"
category: "correctness"
scope: "all"
applies_to: "PostgreSQL"
last_updated: "2026-09-30"
source: "https://www.postgresql.org/docs/current/sql-createindex.html"
---

# CREATE INDEX CONCURRENTLY Cannot Run in a Transaction Block

In PostgreSQL, `CREATE INDEX CONCURRENTLY` cannot be executed inside a transaction block (BEGIN/COMMIT). Attempting to do so results in an error. This constraint is often missed when trying to add indexes without downtime.

## Why

The `CONCURRENTLY` option requires two scans of the table and must wait for conflicting transactions to finish. It cannot run inside a transaction because it needs to commit its two scans separately. Trying to run it within a transaction block violates this requirement and causes the command to abort with an error.

## Do

- Run `CREATE INDEX CONCURRENTLY` outside of any explicit transaction block.
- If you are using a tool that wraps commands in transactions (like some migration frameworks), disable transaction wrapping for this command.
- Schedule concurrent index creation during maintenance windows or when load is low, as it still takes longer than a regular index build.

## Don't

- Wrap `CREATE INDEX CONCURRENTLY` in a `BEGIN ... COMMIT` block assuming it will work like other DDL.
- Expect the command to succeed inside a transaction just because a regular `CREATE INDEX` does.
- Assume that the error message will be obvious; some clients may hide the SQL state.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Error: "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" | The command was executed within an explicit transaction | Remove the transaction block or use a session with autocommit |
| Migration fails silently because the error is caught and retried | Some ORMs retry on failure but do not notice the transaction restriction | Check migration logs for the specific SQL state `2D000` (invalid_transaction_termination) |
| Index creation takes longer than expected but eventually succeeds | The command fell back to a regular `CREATE INDEX` after failing (not typical) | Verify that the index was created concurrently by checking `pg_index.indisconcurrent` |

## Verifying

- Attempt to run `BEGIN; CREATE INDEX CONCURRENTLY idx ON tbl (col); COMMIT;` and observe the error.
- Check that `CREATE INDEX` (without CONCURRENTLY) works inside a transaction block.
- After creating an index concurrently, verify that `SELECT indisconcurrent FROM pg_index WHERE indexrelid = 'idx'::regclass;` returns true.