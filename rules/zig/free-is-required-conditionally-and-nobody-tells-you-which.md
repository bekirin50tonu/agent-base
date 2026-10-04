---
title: "free is required conditionally and nothing tells you which condition"
rule_id: "RULE-ZIG-001"
category: "correctness"
scope: "backend"
applies_to: "Zig, std.mem.Allocator, manual memory management"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator"
---

# free is required conditionally and nothing tells you which condition

`std.mem.Allocator` is an interface — two words and a vtable pointer — so a function that takes
one cannot know what will happen when it frees. The interface's own documentation declines to
promise that freeing is required at all:

> Allocates an array of n items of type T and sets all the items to undefined. Depending on the
> Allocator implementation, it may be required to call free once the memory is no longer needed,
> to avoid a resource leak. If the Allocator implementation is unknown, then correct code will
> call free when done.
> ([std.mem.Allocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator))

Read the middle sentence as the general rule and the last as the exception. A caller holding an
`ArenaAllocator` may legitimately skip the free; a caller holding an unknown allocator may not. Both
compile. Neither gets a diagnostic. The decision about whether `defer allocator.free(x)` is
required is pushed out of the type system and into whoever reads the docstring at each call site.

Underneath, the vtable is four function pointers. Three of them state a precondition the callee
cannot check:

> memory.len must equal the length requested from the most recent successful call to alloc, resize,
> or remap. alignment must equal the same value that was passed as the alignment parameter to the
> original alloc call.
> ([std.mem.Allocator.VTable — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.mem.Allocator.VTable))

The allocator receives a pointer and a length. It has no way to know whether they describe the
allocation it actually made, so freeing a resized slice frees with the wrong length. That is the
ownership story in one sentence: the invariant is documented four times and checked zero times,
because the callee lacks the state to check it.

## Why

"Always free, or you leak" is the rule most code follows, and following it is wrong in one
direction and insufficient in the other. Wrong: freeing individual items out of order on a
`FixedBufferAllocator` corrupts its own bookkeeping. Insufficient: an unconditional free on an arena
is legal and inconsequential, which teaches the next reader that the free was necessary — so when
the same code is handed a `page_allocator`, nothing distinguishes the two regimes.

The slice precondition is the sharper edge. `allocator.resize(buf, n)` followed by
`allocator.free(buf[0..old_len])` is not caught by the allocator, and safety-enabled builds need
not catch it either, because a `[]Token` of the wrong length is a perfectly well-typed value.

## Do

- Carry the allocator as a parameter typed `std.mem.Allocator`, and keep it out of globals. The
  conditional-free rule is only decidable if the implementation is known at the call site.
- Keep the slice you were given as the slice you free. Never reconstruct a length from other state.
- Treat a free as required until the implementation is known to be an arena or a fixed buffer, and
  say which it is in a comment where the choice is made.
- Bind the free to the scope that received the memory with `defer`, immediately after the
  successful allocation.
- Use `allocator.free` for arrays and `allocator.destroy` for single items — the interface
  documents the distinction rather than inferring it.

```zig
// Correct — the allocator is a parameter, and the freed slice is the allocated slice
fn parse(self: Allocator, input: []const u8) ![]Token {
    const buf = try self.alloc(Token, input.len);
    defer self.free(buf);            // required: the implementation may be any Allocator
    var used: usize = 0;
    // ... fill buf[0..used]
    return self.realloc(buf, used) catch buf[0..used];
}

// Incorrect — the length is reconstructed, so free receives a memory.len
// that does not match the most recent successful call
fn parse(self: Allocator, input: []const u8) ![]Token {
    const buf = try self.alloc(Token, input.len);
    defer self.free(buf[0..input.len / 2]);   // precondition violated
    // ...
}
```

## Don't

- Don't reach for a global or thread-local "current allocator" — it makes the implementation
  unknowable at the call site, which is the one thing this rule needs.
- Don't reconstruct a slice for `free` because you only cared about part of it. Free the whole
  allocation or none of it.
- Don't assume an unconditional free is harmless. It is legal on an arena and corrupt on a
  fixed buffer.
- Don't skip the free on the grounds that the allocator "probably" cleans up. That is exactly the
  case the interface's hedge covers, and `page_allocator` does not.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Corruption only under high alignment | Slice length does not match the last successful call | Free the slice you received |
| A buffer grows without bound in a request path | Free was skipped under the assumption an arena handles it | Propagate the allocator; do not assume |
| Leak detector reports nothing, memory still climbs | Free omitted where the implementation required it | Restore the free; verify with `DebugAllocator` |
| Works under `DebugAllocator`, breaks in production | Different implementation, same code | Make the freeing discipline explicit per call site |
| Double free or corruption on a fixed buffer | Individual frees issued out of allocation order | One `reset()` for the whole buffer |
| Crash in `free` with no diagnostic | Slice length or alignment violated | Free the allocation you were given, unmodified |

## Verifying

```bash
# The allocator behind each free -- is the implementation knowable here?
grep -rn --include='*.zig' -B4 '\.free(' src/ | grep -E 'allocator|gpa|arena'

# Frees whose argument is not plainly the allocation it came from
grep -rn --include='*.zig' -E '\.free\([^)]*\[0\.\.|\.free\([^)]*\.items\[[^]]*\.|\.free\([^)]*\bslice\b' src/

# Allocating call sites with no free anywhere near them
grep -rn --include='*.zig' -A6 '\.alloc\(|\.create\(' src/ | grep -vE 'free|destroy|defer|errdefer'

# Code reaching for a shared allocator instead of taking one
grep -rn --include='*.zig' -E 'var g_allocator|threadlocal .*llocator|pub var allocator' src/
```

The first list tells you, per call site, whether the freeing rule was decidable. The second is
where the vtable precondition is most likely violated. The third is the direct analogue of a leak
check whose verdict nobody reads.

These greps cannot tell you whether an `ArenaAllocator` you are handing out will outlive the
pointers it vends, or whether a slice's length was mutated between the `resize` and the `free`.
Those need the surrounding scope read, not a line match.