---
name: adopt-mypy-on-a-legacy-codebase
description: "Adopt mypy on a large unannotated Python codebase. Use when adding mypy or a CI type gate to legacy code, or when a green run is not evidence the checked surface is what it appears."
version: "1.0.0"
tags:
  - python
  - typing
  - migration
---

# Adopt mypy on a Legacy Codebase — the Config File Is the Work Queue

The intuitive order — annotate, then check — is the one mypy's own guide warns against. The
documented order runs the checker *before* any annotation exists, and drives the rest of the
migration through a config file whose shrinking entry count is the progress metric.

Everything below rests on a fact that is easy to skip and load-bearing: Python's gradual
typing is a guideline, not a contract.

## Why

The typing specification names the property that makes incremental adoption possible, then
explicitly declines to require it:

> Adding type annotations to the program (making the program more statically typed) may result
> in static type errors […] Removing type annotations (making the program more dynamic) should
> not result in additional static type errors. This is often referred to as the gradual
> guarantee.
>
> In Python's type system, **we don't take the gradual guarantee as a strict requirement, but
> it's a useful guideline.**
> — https://typing.python.org/en/latest/spec/concepts.html

That disclaimer is the entire failure surface of this migration. It justifies the ordering
(unannotated code cannot newly fail, so checking can precede annotating), but it promises
nothing about *coverage* — and every escape hatch this workflow uses (`ignore_errors`,
`# type: ignore`, `follow_imports`) is a place the guarantee silently stops holding.

The ordering, from mypy's own guide for existing codebases:

> If your codebase is large, pick a subset of your codebase (say, 5,000 to 50,000 lines) and
> get mypy to run successfully only on this subset at first, **before adding annotations.**
> This should be doable in a day or two.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

Note what that insists on: phase 1 is a green run over a *slice of unannotated code*. That is
only possible because unchecked functions are `Any`-typed and `Any` is consistent with
everything.

## Step 0 — Lint first, because it is cheaper and it is not typing

Run ruff with a minimal rule set before touching mypy:

```toml
[tool.ruff.lint]
select = ["E", "F"]   # add a group at a time, e.g. "B" next
```

ruff's rule categories — correctness, suspicious, complexity, performance, style — are all
*local* judgements. None of them do cross-module type inference, so this gate does not
duplicate the type checker; it produces the first green CI run with real teeth, in an
afternoon. Two caveats from the docs: the category taxonomy is preview-only while linter
groups are on a deprecation path, so expect selector churn; and ruff documents no
`ignore_errors` analogue — if the initial lint run on a legacy corpus is too large, there is
no documented gradual ramp.

## Step 1 — Get a green run on a slice, before annotating anything

```bash
# Pick 5,000–50,000 lines that includes real import edges — a slice with no
# interesting imports produces a green run that tells you nothing.
mypy <subset>
```

Errors at this stage get silenced with `# type: ignore`, not fixed. Fixing comes later; the
point of phase 1 is establishing that the tool *runs* and that the command is reproducible.
Teams that skip to annotating inherit a 4,000-error wall and lose the ability to tell new
breakage from old.

**Exit criterion:** `mypy <subset>` exits 0, with a checked-in invocation.

## Step 2 — Lock the invocation in CI, pin the version

> Make sure all developers on your codebase run mypy the same way. […] Make sure everyone runs
> mypy with the same version of mypy, for instance by pinning mypy with the rest of your dev
> requirements.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

mypy is at 2.3.1; the adoption guide's sample CI script still pins `mypy==1.8`. Do not copy
that pin literally — the workflow is stable across that jump, the example is not.

**Exit criterion:** the invocation runs in CI and the version is pinned.

## Step 3 — Invert the config: `ignore_errors = True` globally, `False` per finished module

The mechanism that makes the migration *terminable*. Rather than opting modules in to
checking, the default state becomes "not checked" and each finished module opts back out:

```ini
[mypy]
ignore_errors = True

[mypy-finished_module]
ignore_errors = False
disallow_untyped_defs = True   # stops the queue from growing back
```

mypy documents the inversion directly:

> You could even invert this, by setting ignore_errors = True in your global config section
> and only enabling error reporting with ignore_errors = False for the set of modules you are
> ready to type check.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

This inverts the meaning of the config file: it is no longer a description of what is checked
but of what is *not yet* checked. Every entry removed is progress, CI stays green throughout,
and the finish line is explicit and greppable. With opt-*in* configuration, omissions are
invisible and silently unchecked forever.

**Progress metric: the count of `ignore_errors = False` lines, rising. The count of remaining
suppressed modules, falling.** Both are one grep.

## Step 4 — Track two numbers, because `Any` launders at the trust boundary

The failure mode that makes a green build dishonest:

> If you get any of these errors on an import, mypy will assume the type of that module is
> Any, the dynamic type. This means attempting to access any attribute of the module will
> automatically succeed: […] This can result in mypy failing to warn you about errors in your
> code.
> — https://mypy.readthedocs.io/en/stable/running_mypy.html

An unfollowed import — an internal `utils` module with no annotations, a third-party library
with no stubs — becomes a hole whose width is the total attribute surface of that module.
Combined with step 3's suppression, you get a green CI run that is checking less than its
output implies.

So track **modules checked** *and* **modules reachable-but-unchecked**. A team tracking only
the first will believe it is further along than it is.

For suppression, prefer per-module config over `# type: ignore` — mypy's own guidance, for
anything imported in more than a couple of places, because per-module config is *visible* and
a scattered comment is not:

```ini
[mypy-untyped_dependency.*]
ignore_missing_imports = True
```

## Step 5 — Know the three places the checker stops

**Import fan-out.** Passing a few files to mypy still processes the whole transitive import
graph. `follow_imports` prunes it — and it has a documented trap:

> If this option is used in a per-module section, the module name should match the name of the
> imported module, **not the module containing the import statement.**
> — https://mypy.readthedocs.io/en/stable/config_file.html

Easy to get backwards; check the direction when pruning.

**Non-transitive consistency.** The relation governing `Any`-containing types is not a partial
order:

> tuple[int, int] is consistent with tuple[Any, int], and tuple[Any, int] is consistent with
> tuple[str, int], but tuple[int, int] is not consistent with tuple[str, int].
> — https://typing.python.org/en/latest/spec/concepts.html

An `Any` in the middle of a container type can let an inconsistency through. Locally
explicable errors, globally surprising ones — this is the formal reason `Any`-containing types
need review even when everything "type checks".

**The `--strict` cliff.** mypy marks several strictness flags as "tricky to get passing if you
use a lot of untyped libraries" — `disallow_subclassing_any`, `warn_return_any`,
`extra_checks` — i.e. they fail in proportion to how untyped your dependencies are. mypy's own
answer is subtraction, not addition:

> Note that you can also start with --strict and subtract, for instance:
> `strict = True` / `warn_return_any = False`
> — https://mypy.readthedocs.io/en/stable/existing_code.html

Past ~100k lines, budget for the daemon and possibly remote caching — a migration that
ignores this stalls on tooling, not on types.

## Step 6 — Write the annotation policy that funds the migration

> Developers should add annotations for any new code. It's also encouraged to write
> annotations when you modify existing code. […] Prioritise annotating widely imported
> modules, such as utilities or model classes.
> — https://mypy.readthedocs.io/en/stable/existing_code.html

Two written conventions — annotate new code, annotate on touch — plus early annotation of
widely-imported modules. This is what makes the migration self-funding rather than
sprint-dependent. `disallow_untyped_defs` per completed module (step 3) is the enforcement.

## Step 7 — Know what "done" means

> An excellent goal to aim for is to have your codebase pass when run against mypy --strict.
> This basically ensures that you will never have a type related error without an explicit
> circumvention somewhere (such as a # type: ignore comment).
> — https://mypy.readthedocs.io/en/stable/existing_code.html

The end state is *not* "no `Any` anywhere" — that is unreachable for a service with untyped
third-party dependencies. It is **`--strict` exits 0, with every remaining error an explicit,
visible circumvention** — countable decisions rather than oversights. Enable
`warn_unused_ignores` so suppressions are audited rather than accumulating monotonically.

**Exit criterion:** `mypy --strict` green, `warn_unused_ignores` on, and coverage tracked as
a metric (annotation %, `# type: ignore` count) rather than a binary.

## When to stop and escalate

- **`follow_imports` tuning is becoming the project.** mypy's own words: fine-grained import
  control is *"very easy to silently shoot yourself in the foot when playing around with
  these, so this should be a last resort."*
- **You are considering `ignore_missing_imports = True` globally.** The docs recommend
  avoiding it — *"this can hide errors later on"* — it is the widest possible `Any` hole.
- **A dependency's missing stubs dominate the error count.** The remedy this skill does not
  cover is stub packages / `py.typed` (PEP 561) — not sourced in the underlying research.
  Escalate before papering over with ignores.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Green CI, but a real bug ships through it | unfollowed import became `Any`; every access succeeded | track reachable-but-unchecked, not just checked |
| Config grows forever, nothing finishes | opt-in config; omissions invisible | invert: `ignore_errors = True` global, `False` per finished module |
| Finished module regresses to untyped code | nothing enforces the floor | `disallow_untyped_defs = True` on completed modules |
| `follow_imports` section has no effect | pattern matches the *importing* module | match the *imported* module name |
| Odd cross-module type error, locally clean | consistency is non-transitive through `Any` | review `Any`-containing container types by hand |
| `--strict` unreachable | strictness flags fail with untyped deps | start strict and subtract; mypy documents this direction |
| mypy slow enough to stall work | corpus >100k lines | daemon; remote caching |
| Suppressions only ever grow | ignores never audited | `warn_unused_ignores = True` |

## Verifying

```bash
# The two numbers — checked vs. reachable-but-unchecked
grep -c 'ignore_errors = False' mypy.ini 2>/dev/null || grep -c 'ignore_errors = false' pyproject.toml
grep -rn '# type: ignore' --include=*.py . | wc -l

# The suppressed set — this is the work queue
grep -B1 'ignore_errors' mypy.ini 2>/dev/null

# The end state
mypy --strict .
grep 'warn_unused_ignores' mypy.ini pyproject.toml 2>/dev/null || echo "warn_unused_ignores not set"
```

## Limits of this skill

Stated plainly, because they are real:

- **Documented ordering, zero practitioner corroboration.** Every phase above comes from
  normative docs and mypy's official adoption guide. No source that actually performed this
  migration on a large legacy service and reported where it broke was read.
- **The `py.typed` / stub-package remedy is deliberately not written up.** PEP 561 was not
  read from source; only mypy's references to it. Step 4 manages the `Any` hole; it does not
  close it.
- **PEP 649/749 (deferred annotation evaluation) claims are inference, not sourced.** The
  reasoning that deferred evaluation changes *when* annotations evaluate, not *whether*
  gradual checking works, is defensible but was not verified against the PEPs.
- **No pyright.** Nothing here is claimed about editor-time feedback; the workflow covers CI.
