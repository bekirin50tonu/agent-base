---
title: "C++ — who owns it, and what ordering does it need"
category: "architecture"
scope: "backend"
last_updated: "2026-10-04"
source: "https://en.cppreference.com/w/cpp/atomic/memory_order.html"
---

# C++ — who owns it, and what ordering does it need

Two decisions meet in almost every C++ class that crosses a thread boundary: **who owns this object**,
and **what ordering does this access need**. Neither lines up with the type name, and in both the
shipped default is the stronger, slower, more permissive option.

This sits one level below `RULE-CPP-001` … `RULE-CPP-006`, which explain each mechanism. This matrix
is for choosing between them.

## The two questions

1. **Who destroys this object, and can I name them?** One site → `unique_ptr`. No single site can →
   `shared_ptr`, taken **by value**. A back-reference or observer that is not an owner → `weak_ptr`.
   Nothing → `T&` or `T*`, which are non-owning by rule. (`RULE-CPP-004`)
2. **What does another thread's behaviour depend on here?** Nothing depends on the value → `relaxed`.
   Another thread must *see* other data before it → `release`/`acquire`. Genuinely unsure → `seq_cst`,
   which is the default and is correct; you are only paying for a fence. (`RULE-CPP-001`)

Two things that are **not** answers to either question: `volatile` (no ordering, not atomic) and
`memory_order_consume` (acquire, deprecated). (`RULE-CPP-002`, `RULE-CPP-003`)

## The defaults, in one table

Each is correct for the common case, and each is a silent cost or a silent hole in the other one.

| Decision | Shipped default | The default's cost |
|---|---|---|
| Atomic ordering | `memory_order_seq_cst` | A full fence per operation on every multi-core CPU |
| Program-level ordering | Guaranteed only while *every* atomic is `seq_cst` | One relaxed counter removes it everywhere |
| Publishing data | Implicit `seq_cst` both ends | Cheaper exists; name it |
| Dependency ordering | `memory_order_consume` | Deprecated in C++26; lifted to acquire anyway |
| Shared flag | `volatile` (wrong) | Not atomic; a data race and undefined behaviour |
| Sole ownership | `shared_ptr` | A use count maintained on every copy |
| Passing shared ownership | By non-const reference | Racing one handle is a data race |
| Ownership cycle | `shared_ptr` both ways | The count never reaches zero |
| Transferring ownership | `std::move` at the call site | A cast; the source stays live and is used |
| Adding a destructor | Just add it | Suppresses the implicit move constructor |
| Deriving a type | Public non-virtual destructor | Delete-through-base is undefined behaviour |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Sole owner | `unique_ptr` + `make_unique` | `shared_ptr` | You pay for sharing you do not have |
| Genuinely shared lifetime | `shared_ptr` + `make_shared`, by value | `shared_ptr&` | Racing the handle is UB |
| Back-reference, cycle | `weak_ptr` | `shared_ptr` | The count never reaches zero |
| Non-owning observation | `T*` / `T&` | `shared_ptr` | Implies a lifetime you do not manage |
| Publish data, read once | `store` release / `load` acquire | plain store/load | Undefined, not merely stale |
| Independent counters | `relaxed` | `seq_cst` | A fence per increment |
| Count plus a payload | relaxed counter + separate flag | one `seq_cst` pair | Same cost, clearer intent |
| Device register | `volatile` | `std::atomic` | Correct tool, wrong everywhere else |
| Signal-handler flag | `std::atomic<sig_atomic_t>` | `volatile` | Compiler may still elide |
| Sink parameter | By value, moved in the callee | `std::move` at the call site | The source stays live and is used |
| RAII wrapper | Member of a type declaring all six | a lone destructor | The destructor suppressed the moves |
| Polymorphic base | `virtual ~Base()` | public non-virtual | Members of derived never destroyed |

## The pattern shared by most of these rows

Eight rows above have the same shape, and it recurs across C++ domains: **the shipped default is the
permissive one, and the failure is the default behaving exactly as documented.**

- `volatile` is documented as not establishing synchronization, and code uses it anyway.
- `consume` is documented as lifted to acquire, and the comment still claims a cheaper fence.
- `shared_ptr` is documented as requiring an atomic decrement, and nobody asked for the count.
- `std::move` is documented as a cast, and it is treated as a consuming operation.
- A destructor is documented as suppressing the implicit move, and it is added for logging.

The instrument is never the problem. In each case the *type or default is correct* and the thing that
under-reports is the caller's belief about it. When adopting any new C++ facility, the question worth
asking is not "does this detect the problem" but "what must the caller do for the guarantee to be
reported at all."

## Sources

- [std::memory_order — cppreference](https://en.cppreference.com/w/cpp/atomic/memory_order.html)
- [std::atomic_thread_fence — cppreference](https://en.cppreference.com/w/cpp/atomic/atomic_thread_fence.html)
- [std::shared_ptr — cppreference](https://en.cppreference.com/w/cpp/memory/shared_ptr.html)
- [std::unique_ptr — cppreference](https://en.cppreference.com/w/cpp/memory/unique_ptr.html)
- [Move constructor — cppreference](https://en.cppreference.com/w/cpp/language/move_constructor.html)
- [std::move — cppreference](https://en.cppreference.com/w/cpp/utility/move.html)
- [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) — R.3, R.21,
  R.24, C.21, C.35, C.37

## Version note

Written against **C++23/C++26** cppreference. `memory_order_consume` is deprecated in C++26 and
`shared_ptr`'s reference-count description is explicitly implementation-typical rather than
normative — treat the ordering claims as observable behaviour of real implementations, not as portable
guarantees. The Core Guidelines are a living document and their rule numbers are stable, but the text
under each can be revised.