---
title: "Compose does not confine reads to the project directory"
rule_id: "RULE-DOCKER-004"
category: "security"
scope: "infrastructure"
applies_to: "Docker Compose, include, extends, bind mounts, provider, tag mutability, supply chain"
last_updated: "2026-10-04"
source: "https://docs.docker.com/compose/trust-model.md"
---

# Compose does not confine reads to the project directory

Docker publishes an explicit trust model, and it is blunt:

> Docker Compose treats every Compose file as trusted input. When a Compose file
> requests elevated privileges, host filesystem access, or any other
> configuration, Compose applies it as written.
> ([Trust model for Compose files](https://docs.docker.com/compose/trust-model.md))

There is no sandbox at the Compose-file level, and reads are not confined:

> Compose does not confine reads to the project directory. Treat a Compose project as
> code you run, not data you inspect.
> ([Trust model for Compose files](https://docs.docker.com/compose/trust-model.md))

## Why

"Data you inspect" is the mental model almost everyone brings to a YAML file in a pull
request. The file is in the repo, the repo was reviewed, so the file is understood. Docker's
own framing inverts that: the unit of trust is the author, and the file is code you *run*.

Concretely, a reviewed file can read `~/.ssh`, `~/.aws/credentials`, a `.env` one directory up,
or an entire `file:` secret path outside the checkout — and those reads can surface in
`docker compose config` output *before any container starts*. `provider` is the sharpest edge
of the set: it runs a host binary, outside any container, on `up`, `down`, and `stop`.

The composed case is worse, because the reviewed file is not the whole file:

> Each level has the same capabilities. The top-level file you inspect may appear
> safe while a nested `include` or `extends` introduces services with elevated
> privileges, host bind mounts, or untrusted images.
> ([Trust model for Compose files](https://docs.docker.com/compose/trust-model.md))

> Risky settings can be introduced by a nested dependency that you never
> see unless you inspect the fully resolved output.
> ([Trust model for Compose files](https://docs.docker.com/compose/trust-model.md))

`include` and `extends` both accept remote references and both chain, so a compose file can
resolve at `up` time to a different file than the one in the pull request. And the reference
itself is mutable:

> Tags are mutable, meaning anyone with push access to a registry can overwrite a tag silently, so a reference you reviewed last week may point to different content today.
> ([Trust model for Compose files](https://docs.docker.com/compose/trust-model.md))

This applies to `image:` independently of any `include`. A tag is not a version.

## Do

- Review `docker compose config`, never the YAML alone. That is the resolved output, with
  every `include`, `extends`, override, and interpolation applied.
- Pin every remote reference — `include`, `extends`, and `image` — to a digest.
- Treat a digest update as a code change requiring the same review as any other.
- Audit the transitive chain: every `include` and `extends` in the resolved output, not just
  the top-level file.
- Host OCI artifacts on a registry you control, and restrict who can push to it.
- Read the confirmation prompts when a remote Compose file requests interpolation variables or
  environment values.
- In CI, avoid unverified Compose configurations and use read-only Docker socket mounts where
  possible.

```yaml
# Correct — immutable references, reviewable as a code change
include:
  - oci://registry.example.com/base@sha256:a1b2c3d4...

services:
  app:
    image: example/app@sha256:9f8e7d6c...
    extends:
      file: oci://registry.example.com/templates@sha256:11223344...
      service: webapp
```

## Don't

- Don't review a Compose file without reading `docker compose config`. The YAML is an input,
  not the configuration.
- Don't accept a `:latest` or a version tag for a base image, an included file, or an
  extended template in anything you intend to run.
- Don't audit only the top-level file. Nested levels carry the same privileges.
- Don't run a Compose file from an untrusted source on a machine holding credentials, a
  cloud token, or the Docker socket — that combination is the documented CI risk.
- Don't assume a path inside the project stays inside the project. It does not.
- Don't treat "it only sets a config value" as low risk. `privileged`, `cap_add`,
  `network_mode: host`, `pid: host`, and `provider` are all one line each.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Compose file reads outside the checkout | Reads are not confined to the project directory | Audit resolved config |
| Reviewed file behaves differently in CI | Remote `include`/`extends` resolved differently | Pin to digest |
| Image content changed without a commit | Tag is mutable | Pin to digest |
| Privilege escalation from a "safe" file | Nested dependency introduced it | Audit the transitive chain |
| Credentials leak via `config` output | `env_file`/`secrets` outside the project | Narrow the paths |
| Host binary runs during `up` | `provider` field | Remove it or review the binary |
| CI compromise from a fork PR | Unverified config with socket access | Gate and use read-only socket |

## Verifying

```bash
# The high-risk fields, in every compose file
grep -rn --include='compose*.y*ml' -E '^\s*(privileged|cap_add|network_mode|pid|ipc|devices|provider):' .

# Reads that leave the project directory
grep -rn --include='compose*.y*ml' -E '(file:\s*\.\./|file:\s*~/|:\s*~/|\.\./\.\./)' .

# Remote references, which need digest pinning
grep -rn --include='compose*.y*ml' -E '(include:|extends:|image:).*(oci://|https://|:latest|:[0-9]+\.[0-9]+$)' .

# Docker socket mounts
grep -rn --include='compose*.y*ml' '/var/run/docker.sock' .
```

The third list is the one that catches the supply-chain shape: any remote reference without
`@sha256:` is a mutable dependency that will change without a commit.

These greps cannot resolve what the file actually does at run time. Confirm with
`docker compose config` and read the resolved output — that is what Docker itself tells you to
review before running `up` or `create`.