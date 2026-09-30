---
title: "Concurrency Strategy Is Not Vertical-Slice Veneer"
rule_id: "RULE-DISTRIBUTED-001"
category: "architecture"
scope: "backend"
applies_to: "Any service with two or more queued/async workers, or a database-backed job table"
last_updated: "2026-09-30"
source: "https://www.postgresql.org/docs/current/sql-select.html, https://redis.io/docs/latest/develop/data-types/streams/consumer-groups/, https://www.rabbitmq.com/docs/quorum-queues"
---

# Concurrency Strategy Is Not Vertical-Slice Veneer

Concurrency and queueing are not a place you can pretend to be happy. The single most expensive bug to fix is a job that runs twice under concurrent consumers: it is intermittently reproducible, rarely caught in tests, and its blast radius is every same-schema deployment you ever made. If your workers are concurrent and your work is at-least-once — the default — then safe execution is a mandatory lane, not a sliver you've held until "there's time".

## Why

Three strategies exist for making concurrent work safe, and each must be *explicit*:

1. **Locking the row the business write touches.**
   ```sql
   -- claim a job enumerably: lock, mark, commit
   SELECT * FROM jobs WHERE status = 'pending'
     ORDER BY scheduled_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
   ```
   This is the only correct shape for "take the next pending thing". The naive form — `SELECT ... WHERE status='pending'` then a separate `UPDATE ... SET status='running'` — lets two workers claim the same row between the read and the write, and both process it.
2. **Idempotent workers** keyed on a monotonic, assignment-scoped token (message id, event id, client-generated `<idempotency_key>`), where the datastore refuses the duplicate and the worker rejoices at that refusal.
3. **Exactly-once emulation** that is honest about its boundary: Kafka's transactional read-process-write is scoped to the log and does not extend to your Postgres. `isolation.level=read_committed` does not make an external write idempotent.

## Do

- Use `FOR UPDATE SKIP LOCKED` (or your queue's native claim) for job tables. `SKIP LOCKED` exists precisely so N workers can race for different rows without blocking on the same one.
- Prefer the **idempotency-key-first** design when the work is a mutation of business state: the worker can be reckless about ordering because the datastore rejects the second application.
- Make every claim/skip decision transactional — the `SELECT ... FOR UPDATE` and the state transition in one transaction or one Lua script.
- Track a monotonic sequence per key (Redis `INCR`, or the broker offset) where "latest wins" is the business rule.

## Don't

- **Don't use a non-blocking read-then-mark pattern for claims.** It is correct on the happy path and corrupted under concurrency. If you cannot use `SKIP LOCKED`, use a compare-and-set (`UPDATE ... WHERE status='pending'` returning affected rows) — and verify the affected-count equals one.
- **Don't put the idempotency key outside the business transaction.** A dedupe record committed separately from the write is itself a race — two duplicates can both pass.
- **Don't architect "exactly once" with the word and nothing underneath.** "At-most-once processing, dedupe on the DB side" is a claim that must be implemented by the same `processed_events` unique index that backstops everything else.
- **Don't scatter worker count and concurrency knobs in five config files** you then forget to align. Prefer one worker-pool setting that all claimers share.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A job executes twice though logs show one lock | Read-then-mark has a race window | `FOR UPDATE SKIP LOCKED` or CAS-on-status |
| Two workers both claim the same row | No `SKIP LOCKED`; blocking select with no row lock | Add `SKIP LOCKED` + `LIMIT 1` |
| "Distributed" job silently lost | Ack-before-process | Acknowledge after commit/result durable |
| Dedupe misses intermittently | `processed_events` insert outside the write transaction | Put the insert and the write in one transaction |

## Verifying

1. Fire 25 concurrent consumers against a table of 100 pending jobs; assert exactly 100 claims and no job processed twice.
2. `SELECT id, COUNT(*) FROM jobs GROUP BY id HAVING COUNT(*) > 1` returns zero.
3. Kill a worker mid-job, restart it, and assert the job is re-claimed exactly once.

## Caveats on confidence

- `FOR UPDATE SKIP LOCKED` semantics are verified against the PostgreSQL SELECT reference (`FOR UPDATE [OF ...] [NOWAIT | SKIP LOCKED]`) as of 2026-09-30. The specific performance cliff under very high contention is not benchmarked here; if your table exceeds ~100k hot rows, measure with a concurrent load before assuming.
- Kafka's exactly-once boundary is asserted from the API surface, not from an end-to-end benchmark. Do not quote a latency figure from this rule.
- The "idempotency-key-first" preference is a design recommendation, not a vendor guarantee — the message/side-effect idempotency must be implemented by the worker.