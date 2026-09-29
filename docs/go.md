---
language: "Go"
tag: "go"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for Go assets."
---

# Documentation Hub: Go

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`go.mod`). Match
> the conditions below to determine which `rules`, `skills`, `agents`, or `shared` assets to
> inject.
>
> **Status**: rules cover context lifetime and goroutine exit — the two places Go's implicit
> control flow is most often wrong. No `skills` or `agents` yet.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/go/context-cancel-func-leak.md`
  - **Why**: A `CancelFunc` that is not called leaks the child context *and its children* until
    the parent is cancelled — which, for a package-level background context, is never. The
    failure is invisible under test and shows up as memory growth under sustained load.
  - **When**: Target project contains any `context.WithCancel`, `WithTimeout`, or
    `WithDeadline` call, or derives a context inside an HTTP/gRPC handler or worker loop.
  - **Target Location**: `docs/rules/context-cancel-func-leak.md`

- **Path**: `rules/go/context-value-discipline.md`
  - **Why**: `context.WithValue` is the only way to make a required dependency invisible to
    the compiler, and a `string` key is the only way to make two packages silently overwrite
    each other. Both are forbidden by the godoc and neither is caught by any tool.
  - **When**: Target project calls `context.WithValue` with a non-struct key type, or reads
    `ctx.Value` without a type assertion, or reads one with a bare assertion and no `ok`.
  - **Target Location**: `docs/rules/context-value-discipline.md`

- **Path**: `rules/go/errgroup-setlimit-deadlock.md`
  - **Why**: `errgroup.Go` *blocks* at the limit rather than queueing — a deliberate design
    choice, since queueing to a bounded executor "is much too prone to deadlocks". A `Go` from
    inside a group goroutine therefore hangs forever, and `go g.Go(f)` lets `Wait` return
    before the work starts.
  - **When**: Target project imports `golang.org/x/sync/errgroup` and calls `SetLimit`, or
    calls `Go` from inside a goroutine the group started, or writes `go g.Go(...)`.
  - **Target Location**: `docs/rules/errgroup-setlimit-deadlock.md`

- **Path**: `rules/go/loop-variable-capture-gate.md`
  - **Why**: Go 1.22's per-iteration loop variables are gated on the `go` directive in
    `go.mod`, not on the installed toolchain — and `go vet` was simultaneously taught to stop
    reporting captures. A clean vet run therefore proves nothing, and table-driven tests
    combining `t.Run` + `t.Parallel()` were passing because every subtest asserted the same
    final value.
  - **When**: Target project has a `go.mod` with `go 1.21` or lower, or is considering a
    bump past 1.22, or has table-driven tests using `t.Parallel()` over per-case data.
  - **Target Location**: `docs/rules/loop-variable-capture-gate.md`

- **Path**: `rules/go/goroutine-lifetime-obvious.md`
  - **Why**: An unreachable channel does not make a blocked goroutine collectable — the
    goroutine *is* the reference. Unowned goroutines leak silently, and outliving their
    input produces data races that surface long after the code was written.
  - **When**: Target project starts goroutines outside an `errgroup` or `sync.WaitGroup`, or
    a component is documented as fire-and-forget.
  - **Target Location**: `docs/rules/goroutine-lifetime-obvious.md`

## 2. Skills (`skills/`)
_Empty — no Go skills have been synthesized._

## 3. Agents (`agents/`)
_Empty — no Go agents have been synthesized._

## 4. Shared Assets (`shared/`)
_Empty — no Go-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
