---
title: "addTest runs only for the targets you listed"
rule_id: "RULE-ZIG-006"
category: "correctness"
scope: "backend"
applies_to: "Zig, build.zig, Zig build system, CI"
last_updated: "2026-10-04"
source: "https://ziglang.org/learn/build-system/"
---

# addTest runs only for the targets you listed

The build system's testing section wires one test artifact per target, in a loop, and each run has
to be attached to the step by hand:

> pub fn build(b: *std.Build) void {
>     const test_step = b.step("test", "Run unit tests");
>
>     for (test_targets) |target| {
>         const unit_tests = b.addTest(.{
>             .root_module = b.createModule(.{
>                 .root_source_file = b.path("main.zig"),
>                 .target = b.resolveTargetQuery(target),
>             }),
>         });
>
>         const run_unit_tests = b.addRunArtifact(unit_tests);
>         test_step.dependOn(&run_unit_tests.step);
>     }
> }
> ([Zig Build System](https://ziglang.org/learn/build-system/))

Two things make this fail quietly. `dependOn` is the only thing that connects a runnable artifact
to a step — a test artifact that is built but never depended on is **not run**, and `zig build`
reports success. And the target list is a hand-written array literal, so the set of platforms the
tests actually execute on is whatever that array says, which is frequently the native entry alone.

This is the build-system twin of `RULE-ZIG-001`: a correct-looking configuration whose failure mode
is doing less than it appears to. The step is named `test`, the artifact is a real test
compilation, and it runs only because of one method call inside a loop.

## Why

A cross-platform library whose `zig build test` is green may have executed its tests on one
target. The other entries in `test_targets` still *compile* — that is all `addTest` guarantees —
and a compile is reported as part of the successful build. So a bug that only fails at run time on
aarch64 is not caught, while the build reads as thorough precisely because something happened.

The compile-only case is worse than it looks: the target you did not run is still type-checked, so
the failure is not a compile error. It is a behavioural divergence, which is the class of bug a
matrix build exists to find and the class this silently declines to look for.

## Do

- `dependOn` every runnable artifact to a step, or the step is decoration.
- Keep the target list explicit and complete, and treat adding a platform as a `build.zig` change —
  not a CI matrix change, which only varies the host.
- Use `standardTargetOptions` and `standardOptimizeOption` so `-Doptimize` reaches every target
  uniformly.
- Run in both Debug and ReleaseFast before trusting a performance claim — `addTest` defaults to a
  debug build.
- Cross-compiled targets need an emulator or device to *run*; if there is none, `addTest` still
  verifies compilation, and saying so is more honest than implying the target was tested.

```zig
// Correct — every target's test run is attached to the step
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const test_step = b.step("test", "Run unit tests");

    for (test_targets) |q| {
        const tests = b.addTest(.{ .root_module = b.createModule(.{
            .root_source_file = b.path("main.zig"),
            .target = b.resolveTargetQuery(q),
            .optimize = optimize,
        }) });
        test_step.dependOn(&b.addRunArtifact(tests).step);
    }
}
```

## Don't

- Don't write `_ = tests;` or keep the artifact in a variable nothing reads — an unused value is a
  compile error, so the realistic defect is an artifact that *is* referenced but whose run is not
  depended on.
- Don't assume a green `zig build test` means every entry in `test_targets` executed. Name the
  targets in the step or in CI output so the claim is checkable.
- Don't vary only the host in CI. `resolveTargetQuery` is what selects the *test* target; a matrix
  of runners with a native-only target list tests one platform N times.
- Don't rely on `zig build test` to run tests for a dependency — it runs only the tests declared in
  this build graph.
- Don't drop `dependOn` because the artifact is reachable from `install`; installation and
  execution are different edges.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `zig build test` green, aarch64 bug ships | Target compiled but never run | `dependOn` every `addRunArtifact` |
| Tests run on one platform in CI | Target list has only the native entry | Add the entries explicitly |
| Release-only failure | `addTest` defaults to debug | Pass `optimize` from `standardOptimizeOption` |
| Tests pass locally, differ in CI | Different `-Dtarget` or `-Doptimize` | Share the same step arguments |
| Cross-compiled target "tested" with no runner | Compile treated as execution | Run under an emulator, or label it compile-only |

## Verifying

```bash
# Test artifacts declared in the build graph
grep -rn -E 'addTest\(' build.zig build.zig.zon 2>/dev/null

# Runs actually attached to a step -- should match the artifacts one-for-one
grep -rn -E 'dependOn\(|addRunArtifact\(' build.zig 2>/dev/null

# The target list, which decides what executes rather than what compiles
grep -rn -B3 -A8 'test_targets' build.zig 2>/dev/null

# Tests invoked from CI, to see which step the pipeline calls
grep -rn 'zig build.*test\|build.*test' .github/workflows/ 2>/dev/null
```

The second list must have at least as many entries as the first, or some artifacts are built and
never run. The third is the declaration of what matters — anything absent from it is not tested,
whatever the step name suggests.

These greps cannot tell you that the target list covers the platforms you support, because
"supported" is not in `build.zig`. That needs the support policy read, and the two compared by
hand.