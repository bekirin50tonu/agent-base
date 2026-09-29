---
title: "uv / Ruff / ty Python Toolchain"
category: "tooling"
applies_to: "Python 3.12+"
last_updated: "2026-09-29"
source: "https://docs.astral.sh/uv/"
---

# uv / Ruff / ty Python Toolchain

One Rust-based toolchain replacing the pip / flake8 / black / mypy stack, driven entirely
through `uvx` so no tool needs a permanent install.

## When to Use

- `pyproject.toml` exists and declares dependencies or dev dependencies.
- `requirements.txt` is hand-maintained, or `requirements.in` is compiled by hand.
- The project pins a Python version in CI but not locally.
- Single-file scripts carry a manual `pip install` preamble.

## Usage Example

```bash
# Install uv itself
curl -LsSf https://astral.sh/uv/install.sh | sh

# Lint, format, and type check without installing anything permanently
uvx ruff check
uvx ruff format
uvx ty check
```

```toml
# pyproject.toml — Ruff config; replace the flake8/isort/black tool sections
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]   # pycodestyle, pyflakes, isort, bugbear, pyupgrade
```

```bash
# Project dependencies through uv, not pip
uv add ruff
uv run ruff check
uv lock && uv sync

# Pin the interpreter per project rather than globally
uv python install 3.12
uv python pin 3.12          # writes .python-version

# Single-file scripts carry their own dependencies
uv add --script example.py requests
uv run example.py
```

Migrating an existing pip codebase without changing workflows first:

```bash
uv pip compile requirements.in --universal --output-file requirements.txt
uv pip sync requirements.txt
```

## Caveats

- `ty` is pre-1.0 (0.0.x). Its diagnostics and rule set change between minor versions —
  pin it if CI depends on it.
- `uv pip` is a drop-in interface, not a reimplementation of all of pip's behaviour.
  Flags pip silently accepts may be unsupported.
- `uv pip compile --universal` resolves for every platform; that is correct for a
  committed `requirements.txt` but will not match a Linux-only install exactly.
- `--universal` output is not the same as `pip-compile` output. Do not diff them.
- Ruff's `select` list is not a superset of Flake8's defaults. Removing Flake8 without
  choosing a rule set silently drops checks.
