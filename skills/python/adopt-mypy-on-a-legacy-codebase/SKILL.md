---
name: adopt-mypy-on-a-legacy-codebase
description: "Add mypy and ruff to a large unannotated Python codebase. Use when a legacy service needs types, when a type gate lands in CI, or when the checked-module set needs to grow without a big-bang flip."
version: "1.0.0"
tags:
  - python
  - migration
  - typing
  - tooling
---

# Adopt mypy on a Legacy Codebase: Build the Gate First, Accumulate Types Behind It

The documented order is counter-intuitive and it is the thing teams most often get wrong: **you
get the checker running before you write a single annotation.** Phase 1 is not "add types" — it
is "make mypy pass on 5,000–50,000 lines of currently unannotated code."

## Step 0 — Know what the guarantee does not promise

Do this before planning anything, because it is what makes the rest of the workflow necessary.

The typing specification names the property your migration depends on and then declines to
enforce it:

> Any allows gradually adding static types to a dynamically typed program. […] Removing type
> annotations (making the program more dynamic) should not result in additional static type
> errors. This is often referred to as the gradual guarantee.
>
> In Python's type system, **we don't take the gradual guarantee as a strict requirement, but
> it's a useful guideline.**
> — https://typing.python.org/en/latest/spec/concepts.html

Read the bold part as the design constraint. If the guarantee were strict, the workflow would be
mechanical: annotate, fix errors, done. Because it is a guideline, the workflow needs escape
hatches — `ignore_errors`, `# type: ignore`, `follow_imports=skip`, `--disable-error-code` — and
**every escape hatch is a place where the guarantee silently stops holding.** The failure modes
in steps 3 and 4 are not mypy bugs; they are the predictable consequence of a guideline.

## Step 1 — Phase 0: lint before types (one afternoon)

There is a cheaper gate than mypy and it comes first. ruff is a linter, not a type checker —
its categories are correctness, suspicious, complexity, performance, style, all local or
syntactic judgements with no cross-module type reasoning. It can check whether an annotation
*exists* (`ANN`), but that is a presence check, not a type check.

```toml
# pyproject.toml
[tool.ruff]
select = ["E", "F"]     # start with two prefixes; add a group at a time
```

> Start with a small set of rules (select = ["E", "F"]) and add a group at-a-time. For example,
> you might consider expanding to select = ["E", "F", "B"] to enable the popular flake8-bugbear
> extension.
> — https://docs.astral.sh/ruff/linter/

> Correctness: These rules flag code that is outright wrong as written. If you encounter a
> correctness issue, you should try to fix it rather than suppressing the error with noqa or
> ruff: ignore.
> — https://docs.astral.sh/ruff/linter/

Unlike mypy, ruff documents **no gradual-adoption escape hatch for a large legacy corpus** — no
`ignore_errors` analogue. If the first run is too large, the pragmatic move is a narrow `select`
plus a narrow path in CI, not a codebase-wide run.

## Step 2 — Get a green run on a slice, before annotating

> If your codebase is large, pick a subset of your codebase (say, 5,000 to 50,000 lines) and get
> mypy to run successfully only on this subset at first, before adding annotations. This should
> be doable in a day or two. The sooner you get some form of mypy passing on your codebase, the
> sooner you benefit.
>
> You'll likely need to fix some mypy errors, either by inserting annotations requested by mypy
> or by adding # type: ignore comments to silence errors you don't want to fix now.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

The exit criterion is **not** zero errors on the whole repo. It is: `mypy <subset>` exits 0,
with whatever annotations already exist.

Two things the guide does not say and you must decide:

- **How to choose the subset.** The range is not a recipe. Pick a slice large enough to contain
  real import edges — a slice with no interesting imports gives a green run that tells you
  nothing.
- **Errors here are silenced, not fixed.** That is the documented intent. Fixing is step 4. The
  point of phase 1 is only that the tool runs and the command is reproducible.

## Step 3 — Lock the invocation, and invert the config

> Make sure all developers on your codebase run mypy the same way. […] Make sure everyone type
> checks the same set of files. […] Make sure everyone runs mypy with the same version of mypy,
> for instance by pinning mypy with the rest of your dev requirements.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

```ini
# mypy.ini — global section
[mypy]
ignore_errors = True
warn_unused_ignores = True
mypy_path = .

# one section per module you have finished, and nothing else
[mypy-myapp.api.handlers]
ignore_errors = False
disallow_untyped_defs = True
```

The inversion is the mechanism that makes a large migration *terminable*. Most migration tooling
is opt-in — you list what should be checked, and every omission is invisible and silently
unchecked forever. Here the default is unchecked and each removal is progress:

> You could even invert this, by setting ignore_errors = True in your global config section and
> only enabling error reporting with ignore_errors = False for the set of modules you are ready to
> type check.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

**Your config file is a work queue.** The count of `[mypy-*]` sections is the progress metric, and
CI stays green throughout because the queue absorbs everything unchecked.

The direct cost is real: a new module is unchecked by default and nobody notices. `disallow_untyped_defs`
on each completed module is the mitigation — it raises the floor locally instead of relying on
remembering to opt in. An inversion without it has traded a visible problem for an invisible one.

Do not use the global inversion on day one. mypy documents both directions without ranking them;
the opt-out form is the phase-1 form, and the inversion is the move that starts paying once you
have finished modules worth listing.

## Step 4 — Track two numbers, not one

This is the failure mode that produces a green build checking less than its output implies.

When mypy cannot follow an import it does not error-and-stop. It assigns the module `Any` and
proceeds:

> If you get any of these errors on an import, mypy will assume the type of that module is Any,
> the dynamic type. This means attempting to access any attribute of the module will
> automatically succeed […] This can result in mypy failing to warn you about errors in your
> code.
> — https://mypy.readthedocs.io/en/stable/running_mypy.html

Every attribute access succeeds, every call returns `Any`, every assignment is consistent. The
guarantee does not degrade at that boundary — it stops. And because step 3 suppresses errors
rather than raising them, you get a passing CI run over a smaller surface than it implies.

```bash
# 1. modules you have opted in — the number teams report
grep -c '^\[mypy-' mypy.ini

# 2. modules reachable but opted out — the number teams do not report.
#    With the inversion this is "everything else", so count the whole surface:
find myapp -name '*.py' | wc -l

# 3. suppressed, not fixed
grep -rn '# type: ignore' --include=*.py . | wc -l
```

**Every `Any` you introduce is an undocumented exemption from the gate.** Prefer per-module
config for anything imported in more than a couple of places, because config is *visible* and
`# type: ignore` is not:

> If you only import that module in one or two places, you can use # type: ignore comments. […]
> But if you import the module in many places, this becomes unwieldy. In this case, we recommend
> using a configuration file.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

Also: the consistency relation governing `Any` is **not transitive**, which is the formal reason
a hole in the middle of a container type passes unnoticed:

> The consistency relation is not transitive. tuple[int, int] is consistent with tuple[Any, int],
> and tuple[Any, int] is consistent with tuple[str, int], but tuple[int, int] is not consistent
> with tuple[str, int].
> — https://typing.python.org/en/latest/spec/concepts.html

## Step 5 — Make it self-funding, and prune what you cannot check

Two documented policies turn this from a project into a habit. Both come from the same page.

> Developers should add annotations for any new code.
>
> It's also encouraged to write annotations when you modify existing code.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

> Most projects have some widely imported modules, such as utilities or model classes. It's a good
> idea to annotate these pretty early on, since this allows code using these modules to be type
> checked more effectively.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

Widely-imported modules first — they are where one annotation buys checks across the whole
codebase. That is the ordering that makes the migration self-funding rather than dependent on a
dedicated sprint.

For modules that cannot be checked yet, `follow_imports` is the pruning tool, and the direction
of the pattern is a genuine trap:

> Using this option in a per-module section (potentially with a wildcard […] ) is a good way to
> prevent mypy from checking portions of your code.
>
> **If this option is used in a per-module section, the module name should match the name of the
> imported module, not the module containing the import statement.**
> — https://mypy.readthedocs.io/en/stable/config_file.html

mypy's own verdict on this knob is blunt — treat it as a last resort:

> It's very easy to silently shoot yourself in the foot when playing around with these, so this
> should be a last resort.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

## Step 6 — Reach `--strict` by subtraction, not addition

`--strict` is the goal but it is not reached by turning flags on one at a time:

> Note that you can also start with --strict and subtract, for instance:
> ```
> strict = True
> warn_return_any = False
> ```
> — https://mypy.readthedocs.io/en/stable/existing_code.html

The subtraction order is not a guess — mypy annotates each flag's difficulty inline. Read them
as the maintainers telling you where to expect pain:

| Flag | mypy's own annotation | Reached by |
|---|---|---|
| `strict_equality` | "Getting this passing should be easy" | adding |
| `check_untyped_defs` | "Strongly recommend enabling this one as soon as you can" | adding |
| `disallow_subclassing_any` | "tricky to get passing if you use a lot of untyped libraries" | subtracting |
| `disallow_untyped_decorators` | (same) | subtracting |
| `disallow_any_generics` | (same) | subtracting |
| `disallow_untyped_calls` / `_incomplete_defs` / `_defs` | "gradations of forcing use of type annotations" | adding, per module |
| `no_implicit_reexport` | "return on investment is lower" | last |
| `warn_return_any` | "tricky to get passing if you use a lot of untyped libraries" | subtract first |
| `extra_checks` | catch-all, "technically correct but may not be practical" | last |

Start `strict = True`, subtract `warn_return_any` and `extra_checks` if the untyped-dependency
count is high, and re-add as modules land.

Past ~100,000 lines the run time becomes the constraint before the types do:

> You can use mypy daemon to get much faster incremental mypy runs. The larger your project is,
> the more useful this will be. If your project has at least 100,000 lines of code or so, you may
> also want to set up remote caching for further speedups.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

## What "done" means

Not "no `Any` anywhere" — that is unreachable with untyped third-party dependencies, and a plan
that targets it stalls. The documented end state is:

> An excellent goal to aim for is to have your codebase pass when run against mypy --strict. This
> basically ensures that you will never have a type related error without an explicit
> circumvention somewhere (such as a # type: ignore comment).
> — https://mypy.readthedocs.io/en/stable/existing_code.html

"Passes `--strict` with every remaining error being a visible, counted circumvention." That
requires `warn_unused_ignores = True` — without it, ignores that are no longer needed are never
reported, suppressions accumulate, and the number grows monotonically even as coverage improves.
Coverage becomes a tracked metric (annotation percentage, count of `type: ignore`), not a binary.

## When to stop and escalate

- **A slice with no cross-module imports.** The green run proves nothing; pick a wider slice.
- **`--disable-error-code=import-untyped` globally.** mypy warns about this itself: *"This can
  hide errors later on, so we recommend avoiding this if possible."* It is the fastest way to
  manufacture the green build this skill exists to prevent.
- **The first ruff run is unmanageably large.** There is no documented escape hatch; narrow
  `select` and narrow the CI path instead of suppressing.
- **The codebase is past ~100k lines and runs are slow.** That is a tooling problem, not a typing
  problem — daemon and remote caching come before more flags.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 4,000 errors before any annotation is written | annotated before gating | step 2 — green run on a slice first |
| Green CI, far less checked than it looks | `Any` on unfollowed imports plus suppressed errors | track both numbers from step 4 |
| `follow_imports` on the wrong module | pattern must match the *imported* module | match the imported name, not the importer |
| New module silently unchecked forever | inversion, with no `disallow_untyped_defs` | set it on every completed module |
| `type: ignore` count only grows | `warn_unused_ignores` off | turn it on; the count must be able to fall |
| `--strict` will not go green | untyped dependencies | subtract, per the table in step 6 |
| Migration appears to stall | run time | daemon + remote caching past ~100k lines |

## Verifying

```bash
mypy --version
mypy <your-slice>              # exits 0 — phase 1 criterion

# 1. checked set vs. whole surface
grep -c '^\[mypy-' mypy.ini
find myapp -name '*.py' | wc -l

# 2. the suppressed count must be able to fall
grep -rn '# type: ignore' --include=*.py . | wc -l
grep -rn 'warn_unused_ignores' mypy.ini

# 3. where the guarantee is not holding
mypy --strict 2>&1 | tail -20
ruff check .
```

## Known limits of this skill

- **The phase ordering is documented, not tested in the wild.** Every source here is normative —
  the typing spec, mypy's adoption guide, mypy's config reference, ruff's linter page. There is
  **zero practitioner corroboration**: no source describing an actual migration on a large legacy
  service and reporting where it broke. Read step 2–3 ordering as the documented default, not as
  a battle-tested one.
- **The installed-stubs remedy is not closed.** The `Any`-laundering failure mode in step 4 is
  precisely what `py.typed` markers and stub packages exist to fix, and this skill does not cover
  that remedy — neither PEP 561 nor the typing spec's distribution page was consulted. Step 4
  tells you how to *measure* the hole, not how to close it. Installing stubs is the obvious first
  move and is not written up here.
- **Deferred annotation evaluation is not covered.** `from __future__ import annotations`, string
  annotations, and PEP 649/749 change *when* annotations are evaluated. Nothing above depends on
  eager evaluation, but nothing above is sourced on the deferred model either.
- **mypy only.** pyright is not covered, so editor-time feedback is not compared against CI.

## Sources

- https://typing.python.org/en/latest/spec/concepts.html
- https://mypy.readthedocs.io/en/stable/existing_code.html
- https://mypy.readthedocs.io/en/stable/config_file.html
- https://mypy.readthedocs.io/en/stable/running_mypy.html
- https://docs.astral.sh/ruff/linter/
