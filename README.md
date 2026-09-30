# knowledge-base

A curated library of engineering assets — rules, skills, agents, and shared patterns — plus
the `knowledge-base` skill that injects the right ones into a target project.

This repository is the **distribution source** for Phase 4 of the knowledge base
orchestrator. What ships here is the asset library and the manifests that describe it.

## Install

```bash
npx github:bekirin50tonu/agent-base install            # ~/.claude/skills/ (all projects)
npx github:bekirin50tonu/agent-base install --project  # .claude/skills/ (this repo only)
```

No account, no publish step, no dependency — `install` copies the bundled `SKILL.md` straight
out of the package. Then invoke `/knowledge-base` from a project.

`uninstall` takes the same flag and removes what `install` wrote:

```bash
npx github:bekirin50tonu/agent-base uninstall
```

It removes the skill only. Assets you already injected under `docs/` are your files by then,
and `.agent-base/state.json` stays put — deleting it would make every one of them look
`unmanaged`, so the next `apply` could no longer tell an edit from an update.

Prefer `curl`? The skill is one file and needs nothing else:

```bash
curl -fsS "https://raw.githubusercontent.com/bekirin50tonu/agent-base/main/skills/knowledge-base/SKILL.md" \
  -o .claude/skills/knowledge-base/SKILL.md
```

## Applying assets

The skill decides which assets apply — the `When` conditions in a manifest are prose, and only
a reader can judge them. The CLI does the part that shell cannot: it knows which of your files
came from this repo and which you have edited.

```bash
npx github:bekirin50tonu/agent-base apply python
```

Prints the plan — every candidate with its `Why`, its `When`, and one of six statuses:

| Status | Meaning |
|---|---|
| `new` | not on disk yet |
| `up to date` | your file matches this repo |
| `upstream changed` | your file is untouched — safe to overwrite with `--yes` |
| `you edited this` | upstream unchanged — the CLI leaves it alone |
| `both changed` | a merge conflict on prose; the CLI stops and writes nothing |
| `unmanaged` | on disk with no record here; `--force` adopts it, does not merge it |

Then inject what you accepted:

```bash
npx github:bekirin50tonu/agent-base apply python --asset rules/python/free-threading-detection.md
```

Each injection records a sha256 in `.agent-base/state.json`. That file is how "you edited
this" and "upstream changed" are told apart. Do not commit it — per-machine paths merge badly.
Recover by deleting the target file and re-running `apply`.

A skill is the judgment; this is the plumbing. Both paths are supported: `agentbase apply`
first, `curl -fsS "$RAW/<path>" -o docs/<target>` when you want no install.

## Layout

```text
docs/<tech>.md            # manifest hubs — the routing layer, one per language
rules/<ecosystem>/        # coding standards and constraints
skills/<ecosystem>/       # multi-step workflows
agents/<ecosystem>/       # subagent personas (JSON)
shared/                   # reusable patterns, boilerplate, infra
```

Everything above is consumable. Each `docs/<tech>.md` declares, per asset, **why** it exists
and **when** it applies, so the skill can decide without guessing.

## Current contents

| Hub | Routes |
|---|---|
| `docs/html-css.md` | _empty hub — reserved_ |
| `docs/javascript.md` | 1 skill (TypeScript strict) |
| `docs/python.md` | 3 rules + 1 skill (mypy/ruff adoption) + 1 agent + 2 shared assets |
| `docs/go.md` | 5 rules + 1 skill (toolchain vs. language version) + 1 agent + 1 shared asset |
| `docs/react.md` | 8 rules (5 React, 3 Next.js-scoped) + 1 skill (TS strict) + 1 agent + 4 shared assets |
| `docs/nestjs.md` | 4 rules + 1 skill (request-scope to ALS) + 1 agent |
| `docs/java.md` | 4 rules (Spring `@Async`, proxy mechanics, virtual threads) + 1 skill (Spring Boot migration) + 1 agent + 1 shared asset |
| `docs/dotnet.md` | 5 rules (cancellation, discarded tasks, task composition, thread-pool starvation, hosted work) + 1 skill (.NET Framework → SDK-style) + 1 agent + 1 shared asset |
| `docs/sql.md` | 3 rules (`NOT IN` nulls, disabled timeouts, `CREATE INDEX CONCURRENTLY`) + 1 skill (EXPLAIN-first) + 1 agent |
| `docs/backend-architecture.md` | 9 rules (durable execution, dual-write, vertical slice, service extraction, idempotency keys, delivery guarantees, worker claims, trace propagation, microservices vs monolith approaches) + 1 shared asset |
| `docs/authentication.md` | 2 rules (JWT algorithm/key pinning per RFC 8725, browser token storage per RFC 10017) |
| `docs/mcp.md` | 2 rules + 1 skill + 1 shared asset (agents empty) |

A hub's rules may be framework-scoped. `docs/react.md` serves plain React and Next.js from one
page, because a Next.js project is a React project; entries that only apply to Next.js say so
in their *When* condition, and a React-only project skips them. `package.json` presence alone
does not select a hub — the skill resolves by framework dependency, since Vue, Svelte, Angular,
and NestJS all have one too.

## Adding an asset

1. Synthesize the asset into its directory (`rules/`, `skills/`, `agents/`, `shared/`).
2. Add the matching entry to the relevant `docs/<tech>.md` manifest, with **why** and
   **when** — the skill decides on those, not on the path.
3. Run the integrity check, then commit the asset and the manifest change together.

```bash
node scripts/check-manifests.mjs
```

A manifest entry is a promise that the path exists on `main`. An entry whose file is missing
produces a 404 for every consumer, silently, forever — that check is the one thing worth
running every time.

Assets here are produced by a separate **private** research engine. This repository is
downstream of it: it carries the result, not the machinery.

## Development

The orchestrator that produces these assets — scouting, research, and synthesis — lives in
its own private repository. This repo contains only the synthesized output and the manifests
that route it. Nothing needed to *consume* these assets lives there; nothing needed to
*produce* them lives here.

## Conventions

- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) with an
  optional scope, e.g. `feat(assets):`. No attribution trailers.
- **Skills** follow progressive loading: `SKILL.md` (≤500 lines) plus optional
  `references/` (≤200 lines/file), `scripts/` (≤300), `templates/` (≤100), and `assets/`.
  Only the `name` and `description` frontmatter is loaded at discovery.
