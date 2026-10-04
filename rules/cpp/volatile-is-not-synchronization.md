---
title: "volatile is not synchronization"
rule_id: "RULE-CPP-002"
category: "concurrency"
scope: "backend"
applies_to: "C++, volatile, std::atomic, inter-thread communication"
last_updated: "2026-10-04"
source: "https://en.cppreference.com/w/cpp/atomic/memory_order.html"
---

# volatile is not synchronization

`volatile` predates `<atomic>`. It means "the compiler may not cache, elide, or reorder this access
relative to other `volatile` accesses". It says nothing about threads, and cppreference is unusually
direct about the two things people assume it does:

> volatile access does not establish inter-thread synchronization
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

> volatile accesses are not atomic (concurrent read and write is a data race)
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

Not "may be stale" — a data race, and the definition of one is precise:

> If one evaluation modifies a memory location, and the other reads or modifies the same memory
> location, and if at least one of the evaluations is not an atomic operation, the behavior of the
> program is undefined (the program has a data race) unless there exists a happens-before relationship
> between these two evaluations.
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

There is a compiler-specific wrinkle that makes this worse rather than better. MSVC gives `volatile`
acquire/release semantics by default; `/volatile:iso` turns that off. A project developed on Windows
can have a `volatile` flag that *appears* correctly ordered, and lose that ordering entirely on GCC or
Clang with no diagnostic — the code still compiles, still tests clean, and becomes wrong.

## Why

`volatile` is the classic silent failure here because the flag pattern looks right, the code is
readable, and the compiler is visibly doing *something* with the variable. On x86 a lone load and a
lone store usually happen to be atomic in practice, so the bug reproduces rarely and never on the
developer's laptop.

But "usually atomic on x86" is not a guarantee, and the failing case is a torn read on a wider type
or a lost update on a read-modify-write — neither of which a debug build on one machine will show you.
The absence of the ordering is only visible on weaker hardware, which is to say, in production.

## Do

- Use `std::atomic` for anything read by one thread and written by another, with the order named.
- Use `volatile` for what it is actually for: MMIO and device registers, `sig_atomic_t`, and memory
  modified by something the compiler cannot reason about.
- Treat a `volatile` flag plus a plain data structure as a bug to find, not a pattern to document.
- If a project must support MSVC's legacy `volatile`, compile it with `/volatile:iso` so the
  behaviour matches every other compiler.

```cpp
// Incorrect — not atomic, no ordering, undefined behaviour under concurrency
static volatile bool shutdown_requested = false;
void request_shutdown() { shutdown_requested = true; }
bool should_stop()    { return shutdown_requested; }

// Correct
std::atomic<bool> shutdown_requested{false};
void request_shutdown() { shutdown_requested.store(true, std::memory_order_release); }
bool should_stop()    { return shutdown_requested.load(std::memory_order_acquire); }
```

## Don't

- Don't use `volatile` as a cheaper `std::atomic`. It is not cheaper; it is different, and the
  difference is that it provides no inter-thread guarantee at all.
- Don't add `volatile` to a plain variable "to make the thread see the update". On x86 the compiler
  is not the problem; on other architectures this changes nothing about ordering and hides the real
  defect.
- Don't rely on MSVC's default `volatile` semantics in portable code.
- Don't use `volatile` on a `struct` or pointer and assume the pointed-to data is protected. The
  qualifier applies to the access, not to the memory graph behind it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Flag observed late by a reader thread | `volatile` established no ordering | `std::atomic` with acquire/release |
| Torn or stale multi-word value read | `volatile` access is not atomic | `std::atomic` of a trivially-copyable type, or a mutex |
| Correct on Windows, wrong on ARM | MSVC default `volatile` semantics | `std::atomic`, and `/volatile:iso` |
| Reads optimized out under `-O2` in a signal handler | `volatile` is the wrong tool there | `std::atomic<sig_atomic_t>` or `atomic_signal_fence` |
| Lost update on a counter | Read-modify-write is not atomic | `fetch_add`, not `x = x + 1` |

## Verifying

```bash
# volatile uses, to triage each as either MMIO/signal-handler (legitimate) or shared state (not)
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '\bvolatile\b' src/ include/

# volatile variables that look like shared flags -- the defect surface
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '(static|extern)?\s*volatile\s+[A-Za-z_]' src/ include/

# Plain non-atomic globals touched from more than one thread -- invisible without this
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '^(static\s+)?(bool|int|unsigned|size_t|float)\s+g_[A-Za-z_]*\s*;' src/

# Threads, to see which functions can overlap
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E 'std::thread|std::async|detach\(\)' src/
```

The second list needs every hit classified: a `volatile` register write is correct, a `volatile`
shared flag is undefined behaviour. The fourth list tells you which functions can run concurrently,
so the writers and readers of each flag can be paired by hand.

These greps cannot prove that a plain global is shared — that depends on the call graph, not the
declaration. Each candidate from the third list needs its writers and readers traced to threads.