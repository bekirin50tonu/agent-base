---
title: "Free-Threaded Python Has a Real, Platform-Dependent Cost"
rule_id: "RULE-PYTHON-003"
category: "performance"
scope: "all"
applies_to: "Python 3.13+ free-threaded builds"
last_updated: "2026-09-30"
source: "https://docs.python.org/3/howto/free-threading-python.html"
---

# Free-Threaded Python Has a Real, Platform-Dependent Cost

Budget 1-8% single-threaded overhead and lose deterministic deallocation. Adopt on
measurement, never on the premise that "threads are fast now."

## Do

- Benchmark on the target architecture against the GIL build on the *same* machine. The
  docs give average pyperformance overhead from **about 1% on macOS aarch64 to 8% on x86-64
  Linux** — 8% is the pessimistic end, not a constant:

  ```bash
  python3.14t -c "import mymodule"   # free-threaded
  python3.14  -c "import mymodule"   # GIL
  ```

- Use explicit synchronisation even though built-in types are internally locked. The docs
  recommend it over relying on the internal locks of `dict`, `list`, and `set`:

  ```python
  _lock = threading.Lock()

  with _lock:
      shared_state[key] = value
  ```

- Adopt free-threading specifically for CPU-bound work that saturates cores on threads. That
  is the case where the win is larger than the cost.

## Don't

- Adopt it "because threads are fast now." If the workload is I/O bound, the async
  toolchain already delivered the property you were buying, without the overhead.
- Rely on immortalization as a memory optimisation. In the free-threaded build some objects
  are immortal — never deallocated, reference counts never modified — to avoid refcount
  contention. If your correctness depends on finalizers, `weakref` callbacks, or
  deterministic teardown, the build has changed that on purpose.
- Promise JIT-era performance. PEP 836 ("JIT Go Brrr") is **Status: Draft**, its
  `Python-Version` is **3.16**, and the ≥20% geometric mean target is set for the first beta
  of **3.17**. The current JIT measures roughly **4-12%**. A Draft PEP is not a schedule.

## Code Example

```python
# Correct — explicit primitive, measured adoption
import threading

_lock = threading.Lock()


def bump(key: str) -> None:
    global _counters
    with _lock:
        _counters[key] = _counters.get(key, 0) + 1


# Incorrect — correctness riding on deallocation the build removes
import weakref


def _on_collect(conn):        # may never run on a free-threaded build
    conn.close()

weakref.finalize(conn, _on_collect, conn)
```

## Rationale

The overhead is documented as workload- and hardware-dependent, so any single number quoted
as "the cost" is wrong for someone else's machine. Measuring on the deployment architecture
is the only way to know.

The immortalization change is the trap. It is an internal scaling trade-off that reads as a
memory win, but it silently removes deallocation — which is a correctness dependency in code
that uses `weakref.finalize` or context managers to release external resources.
