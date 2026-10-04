---
language: "C++"
tag: "cpp"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for C++ memory model and ownership assets."
---

# Documentation Hub: C++

> **Agent Directive (Phase 4)**: Inspect the target project's headers and grep for `std::atomic`,
> `memory_order`, `volatile`, `shared_ptr`, `unique_ptr`, `std::move`, and any user-declared
> destructor in a class that also gets copied. Match the conditions below to determine which
> `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the memory model and ownership — the places where C++'s defaults compile,
> pass tests, and quietly do less than the source claims. No `skills` yet.
>
> **Version note**: verified against cppreference's current pages, which track **C++23** with C++26
> changes marked inline. `memory_order_consume` is deprecated as of C++26, so the recommended ordering
> set is `relaxed` / `release` / `acquire` / `seq_cst`. Standard library state used here
> (`std::atomic`, `unique_ptr`, `shared_ptr`) is C++11 or earlier and has not changed.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/cpp/seq-cst-is-the-default-for-every-atomic.md`
  - **Why**: Every `<atomic>` operation without an explicit order defaults to `memory_order_seq_cst`,
    which cppreference says "can hurt performance" and which "requires a full memory fence CPU
    instruction on all multi-core systems". The guarantee is also program-level, not per-variable: "as
    soon as atomic operations that are not tagged memory_order_seq_cst enter the picture, the
    sequential consistency guarantee for the program is lost" — so a codebase cannot adopt `seq_cst`
    selectively, and one relaxed counter removes the ordering everywhere while each `atomic` still
    reads as carrying its own semantics.
  - **When**: Target project has `std::atomic` in it, or a hot counter written `++hits` /
    `fetch_add(1)` with no order named.
  - **Target Location**: `docs/rules/seq-cst-is-the-default-for-every-atomic.md`

- **Path**: `rules/cpp/volatile-is-not-synchronization.md`
  - **Why**: "volatile access does not establish inter-thread synchronization" and "volatile accesses
    are not atomic (concurrent read and write is a data race)" — undefined behaviour, not staleness.
    MSVC additionally gives `volatile` acquire/release semantics by default, so a flag that looks
    correctly ordered on Windows loses that ordering entirely on GCC and Clang, with no diagnostic.
  - **When**: Target project declares `volatile` on anything that is not an MMIO register or a signal
    handler flag, or supports MSVC alongside other compilers.
  - **Target Location**: `docs/rules/volatile-is-not-synchronization.md`

- **Path**: `rules/cpp/consume-is-a-deprecated-no-op.md`
  - **Why**: `memory_order_consume` is "(deprecated in C++26)", "no known production compilers track
    dependency chains: consume operations are lifted to acquire operations", and the standard now
    states outright that "Release-consume ordering has the same effect as release-acquire ordering and
    is deprecated". A `consume` line costs acquire while its comment claims a cheaper fence — and the
    claim is the part that is wrong.
  - **When**: Target project uses `memory_order_consume` / `memory_consume`, or carries a
    dependency-ordering comment written before 2015.
  - **Target Location**: `docs/rules/consume-is-a-deprecated-no-op.md`

- **Path**: `rules/cpp/shared-ptr-counts-threads-you-did-not-write.md`
  - **Why**: The Core Guidelines rank `unique_ptr` above `shared_ptr` because it is "faster (you don't
    implicitly maintain a use count)", and the count is a concurrent counter whose *decrement* — not
    increment — needs stronger ordering, since that is what can run the destructor. The thread-safety
    guarantee covers copies, not the handle: accessing the same `shared_ptr` object from two threads
    with a non-const member is a data race, which is why the by-value parameter is the safe form.
    Cycles never free, and the answer is `weak_ptr`.
  - **When**: Target project uses `shared_ptr`, takes one by non-const reference, or has two types that
    hold each other.
  - **Target Location**: `docs/rules/shared-ptr-counts-threads-you-did-not-write.md`

- **Path**: `rules/cpp/std-move-is-a-cast-not-an-operation.md`
  - **Why**: `std::move` "is exactly equivalent to a static_cast to an rvalue reference type", and the
    selected overload "have the option, but aren't required, to move any resources". The moved-from
    state is "valid but otherwise indeterminate" for most types, so reading it is defined behaviour
    that no sanitizer flags — while the destructor "will typically be called on the argument at a
    later point", on RAII members whose contents are now indeterminate.
  - **When**: Target project calls `std::move` at a call site, uses a moved-from object afterwards, or
    has a move constructor without `noexcept`.
  - **Target Location**: `docs/rules/std-move-is-a-cast-not-an-operation.md`

- **Path**: `rules/cpp/declaring-one-special-member-suppresses-the-other-five.md`
  - **Why**: "Declaring any copy/move/destructor function, even as =default or =delete, will suppress
    the implicit declaration of a move constructor and move assignment operator" — and the move
    constructor's own conditions name a user-declared destructor as sufficient on its own. Adding a
    destructor to log teardown silently turns every move in the class into a copy. The same guidelines
    require destructors that "must not fail" and a base destructor that is virtual or protected,
    since deleting through a base pointer is undefined behaviour.
  - **When**: Target project has any class with a user-declared destructor, a base class, or a
    `= default` / `= delete` on one special member.
  - **Target Location**: `docs/rules/declaring-one-special-member-suppresses-the-other-five.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/cpp/agent.json`
  - **Why**: Helps with C++-related tasks, such as choosing between unique_ptr, shared_ptr and
    weak_ptr, picking memory_order values and separating relaxed counters from release/acquire
    publication, spotting volatile used as synchronization, std::move lifetime rules, and applying the
    rule of zero to classes with destructors.
  - **When**: Target project is a C++ project (has `.cpp`/`.cc`/`.hpp` sources or a `CMakeLists.txt`).
  - **Target Location**: `docs/agents/cpp/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/cpp/cpp-ownership-and-atomicity-decisions.md`
  - **Why**: Two questions decide almost every C++ class that crosses a thread boundary — who owns this
    object, and what ordering does this access need — and neither lines up with the type name. The
    matrix names each mechanism *and* the default it ships with, because in C++ the default is almost
    always the stronger, slower, more permissive option: the `seq_cst` fence, the `shared_ptr` use
    count, the `volatile` that is not atomic, the `consume` that is really acquire, the `std::move`
    that is a cast, the destructor that suppresses the moves.
  - **When**: Target project picks between `unique_ptr` / `shared_ptr` / `weak_ptr`, chooses a
    `memory_order`, or decides whether a destructor is worth what it suppresses.
  - **Target Location**: `docs/cpp/cpp-ownership-and-atomicity-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.