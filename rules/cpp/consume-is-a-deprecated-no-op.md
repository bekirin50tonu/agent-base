---
title: "consume is deprecated and was never implemented"
rule_id: "RULE-CPP-003"
category: "concurrency"
scope: "backend"
applies_to: "C++, memory_order_consume, dependency ordering, C++26"
last_updated: "2026-10-04"
source: "https://en.cppreference.com/w/cpp/atomic/memory_order.html"
---

# consume is deprecated and was never implemented

`memory_order_consume` was designed to be the cheapest ordering in the library: publish a pointer, and
have the reader follow the *dependency chain* rather than acquire a full barrier. It does not exist in
practice, and the standard has now given up on it:

> memory_order_consume(deprecated in C++26)
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

> Note that currently (2/2015) no known production compilers track dependency chains: consume
> operations are lifted to acquire operations.
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

> Release-consume ordering has the same effect as release-acquire ordering and is deprecated.
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

That third sentence is the one to internalize: the standard now *states* that consume and acquire are
the same operation. A codebase still using `consume` is paying full acquire cost while documenting an
intent that no production compiler implements.

The failure is not a bug today. It is a comment that has become a lie, sitting next to code that
pays for the stronger guarantee nobody asked it to provide — and which would be actively wrong if a
future compiler *did* start tracking dependency chains, because the code was never written to be
correct under the weaker guarantee it claims.

## Why

This is the only rule in the corpus about an optimization that was specified, never implemented, and
then deprecated. It matters because the cost is invisible in two directions at once: `consume` looks
free in the source, and it is not free at runtime — it is acquire, exactly as it would be if you had
typed it.

Meanwhile the *reason* someone reached for it — avoiding a fence on a pointer handoff — is often
still the right goal, reached by a different route. A release/acquire pair on the pointer costs the
same as release/consume did, because consume *is* acquire. So the code gains nothing by being subtle,
and loses the ability to be understood by the next person.

## Do

- Write `memory_order_acquire` where `consume` appears. The generated code is identical; the source
  says what actually happens.
- Use release/acquire for pointer publication, which is the case consume was meant for: store the
  pointer with `memory_order_release` and load it with `memory_order_acquire`.
- When porting code that uses `consume`, delete the dependency-ordering comment along with it. A
  comment saying "the reader only needs dependency ordering" now describes an intent the compiler
  does not implement and the standard has deprecated.
- Treat `[[deprecated]]` warnings from C++26 toolchains as real, and fix them rather than
  suppressing them.

```cpp
// Incorrect — reads as if cheaper than acquire; it is not, and it is deprecated
config_ready.store(&config, std::memory_consume);

// Correct — acquire, and it says what it synchronizes with
config_ready.store(&config, std::memory_order_release);
auto* config = config_ready.load(std::memory_order_acquire);
```

## Don't

- Don't write `memory_order_consume` in new code. There is no case where acquire is wrong here,
  because consume is defined to become acquire.
- Don't keep a `consume` line "because it documents intent". It documents an intent that no compiler
  honours, which is worse than no comment.
- Don't assume `consume` is weaker and therefore safe where `acquire` would be too strong. Since the
  two are the same operation, there is no program that `consume` makes correct and `acquire` does not.
- Don't suppress `-Wdeprecated` to keep a consume-based codebase building quietly.
- Don't read the C++20 or earlier wording as current — the deprecation is C++26, and the standard's
  own text now asserts consume and acquire are equivalent.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Fence appears in the disassembly anyway | `consume` lifted to acquire by the compiler | Expected; write `acquire` and say so |
| C++26 toolchain warns on a clean build | Deprecation newly applies | Replace with `acquire` |
| Comment says "only needs dependency ordering" | Intent from before 2015 | Delete the comment and the `consume` |
| Micro-benchmark shows no gain from the change | It was already `acquire` | Nothing to gain; the benchmark premise was wrong |
| Reviewer assumes `consume` is cheaper than `acquire` | Both readings look plausible in source | Cite the standard's equivalence directly |

## Verifying

```bash
# consume uses, including the spellings that do not name the enum
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E 'memory_order_consume|memory_consume' src/ include/

# The deprecated helper it replaced
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '\bkill_dependency\b' src/ include/

# Comments asserting dependency-ordering intent, which are now false
grep -rn --include='*.{c,cc,cpp,h,hpp}' -iE '//.*(dependency order|consume)' src/ include/

# To see what the compiler actually emitted for a consume load
#   objdump -d build/<target> | grep -A4 '<consumer>:'
```

The first list should be empty; every hit is a line that costs acquire and claims otherwise. The
third list is the one that survives a careless find-and-replace — the code becomes correct while the
explanation stays wrong.

These greps cannot tell you whether a `consume` load is actually a dependency-ordered load in any given
build, because that is exactly the thing no compiler implements. The disassembly line is there to
confirm the equivalence, not to find a performance bug.