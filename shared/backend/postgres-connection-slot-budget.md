---
title: "PostgreSQL Connection Slot Budget: max_connections and Reserved Connections"
category: "configuration"
applies_to: "PostgreSQL"
last_updated: "2026-10-01"
source: "https://www.postgresql.org/docs/current/runtime-config-connection.html"
---

# PostgreSQL Connection Slot Budget: max_connections and Reserved Connections
PostgreSQL limits the number of concurrent connections via `max_connections`. Setting this parameter too high consumes excessive shared memory; setting it too low risks connection rejection. Additionally, reserved connection slots (`reserved_connections` and `superuser_reserved_connections`) ensure superusers and maintenance tasks can connect even when the general pool is exhausted. On a standby server, `max_connections` must be at least as high as the primary's, or queries will be refused.

## Why
Each PostgreSQL connection consumes a backend process and a portion of shared memory. The `max_connections` parameter determines the upper limit:
- **Connection overhead**: Each backend uses ~5MB of RAM (varies by platform) plus shared memory structures (lock tables, buffer descriptors, etc.).
- **Shared memory scaling**: Many shared memory allocations (e.g., lock manager, predicate lock table, auto-vacuum) scale with `max_connections`.
- **Reserved slots**: `reserved_connections` (default 0) are for the `pg_use_reserved_connections` role; `superuser_reserved_connections` (default 3) are for superuser connections. These slots are checked *after* the general pool is exhausted, allowing emergency access.
- **Standby requirements**: A standby server must accept connections for replication and querying; if its `max_connections` is lower than the primary's, it will refuse connections when the primary has many active sessions.
- **Connection pooling**: Proper use of connection pools (e.g., PgBouncer, HikariCP) keeps the number of actual backend processes low while serving many application threads.

Understanding this budget is critical for sizing instances, avoiding connection rejection errors, and ensuring maintenance access.

## Do
- Set `max_connections` based on available RAM and workload: start with `RAM_in_GB × 50` as a rough guideline (e.g., 16 GB → 800 connections), then adjust based on monitoring.
- Monitor actual usage via `pg_stat_activity` and `pg_stat_database` to see peak connection count.
- Consider connection pooling to reduce backend count and connection churn.
- Set `reserved_connections` > 0 if you need non-superuser roles to have emergency access (e.g., for a monitoring role).
- Keep `superuser_reserved_connections` at its default (3) or higher if you frequently need superuser access under load.
- On standby servers, set `max_connections` ≥ primary's `max_connections` to avoid replication or query rejection.
- Monitor for `FATAL: sorry, too many clients already` in logs — indicates `max_connections` exceeded.
- Remember that prepared statements, temp tables, and session-specific allocations add per-connection memory overhead.
- Use `ALTER SYSTEM SET` or `postgresql.conf` to change `max_connections`; requires a restart.
- Check `pg_settings` for current values: `SELECT name, setting FROM pg_settings WHERE name LIKE '%connections%';`

## Don't
- Don't set `max_connections` to an arbitrary high number (e.g., 10000) without considering memory overhead — each connection consumes resources even if idle.
- Don't assume that `max_connections` only limits application connections; it includes superuser, replication, and standby connections.
- Don't forget that changing `max_connections` requires a server restart — it cannot be reloaded.
- Don't set `reserved_connections` so high that it eats into the general pool unnecessarily; reserved slots are only used after the general pool is exhausted.
- Don't rely on the default `superuser_reserved_connections` (3) if you frequently run out of connections and need superuser access — consider increasing it.
- Don't set a standby's `max_connections` lower than the primary's; replication will fail or standby queries will be refused.
- Don't ignore connection leaks in application code — they consume slots until the backend terminates.
- Don't use `max_connections` as a throttling mechanism; use connection pooling or application-level rate limiting instead.
- Don't forget that autovacuum workers and background processes (e.g., logical replication consumers) also take connection slots.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| `FATAL: sorry, too many clients already` | `max_connections` exceeded | Increase `max_connections` or add connection pooling |
| Connection rejection despite available RAM | Forgot about reserved slots or standby restrictions | Check `pg_settings` for `max_connections`; ensure standby ≥ primary |
| Superuser cannot connect under load | No reserved superuser slots available | Increase `superuser_reserved_connections` |
| High memory usage despite low active connections | Many idle connections consuming memory | Implement connection pooling or enforce connection limits in app |
| Standby refusing replication connections | Standby `max_connections` < primary's | Align standby setting with primary |
| Inconsistent connection counts after restart | `max_connections` change not applied due to missing restart | Remember that `max_connections` requires a server restart |
| Connection spikes during autovacuum | Autovacuum workers consuming slots | Tune autovacuum parallelism or increase `max_connections` |