---
title: "PEP 695 Native Generic Syntax"
rule_id: "RULE-PYTHON-001"
category: "style"
scope: "all"
applies_to: "Python 3.12+"
last_updated: "2026-09-29"
source: "https://peps.python.org/pep-0695/"
---

# PEP 695 Native Generic Syntax

Declare type parameters with the Python 3.12 syntax rather than the `typing` module
spellings, and never combine the new syntax with an explicit `Generic`/`Protocol` base.

## Do

- Declare type parameters inline on the class or function for 3.12+ code:

  ```python
  class ClassA[T: str]:
      def method1(self) -> T: ...

  def func[T](a: T, b: T) -> T: ...

  type ListOrSet[T] = list[T] | set[T]   # arity requirement now visible

  class ChildClass[T, *Ts, **P]: ...
  ```

- Keep the `TypeVar` / `Generic` spellings for code that must import on < 3.12. They are
  supported, not deprecated — use them where the minimum version requires it.
- Drop a redundant `Generic` base and let the type parameters carry the information:

  ```python
  class ClassB[T](Protocol): ...   # Recommended
  ```

## Don't

- Pair new-style type parameters with a `Generic` or `Protocol` base class. The base is
  implied, and stating it again is a **runtime error**, not a type error:

  ```python
  class ClassA[T](Generic[T]): ...   # Runtime error
  ```

- Continue writing `TypeVar("_T_co", covariant=True)` for new code. The new syntax removes
  most of the need to reason about variance by hand.
- Declare a generic alias without type parameters and rely on the checker inferring
  arity. The PEP's analysis of 25 popular typed libraries found this was the most common
  misuse — an unintended type argument gets silently implied.

## Code Example

```python
# Correct — inline type parameters, no redundant base
class Repository[T]:
    def get(self, key: str) -> T | None: ...


# Incorrect — Generic alongside PEP 695 parameters
class Repository[T](Generic[T]):   # Runtime error
    def get(self, key: str) -> T | None: ...


# Compatibility path for a < 3.12 target
from typing import Generic, TypeVar

_T = TypeVar("_T")

class Repository(Generic[_T]):
    def get(self, key: str) -> _T | None: ...
```

## Rationale

PEP 695 is Final and targets 3.12. The redundant-base form fails at runtime, not at
check time, so a reviewer relying on a type checker alone will not catch it.

The arity problem is the substantive one: a bare `type Alias = list` gives no signal that
an argument is required, and the checker supplies an implied argument that is rarely the
intent. The new syntax moves that requirement to the declaration, where it is visible.
