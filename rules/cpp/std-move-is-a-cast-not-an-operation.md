---
title: "std::move is a cast, and the moved-from state is usually unspecified"
rule_id: "RULE-CPP-005"
category: "correctness"
scope: "backend"
applies_to: "C++, std::move, std::forward, move constructors, RAII"
last_updated: "2026-10-04"
source: "https://en.cppreference.com/w/cpp/utility/move.html"
---

# std::move is a cast, and the moved-from state is usually unspecified

`std::move` performs no move. It is a cast to an rvalue reference, which exists only to select an
overload:

> It is exactly equivalent to a static_cast to an rvalue reference type.
> ([std::move — cppreference](https://en.cppreference.com/w/cpp/utility/move.html))

> If the argument identifies a resource-owning object, these overloads have the option, but aren't
> required, to move any resources held by the argument.
> ([std::move — cppreference](https://en.cppreference.com/w/cpp/utility/move.html))

So `std::move(x)` on a type with no move constructor silently copies, and `std::move` on an already-rvalue
is a no-op. What you actually want is the *guarantee*, and that guarantee is per-type:

> Move constructors typically transfer the resources held by the argument (e.g. pointers to
> dynamically-allocated objects, file descriptors, TCP sockets, thread handles, etc.) rather than make
> copies of them, and leave the argument in some valid but otherwise indeterminate state.
> ([Move constructor — cppreference](https://en.cppreference.com/w/cpp/language/move_constructor.html))

> For example, moving from a std::string or from a std::vector may result in the argument being left
> empty. For some types, such as std::unique_ptr, the moved-from state is fully specified.
> ([Move constructor — cppreference](https://en.cppreference.com/w/cpp/language/move_constructor.html))

"Valid but otherwise indeterminate" is the phrase to remember. Reading a moved-from object is *defined
behaviour*, so no sanitizer fires and no compiler warns — it may return the original value rather than
the empty one a reader expects. Only some types (`unique_ptr` above) promise a specific state.

The lifetime half is the one that bites in RAII code:

> Since move constructor doesn't change the lifetime of the argument, the destructor will typically be
> called on the argument at a later point.
> ([Move constructor — cppreference](https://en.cppreference.com/w/cpp/language/move_constructor.html))

The destructor still runs on the moved-from object. Every RAII member of it performs the cleanup its
own destructor declares — on members whose contents are now indeterminate.

## Why

`std::move` at a call site is the common form, and it inverts the responsibility. Taking a parameter
**by value** and moving it out at the end puts the transfer in the callee, where the parameter is a
local nobody else can observe. Calling `std::move` at the assignment site moves a value that is still
live in the caller's scope and still has a destructor attached — so "it was moved" has to be an
unstated invariant, held by convention, across every call site that touches the variable afterwards.

That invariant is exactly what breaks. `x = std::move(y); use(y);` is not a compile error, is not
flagged by any sanitizer, and reads like a leftover. The classic instance is a moved-from `std::mutex`
or `std::lock_guard` member: the destructor still runs, on a state nobody documented.

The `noexcept` interaction is the other half. `std::move` itself is `noexcept`, but the move
*constructor* it selects may not be. Marking your move constructor `noexcept` matters for whether
`std::vector` reallocates or moves elements one at a time — and a move constructor that can throw
turns a reallocation into a partial move with no transactional guarantee.

## Do

- Take sink parameters **by value** and `std::move` them in the callee. `void push(std::string title)`
  then `sink_ = std::move(title);` is the safe idiom.
- Use `std::move` at an assignment only when the source is a local about to go out of scope, and let
  the comment say so.
- Mark move constructors and move assignment `noexcept` when they cannot throw — it lets containers
  move instead of copy on reallocation.
- Rely on the moved-from state only for types that specify it. `unique_ptr` does; a user-defined type
  does not until you say so.
- Use `std::move` on an rvalue only if you intend to move *again* from it. Prefer passing rvalues
  directly and letting the parameter's construction do the move.

```cpp
// Correct — the callee owns the transfer; the caller's value is untouched
void push(std::string title) { sink_ = std::move(title); }

// Incorrect — the source is still live, still has a destructor, and "it was moved"
// is now an invariant held by nobody
title = std::move(other_title);
log(other_title);   // defined, unspecified, and almost certainly not what you meant
```

## Don't

- Don't `std::move` a function parameter that the caller passed by reference — you are emptying their
  object, not your copy.
- Don't use a moved-from object afterwards, even to "check if it is empty". Checking costs a call that
  only sometimes means what you think.
- Don't assume `std::move` made a copy cheap. It selects an overload; if there is no move constructor
  you have a copy with an extra cast.
- Don't write a move constructor without checking what your members do, since each member's destructor
  will run on the moved-from object too.
- Don't mark a move constructor `noexcept` if it can throw — that is a promise the container will
  rely on and the program will break.
- Don't reach for `std::forward` to "fix" a move; forwarding and moving are different intents.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Source used after assignment, garbage value | Moved-from state is indeterminate | Move at the callee, or leave the source alone |
| Element-by-element copy during `vector` growth | Move constructor not `noexcept` | Add `noexcept` if it cannot throw |
| Moved-from `mutex` unlocked by a later destructor | Destructor runs on moved-from state | Own the mutex in a non-movable type |
| Destructor closes a handle twice | RAII member cleanup on the source object | Transfer by value into the callee |
| No speedup from `std::move` | Type has no move constructor | Write one, or pass by value |
| Compile error on a moved-from object use | Type explicitly deletes the operation | Reconstruct or check `use_count()` |

## Verifying

```bash
# std::move at call sites, to see which are sinks and which are still live afterwards
grep -rn --include='*.{c,cc,cpp,h,hpp}' 'std::move' src/ include/

# Move constructors and assignments, to check noexcept is present where it can be
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '\b\w+\s*\(\s*\w+\s*&&\s*(,\s*noexcept)?\s*\)' src/ include/

# Move operations that are not noexcept
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '&&\s*\)' src/ include/ | grep -v noexcept

# Reassignment of a moved-from variable -- each hit needs the intervening uses read
grep -rn --include='*.{c,cc,cpp,h,hpp}' -B2 -A6 'std::move' src/ | grep -E '\b[a-z_]+\s*(=|\.append|\.push_back|\.emplace)'
```

The third list is where container performance is decided: a missing `noexcept` means reallocation
copies instead of moving. The fourth is the real defect surface — each hit is a variable whose
state after the move is not written down.

These greps cannot tell you whether a moved-from object is still used, because use can be anywhere in
the variable's remaining scope. Every match from the last grep needs the code after it read by hand.