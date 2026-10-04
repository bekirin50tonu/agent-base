---
title: "Settings Are Imported Module Constants, Not a Config API"
rule_id: "RULE-DJANGO-006"
category: "architecture"
scope: "backend"
applies_to: "Any library or shared module that reads django.conf.settings at import time; any project with more than one environment or a test suite that overrides settings"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/topics/settings/,https://docs.djangoproject.com/en/6.1/topics/testing/tools/"
---

# Settings Are Imported Module Constants, Not a Config API

Django's settings are not a config system with an access API. They are module-level variables in a
Python module that is imported once at startup, and every `settings.X` is a plain attribute lookup
against a frozen module namespace.

## Why

The documentation states the mechanism plainly:

> A settings file is just a Python module with module-level variables.
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/topics/settings/))

And then lists what "just a Python module" licenses:

> It can import values from other settings files.
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/topics/settings/))

The full list is that a settings file doesn't allow for Python syntax errors, can assign settings
dynamically using normal Python syntax, and can import values from other settings files. That third
item is the seam this rule is about.

Nothing prevents a settings file from importing a secret-store client
and reading a secret at import time, or from computing a value with a database query, or from
importing a module with side effects. The value is resolved once, at import, and frozen for the
process lifetime.

### Import order becomes configuration

If `settings.py` imports a module that reads `os.environ`, the value depends on the environment at
the moment the settings module was first imported — before any test fixture, before any
`override_settings` block. `override_settings` swaps the module attribute; it does not re-run an
import. A value computed during import keeps its original value, so the test asserts against the
developer's local environment rather than the one the test declared.

### The boundary is discipline, not enforcement

Nothing raises when a library module imports `django.conf.settings`. Compare a framework where a
container resolves config, or a validation layer where a mechanism decides the allowlist — in those
cases a rule is true because something enforces it. Here the rule "don't reach into Django settings
from library code" is a convention. Nothing enforces it, and the consequences arrive late: the
library becomes Django-only, cannot be configured independently, and pulls Django in as a
transitive dependency for anyone who wants its one function.

The testability cost is the version people notice first. Code that reads `settings.API_KEY` at
call time is overridable. Code that reads `os.environ["API_KEY"]` at import time is not — and the
resulting test either mutates `os.environ` and hopes for a re-import, or silently passes against
whatever was in the developer's shell.

## Do

- Read the environment at call time in application code, so overrides and tests reach it:
  ```python
  # Incorrect — resolved once at import; override_settings cannot reach it
  # settings.py
  API_KEY = os.environ["PAYMENT_API_KEY"]

  # Correct — read at call time
  # payments/client.py
  def get_api_key() -> str:
      return os.environ["PAYMENT_API_KEY"]
  ```
- Inject configuration into libraries. A constructor parameter is testable by construction; a
  module-level global read from Django settings is not:
  ```python
  # Incorrect — mylib is now Django-only, and the value is frozen at import
  # mylib/client.py
  from django.conf import settings

  TIMEOUT = settings.PAYMENT_TIMEOUT

  # Correct — the caller injects it, and mylib has no Django dependency
  class PaymentClient:
      def __init__(self, api_key: str, timeout: float = 10.0):
          self.api_key = api_key
          self.timeout = timeout
  ```
- Keep settings assignments literal. A comprehension or a function call in `settings.py` makes the
  value depend on import-time state you cannot see in the file:
  ```python
  # Incorrect — a computed value nobody can trace by reading the file
  ALLOWED_HOSTS = [h for h in os.environ["HOSTS"].split(",") if h]

  # Correct — explicit, and the derivation is visible where it happens
  ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost").split(",")
  ```
- Assert the production settings in a startup check or a test. A setting that exists only in the
  deploy environment is caught by nothing in development.
- Reach for a typed settings object once there are enough settings that a typo is plausible —
  `pydantic-settings` makes an undefined name a startup error rather than an `AttributeError`
  halfway through a request. See `shared/python/settings-and-secrets.md`.

## Don't

- Import `django.conf.settings` in reusable library code. It is the same mistake as importing any
  other framework global: it inverts the dependency and makes the module untestable in isolation.
- Read `settings.X` at module level in a module a test wants to reconfigure. Move it into a
  function or a class attribute.
- Assume `override_settings` re-runs anything. It replaces module attributes on
  `django.conf.settings`; it cannot re-run an import, so import-time derivations keep their
  original values.
- Put I/O in `settings.py`. A database query, an HTTP call, or a secret-store read in the settings
  module is a startup dependency that fails as an opaque import error rather than as configuration
  you can point at.
- Add a settings library to a small project. The failure this rule describes requires discipline,
  not a dependency — a package adds a startup failure mode and removes nothing.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Test asserts against the developer's local value | `os.environ` read at import time in a module `settings.py` imports | Read at call time; pass config in explicitly |
| `override_settings` has no effect on a value | Value was derived during import, not stored as an attribute | Move derivation into the code that uses it |
| A shared library cannot be imported outside Django | Library imports `django.conf.settings` | Inject config; keep the library framework-free |
| Startup fails with an opaque `ImportError` | I/O or a missing dependency inside `settings.py` | Keep settings assignments literal |
| A setting is missing in one environment only | No startup assertion for the deploy config | Validate settings at boot in a test or health check |
| A typo in a setting name is a runtime `AttributeError` | Settings are untyped module attributes | Use a typed settings object once the count warrants it |

## Verifying

```bash
# Library and shared modules that reach into Django settings
grep -rn "from django.conf import settings\|django.conf.settings" --include=*.py .

# Settings read at module level rather than inside a function or class body
grep -rn "^[A-Z_]* *= *settings\.\|^[A-Z_]* *= *os.environ" --include=*.py .

# Overrides in tests that a value derived at import would ignore
grep -rn "override_settings" --include=*.py .

# Non-literal assignments in the settings module — each is import-time work
grep -nE "^[A-Z_]+ *= .*\(" --include=*.py . | grep -v "os.environ.get"
```

The first command is the boundary: everything it lists is code whose testability now depends on a
Django app being configured. The fourth finds settings that do work at import rather than declaring
a value. Neither can tell you whether an override in the third actually reaches the value — that
takes reading the module where the value was captured.