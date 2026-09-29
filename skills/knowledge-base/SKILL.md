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

## 2. Scan the target project

Determine the ecosystem from files that already exist. Do not ask the user what they use —
read it:

| File | Ecosystem |
|---|---|
| `package.json` | JS/TS — check for `next`, `react`, `pnpm-lock.yaml` |
| `pyproject.toml`, `requirements.txt` | Python — check for `fastapi`, `django`, `pydantic` |
| `go.mod` | Go |
| `*.csproj`, `*.sln` | .NET/C# |
| `composer.json` | PHP/Laravel |

Note the *present* dependencies, not every possible one. A project with `next` in
`dependencies` gets the React hub; one without does not.

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

Write each selected asset to its declared target location:

```bash
curl -s "$RAW/rules/frontend/react-hooks.md" -o ".cursor/rules/react-hooks.md"
```

Create parent directories as needed. Overwriting an existing file at the target path requires
confirmation first — the user's own version may be there.

## 6. Report

Tell the user, per asset: what was injected, where, and which condition triggered it. List
what was skipped and why. That list is how they learn the manifest has a gap.

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
