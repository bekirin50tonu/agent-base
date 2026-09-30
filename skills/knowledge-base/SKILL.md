---
name: knowledge-base
description: "Analyze a target repository's dependencies and inject matching rules, skills, agents, and shared assets from this knowledge base. Use when setting up a new project, auditing an existing one against best practices, or when asked what standards apply to a stack."
version: "1.0.0"
phase: 4
---

# Skill: `knowledge-base`

Inject this repository's assets into a target project. The target is **read** to decide what to
pull, never modified except by the asset files themselves.

This is Phase 4 of the orchestrator described in `CLAUDE.md`. It is the distribution
mechanism: everything under `rules/`, `skills/`, `agents/`, and `shared/` ships here, and
consumers fetch only what their project actually needs.

## 1. Resolve the base URL

Asset sources are raw file URLs on this repo. **This is the single source of truth for the
slug** — change it here and nowhere else:

```bash
RAW="https://raw.githubusercontent.com/bekirin50tonu/agent-base/main"
```

The literal is correct as written and must not be invented around. A local clone of the
sibling **private** research repo also carries this value in `.config/search.json`, but that
file is not part of this repo and will not exist in a fresh clone — so do not make the
`jq` read a dependency. Never write a different slug.

The `agentbase` CLI derives the same URL from its own `package.json` `repository.url`. If the
two ever disagree, this section wins and `node scripts/check-manifests.mjs` fails.

## 2. Scan the target project

Determine the ecosystem from files that already exist. Do not ask the user what they use — read it:

| File | Ecosystem | Trigger Conditions |
|---|---|---|
| `pom.xml`, `build.gradle`, `build.gradle.kts` | Java | `spring-boot-starter-*` veya `org.springframework.boot` Gradle plugin |
| `docker-compose.yml`, `docker-compose.override.yml` | Backend Architecture | Herhangi bir Docker Compose dosyası |
| `*.k8s.yaml`, `*.k8s.yml`, `kustomization.yaml` | Backend Architecture | Kubernetes manifest veya Kustomization dosyası |
| `*.broker.yaml`, `*.broker.yml`, `rabbitmq.conf`, `kafka.properties` | Backend Architecture | Message broker yapılandırma dosyaları |
| `services/` veya `apps/` dizini var | Backend Architecture | Mikroservis veya modüler monolit yapısı gösteren dizin yapısı |
| `package.json` | MCP | `@modelcontextprotocol/sdk` veya `@modelcontextprotocol/spec` bağımlılığı |
| `*.mcp.json` | MCP | MCP konfigürasyon dosyası |
| `pyproject.toml`, `requirements.txt` | Python MCP | `mcp` veya `modelcontextprotocol` paketi |
| `*.csproj`, `*.sln` | .NET MCP | `ModelContextProtocol` veya `Mcp.Sdk` paket referansı |
| `go.mod` | Go MCP | `github.com/modelcontextprotocol/modelcontextprotocol-go` |

For each row, if the file exists and the trigger condition holds, then the ecosystem is matched.

A project can match multiple ecosystems (e.g., having both a Docker Compose file and a package.json would match both Backend Architecture and MCP).

### Cross-cutting hubs

Three hubs resolve from **no dependency file at all**, so the table above will never surface
them. Check them explicitly, alongside whichever language hub the project matched:

| Hub | Evaluate when |
|---|---|
| `docs/backend-architecture.md` | `docker-compose.yml` declares two or more app services, `kustomization.yaml` or a `*.k8s.yaml` manifest set exists, `services/` or `apps/` is a top-level directory, a broker config is present (`kafka.properties`, `rabbitmq.conf`, `*broker*.yml`), or `temporal` / `restate` / `dbos` appears in any manifest |
| `docs/mcp.md` | `mcp` / `modelcontextprotocol` / `@modelcontextprotocol/sdk` appears in a manifest, or a `.mcp.json` file exists |
| `docs/authentication.md` | `jwt` / `jose` / `paseto` / `PyJWT` / `python-jose` / `golang-jwt` / `jsonwebtoken` / `System.IdentityModel.Tokens.Jwt` appears in a manifest, a `jwks.json` or `.well-known/openid-configuration` file is in the tree, or the project has a `login` / `auth` / `session` route module |

All three are language-agnostic: a project can match them together with its language hub. Judge
each entry on its own *When*. The authentication hub's two rules point in opposite directions —
the verifier rule to a service that *checks* tokens, the storage rule to a project with a browser
login — so a backend-only service takes one and a full-stack app takes both.

## 3. Fetch the matching manifest

```bash
curl -s "$RAW/docs/react.md" | sed -n '/<!-- ASSET_MANIFEST_START -->/,/<!-- ASSET_MANIFEST_END -->/p'
```

Fetch only the manifest block. The hub pages carry human-readable prose that wastes context
and does not affect the decision.

## 4. Evaluate trigger conditions

Each manifest entry declares **Why** and **When**. Inject an asset only when its *When*
condition holds against what step 2 found. `When` is a testable statement about the target
repo — "target project uses Next.js", "`pnpm-workspace.yaml` exists" — not a suggestion.

Skip silently when a condition does not hold. Do not inject an asset "just in case" — an
unused rule file is noise the maintainer has to read and delete.

## 5. Inject

Preferred path — the CLI knows which of the target's files came from this repo and which the
user edited, and refuses to overwrite the second kind:

```bash
agentbase apply python                              # plan: every candidate, with Why/When + status
agentbase apply python --asset rules/python/free-threading-detection.md
```

Without `--asset` it only prints the plan. Judge the `When` conditions first, then pass the
assets you accepted. `docs/**` is the only target namespace any manifest declares.

Without the CLI, write each selected asset to its declared target location:

```bash
curl -fsS "$RAW/rules/python/free-threading-detection.md" -o "docs/rules/free-threading-detection.md"
```

Create parent directories as needed. Overwriting an existing file at the target path requires
confirmation first — the user's own version may be there.

## 6. Report

Tell the user, per asset: what was injected, where, and which condition triggered it. List
what was skipped and why. That list is how they learn the manifest has a gap.

Relay the CLI's status verbatim — `up to date`, `upstream changed`, `you edited this`,
`both changed`, `unmanaged`. A file the user edited and upstream then changed is a merge
conflict on prose, not an update; say so rather than resolving it.

## Working in the target repo

**Worktree first.** This skill writes into someone else's checkout. Before injecting anything:

- Run `git status` in the target. A dirty tree means injected files mix with uncommitted
  work, and a later `git checkout` or `git clean` can destroy both.
- If the target has uncommitted changes, propose a worktree:
  `git worktree add ../<name>-kb-inject -b kb-inject`. Inject there, review, then merge.
- If the target is clean, inject directly — the worktree ceremony costs more than it buys.

Injection is a branch-worthy change. Even on a clean tree, say that the result is new files
the user has not committed, and let them decide what lands.

**Verify what landed.** After each `curl`, confirm the response was a file and not a 404 page
or an LFS pointer. `curl -f` exits non-zero on HTTP errors, so a silent bad body is otherwise
easy to miss:

```bash
curl -fsS "$RAW/docs/react.md" | sed -n '/<!-- ASSET_MANIFEST_START -->/,/<!-- ASSET_MANIFEST_END -->/p'
```

If `curl -f` fails, the manifest does not exist for that language — report it as a gap rather
than falling back to another ecosystem's assets.

## Constraints

- **Read-only against this repo.** Never write to `rules/`, `skills/`, `agents/`, `shared/`,
  or `docs/` from this skill. Only Phase 3 writes there.
- **No research.** This skill consumes assets that already exist. Discovering new knowledge
  is Phase 1/2, and it goes through Camofox.
- **Manifests are authoritative.** If a manifest lists a path, fetch that path. If the fetch
  404s, report it — do not substitute a similar asset.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Manifest fetch returns empty | `docs/<tech>.md` missing on the remote | Report; the hub was never generated |
| 404 on asset download | Manifest lists a path with no file | Report the exact path; Phase 3 registered a phantom |
| `jq` errors on `repo_slug` | Clone predates the config | Use the literal in §1 |
| Fetched asset contradicts local setup | Version drift | Report both; let the user decide, do not silently overwrite |
