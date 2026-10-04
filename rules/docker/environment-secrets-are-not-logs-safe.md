---
title: "environment variables are not a safe place for a secret"
rule_id: "RULE-DOCKER-006"
category: "security"
scope: "infrastructure"
applies_to: "Docker Compose, secrets, env_file, environment, build secrets, Swarm portability"
last_updated: "2026-10-04"
source: "https://docs.docker.com/compose/how-tos/use-secrets.md"
---

# environment variables are not a safe place for a secret

Compose supports both mechanisms, and the difference is not primarily about storage — it is
about who can read the value after it lands. Access is explicit:

> Services can only access secrets when explicitly granted by a `secrets` attribute within the `services` top-level element.
> ([Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets.md))

The environment-variable problem is stated directly:

> Environment variables are often available to all processes, and it can be difficult to track access. They can also be printed in logs when debugging errors without your knowledge. Using secrets mitigates these risks.
> ([Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets.md))

## Why

The exposure model is a property of the mechanism, not a bug in the application. `docker
inspect` prints environment values in plaintext. Every child process inherits them. A crash
reporter that dumps the environment dumps the token. A framework that logs its resolved config
at startup logs the credential. A debugging `printenv` in a shell you `docker exec` into shows
it to whoever runs that next. None of those are bugs; each is the environment doing exactly
what an environment does.

Two portability constraints turn a mitigation into a surprise. Secrets are Linux-only:

> Secrets are supported on Linux containers only. Compose delivers each secret by bind-mounting a single file into the container, and Windows containers support bind-mounting directories only.
> ([Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets.md))

So a Compose file that works on Linux CI fails on a Windows developer machine, and the failure
is a missing file rather than a clear error. And the source choice splits too:

> The source of the secret is either `file` or `environment`.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/secrets.md))

> This is only supported by Docker Compose. It is not supported when deploying with [`docker stack deploy`](/engine/swarm/stack-deploy/).
> ([Compose file reference](https://docs.docker.com/reference/compose-file/secrets.md))

`secrets: [{environment: VAR}]` is Compose-only and simply unavailable under
`docker stack deploy`. A file that works locally and in CI fails at the Swarm deploy step —
the last step, on the deploy that matters.

At build time the equivalent keeps the value out of the image:

> This mount type allows the build container to access secret values, such as
> tokens or private keys, without baking them into the image.
> ([Dockerfile reference](https://docs.docker.com/reference/dockerfile.md))

## Do

- Use `secrets` with a per-service grant, and have the application read the mounted file path.
- Use `file:` as the secret source, so the same file works under Compose and Swarm.
- Use `RUN --mount=type=secret` for build-time credentials instead of `ARG`/`ENV`.
- Remember the `_FILE` convention is a convention, not a platform guarantee — the image must
  implement it. Official images like `postgres` and `mysql` do; your own image must.
- Audit `docker inspect` output in CI if any service still carries secrets in `environment`.

```yaml
# Correct — per-service grant, file-mounted, portable to Swarm
services:
  api:
    image: example/api
    environment:
      STRIPE_SECRET_KEY_FILE: /run/secrets/stripe_key
    secrets:
      - stripe_key
secrets:
  stripe_key:
    file: ./secrets/stripe_key.txt      # `environment:` breaks docker stack deploy
```

```dockerfile
# Correct — the token reaches the build without entering a layer
RUN --mount=type=secret,id=npm_token \
    npm ci --token="$(cat /run/secrets/npm_token)"
```

## Don't

- Don't put tokens, passwords, or API keys in `environment`. They land in `docker inspect`, in
  every child's environment, and in logs.
- Don't use `secrets: {environment: ...}` if you deploy with `docker stack deploy`. It is not
  supported there.
- Don't assume `secrets` works on Windows containers. It is Linux-only.
- Don't use `ARG` or `ENV` for build credentials. They persist in image layers; `--mount`
  does not.
- Don't assume the image honours `*_FILE` unless it implements it. Check the entrypoint.
- Don't treat "it's only in the dev environment" as the reason. Dev machines hold the most
  credentials, not the fewest.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Token visible in `docker inspect` | Secret in `environment` | `secrets` + `_FILE` |
| Token in a log or crash report | Environment dumped by a reporter | Same |
| Works on Linux, fails on Windows | Secrets are Linux-only | Document the constraint |
| Works locally, fails at `stack deploy` | `environment:` secret source | Use `file:` |
| Token found in image layers | `ARG`/`ENV` in the Dockerfile | `--mount=type=secret` |
| App ignores the mounted file | Image does not implement `*_FILE` | Read the path in the app |
| Secret exposed to every service | Granted at the wrong scope | Grant per service |

## Verifying

```bash
# Secrets still living in the environment
grep -rn --include='compose*.y*ml' -iE '(PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY|CREDENTIAL)\s*[:=]' .

# Top-level secret declarations and their sources
grep -rn --include='compose*.y*ml' -A4 '^secrets:' . | grep -E '(file|environment|external):'

# environment-source secrets, which break docker stack deploy
grep -rn --include='compose*.y*ml' -A3 '^secrets:' . | grep 'environment:'

# Build-time credentials that will enter an image layer
grep -rn --include='Dockerfile*' -iE '^\s*(ARG|ENV)\s+\w*(TOKEN|SECRET|PASSWORD|KEY)\b' .

# Whether an image honours the _FILE convention
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' <image> | grep '_FILE'
```

The first list is the whole surface and every hit needs the value moved. The third is the
portability trap — it is short, and it is the list that fails only at deploy time.

These greps cannot tell whether a mounted secret file is read or ignored. Confirm by running
the container and checking that the file path in `_FILE` exists and the application behaves
differently when the file is absent.