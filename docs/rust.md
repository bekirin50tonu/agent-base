---
language: "Rust"
tag: "rust"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Rust assets."
---

# Documentation Hub: Rust

> **Agent Directive (Phase 4)**: Inspect the target project's `Cargo.toml`. Match the conditions
> below to determine which `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover async lifetime and cancellation — the places Rust's implicit control
> flow is most often wrong. No `skills` yet.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/rust/async-fn-in-a-trait-is-not-dispatchable.md`
  - **Why**: An `async fn` in a trait has a hidden `Future` type, which silently makes the trait
    not dyn-compatible. The code compiles, monomorphises, and works — until the first `dyn Trait`
    is written, at which point the loss is a compile error with no obvious cause. This is the
    single most common reason a Rust codebase ends up boxed at every call site.
  - **When**: Target project defines a trait containing `async fn`, or boxes a future at a call
    site to make a trait usable, or uses `#[async_trait]`.
  - **Target Location**: `docs/rules/async-fn-in-a-trait-is-not-dispatchable.md`

- **Path**: `rules/rust/three-drop-semantics-for-one-task.md`
  - **Why**: `tokio::task` contains three types whose `Drop` means three different things:
    `JoinHandle` detaches, `JoinSet` aborts, `AbortHandle` merely releases the permission to
    abort. All three read as "stopping" at the call site, and `spawn_blocking` sits outside all
    three because it cannot be aborted at all. Detachment additionally swallows the task's
    `Result` and any panic, so a 4 ms shutdown looks identical to a clean one.
  - **When**: Target project calls `tokio::spawn`, holds a `JoinHandle`, uses a `JoinSet`, drops
    an `AbortHandle`, or spawns blocking work.
  - **Target Location**: `docs/rules/three-drop-semantics-for-one-task.md`

- **Path**: `rules/rust/select-branches-must-be-cancellation-safe.md`
  - **Why**: Every `tokio::select!` branch is a cancellation point, and whether losing one is
    harmless is a property of the future, not the call site. Tokio publishes two lists — futures
    that lose *data* (`read_exact`, `write_all`) and futures that lose *queue position*
    (`Mutex::lock`, `Semaphore::acquire`) — and the data-loss case surfaces as a protocol desync
    in a component with no reason to suspect the select loop.
  - **When**: Target project uses `tokio::select!`, or has a socket read or write racing a
    timeout, a shutdown signal, or another I/O source.
  - **Target Location**: `docs/rules/select-branches-must-be-cancellation-safe.md`

- **Path**: `rules/rust/select-returns-the-loser-join-drops-nothing.md`
  - **Why**: `tokio::select!` and `futures::future::select` have the same name and opposite
    cancellation behaviour — one drops the loser, the other hands it back to you. `join!` and
    `try_join!` are the other half: neither short-circuits, proven by `join.rs` polling both
    futures unconditionally with a non-short-circuiting `&=`. A slow second future delays an
    answer you already have.
  - **When**: Target project uses `join!`, `try_join!`, `select!`, `select_all` or
    `select_biased`, or assumes a race returns as soon as one branch completes.
  - **Target Location**: `docs/rules/select-returns-the-loser-join-drops-nothing.md`

- **Path**: `rules/rust/blocking-a-worker-stalls-everything-on-it.md`
  - **Why**: Concurrency inside a Tokio task is cooperative, so a blocking call stops every other
    task on that worker thread — not just itself. The escape hatch `block_in_place` panics on a
    `current_thread` runtime, which is exactly what `#[tokio::test]` builds by default: a suite
    that is entirely `flavor = "multi_thread"` structurally cannot exercise the configuration
    that panics in production.
  - **When**: Target project calls a sync library from an async task, uses `spawn_blocking` or
    `block_in_place`, or has a test suite using `#[tokio::test]`.
  - **Target Location**: `docs/rules/blocking-a-worker-stalls-everything-on-it.md`

- **Path**: `rules/rust/a-future-you-never-await-does-not-run.md`
  - **Why**: Futures are lazy, so a dropped future is not a cancelled computation — it is one
    that never started. Rustc's `#[must_use]` catches this, but it is a lint: it can be allowed,
    silenced crate-wide, or discarded with `let _ =`. A missing `.await` therefore becomes a
    function that returns `()` normally and did nothing.
  - **When**: Target project calls an async fn without `.await`, stores a future in a struct
    field with no owner polling it, or sets `unused_must_use = "allow"`.
  - **Target Location**: `docs/rules/a-future-you-never-await-does-not-run.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/rust/agent.json`
  - **Why**: Helps with Rust-related tasks, such as async and concurrency architecture, trait
    design for dyn compatibility, and applying Rust best practices.
  - **When**: Target project is a Rust project (has `Cargo.toml`).
  - **Target Location**: `docs/agents/rust/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/rust/async-concurrency-decisions.md`
  - **Why**: Four questions decide nearly every case in an async Rust codebase — do you need the
    result, must the loser be cancelled or kept, is the work CPU-bound or blocking, and does the
    trait need to be a trait object — and in every case the recommended primitive's own default is
    the more permissive, faster choice that fails silently. Includes the three drop semantics side
    by side and the traps that only appear when two of them interact.
  - **When**: Target project depends on `tokio` or `futures`, or has a module choosing between
    `select`/`join`/`JoinSet`/`spawn_blocking`/`rayon` — or a new trait that may need to be
    dispatched dynamically.
  - **Target Location**: `docs/rust/async-concurrency-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.