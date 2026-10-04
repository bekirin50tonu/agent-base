---
title: "Every Config Loader Keeps Only UPPERCASE Keys, and a Dropped Key Equals an Absent One"
rule_id: "RULE-FLASK-002"
category: "correctness"
scope: "backend"
applies_to: "Any app.config.from_object, from_pyfile, from_mapping, from_envvar, or from_prefixed_envvar call; any extension config class; any config file authored to another tool's conventions"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst,https://raw.githubusercontent.com/pallets/flask/main/src/flask/config.py"
---

# Every Config Loader Keeps Only UPPERCASE Keys, and a Dropped Key Equals an Absent One

Flask's config loaders iterate their source and keep entries whose key `isupper()`. Everything else
is discarded without a warning, at every entry point — including `from_mapping`, which is the one
people believe is exempt. A key that was dropped is indistinguishable from a key that was never
written, so the failure surfaces at first use with the framework's own default in place.

## Why

The documented rule:

> The configuration files themselves are actual Python files. Only values in uppercase are actually
> stored in the config object later on. So make sure to use uppercase letters for your config keys.
> ([Flask config](https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst))

The mechanism, from the docstring:

> Objects are usually either modules or classes. :meth:`from_object` loads only the uppercase
> attributes of the module/class. A ``dict`` object will not work with :meth:`from_object` because the
> keys of a ``dict`` are not attributes of the ``dict`` class.
> ([Flask `config.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/config.py))

So `secret_key = "..."` in `default_config.py` is loaded into the module and then thrown away.
`app.config["SECRET_KEY"]` is `None` — the shipped default — and the first request that touches
`session` is where it appears. There is no log line, no warning, and no difference in behaviour
between "you wrote it wrong" and "you forgot it".

The filter is a bare `key.isupper()` in each loader, which is why it is easy to assume it is
`from_object`-specific. It is not:

```python
        for key, value in mappings.items():
            if key.isupper():
                self[key] = value
        return True
```
([Flask `config.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/config.py))

That is `from_mapping`, and it filters exactly like `from_object` does — `app.config.from_mapping(
{"debug": True})` drops `debug` too. The common workaround of moving a dict into `from_mapping` to
avoid the uppercase requirement does not exist. What does work is
`app.config.from_object(module)`, which is not affected because module-level `dir()` names are
already uppercase in a conventional config module.

The variant that survives review is not a typo. A config file written for `django-environ`,
`pydantic-settings`, or `.env` conventions is case-insensitive and idiomatic everywhere else; it is
wrong only here, and only for the keys that differ in case.

### `silent` is about missing files, not precedence

The instance-folder folklore needs a correction, because it attributes a real behaviour to a flag
that does something else:

> :param silent: set to ``True`` if you want silent failure for missing files.
> ([Flask `config.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/config.py))

`silent=True` governs **missing files**, which is the normal development case — there is no instance
config locally, and that is not an error. It says nothing about precedence. An instance `config.py`
that exists does override `default_config.py` because it loads later, which is ordinary module load
order and would be true of any two config objects. The distinction matters in exactly one direction:
a **missing** instance file fails silently and a **present but broken** one raises, so a deploy that
forgot to copy the file starts normally with production defaults.

## Do

- Keep config keys uppercase everywhere, in files, classes, and dicts alike:
  ```python
  import os

  class DefaultConfig:
      DEBUG = False
      SECRET_KEY = os.environ.get("SECRET_KEY")
      DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///dev.db")
  ```
- Assert the load happened, so a dropped or missing key stops the boot instead of the first request:
  ```python
  def create_app():
      app = Flask(__name__)
      app.config.from_object("project.default_config")

      instance_config = os.path.join(app.instance_path, "config.py")
      if os.path.exists(instance_config):
          app.config.from_pyfile(instance_config)

      # the check that turns a silent no-op into a failed start
      if not app.config["DATABASE_URL"]:
          raise RuntimeError("DATABASE_URL was not loaded from any config source")
      return app
  ```
- Make required settings fail at load rather than at use. `os.environ["DATABASE_URL"]` without a
  default raises at import; `os.environ.get("DATABASE_URL")` returns `None` and fails later. The
  first is the one you want for anything the app cannot start without.
- Dump the resolved config in CI and diff it against the committed expectation. `flask --app
  'project:create_app()' config` needs no dependency and catches a key that stopped being read
  because someone renamed it.
- Read extension config through the same rule. An extension whose config class uses lowercase
  attributes loses those values here, and its own docs usually show uppercase — so the mistake is
  only ever in your file.

## Don't

- Assume `from_mapping` accepts lowercase keys. It filters them, same as every other loader; this is
  the most commonly repeated wrong belief about Flask config.
- Mix case conventions across config files in one project. The uppercase rule is Flask's; the
  case-insensitive convention belongs to the other tools, and a file serving both will be wrong for
  one of them.
- Treat a missing instance config as an error in development. It is not, `silent=True` is correct,
  and the place to catch it is the assertion at boot.
- Rely on `DEBUG` being set because you wrote it. `app.config["DEBUG"]` after a lowercase
  `debug = True` is `False` — the shipped default — which looks exactly like a deliberate choice.
- Use `flask config` output as documentation of what you intended. It shows what was loaded, which
  is the point: when a key is missing from the dump, it was never read.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `SECRET_KEY` is `None`, sessions fail at first request | Lowercase key dropped by the loader | Uppercase the key; assert at boot |
| `DEBUG` off despite setting it | `debug = True` dropped | Use `DEBUG` |
| `from_mapping` drops a lowercase key | The filter applies to every loader | Uppercase the key |
| An extension's config values are ignored | Its config class uses lowercase attributes | Uppercase them in your file |
| Production starts with dev defaults | Instance file missing; `silent=True` | Assert required keys after loading |
| A key stops being read after a rename | Old case still in the file | Diff `flask config` output in CI |

## Verifying

```bash
# Lowercase or mixed-case assignments in config files and config classes
grep -rn "^ *[a-z][a-zA-Z_]* *= " --include=*config*.py .

# Every loader in use — all of them filter
grep -rn "from_object\|from_pyfile\|from_mapping\|from_envvar\|from_prefixed_envvar\|from_file" --include=*.py .

# Lowercase keys passed through from_mapping
grep -rn "from_mapping(" --include=*.py .

# Settings read from the environment without a hard failure
grep -rn "environ\.get\|getenv" --include=*config*.py .
```

The first command is the audit and the only one that needs judgement: every hit is a value that will
not reach `app.config`. The second tells you which loaders are in play, all of which behave the
same way. The last finds the settings that will be `None` rather than absent-at-import. Nothing here
tells you the value that ended up in `app.config` — for that, `flask config` on the resolved app.