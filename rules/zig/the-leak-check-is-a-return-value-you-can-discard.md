---
title: "the leak check is a return value you can discard"
rule_id: "RULE-ZIG-004"
category: "correctness"
scope: "backend"
applies_to: "Zig, std.heap.DebugAllocator, testing"
last_updated: "2026-10-04"
source: "https://ziglang.org/documentation/0.16.0/std/#std.heap.DebugAllocator"
---

# the leak check is a return value you can discard

`std.heap.DebugAllocator` is the allocator you are told to use to find leaks. Its teardown returns
the verdict:

> pub fn deinit(self: *Self) std.heap.Check
>
> Returns std.heap.Check.leak if there were leaks; std.heap.Check.ok otherwise.
> ([std.heap.DebugAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.DebugAllocator))

`std.heap.Check` has two members, `ok` and `leak`. And `defer` accepts a void expression — so
`defer gpa.deinit();`, the spelling the type's own examples use, **discards the verdict entirely**.
The leak is detected and the detection is thrown away.

The type provides the escape hatch by name:

> pub fn deinitWithoutLeakChecks(self: *Self) void
>
> Like deinit, but does not check for memory leaks. This is useful if leaks have already been
> detected manually with detectLeaks to avoid reporting them for a second time.
> ([std.heap.DebugAllocator — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.heap.DebugAllocator))

So there are two teardowns — one that checks, one that does not — differing by a prefix at the call
site, with no type-level way to tell them apart. Choosing the checking one requires the caller to
know that its `defer` statement is discarding a result.

This is the strongest instance of the pattern in Zig: the recommended diagnostic's own default
invocation discards its output. Using `DebugAllocator` to find leaks, and calling its teardown the
ordinary way, finds them and reports nothing.

## Why

Leak detection in a test suite is usually the only automated check on allocator correctness. If the
verdict is discarded — which is the natural spelling — the suite has no leak coverage at all, and
reports green. Nobody notices, because the absence of a failure is exactly what a passing suite
looks like.

The two-name design makes the wrong choice look deliberate. `deinitWithoutLeakChecks` is
self-documenting and reads as an intentional API in grep results. `defer gpa.deinit()` reads as
nothing at all — which is precisely why it goes unreviewed.

## Do

- Propagate the `Check`: compare it against `.ok` and turn a leak into a test failure.
- Use `deinitWithoutLeakChecks` only after `detectLeaks`, and comment why you are skipping.
- Use `detectLeaks()` when you want the count rather than a pass/fail, and handle the `usize` it
  returns.
- Pair the allocator with `checkAllAllocationFailures` so the failure paths are covered too — not
  just the happy path's frees.

```zig
// Correct — the verdict is propagated, so a leak fails the test
test "parser owns its buffer" {
    var gpa = std.heap.DebugAllocator.init(.{ .safety = true });
    defer std.testing.expect(gpa.deinit() == .ok) catch |e| switch (e) {
        error.TestUnexpectedResult => return error.LeakDetected,
    };
    try parseWith(gpa.allocator());
}

// Incorrect — the leak is detected and the answer discarded;
// defer takes a void expression, so this compiles and reports nothing
test "parser owns its buffer" {
    var gpa = std.heap.DebugAllocator.init(.{ .safety = true });
    defer gpa.deinit();          // returns std.heap.Check; nobody reads it
    try parseWith(gpa.allocator());
}
```

## Don't

- Don't write `defer gpa.deinit();` in a test. That line is the whole defect.
- Don't reach for `deinitWithoutLeakChecks` because a leak was reported twice — that means two
  owners, not two reports.
- Don't assume `std.testing.allocator` fixes this. It is the same machinery, and it has its own
  scope note:

> This should only be used in temporary test programs.
> ([std.testing — Zig 0.16.0](https://ziglang.org/documentation/0.16.0/std/#std.testing))

- Don't treat a green test suite as leak coverage without checking that the verdict is propagated.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Suite green, memory grows across tests | `deinit()` verdict discarded | Compare against `.ok` |
| Leak reported twice for one allocation | Two owners, or teardown plus `detectLeaks` | Find the second owner |
| Allocation-failure paths never exercised | `checkAllAllocationFailures` never called | Wrap the test body |
| Leak appears only in one build mode | Different allocator wiring per mode | Same teardown discipline everywhere |
| Crash at teardown in a threaded test | Allocator torn down while workers still hold it | Join workers before teardown |

## Verifying

```bash
# The defect: teardown written as a bare defer statement
grep -rn --include='*.zig' -E 'defer\s+\w*[a-z_]*\.deinit\(\);' src/ tests/

# Teardowns whose verdict IS propagated -- the shape to copy
grep -rn --include='*.zig' 'deinit() ==\|\.deinit() !=\|detectLeaks()' src/ tests/

# The named escape hatch, which should be rare and commented
grep -rn --include='*.zig' -B2 'deinitWithoutLeakChecks' src/ tests/

# Allocation-failure coverage: is it called anywhere?
grep -rn --include='*.zig' 'checkAllAllocationFailures' tests/ src/
```

Every hit in the first list is a test that cannot fail on a leak. The third list should be short and
each hit should have a comment; a long one means the suite has no leak coverage rather than that it
avoids duplicate reports.

These greps cannot tell you whether a propagated `Check` is actually asserted on — the comparison
can be computed and discarded in turn. That needs the test read, or a deliberate
`std.testing.expect` wrapper that fails the test by construction.