# knowledge-base

A curated library of engineering assets — rules, skills, agents, and shared patterns — plus
the `knowledge-base` skill that injects the right ones into a target project.

This repository is the **distribution source** for Phase 4 of the knowledge base
orchestrator. What ships here is the asset library and the manifests that describe it.

## Install

The skill itself is the entry point. Fetch it into a target project's skills directory:

```bash
curl -fsS "https://raw.githubusercontent.com/bekirin50tonu/agent-base/main/skills/knowledge-base/SKILL.md" \
  -o .claude/skills/knowledge-base/SKILL.md
```

Then invoke it from that project. It reads the repo, works out which assets apply, and
fetches only those.

```bash
# 1. the skill resolves the base URL (see skills/knowledge-base/SKILL.md §1)
RAW="https://raw.githubusercontent.com/bekirin50tonu/agent-base/main"

# 2. fetch only the manifest block from a language hub
curl -s "$RAW/docs/react.md" | sed -n '/<!-- ASSET_MANIFEST_START -->/,/<!-- ASSET_MANIFEST_END -->/p'

# 3. inject a matching asset
curl -s "$RAW/shared/design-patterns-library.md" -o "docs/design-patterns.md"
```

Run it as a Claude Code skill, or follow those steps directly — they are the whole
integration surface.

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
| `docs/python.md` | 3 rules + 1 shared asset |
| `docs/react.md` | 1 shared asset |
| `docs/go.md`, `docs/dotnet.md` | empty — awaiting research cycles |

A manifest entry is a promise that the path exists on `main`. An entry whose file is missing
produces a 404 for every consumer, so assets and their manifest entries are committed
together.

## Adding an asset

1. Synthesize the asset into its directory (`rules/`, `skills/`, `agents/`, `shared/`).
2. Add the matching entry to the relevant `docs/<tech>.md` manifest, with **why** and
   **when** — the skill decides on those, not on the path.
3. Verify the path resolves, then commit the asset and the manifest change together.

```bash
for p in $(sed -n '/ASSET_MANIFEST_START/,/ASSET_MANIFEST_END/p' docs/python.md \
           | grep -oP '(?<=\*\*Path\*\*: `)[^`]+'); do
  [ -f "$p" ] || echo "MISS $p"
done
```

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
