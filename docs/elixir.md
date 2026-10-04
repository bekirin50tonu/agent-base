---
language: "Elixir"
tag: "elixir"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Elixir/OTP assets."
---

# Documentation Hub: Elixir

> **Agent Directive (Phase 4)**: Inspect the target project's `mix.exs` and its `lib/*_application`
> / supervision tree. Match the conditions below to determine which `rules`, `skills`, `agents`,
> or `shared` assets to inject.
>
> **Status**: rules cover supervision and process lifecycle — the places OTP's defaults fail
> silently rather than loudly. No `skills` yet.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/elixir/terminate-is-not-guaranteed-to-run.md`
  - **Why**: `GenServer`'s `terminate/2` documentation opens with "It should do any cleanup
    required" and twenty words later states it is "not guaranteed that terminate/2 is called when
    a GenServer exits", then enumerates four conditions that skip it: `:brutal_kill` in the child
    spec, a timeout expiring mid-cleanup, a non-`:normal` signal from any linked process, and a
    `:kill` arriving before the mailbox drains. Cleanup that exists only there is skipped exactly
    when it is needed, and the resource it holds has no other owner.
  - **When**: Target project implements `terminate/2`, opens a file, socket, subscription or lease
    inside a GenServer, or sets `brutal_kill` in a child spec.
  - **Target Location**: `docs/rules/terminate-is-not-guaranteed-to-run.md`

- **Path**: `rules/elixir/an-exit-signal-from-any-linked-process-skips-cleanup.md`
  - **Why**: A process not trapping exits dies when *any* linked process exits abnormally — the
    default for every link, not a supervision policy. `Task.async` links bidirectionally on
    purpose, so a fire-and-forget helper built on it takes down the caller when it fails; `:kill`
    is untrappable. A request dies with a reason that appears nowhere in its own code path.
  - **When**: Target project uses `Task.async`, links processes for lifecycle, sets
    `Process.flag(:trap_exit, true)`, or has a supervisor restart loop with no exception logged.
  - **Target Location**: `docs/rules/an-exit-signal-from-any-linked-process-skips-cleanup.md`

- **Path**: `rules/elixir/permanent-is-the-default-and-it-erases-the-crash.md`
  - **Why**: `:restart` defaults to `:permanent`, and the supervisor decides whether a child
    should come back *before* the strategy is consulted — ":temporary … never restarted,
    regardless of the supervision strategy". So a one-shot job written from a copied template
    restarts forever, and a deliberate `GenServer.stop/1` is indistinguishable from a crash.
  - **When**: Target project writes child specs without `restart:`, or has a job that repeats
    itself, or restarts workers after an intentional stop.
  - **Target Location**: `docs/rules/permanent-is-the-default-and-it-erases-the-crash.md`

- **Path**: `rules/elixir/strategy-choice-is-answered-by-start-order-not-by-dependency.md`
  - **Why**: The three strategies are defined over the `children` **list**, not over dependencies:
    `:rest_for_one` restarts "the children started after it". The list order is the only
    dependency declaration a supervisor has, nothing enforces it, and children terminate in
    reverse order. Choosing by blast radius rather than by position is why an unrelated worker
    loses its warm cache on every neighbour's failure.
  - **When**: Target project chooses between `:one_for_all`, `:rest_for_one` and `:one_for_one`,
    or has children restarting that share no state with the failed one.
  - **Target Location**: `docs/rules/strategy-choice-is-answered-by-start-order-not-by-dependency.md`

- **Path**: `rules/elixir/max-children-defaults-to-infinity.md`
  - **Why**: `max_children` is optional and defaults to `:infinity`, so a dynamic supervisor
    started with a name and nothing else is unbounded — the `{:error, :max_children}` branch is
    never reached, so it is never exercised. The parent `Task.Supervisor` is a single process,
    which the documentation itself answers with `PartitionSupervisor` keyed on `self()`.
  - **When**: Target project calls `DynamicSupervisor.start_child/2`, starts a `Task.Supervisor`,
    or has latency and memory climbing with request rate without any error.
  - **Target Location**: `docs/rules/max-children-defaults-to-infinity.md`

- **Path**: `rules/elixir/async-copies-the-whole-closure.md`
  - **Why**: `Task.async` gives the task "a copy of all the variables and aliases in the caller's
    context", so per-request fan-out copies the whole request heap. And `Agent.get/2` followed by
    a separate write loses updates: the agent serialises each call, not the sequence around them.
    Both produce working code in development and wrong code under concurrency.
  - **When**: Target project uses `Task.async`, `Agent.get/2` with a following `Agent.update/2`, or
    keeps shared mutable state outside `:ets`.
  - **Target Location**: `docs/rules/async-copies-the-whole-closure.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/elixir/agent.json`
  - **Why**: Helps with Elixir-related tasks, such as OTP supervision tree design, restart
    strategies, process lifecycle and failure containment, and applying Elixir best practices.
  - **When**: Target project is an Elixir project (has `mix.exs`).
  - **Target Location**: `docs/agents/elixir/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/elixir/elixir-otp-decisions.md`
  - **Why**: Five questions decide nearly every case in an OTP codebase — may the state be lost,
    must cleanup survive a crash, should the failure reach the caller, is the fan-out bounded,
    are the children independent — and in each case the shipped default is the more permissive
    option that fails silently. Includes the defaults table across OTP, Phoenix and Ecto, and the
    package-matching trap where `Ecto.Multi`'s function variants skip the pre-transaction
    validation its changeset variants perform.
  - **When**: Target project depends on OTP, Phoenix or Ecto, or has a module choosing between
    `Supervisor`/`DynamicSupervisor`/`Task.Supervisor`/`PartitionSupervisor`/`Agent`.
  - **Target Location**: `docs/elixir/elixir-otp-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
