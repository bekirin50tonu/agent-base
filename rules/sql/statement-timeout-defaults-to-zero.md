---
title: "Statement Timeout Defaults to Zero"
rule_id: "RULE-SQL-002"
category: "performance"
scope: "all"
applies_to: "PostgreSQL"
last_updated: "2026-09-30"
source: "https://www.postgresql.org/docs/current/runtime-config-client.html"
---

# Statement Timeout Defaults to Zero

In PostgreSQL, the `statement_timeout` (along with `lock_timeout`, `transaction_timeout`, and `idle_in_transaction_session_timeout`) defaults to zero, which disables the timeout. Setting a timeout without understanding the default can lead to long-running queries that consume resources or block others.

## Why

Many developers assume that timeouts are enabled by default or set to a safe value. In PostgreSQL, a value of zero means the timeout is disabled. Relying on the default can cause queries to run indefinitely, leading to connection exhaustion, locked tables, or degraded performance.

## Do

- Explicitly set an appropriate timeout value in your application or session based on your SLA.
- Use `ALTER DATABASE ... SET statement_timeout = ...` to set a default for a database.
- Monitor for queries that exceed expected duration and adjust timeouts accordingly.
- Consider setting `lock_timeout` lower than `statement_timeout` to avoid waiting for locks when the statement timeout would fire first.

## Don't

- Assume the timeout is enabled by default.
- Set `lock_timeout` to the same or higher value than `statement_timeout` without reason, as the statement timeout will always trigger first.
- Forget to apply timeouts in connection pools or application initialization code.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Queries run for hours or days, consuming CPU and memory | `statement_timeout` is zero (disabled) | Set a non-zero timeout value appropriate for your workload |
| Applications experience connection leaks or exhaustion | Long-running queries hold connections open | Implement query timeouts and monitor connection usage |
| Lock contention worsens because queries wait indefinitely | `lock_timeout` is zero, allowing queries to wait for locks | Set `lock_timeout` to a value lower than `statement_timeout` |

## Verifying

- Check the current value with `SHOW statement_timeout;`; it should return `0` if not set.
- Set a timeout and verify it cancels a long-running query: `SET statement_timeout = '5s'; SELECT pg_sleep(10);` should cancel after 5 seconds.
- Review your application's connection initialization code to ensure timeouts are set.