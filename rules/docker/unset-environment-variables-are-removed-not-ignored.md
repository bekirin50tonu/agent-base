---
title: "unset environment variables are removed, not inherited"
rule_id: "RULE-DOCKER-002"
category: "correctness"
scope: "infrastructure"
applies_to: "Docker Compose, environment, env_file, variable interpolation, YAML booleans"
last_updated: "2026-10-04"
source: "https://docs.docker.com/reference/compose-file/services.md"
---

# unset environment variables are removed, not inherited

Compose allows a bare key in `environment` — no value, no `=`. The consequence of the value not
being resolved is silent removal:

> Environment variables can be declared by a single key (no value to equals sign). In this case Compose
> relies on you to resolve the value. If the value is not resolved, the variable
> is unset and is removed from the service container environment.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

The three outcomes of `environment: [DATABASE_URL]` are **inherited**, **your value**, and
**absent** — not "inherited", "defaulted", "empty".

## Why

An application that reads a missing variable behaves in whatever way it happens to behave
without one. For most ORMs that is a connection attempt to a compiled-in default host, and for
a good number it is a *successful* connection to the wrong database. Nothing raises, nothing
logs, and the record written is the record you wanted — in the wrong place.

The precedence rule makes this worse, because it reads in the safe direction:

> When both `env_file` and `environment` are set for a service, values set by `environment` have precedence.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

`environment` wins — and then, if the key is bare and unresolved, it *removes* the variable.
An override meant to be conditional in one environment silently deletes the `env_file` value in
another. The base file says the variable is set. It isn't.

The third trap is typing, documented in the same section:

> Any boolean values; true, false, yes, no, should be enclosed in quotes to ensure
> they are not converted to True or False by the YAML parser.
> ([Compose file reference](https://docs.docker.com/reference/compose-file/services.md))

Unquoted `FEATURE_FLAG: no` parses as the boolean `False`, which reaches the application as
the string `"False"` — not `"no"`, not `"false"`, not `""`. A feature gate comparing against
`"false"` is now **on**, which is the opposite of what the file says.

## Do

- Give every variable an explicit value. A bare key is only correct when host passthrough is
  genuinely the intent.
- Use `${VAR:?message}` for anything the service cannot start without — it converts a silent
  default into a startup error.
- Quote every boolean-looking value: `SHOW: "true"`, `FEATURE: "no"`.
- Keep non-secret configuration in `env_file` and secrets out of both (see
  `RULE-DOCKER-006`).
- Assert on the resolved environment in CI rather than on the source file.

```yaml
# Correct — explicit values, required ones enforced, booleans quoted
services:
  api:
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/app
      LOG_LEVEL: ${LOG_LEVEL:?LOG_LEVEL must be set}
      FEATURE_FLAG: "no"
```

## Don't

- Don't use a bare key as a "pass it through if present" idiom. It removes the variable when
  it isn't.
- Don't use `${VAR}` for anything required. It substitutes an empty string, and the
  application starts.
- Don't leave booleans unquoted. YAML 1.1 reads `no`, `yes`, `on`, and `off` as booleans.
- Don't layer `environment` over `env_file` and assume the `env_file` is a fallback. The
  override wins even when it resolves to nothing.
- Don't validate configuration by reading the Compose file. Validate
  `docker compose config`, which is what Compose actually applies.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| App connects to the wrong host | Bare key removed the variable | Give it an explicit value |
| Variable missing despite `env_file` | `environment` override wins, then removes | Remove the bare key |
| Env var is `"False"` | Unquoted YAML boolean | Quote it |
| Feature flag inverted | `"False" != "false"` comparison | Quote and normalise |
| Production-only misconfiguration | Host has the var, CI does not | `${VAR:?message}` |
| `env_file` changes have no effect | Overridden by `environment` | Check precedence |

## Verifying

```bash
# Bare keys in environment, the removal form
grep -rn --include='compose*.y*ml' -A30 '^ *environment:' . \
  | grep -E '^\s*-\s*[A-Z_][A-Z0-9_]*\s*$'

# Unquoted booleans anywhere in a compose file
grep -rn --include='compose*.y*ml' -E ':\s*(yes|no|true|false|on|off)\s*$' .

# Interpolation without a required-value guard
grep -rn --include='compose*.y*ml' -E '\$\{[A-Z_][A-Z0-9_]*\}' . | grep -v ':?'

# Both layers present, so precedence applies
grep -rl --include='compose*.y*ml' 'env_file' . | xargs grep -ln 'environment' 2>/dev/null
```

The first list is the whole defect surface. The fourth is a priority list: wherever both
appear, `environment` silently wins over the file someone edited.

These greps cannot tell what the variables actually resolve to. Confirm with
`docker compose config`, which prints the fully interpolated environment — that output, not the
YAML, is what the container receives.