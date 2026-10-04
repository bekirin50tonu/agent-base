---
title: "depends_on short syntax starts but does not wait"
rule_id: "RULE-DOCKER-001"
category: "correctness"
scope: "infrastructure"
applies_to: "Docker Compose, depends_on, healthcheck, service_healthy, startup ordering, migrations"
last_updated: "2026-10-04"
source: "https://docs.docker.com/reference/compose-file/services.md"
---

# depends_on short syntax starts but does not wait

Compose's short `depends_on` form is a startup *order* directive, not a readiness gate:

> With short syntax, Compose does not wait for dependency services to be "healthy" before
> starting a dependent service.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

The guarantee it does make is only about process state:

> Compose guarantees dependency services have been started before
> starting a dependent service.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

"Started" means the container process exists. A PostgreSQL container is started the instant
`docker-entrypoint.sh` execs — before initdb finishes, before the socket listens, before the
first connection is accepted.

## Why

The failure lands on cold starts and nowhere else. On a warm volume the database accepts
connections in milliseconds; on a fresh volume it initialises for tens of seconds. Same file,
same machines, different behaviour, and the difference is whether the volume was populated.

That makes it a bad bug to have. It passes in every developer's environment after the first
run, it passes in CI after the cache is warm, and it fails on the deploy that creates a new
volume — which is the one nobody is watching.

There is a second half. `condition: service_healthy` requires a `healthcheck` on the
dependency. Written without one, the condition has nothing to wait on, and the failure is the
same race wearing a more convincing hat: the file *says* it waits for health.

## Do

- Use the long form with `condition: service_healthy` for anything that must be reachable.
- Declare the `healthcheck` on the dependency in the same edit that adds the condition.
- Set `start_period` generously on slow first-boot init — failures during that window should
  not count against `retries`.
- Use `condition: service_completed_successfully` for one-shot jobs (migrations, seeding).
- Keep `command:` for the long-running process. A migration chained with `&&` reruns on every
  `up`.

```yaml
# Correct — a real readiness gate, with a probe behind it
services:
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
    command: gunicorn api:app
  db:
    image: postgres:18
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s

  migrate:
    build: .
    depends_on:
      db:
        condition: service_healthy
    command: alembic upgrade head
    restart: "no"
```

## Don't

- Don't put `depends_on: [db]` in front of a migration or a connection check. That is the
  race, written down.
- Don't write `condition: service_healthy` without a `healthcheck` on the target service.
- Don't omit `start_period` when initialisation is slow — the probe fails during normal startup
  and the service gets marked unhealthy before it is ever ready.
- Don't assume an exit code means the migration finished. The container is "started" as soon
  as it execs.
- Don't fix a flaky cold start by adding a `sleep` to the dependent service. That trades a
  correctness bug for a slower one that still fails on a slower disk.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Migration fails only on a fresh volume | Short `depends_on` is order only | `condition: service_healthy` |
| `ECONNREFUSED` on first request after deploy | App started before the DB accepted connections | Same, plus `start_period` |
| Healthy service reported unhealthy | Slow init counted against `retries` | Raise `start_period` |
| Migration reruns on every `up` | Migration chained to the app's `command` | Separate one-shot service |
| Passes locally, fails in CI | CI cache warms the volume | Test with an empty volume |
| Depends on a service that never becomes healthy | `service_healthy` with no `healthcheck` | Declare the probe |

## Verifying

```bash
# Short-form depends_on, the order-only form
grep -rn --include='compose*.y*ml' -A5 'depends_on:' . | grep -E '^\s*-\s'

# Long-form conditions
grep -rn --include='compose*.y*ml' -E 'condition:\s*(service_healthy|service_started|service_completed_successfully)' .

# Services with a condition but no healthcheck of their own
for s in $(grep -rl --include='compose*.y*ml' 'condition:' .); do
  echo "--- $s"; grep -c 'healthcheck:' "$s"
done

# Chains that run a migration and then the server
grep -rn --include='compose*.y*ml' -E 'command:.*(&&|;).*(migrate|upgrade|seed)' .
```

The third check is the one that finds the silent half: a service that is depended upon with
`service_healthy` but declares no `healthcheck` anywhere in the file.

These greps cannot tell whether a probe is *correct* — that depends on what the service is.
Confirm by timing the dependency: bring the stack up on an empty volume and watch whether the
dependent service starts before or after the database accepts its first connection.