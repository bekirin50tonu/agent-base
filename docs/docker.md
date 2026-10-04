---
language: "Docker"
tag: "docker"
ecosystem: "infrastructure"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Docker Compose, Dockerfile, and image-supply-chain assets."
---

# Documentation Hub: Docker

> **Agent Directive (Phase 4)**: Inspect the target project for `compose*.y*ml`, `Dockerfile*`,
> `*.dockerfile`, and CI workflow files, then grep for `depends_on:`, `healthcheck:`,
> `restart`, `restart_policy:`, `environment:`, `env_file:`, `secrets:`, `USER `,
> `privileged`, `network_mode:`, `include:`, `extends:`, `deploy:`, and any `image:` line
> without a `@sha256:` digest. Match the conditions below to determine which `rules`, `skills`,
> `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the places where Compose's and the Docker builder's defaults are
> documented, correct, and silently not what the author assumed — startup ordering, variable
> resolution, restart behaviour, the Compose trust model, non-root identity, and secret
> placement. No `skills` yet.
>
> **Version note**: written against the current Docker documentation, which reflects the
> **Compose Specification** (Compose v2, replacing the legacy 2.x and 3.x formats). Some
> defaults are version-gated and name the version that introduced them — `depends_on.restart`
> in 2.17.0, `depends_on.required` in 2.20.0. `deploy.restart_policy.window` and
> `depends_on.condition` behave differently under the Compose CLI than under
> `docker stack deploy`, and `secrets: {environment: ...}` is unsupported under Swarm entirely,
> so a file verified under one path is not automatically verified under the other. There is a
> separate `docs/kubernetes.md` hub; this one covers Compose and the builder, and the two
> overlap only on `resources` and restart semantics.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/docker/depends-on-short-syntax-starts-but-does-not-wait.md`
  - **Why**: With the short syntax, "Compose does not wait for dependency services to be
    \"healthy\" before starting a dependent service" — it only guarantees they "have been
    started". A service that boots as soon as the database process exists, rather than when
    the database accepts connections, passes every warm-start run and fails on a fresh volume,
    a CI container, or the deploy nobody watches. `service_healthy` is only as good as the
    `healthcheck` behind it, and `start_period` is what keeps slow initialisation from
    consuming the retry budget.
  - **When**: Target project has a `compose*.y*ml` using the short `depends_on:` list form, or
    has a migration, seeding, or one-shot job service with no `condition:` on its dependency.
  - **Target Location**: `docs/rules/depends-on-short-syntax-starts-but-does-not-wait.md`

- **Path**: `rules/docker/unset-environment-variables-are-removed-not-ignored.md`
  - **Why**: Compose "rely[ies] on you to resolve the value" for a bare key, and "if the value
    is not resolved, the variable is unset and is removed from the service container
    environment" — so the three outcomes are *inherited*, *your value*, or *absent*, and the
    third reads as the first. With `environment` taking precedence over `env_file`, a bare key
    also deletes the value the file supplied. And unquoted `yes` / `no` are YAML booleans, so
    a flag reaches the application as the string `"False"`.
  - **When**: Target project uses `${VAR}`, a bare key under `environment:`, or
    `env_file` plus `environment` on the same service.
  - **Target Location**: `docs/rules/unset-environment-variables-are-removed-not-ignored.md`

- **Path**: `rules/docker/restart-policy-defaults-to-any-under-deploy.md`
  - **Why**: Two restart directives with opposite defaults. `restart` is "`no`: The default
    restart policy. It does not restart the container under any circumstances", while
    `deploy.restart_policy` is "`any` (default), containers are restarted regardless of the
    exit status" — and `deploy:` is widely read as the Swarm-only block that does nothing
    under plain Compose. The usual reason to add it is `limits`, so the restart behaviour
    changes as a side effect of unrelated good practice. `max_attempts` defaults to unlimited
    and `delay` to zero, making a crash loop a *hot* loop; `unless-stopped` does not help,
    because it stops on a deliberate stop, not on repeated failure.
  - **When**: Target project has a `deploy:` block, any `restart:` or `restart_policy:`, or a
    container whose `RestartCount` is far above zero.
  - **Target Location**: `docs/rules/restart-policy-defaults-to-any-under-deploy.md`

- **Path**: `rules/docker/compose-does-not-confine-reads-to-the-project-directory.md`
  - **Why**: Docker states the model outright — "Docker Compose treats every Compose file as
    trusted input", "Compose does not confine reads to the project directory", and "Treat a
    Compose project as code you run, not data you inspect". Nested levels carry the same
    capabilities: "the top-level file you inspect may appear safe while a nested `include` or
    `extends` introduces services with elevated privileges". And the reference itself is
    mutable — "anyone with push access to a registry can overwrite a tag silently".
  - **When**: Target project uses `include:`, `extends:`, `provider:`, `privileged`,
    `cap_add:`, `network_mode: host`, `/var/run/docker.sock`, or any `image:` reference without
    an `@sha256:` digest.
  - **Target Location**: `docs/rules/compose-does-not-confine-reads-to-the-project-directory.md`

- **Path**: `rules/docker/user-instruction-replaces-group-membership.md`
  - **Why**: Naming a group *replaces* the membership set — the user "will have _only_ the
    specified group membership. Any other configured group memberships will be ignored" — so
    one hardening line silently drops group access. Worse, `USER 1000` with no gid on an
    account with no primary group runs with "the `root` group", and every check that would
    catch it inspects uid, sees 1000, and passes.
  - **When**: Target project has a `Dockerfile*` with `USER` but no explicit `uid:gid` pair,
    or no `useradd`/`adduser` creating the account in-image.
  - **Target Location**: `docs/rules/user-instruction-replaces-group-membership.md`

- **Path**: `rules/docker/environment-secrets-are-not-logs-safe.md`
  - **Why**: Access to a secret is explicit — services "can only access secrets when explicitly
    granted" — whereas environment variables "are often available to all processes", are
    "printed in logs when debugging errors without your knowledge", and appear in plaintext in
    `docker inspect`. The exposure model is a property of the mechanism, not an application
    bug. Two portability traps follow: secrets are "supported on Linux containers only", and
    a `secrets: {environment: ...}` source "is not supported when deploying with
    `docker stack deploy`" — which fails at the last step, on the deploy that matters.
  - **When**: Target project has passwords, tokens, or keys under `environment:`, `env_file:`,
    `ARG`, or `ENV` in a `Dockerfile*`; or grants `secrets` at the wrong scope.
  - **Target Location**: `docs/rules/environment-secrets-are-not-logs-safe.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/docker/agent.json`
  - **Why**: Helps with Docker and Docker Compose-related tasks, such as waiting for a service to
    be ready rather than merely started, understanding why an unresolved environment variable
    removes the variable instead of inheriting it, bounding a restart loop instead of leaving
    deploy.restart_policy at any, reviewing a Compose file's resolved output instead of its
    YAML, running as a real non-root uid:gid pair, and keeping secrets out of environment
    variables and image layers.
  - **When**: Target project ships a container — has a `Dockerfile*`, a `compose*.y*ml`, or a CI
    workflow that builds or runs an image.
  - **Target Location**: `docs/agents/docker/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/docker/compose-startup-readiness-and-secret-decisions.md`
  - **Why**: Three questions decide most Compose defects that only appear on a cold start, a
    second machine, or in CI — what must be true before this service starts, what happens when
    it exits, and where the secret lives — and in all three the shipped default is the
    permissive option. The matrix names each default *and* its cost, because the recurring
    shape is the one from the Node.js and C++ rounds: the tool is correct and the author's model
    of the tool is what is wrong. `docker compose config` answers most of it; reading the YAML
    does not.
  - **When**: Target project has more than one service, runs migrations or seeding on startup,
    uses resource limits, or ships any credential to a container.
  - **Target Location**: `docs/docker/compose-startup-readiness-and-secret-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.