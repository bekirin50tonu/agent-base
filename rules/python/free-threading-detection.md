---
title: "Detect Whether the GIL Is Actually Enabled"
rule_id: "RULE-PYTHON-002"
category: "architecture"
scope: "all"
applies_to: "Python 3.13+ free-threaded builds"
last_updated: "2026-09-30"
source: "https://docs.python.org/3/howto/free-threading-python.html"
---

# Detect Whether the GIL Is Actually Enabled

Ask the running process and the build separately — a free-threaded interpreter can have the
GIL back on, and the two questions have different APIs.

## Do

- Use `sysconfig.get_config_var("Py_GIL_DISABLED") == 1` to ask whether the *build* supports
  free threading. The docs name this as the recommended mechanism for build-configuration
  decisions:

  ```python
  import sysconfig

  if sysconfig.get_config_var("Py_GIL_DISABLED") == 1:
      ...
  ```

- Use `sys._is_gil_enabled()` to ask whether the GIL is on *right now, in this process*,
  and guard for its absence — it is a CPython implementation detail:

  ```python
  import sys

  if hasattr(sys, "_is_gil_enabled") and sys._is_gil_enabled():
      print("GIL is on; a dependency re-enabled it, or -X gil was passed")
  ```

- Capture the warning printed on import of a non-free-threading C extension. It names the
  culprit; letting it scroll past is how a deployment silently loses parallelism.
- Check the ecosystem trackers when auditing dependencies, not at runtime:
  `https://py-free-threading.github.io/tracking/` and
  `https://hugovk.github.io/free-threaded-wheels/`.

## Don't

- Infer free-threading from the executable name, wheel tag, or `requires-python`. All three
  describe the distribution; none describes the running process.
- Treat the presence of a free-threaded wheel as a runtime guarantee. Wheel availability is
  a packaging fact; whether *your* import graph keeps the GIL off is a separate question.
- Use `python -VV` or `sys.version` to detect current state. They report whether the build
  contains `free-threading build`, not whether the GIL is enabled in this process.

## Code Example

```python
# Correct — two different questions, two different APIs
import sys
import sysconfig


def gil_status() -> tuple[str, str]:
    build_supports = sysconfig.get_config_var("Py_GIL_DISABLED") == 1
    if not hasattr(sys, "_is_gil_enabled"):
        return "unknown", "sys._is_gil_enabled() absent; not CPython"
    return ("enabled" if sys._is_gil_enabled() else "disabled",
            "free-threaded build" if build_supports else "GIL-only build")


# Incorrect — inferring from packaging metadata
import sys
assert sys.version.endswith("(free-threading build 3.14.0)")   # tells you nothing about now
```

## Rationale

The GIL returns through three distinct paths — an explicit `PYTHON_GIL` or `-X gil`, an
automatic re-enable on importing an unmarked C extension, or never having been disabled.
All three produce the same symptom: code written to exploit parallelism that silently does
not get it. Distinguishing them requires the runtime check, not the build metadata.

`sys._is_gil_enabled()` is undocumented-by-convention and may not exist on another
interpreter, which is why the guard is mandatory rather than defensive style.
