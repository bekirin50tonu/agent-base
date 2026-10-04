---
title: "deploy.restart_policy defaults to any while restart defaults to no"
rule_id: "RULE-DOCKER-003"
category: "correctness"
scope: "infrastructure"
applies_to: "Docker Compose, restart, deploy.restart_policy, crash loops, max_attempts, delay"
last_updated: "2026-10-04"
source: "https://docs.docker.com/reference/compose-file/deploy.md"
---

# deploy.restart_policy defaults to any while restart defaults to no

Compose has two restart directives with opposite defaults. The service-level one:

> - `no`: The default restart policy. It does not restart the container under any circumstances.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

The deploy-level one:

> - `any` (default), containers are restarted regardless of the exit status.
> ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md))

And which one applies is documented only for the unset case:

> `restart_policy` configures if and how to restart containers when they exit. If `restart_policy` is not set, Compose considers the `restart` field set by the service configuration.
> ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md))

## Why

`deploy:` is widely read as the Swarm/Kubernetes block — the part that does nothing under
plain `docker compose up`. It is not inert. The usual reason to add it is resource limits,
which is good practice, and then any `restart_policy` written "just to document intent"
inherits `any`.

So a container that exits cleanly on a bad config is restarted immediately, forever. A
container that exits because a migration was already applied is restarted. A container that
exits 0 on a one-shot job that already ran is restarted, which is what turns
`service_completed_successfully` into an infinite loop.

The retry bound is not there either:

> - `max_attempts`: The maximum number of failed restart attempts allowed before giving up. (Default: unlimited retries.)
> ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md))

And the delay defaults to zero, so an unlimited-restart loop is a *hot* loop. The observable
symptom is not "the service is down" — it's a container that has restarted forty thousand
times, filling the disk with log output, with the original error long buried.

`unless-stopped` does not solve this. It is the one people reach for, and it differs from
`always` only in the deliberate-stop direction:

> - `unless-stopped`: The policy restarts the container irrespective of the exit code but stops
>   restarting when the service is stopped or removed.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

A crash-looping container under `unless-stopped` never stops, because nobody stopped it.

## Do

- Set `restart: "no"` explicitly on any service where a clean exit is meaningful.
- Use `restart_policy` with `condition: on-failure`, a `delay`, and a `max_attempts`.
- Add `window` so the attempt count resets after sustained uptime — otherwise a service that
  crashes once a day exhausts its budget and stays down.
- Watch the count, not just the state: a container with a high restart count is a failing
  service even when it is currently up.
- Remember `limits` is a bound and `reservations` is a scheduling hint:

> - `limits`: The platform must prevent the container from allocating more resources.
> ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md))

> - `reservations`: The platform must guarantee the container can allocate at least the configured amount.
> ([Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md))

```yaml
# Correct — bounded, backed off, only on a real error
services:
  worker:
    build: .
    restart: "no"
    deploy:
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
      resources:
        limits: { cpus: '1', memory: 512M }
        reservations: { cpus: '0.25', memory: 128M }
```

## Don't

- Don't add a `deploy:` block for limits and assume the restart behaviour stayed at `no`. It
  did not.
- Don't use `unless-stopped` as a crash-loop remedy. It stops on a deliberate stop, not on
  repeated failure.
- Don't leave `max_attempts` unset on anything that can fail. Unlimited is the default.
- Don't leave `delay` at 0 on a service that can fail fast. The loop becomes a busy loop.
- Don't use `reservations` as a memory bound. Only `limits` prevents allocation.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Container restarts forever on a clean exit | `restart_policy` defaults to `any` | `condition: on-failure` |
| Disk fills with log output | Hot loop, `delay` is 0, `max_attempts` unlimited | Set both |
| One-shot job runs repeatedly | Restarted after clean completion | `restart: "no"` on that service |
| Service gave up and stayed down | `max_attempts` exhausted, no `window` | Add `window` |
| Container killed, host fine | `reservations` mistaken for a bound | Use `limits` |
| Only under Swarm/K8s deploys | Plain Compose run ignores `deploy` intent | Test both paths |

## Verifying

```bash
# Every restart_policy in the project
grep -rn --include='compose*.y*ml' -A8 'restart_policy:' .

# The condition actually chosen, where one is set
grep -rn --include='compose*.y*ml' -E 'condition:\s*(any|on-failure|none)' .

# One-shot services that will be restarted after completing
grep -rn --include='compose*.y*ml' -B2 -A8 'service_completed_successfully' .

# restart_policy present without a bound
grep -rn --include='compose*.y*ml' -A8 'restart_policy:' . | grep -L 'max_attempts' || true
```

The last check is the practical one: any `restart_policy` block with no `max_attempts` in the
following lines is an unbounded loop.

These greps cannot tell what the container actually does on exit. Confirm at runtime:
`docker inspect --format '{{.RestartCount}}' <container>` after the stack has been up for a
while — a count above a handful means the loop is running, whatever `docker ps` reports.