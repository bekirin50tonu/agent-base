---
title: "declaring one special member suppresses the others"
rule_id: "RULE-CPP-006"
category: "correctness"
scope: "backend"
applies_to: "C++, rule of zero, special member functions, destructors, polymorphism"
last_updated: "2026-10-04"
source: "https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines"
---

# declaring one special member suppresses the others

The six special member functions are generated as a set. Declaring any one of them — **including
`= default` and `= delete`** — can suppress the rest, and the suppression is invisible at the
declaration site:

> Declaring any copy/move/destructor function, even as =default or =delete, will suppress the implicit
> declaration of a move constructor and move assignment operator.
> ([C++ Core Guidelines C.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#c21-if-you-define-or-delete-any-copy-move-or-destructor-function-define-or-delete-them-all))

The move constructor's own conditions name the specific trigger, and the fourth item is the one that
surprises people:

> If no user-defined move constructors are provided for a class type, and all of the following is
> true: there are no user-declared copy constructors; there are no user-declared copy assignment
> operators; there are no user-declared move assignment operators; there is no user-declared
> destructor. Then the compiler will declare a move constructor
> ([Move constructor — cppreference](https://en.cppreference.com/w/cpp/language/move_constructor.html))

**A user-declared destructor is enough to suppress the implicit move constructor.** Add a destructor to
close a resource or log teardown, and every move in that class silently becomes a copy. The class keeps
compiling, keeps passing tests, and gets slower — the failure mode where nothing reports anything.

The guidelines draw the same line from the other side, and both sides of it matter:

> A destructor must not fail
> ([C++ Core Guidelines C.37](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#c37-make-destructors-noexcept))

> If the destructor is public, then calling code can attempt to destroy a derived class object through
> a base class pointer, and the result is undefined if the base class's destructor is non-virtual.
> ([C++ Core Guidelines C.35](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#c35-a-base-class-destructor-should-be-either-public-and-virtual-or-protected-and-non-virtual))

## Why

The rule of zero — let the compiler generate everything — is the right default, and it holds until
someone adds a destructor. That single addition is a normal thing to do, so the codebase drifts away
from zero without a decision ever being made about moves.

The cost is invisible because copies and moves are interchangeable at the type level: everything still
compiles, and only a benchmark notices. Meanwhile `= default` reads as "explicitly the same as
before", so it suppresses exactly as much as a user-written destructor while looking inert.

C.35 is the sharp end. A public non-virtual destructor on a base class means deleting through a base
pointer is undefined behaviour — and since C++11's default is `noexcept`, a non-virtual base destructor
leaves the derived object's members not destroyed at all.

## Do

- Follow the rule of zero: hold resources in members with destructors, and declare none of your own.
- When you must declare one, declare all six. The Rule of Five (or Zero) keywords make this cheap:

```cpp
// Correct — all six stated, so suppression is impossible and intent is visible
class Buffer {
public:
    Buffer() = default;
    Buffer(const Buffer&) = default;
    Buffer& operator=(const Buffer&) = default;
    Buffer(Buffer&&) noexcept = default;
    Buffer& operator=(Buffer&&) noexcept = default;
    ~Buffer();
private:
    std::vector<char> data_;
};
```

- Delete rather than suppress, when the intent is "this type does not move":

```cpp
// Correct — non-copyable, non-movable, stated plainly
class Handle {
public:
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&&) = delete;
    Handle& operator=(Handle&&) = delete;
};
```

- Make a base class destructor `virtual` if it will ever be inherited from polymorphically, or
  `protected` and non-virtual if it is only ever a base.
- Mark destructors `noexcept` explicitly when members could throw.

## Don't

- Don't add a destructor "just to log" or "just to reset one flag" — that alone can cost every move in
  the class.
- Don't write `= default` on one special member and believe the others are unaffected. `= default`
  suppresses just as hard as a user-written body.
- Don't delete the move constructor alone. Delete the copy constructor with it; the guidelines' point
  is that the set is decided together.
- Don't inherit from a class with a public non-virtual destructor. Delete-through-base is undefined
  behaviour, and `unique_ptr<Base>` on a `Derived` hits it.
- Don't let a destructor throw, or one that can, mark itself `noexcept`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Type became slow to copy after adding a destructor | Implicit move constructor suppressed | Declare all six explicitly |
| `std::vector` reallocation copies instead of moves | Move constructor not `noexcept` | Add `noexcept` |
| Members of a derived object never destroyed | Deleted through non-virtual base destructor | Make the base destructor `virtual` |
| `noexcept` deleted from a destructor | Destructor can throw | Remove the throw path |
| Compile error on a move after adding `= default` | `= default` suppressed the rest | Declare the whole set |
| Type unexpectedly non-copyable | Copy operations deleted by a sibling declaration | State the full set deliberately |

## Verifying

```bash
# Classes declaring any special member -- each needs the set checked
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '^\s*(explicit\s+)?~[A-Za-z_]+\s*\(|=\s*default\s*;|=\s*delete\s*;' src/ include/

# Destructors, which are the most common suppressor
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '^\s*(explicit\s+)?~[A-Za-z_]+\s*\(' src/ include/

# Base classes with a destructor, to check virtual or protected
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '(public|protected)?\s*(virtual\s+)?~[A-Za-z_]+\s*\(\s*\)\s*' src/ include/

# Move operations missing noexcept
grep -rn --include='*.{c,cc,cpp,h,hpp}' -E '&&' src/ include/ | grep -vE 'noexcept|&&=' 
```

The first list is the whole defect surface, and for each class the count of declared special members
tells you the story: fewer than six is not itself wrong, but it must be a decision. The third list
needs each entry read for `virtual` or `protected`.

These greps cannot tell you whether a move was suppressed rather than merely not requested, because
absence and suppression look identical from outside the class. Confirming it takes
`static_assert(std::is_move_constructible_v<T>)` on the types that matter.