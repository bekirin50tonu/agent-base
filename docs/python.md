---
language: "Python"
tag: "python"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for Python assets."
---

# Documentation Hub: Python

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`pyproject.toml`,
> `requirements.txt`). Match the conditions below to determine which `rules`, `skills`,
> `agents`, or `shared` assets to inject.
>
> **Status**: rules and shared tooling are covered, plus the mypy/ruff adoption workflow for
> unannotated codebases and a Python helper agent.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/python/pep695-native-generics.md`
  - **Why**: Python 3.12 moved generics into language syntax. The redundant
    `Generic`/`Protocol` base form fails at *runtime*, not at type-check time, so it slips
    past reviewers and CI that only runs a checker.
  - **When**: Target project sets `requires-python >= 3.12` or a `py312+` Ruff
    `target-version`, and the codebase declares generic classes or functions.
  - **Target Location**: `docs/rules/pep695-native-generics.md`

- **Path**: `rules/python/free-threading-detection.md`
  - **Why**: A free-threaded build can run *with the GIL back on* — via `PYTHON_GIL`, `-X
    gil`, or an unmarked C extension re-enabling it at import. Build metadata
    (`sys.version`, wheel tag) reports the distribution, not the running process, so the
    parallelism silently is not there.
  - **When**: Target project deploys on Python 3.13+ free-threaded builds (`python3.14t`),
    or pins `Py_GIL_DISABLED`, or has any C extension in its import graph.
  - **Target Location**: `docs/rules/free-threading-detection.md`

- **Path**: `rules/python/free-threading-overhead.md`
  - **Why**: Overhead is 1-8% single-threaded and platform-dependent, and immortalization
    removes deterministic deallocation — which breaks `weakref.finalize`-based cleanup.
    Adopting on the premise that "threads are fast now" is wrong on both counts.
  - **When**: Target project is evaluating or has adopted a free-threaded build for
    CPU-bound work, or uses `weakref.finalize` / finalizers to release external resources.
  - **Target Location**: `docs/rules/free-threading-overhead.md`

## 2. Skills (`skills/`)

- **Path**: `skills/python/adopt-mypy-on-a-legacy-codebase/SKILL.md`
  - **Why**: The documented order runs the checker *before* any annotation exists, and the
    config inverts to `ignore_errors = True` globally with `False` per finished module — so the
    config file is a work queue whose shrinking entry count is the progress metric. Starts from
    the fact that the typing spec names the gradual guarantee and then explicitly declines to
    enforce it, which is why every escape hatch (`ignore_errors`, `type: ignore`,
    `follow_imports`) is a place the guarantee silently stops holding. Includes the two-numbers
    rule — modules checked vs. modules reachable-but-unchecked — because an unfollowed import
    becomes `Any` silently and you get a green build checking less than its output implies.
    Carries its own limits: documented ordering, zero practitioner corroboration, and the
    `py.typed` remedy deliberately not written up.
  - **When**: Target project is Python with substantial code and little or no type annotation,
    and is adding mypy, adding a type gate to CI, or growing the checked-module set without a
    big-bang flip. Also when a type gate already exists and a green run is not evidence that
    the covered surface is what it appears to be.
  - **Target Location**: `docs/skills/python/adopt-mypy-on-a-legacy-codebase/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/python/agent.json`
  - **Why**: Helps with Python-related tasks, such as adopting mypy, ruff, and other Python best practices.
  - **When**: Target project is a Python project (has `pyproject.toml` or `requirements.txt`).
  - **Target Location**: `docs/agents/python/agent.json`

## 4. Shared Assets (`shared/`)
- **Path**: `shared/tooling/uv-toolchain.md`
  - **Why**: Replaces the pip / flake8 / black / mypy stack with one `uvx`-driven Rust
    toolchain (uv, Ruff, ty), driven without a permanent install.
  - **When**: Target project has a `pyproject.toml` with dependencies, or a hand-maintained
    `requirements.txt`, or CI pins a Python version that the project does not pin locally.
  - **Target Location**: `docs/tooling/uv-toolchain.md`

- **Path**: `shared/git/machine-generated-files.md`
  - **Why**: Most ecosystems commit at least one file their own toolchain rewrites. A merge conflict in those files is not a prose conflict, and the three-field diff tool you would reach for is the wrong tool. This is about telling generated files from authored ones, and knowing which regeneration command belongs to each.
  - **When**: A merge or rebase stops with a conflict in `go.sum`, `uv.lock`, `packages.lock.json`, `gradle-wrapper.jar`, or a similar artifact.
  - **Target Location**: `docs/git/machine-generated-files.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
