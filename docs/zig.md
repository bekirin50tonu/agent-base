---
language: "Zig"
tag: "zig"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Zig allocator and ownership assets."
---

# Documentation Hub: Zig

> **Agent Directive (Phase 4)**: Inspect the target project's `build.zig` and grep for
> `alloc(`, `.free(`, `ArenaAllocator`, `DebugAllocator`, `ArrayList` and `addTest`. Match the
> conditions below to determine which `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover allocator ownership — the places where Zig's defaults compile, pass,
> and quietly do nothing. No `skills` yet.
>
> **Version note**: verified against **0.16.0**, the newest release with published std docs.
> 0.17.0 is current stable but its std documentation 404s, so re-check the `ArrayList` shape
> before relying on the per-call allocator described below. `ziglang.org/learn/` still teaches
> the deprecated `ArrayList(i32).init(allocator)` form.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/zig/free-is-required-conditionally-and-nobody-tells-you-which.md`
  - **Why**: `std.mem.Allocator`'s own `alloc` docstring says free "may be required" depending
    on the implementation, and that correct code calls it when the allocator is unknown — so both
    skipping and calling it are documented, and the signature encodes neither. Underneath, three
    of the four vtable functions require that `memory.len` and `alignment` equal what the last
    successful `alloc` was given, a precondition the callee has no state to check. Freeing a
    resized slice with its old length is correct-looking, well-typed code.
  - **When**: Target project has a function taking `std.mem.Allocator`, frees a reconstructed or
    partially-sliced buffer, or reaches for a global/thread-local allocator instead of a parameter.
  - **Target Location**: `docs/rules/free-is-required-conditionally-and-nobody-tells-you-which.md`

- **Path**: `rules/zig/an-arena-free-that-does-nothing-is-still-a-compiling-free.md`
  - **Why**: "Calls to free an individual item only free the item if it was the most recent
    allocation, otherwise calls to free do nothing." An out-of-order free returns, compiles, and
    leaves the allocation live. The same type documents that the allocator it hands out is
    threadsafe given a threadsafe child while its `deinit` is "Not threadsafe" — so sharing
    `arena.allocator()` with workers is sound and sharing `&arena` is not.
  - **When**: Target project uses `ArenaAllocator`, has per-item `.free()` calls on memory from an
    arena, or shares an arena across threads.
  - **Target Location**: `docs/rules/an-arena-free-that-does-nothing-is-still-a-compiling-free.md`

- **Path**: `rules/zig/is-last-allocation-has-documented-false-negatives.md`
  - **Why**: `FixedBufferAllocator.isLastAllocation` documents that it "has false negatives when
    the last allocation had an adjusted_index", because `alignForward` is not reversible. A
    predicate that returns `false` for a slice that *was* the last allocation converts a correct
    free into a silent leak. `ownsPtr`/`ownsSlice` sit beside it with the same hazard and no
    caveat. The threadsafety note hangs off `allocator()`, not `threadSafeAllocator()`, so both
    interfaces read as safe to hold at once.
  - **When**: Target project uses `FixedBufferAllocator`, branches on `isLastAllocation`, or holds
    both `allocator()` and `threadSafeAllocator()` over one buffer.
  - **Target Location**: `docs/rules/is-last-allocation-has-documented-false-negatives.md`

- **Path**: `rules/zig/the-leak-check-is-a-return-value-you-can-discard.md`
  - **Why**: `DebugAllocator.deinit` returns `std.heap.Check`, and `defer` accepts a void
    expression — so `defer gpa.deinit();`, the spelling the type's own examples use, discards the
    verdict. The leak is detected and the detection is thrown away. The type provides
    `deinitWithoutLeakChecks` as a named alternative, which makes the *wrong* choice look
    deliberate in grep results and the right one look like nothing at all.
  - **When**: Target project calls `DebugAllocator`, or uses `std.testing.allocator` without
    `checkAllAllocationFailures`.
  - **Target Location**: `docs/rules/the-leak-check-is-a-return-value-you-can-discard.md`

- **Path**: `rules/zig/the-container-does-not-hold-the-allocator.md`
  - **Why**: `ArrayList` stores `items` and `capacity` and no allocator — `deinit(self, gpa)`
    takes it as a parameter, as does every allocating method. So neither the container nor the
    compiler can enforce that the allocator which grew the list is the one that frees it, and
    `deinit` accepts any `Allocator`. The same page defines "invalidated" as "the memory has been
    passed to an allocator's resize or free function" — invalidated means freed, not merely stale.
  - **When**: Target project uses `std.ArrayList`, `ArrayHashMap`, `AutoHashMap` or
    `StringHashMap`, holds element pointers across an `append`, or learns the API from
    `ziglang.org/learn/`.
  - **Target Location**: `docs/rules/the-container-does-not-hold-the-allocator.md`

- **Path**: `rules/zig/build-test-runs-per-target-or-not-at-all.md`
  - **Why**: `addTest` compiles a test artifact for a target; only `dependOn` on the result of
    `addRunArtifact` makes it execute. An artifact that is built but never depended on is not run
    and `zig build` reports success — and the target list is a hand-written array literal, so
    "cross-platform tests pass" can mean one platform, with the others type-checked only.
  - **When**: Target project has a `build.zig` with `addTest`, or a CI matrix that varies the
    runner while `resolveTargetQuery` resolves only the native target.
  - **Target Location**: `docs/rules/build-test-runs-per-target-or-not-at-all.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/zig/agent.json`
  - **Why**: Helps with Zig-related tasks, such as allocator and ownership decisions,
    ArenaAllocator and fixed-buffer scoping, std.ArrayList buffer lifetimes, build.zig test wiring
    across targets, and applying Zig best practices.
  - **When**: Target project is a Zig project (has `build.zig`).
  - **Target Location**: `docs/agents/zig/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/zig/zig-allocator-ownership-decisions.md`
  - **Why**: Four questions decide the allocator for nearly every component — what is the
    memory's lifetime, does the container or the caller own the buffer, is anyone freeing
    individual items, is this code under test — and none of them line up with the type names. The
    matrix names each mechanism *and* the default it ships with, because in `std` the default is
    nearly always the permissive choice: the arena free that does nothing, the discarded `Check`,
    the opt-in `checkAllAllocationFailures`, the compile-only test target.
  - **When**: Target project picks an allocator, chooses between `ArenaAllocator` /
    `FixedBufferAllocator` / `page_allocator` / `smp_allocator`, or decides who owns a buffer.
  - **Target Location**: `docs/zig/zig-allocator-ownership-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.