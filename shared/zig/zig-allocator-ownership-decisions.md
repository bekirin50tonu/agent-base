---
title: "Zig — which allocator, and who calls free"
category: "correctness"
scope: "backend"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator"
---

# Zig — which allocator, and who calls `free`

Four questions decide the allocator for nearly every component in a Zig codebase. They do not line
up with the type names: `std.ArrayList` is not "the allocating one", `free` is not always required,
and the leak detector reports nothing unless the caller opts in.

So each answer below names the mechanism *and* the default it ships with, because in `std` the
default is nearly always the permissive choice and the failure is the default behaving exactly as
documented.

This sits one level below `RULE-ZIG-001` … `RULE-ZIG-006`, which explain each mechanism. This
matrix is for choosing between them.

## The four questions

1. **What is the lifetime of the memory?** One function → stack buffer or `stackFallback`. One
   request/parse/frame → `ArenaAllocator`, freed once at the end. The life of the process →
   `page_allocator` or `smp_allocator`, freed individually. (`RULE-ZIG-001`)
2. **Does this component own the buffer, or does its caller?** The container holds no allocator, so
   the owner is whoever holds both. Caller owns → build with `.empty`, free with `deinit(gpa)` using
   the same allocator. Buffer must outlive the allocator → `toOwnedSlice(gpa)`, the one call that
   transfers ownership. (`RULE-ZIG-005`)
3. **Is anyone freeing individual items?** Yes, in allocation order → a real allocator. Yes,
   unordered → arena, and delete the per-item frees. No → arena, unconditionally.
   (`RULE-ZIG-002`, `RULE-ZIG-003`)
4. **Is this code under test?** Yes → `DebugAllocator` **with the `Check` propagated**, and
   `checkAllAllocationFailures` for the failure paths. No → the production allocator.
   (`RULE-ZIG-004`)

## The defaults, in one table

Each is correct for the common case, and each is a silent failure in the other one.

| Decision | Shipped default | The default's failure |
|---|---|---|
| Whether to `free` | Free on every path | Inert on an arena, and the habit outlives the arena |
| Arena teardown | One `deinit` for the scope | Per-item `free` compiles and does nothing unless most recent |
| Fixed buffer teardown | Ordered per-item `free` | Any out-of-order `free` corrupts its bookkeeping |
| `isLastAllocation` | `bool` | Documented false negatives turn a real free into a leak |
| `DebugAllocator` teardown | `defer gpa.deinit();` | The `Check` is discarded — the leak is found and unreported |
| `ArrayList` init | `.empty`, per-call allocator | `init` is deprecated; the tutorial still teaches it |
| Test allocator | `std.testing.allocator` | Scoped to temporary test programs by its own docs |
| `addTest` per target | Compiled | Runs only where `dependOn` says so; the rest is a type check |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Scoped to a function | stack buffer, `stackFallback` | `page_allocator` | Frame-sized; falls through silently |
| Scoped to a request/parse | `ArenaAllocator` + one `deinit` | per-item `free` | Frees out of order are no-ops |
| Owned by a container | store the allocator alongside the container | container frees itself | Teardown needs an allocator you no longer have |
| Owned by the caller | `.empty` + `deinit(gpa)` at the site | `deinit()` with no allocator | Won't compile; the argument is required |
| Long-lived, threaded | `smp_allocator` | `ArenaAllocator` shared across threads | `deinit` is not threadsafe |
| Raw memory, no container | `page_allocator` | `c_allocator` | Syscall per allocation and free |
| FFI / C interop | `c_allocator` | `page_allocator` | Alignment requests may need bigger buffers |
| Per-slot fixed storage | `std.heap.MemoryPool` | `ArrayList` of slots | Slots are fixed-size; a larger request is refused |
| Under test | `DebugAllocator`, `Check` propagated | `deinit()` as a statement | Detects the leak, reports nothing |
| Testing failure paths | `checkAllAllocationFailures` | a happy-path-only suite | Never exercises the skip-the-free path |

## The package-matching pattern

Three rows above share a shape worth naming, because it recurs in every Zig domain and it is the
general form of this whole matrix: **the recommended diagnostic silently does nothing unless the
caller opts in.**

- `DebugAllocator` requires the `Check` to be read, and `defer` discards it for free.
- `checkAllAllocationFailures` requires a call nothing makes for you.
- `std.testing.allocator` is scoped to tests by its own documentation.
- `isLastAllocation` documents that it cannot answer the question in some cases, and returns
  `false` rather than erroring.

In each case the instrument is correct, its invocation is the thing that under-reports, and the
resulting report is green. When adopting any new `std` diagnostic, the question to ask is not
"does it detect this" but "what must the caller do for the detection to be reported at all."

## Three rules that hold across the matrix

1. **The allocator is a parameter, never a global.** Whether `free` is required is decidable only
   if the implementation is known at the call site. (`RULE-ZIG-001`)
2. **Free in one place, in one order.** Arena → `deinit`. Fixed buffer → `reset`. Real allocator →
   `defer` at the allocation. Never a mix. (`RULE-ZIG-002`, `RULE-ZIG-003`)
3. **A leak check that is not propagated did not happen.** (`RULE-ZIG-004`)

## Sources

- [std.mem.Allocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator)
- [std.mem.Allocator.VTable — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator.VTable)
- [std.heap.ArenaAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.ArenaAllocator)
- [std.heap.FixedBufferAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.FixedBufferAllocator)
- [std.heap.DebugAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.DebugAllocator)
- [std.array_list.Aligned — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.array_list.Aligned)
- [std.testing — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.testing)
- [Zig Build System](https://ziglang.org/learn/build-system/)

## Version note

The matrix is written against **0.16.0**, the newest Zig release with published std docs. 0.17.0 is
current stable but its std documentation 404s, so the API shapes here — in particular
`ArrayList`'s per-call allocator and the absence of an `Unmanaged` variant — are verified at 0.16.0
and should be re-checked against 0.17.0 before being relied on. `ziglang.org/learn/` still shows
the deprecated `ArrayList(i32).init(allocator)` form; its own CI transcript records that form
failing to compile.