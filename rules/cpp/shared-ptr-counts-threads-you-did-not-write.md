---
title: "shared_ptr maintains a count you did not ask for"
rule_id: "RULE-CPP-004"
category: "architecture"
scope: "backend"
applies_to: "C++, std::shared_ptr, std::weak_ptr, std::unique_ptr, thread safety"
last_updated: "2026-10-04"
source: "https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines"
---

# shared_ptr maintains a count you did not ask for

The Core Guidelines rank `unique_ptr` above `shared_ptr` on both predictability and cost:

> A unique_ptr is conceptually simpler and more predictable (you know when destruction happens) and
> faster (you don't implicitly maintain a use count).
> ([C++ Core Guidelines R.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#r21-prefer-unique_ptr-over-shared_ptr-unless-you-need-to-share-ownership))

The count is not free because it is itself a concurrent counter, and its two ends cost differently:

> To satisfy thread safety requirements, the reference counters are typically incremented using an
> equivalent of std::atomic::fetch_add with std::memory_order_relaxed (decrementing requires stronger
> ordering to safely destroy the control block).
> ([std::shared_ptr — cppreference](https://en.cppreference.com/w/cpp/memory/shared_ptr.html))

Two words in that sentence are load-bearing. **"typically"** and **"equivalent of"** — it describes
how implementations do it, not a guarantee you may rely on. And the asymmetry matters: increment is
relaxed, but **decrement** is the expensive one, because the decrement is what can run the destructor.

The thread-safety guarantee is narrower than it reads. The safe part is copies; the unsafe part is the
handle:

> All member functions (including copy constructor and copy assignment) can be called by multiple
> threads on different shared_ptr objects without additional synchronization even if these objects
> are copies and share ownership of the same object. If multiple threads of execution access the same
> shared_ptr object without synchronization and any of those accesses uses a non-const member function
> of shared_ptr then a data race will occur
> ([std::shared_ptr — cppreference](https://en.cppreference.com/w/cpp/memory/shared_ptr.html))

Passing `shared_ptr` **by value** is the copy that makes this safe — that is why the idiom is
`void f(std::shared_ptr<T> p)` and not `void f(std::shared_ptr<T>& p)`. The reference form invites
exactly the race the standard just described.

Cycles never free, and the answer is a different type:

> shared_ptr s rely on use counting and the use count for a cyclic structure never goes to zero, so
> we need a mechanism to be able to destroy a cyclic structure.
> ([C++ Core Guidelines R.24](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#r24-use-stdweak_ptr-to-break-cycles-of-shared_ptrs))

## Why

`shared_ptr` is the default reach for "a pointer to an object", and a code review that does not ask
"who else owns this?" will approve it for a sole owner. The cost is a use count on every copy, plus
the loss of knowing when the object dies — which is the property most often needed for shutting a
connection, releasing a file handle, or ending a subscription.

The reference-vs-value distinction is the one that causes real bugs, because it is invisible in the
type. `shared_ptr<T>` and `shared_ptr<T>&` in a signature look nearly identical, and the reference form
is the dangerous one. A function taking a non-const reference can `reset()` its argument, and two
threads doing that on the same handle is a data race, not a logic error.

Cycles are the other half, and they are silent in the strongest sense: the type system accepts them,
the code reads as ordinary back-references, and the destructor never runs. Nothing reports it — the
symptom is a process that grows until it is killed.

## Do

- Use `std::unique_ptr` + `make_unique` for sole ownership. Use `std::shared_ptr` + `make_shared`
  only when destruction genuinely cannot be determined by any one site.
- Take `shared_ptr` parameters **by value**, and `const&` only when the function cannot need to
  reassign or reset it.
- Use `std::weak_ptr` for every back-reference, parent link, or observer that is not itself an owner.
- Watch cycles with a weak-pointer sweep, not with review.
- Remember the reference is non-owning by rule, so `T*` is the correct return type for "a pointer you
  do not manage" and `unique_ptr<T>` for "a pointer I hand over".

```cpp
// Incorrect — sole owner, so every copy pays for sharing nobody needs
std::shared_ptr<Session> s = std::make_shared<Session>();

// Incorrect — a non-const reference invites the race the standard warns about
void refresh(std::shared_ptr<Session>& s);

// Correct
std::unique_ptr<Session> s = std::make_unique<Session>();
void refresh(std::shared_ptr<Session> s);   // by value: the copy is the synchronization
```

## Don't

- Don't use `shared_ptr` because a raw pointer "would need manual delete". That is `unique_ptr`.
- Don't take `shared_ptr` by non-const reference in an interface. If the function must reassign or
  reset it, take it by value.
- Don't let two owning types hold each other through `shared_ptr`. Break one side with `weak_ptr`.
- Don't assume the counter increment is the expensive part — it is the decrement, and the decrement is
  what runs the destructor.
- Don't assume sharing across threads makes the *pointee* thread-safe. It does not; only the handle
  is synchronized.
- Don't copy a `shared_ptr` into a loop body "for speed". The copy is an atomic increment plus a
  potential decrement — usually more than the work it precedes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Memory grows until OOM, no leaks reported | `shared_ptr` cycle | `weak_ptr` on the back-reference |
| Data race in a threaded handler | `shared_ptr&` shared across threads | Take by value |
| Slower than a raw pointer at high call rates | Use count on every copy | `unique_ptr`, or a reference for an observer |
| Object never destroyed at shutdown | Sole owner written as `shared_ptr` | `unique_ptr` |
| `use_count()` never reaches zero in tests | Cycle, or a stray copy in a cache | Audit with weak-pointer sweeps |
| Intermittent corruption after adding threads | Sharing assumed to protect the pointee | Synchronize the pointee's own state |

## Verifying

```bash
# shared_ptr uses, to triage each as genuine shared ownership or a sole owner
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E 'shared_ptr' src/ include/

# Parameters taking a non-const reference -- the race surface
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E 'shared_ptr<[^>]*>\s*&' src/ include/

# Members that hold another owning type -- the cycle surface
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E 'shared_ptr<[A-Za-z_:]+\s*[a-z_]+\s*(;|\{|,)' src/ include/

# Reset/reassign on a shared handle, which is what makes the reference form unsafe
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '\.reset\(\)|=\s*std::make_shared' src/
```

The second list is the concurrency defect surface: each hit is a handle that two threads could touch
at once. The third is the cycle surface — a type that owns another type that can reach it back.

These greps cannot tell you whether a `shared_ptr` is genuinely shared or a sole owner, because that
depends on who else holds a copy at runtime. Each candidate needs its holders traced, and the cycle
check needs the object graph walked, which no grep can do.