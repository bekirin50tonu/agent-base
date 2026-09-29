# knowledge-base

A curated library of engineering assets — rules, skills, agents, and shared patterns — plus
the `knowledge-base` skill that injects the right ones into a target project.

This repository is the **distribution source** for Phase 4 of the knowledge base
orchestrator. What ships here is the asset library and the manifests that describe it.

## Install

The skill itself is the entry point. Fetch it into a target project's skills directory:

```bash
curl -fsS "https://raw.githubusercontent.com/bekirin50tonu/knowledge-base/main/skills/knowledge-base/SKILL.md" \
  -o .claude/skills/knowledge-base/SKILL.md
```

Then invoke it from that project. It reads the repo, works out which assets apply, and
fetches only those.

```bash
# 1. the skill resolves the base URL (see skills/knowledge-base/SKILL.md §1)
RAW="https://raw.githubusercontent.com/bekirin50tonu/knowledge-base/main"

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

The library is early. `docs/react.md` routes to one shared pattern library; the Go, .NET, and
Python hubs are in place but empty — they will fill as research cycles run.

A manifest entry is a promise that the path exists on `main`. An entry whose file is missing
produces a 404 for every consumer, so assets and their manifest entries are committed
together.

## Adding an asset

1. Synthesize the asset into its directory (`rules/`, `skills/`, `agents/`, `shared/`).
2. Register it in `.data/inventory_tree.json` via `state_manager.sh add-asset`.
3. Add the matching entry to the relevant `docs/<tech>.md` manifest.
4. Commit the asset and the manifest change together.

Steps 1–2 are performed by the orchestrator's Phase 3. This repository only carries the
result.

## Development

The orchestrator that produces these assets — scouting, research, and synthesis — runs
locally and is intentionally not part of the published repository. Its state (`.data/`),
configuration (`.config/`), scripts (`.scripts/`), templates (`.templates/`), and reports
(`.reports/`) are gitignored; only the synthesized output is published.

See `.claude/CLAUDE.md` in a local checkout for the full protocol.

## Conventions

- **Commits** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) with an
  optional scope, e.g. `feat(assets):`. No attribution trailers.
- **Skills** follow progressive loading: `SKILL.md` plus optional `references/`, `scripts/`,
  `templates/`, `assets/`. Size limits in `.templates/skill_structure_rule.md`.
