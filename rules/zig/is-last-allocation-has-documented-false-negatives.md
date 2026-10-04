---
title: "isLastAllocation has documented false negatives"
rule_id: "RULE-ZIG-003"
category: "correctness"
scope: "backend"
applies_to: "Zig, std.heap.FixedBufferAllocator, manual memory management"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.heap.FixedBufferAllocator"
---

# isLastAllocation has documented false negatives

`FixedBufferAllocator` is the allocator people reach for when they want to *prove* ownership — a
parser, a decoder, a fixed-size scratch buffer. You cannot free out of order, so the type offers
predicates to help. One of them documents its own unreliability:

> This has false negatives when the last allocation had an adjusted_index. In such case we won't
> be able to determine what the last allocation was because the alignForward operation done in
> alloc is not reversible.
> ([std.heap.FixedBufferAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.FixedBufferAllocator))

A predicate that returns `false` for a slice that *was* the last allocation is the most dangerous
shape a helper can have. `false` means "not the most recent, so freeing it is a no-op" — so a false
negative converts a correct free into a silent leak. The cause is named precisely: `alignForward`
is not reversible, so once alignment adjustment has occurred the bump pointer's history is
unrecoverable.

Beside it sit two predicates with no such caveat and the same hazard class: `ownsPtr` and
`ownsSlice` return a `bool` that is trivially ignored, and freeing a pointer that came from a
different arena is exactly the mistake a fixed buffer cannot detect — it will happily corrupt.

The threadsafety note is attached to the wrong-looking function, which makes it easy to read past:

> Using this at the same time as the interface returned by threadSafeAllocator is not thread
> safe.
> ([std.heap.FixedBufferAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.FixedBufferAllocator))

The note hangs off `allocator()`, not off `threadSafeAllocator`. Both interfaces can be live at
once, and mixing them is unsound.

## Why

A component that reaches for these predicates is trying to make ownership provable — in exactly
the places where a proof is most valuable and a wrong answer is most expensive. The documented false
negative bites there.

The failure is a leak that grows with alignment-heavy workloads, which is why it looks intermittent:
whether the last allocation had an `adjusted_index` depends on the alignment of that one call.

## Do

- Do not use `isLastAllocation` to decide whether to free. Make the ordering correct by
  construction — free in reverse, or reset.
- Use `ownsSlice` when checking a pointer's provenance, and treat `false` as an error rather than a
  branch to take.
- Pick one interface per allocator: either `allocator()` or `threadSafeAllocator()`, never both
  concurrently.
- Use `queryCapacity` for capacity questions. It is exact, unlike the last-allocation predicate.
- Reach for `std.heap.MemoryPool` when you need fixed-size slots with unambiguous ownership.

```zig
// Correct — ordering is structural, so no predicate decides correctness
fn decode(buf: []u8) !Frame {
    var fba = std.heap.FixedBufferAllocator.init(buf);
    defer fba.reset();               // one teardown for the whole buffer

    const header = try fba.allocator().alloc(Header, 1);
    const body = try fba.allocator().alloc(u8, header.len);
    // no per-item frees: reset handles it, in the right order, always
}

// Incorrect — a false negative from isLastAllocation silently
// turns a real free into a no-op
fn decode(buf: []u8) !Frame {
    var fba = std.heap.FixedBufferAllocator.init(buf);
    const header = try fba.allocator().alloc(Header, 1);
    const body = try fba.allocator().alloc(u8, header.len);
    if (fba.isLastAllocation(body)) fba.allocator().free(body);  // may be false when it was
    fba.allocator().free(header);
}
```

## Don't

- Don't branch on `isLastAllocation` to decide whether a free is needed. A `false` there is
  ambiguous between "not last" and "cannot tell".
- Don't use `ownsPtr` or `ownsSlice` as a soft warning — a pointer's provenance is a precondition,
  not a diagnostic.
- Don't hold both `allocator()` and `threadSafeAllocator()` interfaces over one buffer.
- Don't assume a `false` from an ownership predicate means the free was unnecessary; on this type
  it means the question was unanswerable.
- Don't grow a fixed buffer allocator by replacing the buffer while keeping the old interface
  live — reset instead.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Small leak that appears only under alignment pressure | `isLastAllocation` false negative | Remove the predicate; reset instead |
| Leak grows with the number of decodes | Ordered frees on a fixed buffer | One `reset()` per operation |
| Corruption when memory is reused across calls | Two interfaces over one buffer | Use one interface only |
| Wrong buffer freed after a refactor | `ownsPtr` result ignored | Assert on ownership; treat false as fatal |
| Capacity reporting disagrees with the caller's accounting | `queryCapacity` excludes bookkeeping | Compare against user allocations only |

## Verifying

```bash
# The predicate used as a control-flow gate -- each is a potential silent no-op free
grep -rn --include='*.zig' -E 'if \(.*isLastAllocation' src/ tests/

# Ownership predicates whose result is not asserted on
grep -rn --include='*.zig' 'ownsPtr\|ownsSlice' src/ tests/

# One allocator, both interfaces
grep -rn --include='*.zig' 'threadSafeAllocator' src/ tests/

# Per-item frees on a fixed buffer, which must be in reverse order by hand
grep -rn --include='*.zig' -A6 'FixedBufferAllocator\.init' src/ tests/ | grep '\.free('
```

The first list is the defect itself. The fourth is the same hazard as `RULE-ZIG-002`, one type
over: a free that does not do what the code assumes.

These greps cannot tell you whether the alignment that triggers the false negative is the one that
fires in production — that is data-dependent, and needs a leak check with the verdict propagated
(`RULE-ZIG-004`) rather than a source read.