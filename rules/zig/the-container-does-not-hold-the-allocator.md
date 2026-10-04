---
title: "the container does not hold the allocator"
rule_id: "RULE-ZIG-005"
category: "correctness"
scope: "backend"
applies_to: "Zig, std.ArrayList, std.array_list.Aligned, manual memory management"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.array_list.Aligned"
---

# the container does not hold the allocator

`std.ArrayList` stores two fields — `items` and `capacity` — and neither is an allocator. In 0.16.0
the allocator is a *parameter of teardown*:

> pub fn deinit(self: *Self, gpa: Allocator) void
> ([std.array_list.Aligned — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.array_list.Aligned))

`initCapacity` takes one too, and so does every method that can allocate. The list cannot tell you
which allocator to free with, cannot remember a capacity to reuse, and cannot free itself when the
allocator is out of scope where the list dies.

That is a design choice with a sharp edge: the container cannot enforce that the allocator used to
grow it is the one used to free it, and neither can the compiler — `deinit` accepts any
`Allocator`. Ownership of the buffer is the caller's, stated in the signature rather than
guaranteed by the type.

The same page defines what "still using this" means, and the definition is stronger than it first
reads:

> Pointers to elements in this slice are invalidated by various functions of this ArrayList in
> accordance with the respective documentation. In all cases, "invalidated" means that the memory
> has been passed to an allocator's resize or free function.
> ([std.array_list.Aligned — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.array_list.Aligned))

"Invalidated" means **freed**, not merely stale. A pointer into `items` dies the moment the list
resizes — and a resize can be triggered by an `append` that appears nowhere near the code holding
the pointer.

## Why

A cross-allocator free is the failure. Building with a scratch arena and freeing with the process
allocator — or building with a per-request `DebugAllocator` and freeing after it is gone — is
correct Zig that the compiler accepts and that no test exercises, because the mismatch only shows
up in whichever allocator happens to check.

The invalidation rule is the half that hides. Holding `*T` into a list across an append is a use of
freed memory that reads as a normal pointer dereference, and the `append` that did it is often
several functions away. Nothing in the code that dereferences the pointer says anything is wrong.

The tutorial on the site is worse than silent here: it still teaches the single-argument
`std.ArrayList(i32).init(std.testing.allocator)`, and its own CI transcript records the compiler
rejecting exactly that. Copying from the page produces code that does not compile — which is the
loud version of a problem whose quiet version is worse.

## Do

- Build with `.empty` (`.init` is deprecated) and keep the allocator in a parameter, never in the
  list.
- Free with `deinit(gpa)` using the **same** allocator that grew the list. Whoever owns the
  allocator owns the list's lifetime.
- Use `toOwnedSlice(gpa)` when the buffer must outlive the allocator — it empties the list and
  transfers ownership of the memory to the caller:

  > The caller owns the returned memory. Empties this ArrayList. Its capacity is cleared, making
  > deinit() safe but unnecessary to call.
  > ([std.array_list.Aligned — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.array_list.Aligned))

- Take element pointers only with `addOne`/`addManyAsArray`, and re-take them after any operation
  that may allocate.
- Learn container APIs from the pinned std docs, not from the tutorial.

```zig
// Correct — the owner holds both, so the allocator and the list cannot be separated
fn buildList(self: Allocator) !std.ArrayList(Item) {
    var list: std.ArrayList(Item) = .empty;
    try list.append(self, .{ .id = 1 });
    return list;                    // caller frees with this same allocator
}

// Incorrect — the list is freed with an allocator it never grew with;
// this compiles, and only DebugAllocator notices
fn buildList(self: Allocator) !std.ArrayList(Item) {
    var list: std.ArrayList(Item) = .empty;
    try list.append(self, .{ .id = 1 });
    defer list.deinit(std.heap.page_allocator);   // cross-allocator free
    return list;
}
```

## Don't

- Don't store the allocator inside a struct that also owns an `ArrayList` grown from it — that
  creates the out-of-scope teardown the design is avoiding.
- Don't `deinit` with a different allocator "because it also frees memory". Correctness here is
  not about whether something is freed, it is about which allocator's bookkeeping is being edited.
- Don't hold `*T` or a sub-slice of `items` across an `append`, `insert`, `resize`, `shrink*` or
  `clearAndFree`. "Invalidated" means freed.
- Don't learn the API from `ziglang.org/learn/`. Its `init` example does not compile against the
  compiler its own CI runs.
- Don't call `toOwnedSlice` and then `deinit` as a habit — it is safe but unnecessary, and the
  habit hides which ownership regime the code is in.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Corruption only under `DebugAllocator` | Cross-allocator free | Free with the allocator that grew the list |
| Crash after the request scope returns | List outlived its allocator | `toOwnedSlice` to transfer ownership |
| Garbage value read from a cached pointer | Pointer invalidated by a resize | Re-take after any allocating call |
| `error: struct 'array_list.Aligned(i32,null)' has no member named 'init'` | Tutorial API, deprecated here | `.empty` + per-call allocator |
| Leak reported only in tests | `deinit` called with the wrong allocator | Same allocator, both ends |
| Double free after a `toOwnedSlice` refactor | Teardown kept alongside the transfer | `deinit` is unnecessary after transfer |

## Verifying

```bash
# Deinit calls -- check the allocator argument matches the one the list grew from
grep -rn --include='*.zig' -B12 '\.deinit(' src/ | grep -E '\.append\(|\.appendSlice\(|\.initCapacity\('

# The teardown argument, isolated: list what is actually being passed
grep -rn --include='*.zig' -E '\.deinit\((\s*self\s*|\s*gpa\s*|\s*allocator\s*|\s*self\.gpa\s*|\s*[a-z_]*\.allocator\(\)\s*)?\)' src/

# Deprecated initialization, and the tutorial's single-argument form
grep -rn --include='*.zig' -E 'ArrayList\([^)]*\)\.init\(|\.init\(std\.testing\.allocator\)' src/ tests/

# Element pointers held across a possible reallocation
grep -rn --include='*.zig' -E '\*\s*(const\s+)?[A-Z]\w*\s*=\s*&?[a-z_]+\.items\[' src/
```

The first two greps are the defect itself: a list whose growing allocator appears in the context
but not in the `deinit` argument. The third is the deprecated form the tutorial teaches. The
fourth finds the invalidation hazard, and each hit needs the pointer's live range read by hand —
grep cannot tell whether an allocating call falls inside it.

These greps cannot tell you whether a slice returned by `toOwnedSlice` is freed by the same
allocator it was grown from, because by then the allocator is a parameter somewhere further out.
That needs the ownership chain read, not a line match.