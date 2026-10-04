---
title: "Docker Compose — startup, readiness, and secret decisions"
category: "architecture"
scope: "infrastructure"
last_updated: "2026-10-04"
source: "https://docs.docker.com/compose/trust-model.md"
---

# Docker Compose — startup, readiness, and secret decisions

Three decisions account for most Compose defects that only appear on a cold start, on a
second machine, or in CI. In every one of them the shipped default is the permissive option.

This sits one level below `RULE-DOCKER-001` … `RULE-DOCKER-006`, which explain each mechanism.
This matrix is for choosing between them.

## The three questions

1. **What must be true before this service starts?** Not "started" — *ready*. That is
   `condition: service_healthy` plus a real `healthcheck` behind it. (`RULE-DOCKER-001`)
2. **What happens when it exits?** `restart_policy` defaults to `any`, with no delay and no
   attempt limit. (`RULE-DOCKER-003`)
3. **Where does the secret live?** Not `environment` — it is readable by `docker inspect`,
   every child process, and every log that dumps it. (`RULE-DOCKER-006`)

## The defaults, in one table

| Decision | Shipped default | The default's cost |
|---|---|---|
| `depends_on` short form | Order only | Migration races an initialising database |
| `depends_on` condition | None | No probe behind `service_healthy` |
| `healthcheck.start_period` | Unset | Slow init counted against `retries` |
| `environment: [KEY]` | Removed if unresolved | App runs on a default host |
| `environment` vs `env_file` | `environment` wins | Bare key deletes the `env_file` value |
| Unquoted `yes` / `no` | YAML boolean | Reaches the app as `"False"` |
| `${VAR}` | Empty string | Service starts without its config |
| `restart` | `no` | — |
| `deploy.restart_policy` | `any` | Crash loop, immediate, unlimited |
| `restart_policy.delay` | `0` | Hot loop fills the log |
| `restart_policy.max_attempts` | Unlimited | Never gives up |
| Undeclared networks | Implicit `default` | Every service reachable from every service |
| `deploy.resources.reservations` | Scheduling hint | Not isolation |
| Build cache | Off per `RUN` | Every layer re-runs |
| `USER 1000` (no gid) | May be group root | Scans pass, privileges do not |
| Image reference | Mutable tag | Content changes without a commit |
| Compose file | Trusted input | Reads outside the project directory |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Wait for a reachable DB | `condition: service_healthy` + `healthcheck` | Short `depends_on` | Starts against a booting DB |
| Survive slow first-boot init | `healthcheck.start_period` | Bare `retries` | Healthy DB marked unhealthy |
| Run a job once | `service_completed_successfully` | `depends_on` + `command` | Reruns on every `up` |
| Fail loudly on missing config | `${VAR:?message}` | `${VAR}` or a bare key | Empty string, service starts |
| Restart only on real errors | `restart_policy: {condition: on-failure, delay, max_attempts}` | The `any` default | Infinite crash loop |
| Reset the retry budget | `window` | `max_attempts` alone | Gives up after a slow day |
| Stop a restart loop | `max_attempts` + `delay` | `unless-stopped` | Never stops on its own |
| Bound memory or CPU | `limits` | `reservations` | Not a bound |
| Isolate the database | A second network | One `default` network | Everything talks to everything |
| Keep a token out of `inspect` | `secrets` + `_FILE` | `environment` | Leaks via inspect and logs |
| Deploy under Swarm too | `secrets: {file: ...}` | `{environment: ...}` | Fails only at `stack deploy` |
| Build without baking a token | `RUN --mount=type=secret` | `ARG` / `ENV` | Token in an image layer |
| Speed up repeat builds | `RUN --mount=type=cache` | Re-running `apt-get update` | Full rebuild every time |
| Run as non-root | `USER uid:gid`, created in-image | `USER 1000` alone | Group root |
| Make a reference stable | Digest | Tag | Content changes under you |
| Review a Compose file | `docker compose config` | Reading the YAML | Nested `include` unseen |
| Know a service is failing | `RestartCount` | `docker ps` state | Currently up, has failed 40k times |

## The pattern shared by most of these rows

Nine rows above have the same shape, and it is the same shape found in the Node.js and C++
rounds: **the default is documented, correct, and silently not what the author assumed.**

- `depends_on` guarantees *started*, which reads as *ready*.
- `restart_policy` defaults to `any`, inside a block that reads as Swarm-only.
- `environment: [KEY]` removes the variable, which reads as inheriting it.
- `${VAR}` substitutes empty, which reads as inheriting the shell's value.
- `USER 1000` may mean group root, which reads as non-root.
- The implicit `default` network joins every service, which reads as isolated.

In each case the tool is correct and the author's model of the tool is the thing that is wrong.
The question worth asking of a Compose file is not "did I set the flag" but **"what does this
file do that I did not write down"** — which is exactly what `docker compose config` answers and
exactly what reading the YAML does not.

## The one command that answers most of it

```bash
docker compose config
```

Docker's own guidance is to inspect the fully resolved configuration — every `include`, every
`extends`, every merged override, every interpolated variable — before running `up` or
`create`, and to treat any update to a pinned digest as a code change.

Two habits follow from it, and both are cheap:

- **In CI**, run `docker compose config` and fail the build if the resolved output contains a
  field from Docker's own watch list: `privileged`, `cap_add`, `network_mode: host`,
  `pid: host`, `devices`, or `provider`.
- **Locally**, run it before the first `up` of anything you did not write, which is the only
  moment the resolved output is not what you expected.

## Sources

- [Compose file reference — services](https://docs.docker.com/reference/compose-file/services.md)
- [Compose Deploy Specification](https://docs.docker.com/reference/compose-file/deploy.md)
- [Compose file reference — secrets](https://docs.docker.com/reference/compose-file/secrets.md)
- [Compose file reference — networks](https://docs.docker.com/reference/compose-file/networks.md)
- [Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets.md)
- [Trust model for Compose files](https://docs.docker.com/compose/trust-model.md)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile.md)

## Version note

Written against the current Docker documentation, which reflects the **Compose Specification**
(Compose v2, replacing the legacy 2.x and 3.x formats). Several defaults are version-gated and
name the version that introduced them: `depends_on.restart` in 2.17.0, `depends_on.required`
in 2.20.0. `deploy.restart_policy.window` and `depends_on.condition` behaviour differ between
the Compose CLI and `docker stack deploy`, so a file verified under one is not automatically
verified under the other — test both paths if you use both.