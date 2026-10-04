---
title: "seq_cst is the default for every atomic"
rule_id: "RULE-CPP-001"
category: "concurrency"
scope: "backend"
applies_to: "C++, C++11 and later, std::atomic, memory_order"
last_updated: "2026-10-04"
source: "https://en.cppreference.com/w/cpp/atomic/memory_order.html"
---

# seq_cst is the default for every atomic

Every `<atomic>` operation you write without an explicit order gets `memory_order_seq_cst`, and
cppreference says what that costs in the first line of the ordering table:

> The default behavior of all atomic operations in the library provides for sequentially consistent
> ordering (see discussion below). That default can hurt performance
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

The guarantee that `seq_cst` buys is maintained by an instruction that does not exist on most CPUs:

> Total sequential ordering requires a full memory fence CPU instruction on all multi-core systems.
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

Two consequences follow that do not follow from the type. First, the ordering is **program-level, not
per-variable**:

> as soon as atomic operations that are not tagged memory_order_seq_cst enter the picture, the
> sequential consistency guarantee for the program is lost
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

A codebase cannot adopt `seq_cst` for the variables that matter and stay correct for the rest. One
relaxed counter removes the guarantee everywhere — while each `atomic` still reads as though it
carries its own semantics.

Second, the cost is usually less bad than folklore says, which is why this is a "know what you pay"
rule rather than "relax everything":

> in many cases, memory_order_seq_cst atomic operations are reorderable with respect to other atomic
> operations performed by the same thread.
> ([std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html))

## Why

`seq_cst` is not wrong. It is the strongest guarantee the library offers, it is what the default
gives you, and it is almost always what you want for a flag or a one-shot publication. The defect is
paying for it invisibly: a hot counter written `hits.fetch_add(1)` compiles to a full fence on every
call, and nothing in the source says so.

The program-level property makes this worse than a local cost. Because a single relaxed atomic voids
the guarantee for the whole program, "we mostly use `seq_cst`" is not a coherent description of a
codebase — it is either "all of them" or a guarantee nobody has. That ambiguity is what makes the
resulting bug so hard to see: a program that reads as thread-safe, passes its tests, and has no
ordering relationship the compiler can rely on.

## Do

- Write the order explicitly at every atomic that matters. `store`/`load` with `release`/`acquire` is
  the shape for publishing data, and it is cheaper than the default.
- Use `memory_order_relaxed` only for a counter whose value no other thread's behaviour depends on,
  and say so in a comment.
- Keep the publication flag `seq_cst` if you are unsure, and relax the counters around it.
- Remember that a relaxed ordering is a real weakening, not a no-op — it removes ordering between this
  operation and *every* other atomic in the program.
- Remember that a fence alone synchronizes nothing:

  > Establishes memory synchronization ordering of non-atomic and relaxed atomic accesses, as
  > instructed by order, without an associated atomic operation. Note however, that at least one
  > atomic operation is required to set up the synchronization, as described below.
  > ([std::atomic_thread_fence — cppreference](https://en.cppreference.com/w/cpp/atomic/atomic_thread_fence.html))

```cpp
// Correct — the ordering is named where the guarantee is relied on
std::atomic<int> ready{0};
void publish() { ready.store(1, std::memory_order_release); }

// Incorrect — reads as "just a counter", pays a full fence per call,
// and weakens the ordering guarantee of every other atomic in the program
static std::atomic<int> hits{0};
void record() { ++hits; }
```

## Don't

- Don't write `++counter` on a hot path and describe it as thread-safe without deciding whether the
  count is ever *read* for a decision. If it is, it needs a fence.
- Don't use `memory_order_seq_cst` as a substitute for a design. It orders your atomics; it does not
  make a data structure thread-safe, and it cannot protect a non-atomic variable.
- Don't add a `std::atomic_thread_fence` because the code "looks like it needs one" and leave the
  atomic operation that pairs with it unspecified.
- Don't mix orders within one variable's access path — a counter stored relaxed and loaded `seq_cst`
  is the same guarantee as the relaxed load, plus the cost.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Counter write 5× slower after adding `<atomic>` | Implicit `seq_cst` fence per operation | `fetch_add(1, std::memory_order_relaxed)` if the value is not load-bearing |
| Ordering bug only on ARM or many-core hardware | Mixed orders; program-level guarantee lost | Audit every atomic's order together, not one at a time |
| Fence added, behaviour unchanged | Fence with no paired atomic operation | Name the release/acquire pair instead |
| `seq_cst` everywhere, still a data race | Non-atomic variable touched concurrently | Make the variable itself `std::atomic` |

## Verifying

```bash
# Every atomic operation, to see which ones carry an explicit order
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '\.(load|store|fetch_add|fetch_sub|exchange|compare_exchange)\(' src/

# Atomics with no explicit memory order -- each is an implicit seq_cst fence
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '(std::atomic|atomic<)[^;]*;' src/ | grep -v 'memory_order'

# Operations that do carry an order
grep -rn --include='*.{c,cc,cpp,h,hpp}' 'memory_order_' src/

# Fences, to check each one has a paired atomic operation nearby
grep -rn --include='*.{c,cc,cpp,h,hpp}' 'atomic_thread_fence' src/
```

The second list is the defect surface: every hit is paying for a full fence, and each needs the
question "does any other thread's behaviour depend on this value?" asked by hand. The third list
being non-empty is what tells you the program-level guarantee is already gone.

These greps cannot tell you whether a given relaxed counter is safe, because safety here depends on
what the value is used for, which is not in the atomic's type. That needs each counter's readers read.