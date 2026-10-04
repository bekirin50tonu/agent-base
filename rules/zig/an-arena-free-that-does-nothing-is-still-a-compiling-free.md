---
title: "an arena free that does nothing is still a compiling free"
rule_id: "RULE-ZIG-002"
category: "correctness"
scope: "backend"
applies_to: "Zig, std.heap.ArenaAllocator, manual memory management"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.heap.ArenaAllocator"
---

# an arena free that does nothing is still a compiling free

`ArenaAllocator` wraps another allocator and frees everything at once. What it does with an
individual free is stated in the type's own description:

> This allocator takes an existing allocator, wraps it, and provides an interface where you can
> allocate and then free it all together. Calls to free an individual item only free the item if
> it was the most recent allocation, otherwise calls to free do nothing.
> ([std.heap.ArenaAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.ArenaAllocator))

The second sentence is the whole hazard. A free of a non-most-recent item **succeeds**, in the only
sense a `void` function can: it returns, it compiles, and the allocation stays live. The caller
receives no signal, because there is no signal to receive.

The order dependence is what survives into code review as a non-issue. Two allocations from the
same arena, freed in reverse order, are both real frees. The same two allocations freed in source
order leave the first one live. Nothing about the two call sites differs.

The struct also carries a thread-safety asymmetry it documents in two places at once: the allocator
it hands out is threadsafe given a threadsafe child, while teardown is not.

> The Allocator implementation provided is threadsafe, given that child_allocator is threadsafe as
> well.
> ([std.heap.ArenaAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.ArenaAllocator))

> Not threadsafe.
> ([std.heap.ArenaAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.ArenaAllocator))

A pool handing out `arena.allocator()` to workers is sound. A pool handing out `&arena` and calling
`deinit` on it is not.

## Why

The code reads correctly under every tool that exists. It has a free for each allocation, in scope,
via `defer`. Static analysis sees a balanced pair. The only thing distinguishing the working version
from the leaking version is the order of two statements a reviewer reads independently.

This is the shape that generalises. An allocator that frees in bulk makes per-item frees *optional*
rather than wrong, so a codebase that grew up on an arena carries a free on every path by habit —
and those frees are no-ops by design. Later, one caller is handed a different allocator and inherits
a discipline that was never doing anything.

## Do

- Inside an arena scope, free the arena once at the end and do not free individual items.
- If individual frees are genuinely needed, they must be in strict reverse allocation order, which
  is why arenas and per-item freeing do not mix in practice.
- Never let an arena escape the function that owns it. Hand out slices with a lifetime, not the
  arena.
- Treat teardown as single-owner even where the allocator it exposes is threadsafe.
- Use `queryCapacity` when you want an arena's current usage — it excludes internal bookkeeping, so
  it is the only honest number.

```zig
// Correct — one owner, one teardown, no per-item frees to get wrong
fn render(self: Allocator, nodes: []const Node) ![]u8 {
    var arena = std.heap.ArenaAllocator.init(self);
    defer arena.deinit();               // frees everything; no per-item free anywhere

    var out: std.ArrayList(u8) = .empty;
    for (nodes) |n| try out.appendSlice(try renderOne(arena.allocator(), n));
    return self.dupe(u8, out.items);
}

// Incorrect — the first free is a no-op because the second allocation
// is more recent; both calls compile and both return
fn render(self: Allocator, nodes: []const Node) ![]u8 {
    var arena = std.heap.ArenaAllocator.init(self);
    defer arena.deinit();

    const a = try arena.allocator().alloc(u8, 64);
    const b = try arena.allocator().alloc(u8, 64);
    arena.allocator().free(a);   // no-op: b is the most recent allocation
    arena.allocator().free(b);
    // `a` is still live and nothing said so
}
```

## Don't

- Don't call `free` on arena memory at all. The habit is the hazard; it is correct nowhere and
  silently wrong for the common case.
- Don't keep an `ArenaAllocator` in a struct or a global that outlives the request it serves.
- Don't call the teardown from more than one place on the assumption that "freeing twice is safe"
  — that is true of `free`, not of arena teardown.
- Don't assume threadsafety of the exposed allocator implies threadsafety of the arena itself.
- Don't mix an arena with a separately-owned long-lived allocation whose lifetime must survive the
  arena.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Memory grows with allocation count inside a scope | Per-item frees issued out of order | Remove the per-item frees; teardown once |
| Peak memory higher than expected for a request | Arena never reset, and the scope repeats | `defer` the teardown in the owning scope |
| Heap corruption after enabling an arena | Individual frees issued out of order | Arena frees in bulk; remove per-item frees |
| Crash under concurrency in a worker pool | Teardown called while allocations are in flight | One owner for teardown; share only `arena.allocator()` |
| `queryCapacity` disagrees with observed usage | Internal bookkeeping is excluded by design | Treat it as user allocations only |

## Verifying

```bash
# Per-item frees on memory that came from an arena -- the habit to remove
grep -rn --include='*.zig' -B8 'arena\.allocator()\.free\|\.free(' src/ | grep -A8 'arena\.allocator()'

# Arenas declared anywhere they could outlive their scope
grep -rn --include='*.zig' -E 'var arena: |arena: std\.heap\.ArenaAllocator|= ArenaAllocator\.init' src/ tests/

# Teardown call sites -- each must have exactly one owner
grep -rn --include='*.zig' 'arena\.deinit()' src/ tests/

# Arenas stored in a struct or a global, which is how they escape their scope
grep -rn --include='*.zig' -E '^\s*(pub )?[a-z_]*: std\.heap\.ArenaAllocator' src/
```

The first list is the defect; the rest describe the shapes that let it survive. The third list is
where a second teardown would hide if one existed.

These greps cannot tell you whether a slice vended by an arena outlives the arena's teardown, which
is the failure that does not show up as any of the rows above. That needs the lifetimes read, not a
line match.