---
title: "Settings and Secrets: Who Fails Loudly When a Variable Is Missing, and Who Returns the Default"
category: "security"
applies_to: "Any Python service reading configuration from the environment — Django settings modules, pydantic-settings BaseSettings models, Flask config objects, django-configurations Value types; any deployment where a missing variable must not fall back to a shipped default"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/joke2k/django-environ/main/environ/environ.py,https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/base.py,https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/providers/env.py,https://raw.githubusercontent.com/jazzband/django-configurations/master/configurations/values.py,https://raw.githubusercontent.com/django/django/main/django/conf/global_settings.py"
---

# Settings and Secrets: Who Fails Loudly When a Variable Is Missing, and Who Returns the Default

Every settings library answers the same two questions, and they disagree on both. **Is a missing
variable an error, or a value?** And **does a typo in the variable name look like a typo, or like an
unset variable?** The first decides whether a misconfigured deploy crashes or ships. The second
decides whether you find out at all.

The libraries are not ordered here. `django-environ` fails loudly and quietly does the dangerous
thing; `django-configurations` defaults silently and has an opt-in for the opposite;
`pydantic-settings` is the only one of the three whose *name matching* is the interesting part.

## When to Use

- A service reads config from environment variables and a missing one should stop the process, not
  become `None`, `""`, or `False`.
- A deploy reached production with a variable unset — or, worse, with a variable *misspelled* and
  the default silently substituted.
- Reviewing whether a secret can be absent at runtime, and what the process does when it is.
- Choosing between plain `os.environ`, `django-environ`, `pydantic-settings`, and
  `django-configurations`, or deciding whether you need any of them.
- A settings module that "works locally and in production" with no local `.env` file present.

## The axis: missing vs misspelled

| Library | Variable absent, no default given | Name misspelled | Default when absent |
|---|---|---|---|
| **`os.environ[...]`** | `KeyError` — loud | `KeyError` — loud | none |
| **`django-environ`** `env.str(...)` | `ImproperlyConfigured` — loud | `ImproperlyConfigured` — loud | none |
| **`pydantic-settings`** | `ValidationError` if field required | **accepted as absent** — falls back to default | the field's default |
| **`django-configurations`** `Value()` | the shipped `default` | the shipped `default` | the shipped `default` |

Only the third and fourth columns differ, and only the third row's *first* column is loud by
default. Two of the three libraries treat a typo as "not set", and `django-configurations` treats
"not set" as "use the default" without complaint. That combination — typo plus default — is the
failure this file exists for: a variable that is misspelled *and* has a default is a variable that
is silently wrong in production and correct-looking everywhere else.

## django-environ: fails loudly, and quietly does the dangerous thing

When a variable is missing and you gave no default, django-environ raises rather than inventing a
value:

```python
            if default is self.NOTSET:
                error_msg = f'Set the {var_name} environment variable'
                raise ImproperlyConfigured(error_msg) from exc
```
([django-environ `environ.py`](https://raw.githubusercontent.com/joke2k/django-environ/main/environ/environ.py))

That is the behaviour you want, and it is the reason to use the library. Note it keys off
`default is self.NOTSET` — an identity check against a sentinel, not `if not default`, so a
legitimate falsy default such as `False` or `0` is not mistaken for "no default given".

Its `.env` loader has the opposite property, and the docstring says so plainly:

> Existing environment variables take precedent and are NOT overwritten by the file content.
> ([django-environ `environ.py`](https://raw.githubusercontent.com/joke2k/django-environ/main/environ/environ.py))

which is implemented as a plain `setdefault`:

```python
             Use setdefault unless overwrite is specified.

        return lambda k, v: envval.setdefault(k, str(v))
```
([django-environ `environ.py`](https://raw.githubusercontent.com/joke2k/django-environ/main/environ/environ.py))

Read the two together and you have the whole library. A variable missing from the real environment
**and** present in a `.env` file is satisfied from the file with no warning. That is what you want in
development, where the `.env` is the source. It is also what silently ships a developer's local
credentials to production if a `.env` file is ever committed or baked into an image — which is the
one thing you wanted the loud failure to prevent.

### The `#` and `$` prefixes

Both are visible in the `get_value` path: a value beginning with `$` is treated as an indirection to
another variable, and `escape_proxy` is what lets you opt out. A password that legitimately starts
with `$` therefore changes meaning unless escaped — a value-level surprise with no error, and the
reason `escape_proxy` exists.

## django-configurations: the default *is* the mechanism

`Value.setup` is the whole design in eight lines:

```python
    def setup(self, name):
        value = self.default
        if self.environ:
            full_environ_name = self.full_environ_name(name)
            if full_environ_name in os.environ:
                value = self.to_python(os.environ[full_environ_name])
            elif self.environ_required:
                raise ValueError('Value {!r} is required to be set as the '
                                 'environment variable {!r}'
                                 .format(name, full_environ_name))
        self.value = value
        return value
```
([django-configurations `values.py`](https://raw.githubusercontent.com/jazzband/django-configurations/master/configurations/values.py))

The first line assigns the default **before** consulting the environment. Absence of the variable
is not an error; it is the ordinary path through the function. And the opt-in for the strict
behaviour is a per-value flag that defaults the other way:

```python
    environ_required = False
```
([django-configurations `values.py`](https://raw.githubusercontent.com/jazzband/django-configurations/master/configurations/values.py))

So `Value(default=None)` in production yields `None`, and nothing says so. The name it looks for is
also derived rather than configured, and the derivation is the second half of the typo problem:

```python
            environ_name = name.upper()
```
([django-configurations `values.py`](https://raw.githubusercontent.com/jazzband/django-configurations/master/configurations/values.py))

`DATABASE_URL` for `DATABASE`, `SECRET_KEY` for `SECRET_KEY` — consistent and predictable, but it
means the variable name is a *convention* rather than something the library can validate against.
A settings attribute nobody reads is never resolved at all, so a misspelled name can also mean the
`Value` is never set up and the plain Python default on the module is what ships.

### `SecretValue` is the opt-in you want

The library does contain the strict form, and it is stricter than most people expect — a secret may
not have a default at all:

```python
        kwargs['environ'] = True
        kwargs['environ_required'] = True
        super().__init__(*args, **kwargs)
        if self.default is not None:
            raise ValueError('Secret values are only allowed to '
                             'be set as environment variables')
```
([django-configurations `values.py`](https://raw.githubusercontent.com/jazzband/django-configurations/master/configurations/values.py))

Using it for `SECRET_KEY` and database URLs converts the first table's row for this library from
"silently `None`" to "refuses to start". That is a one-word change per setting and the highest-value
thing in this file.

## pydantic-settings: the interesting axis is name matching

Missing-required-field behaviour here is the ordinary Pydantic one — a `ValidationError` at
construction — so it is loud by default. What is *not* obvious is the case handling, and the source
states the collision it is defending against:

> # mapping is required because case_sensitive=False can collapse distinct keys
>
> # (e.g. ``TeSt`` and ``TEST``) onto the same normalized name.
> ([pydantic-settings `base.py`](https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/base.py))

which is the flip side of `case_sensitive` defaulting off:

```python
        case_sensitive = self.config.get('case_sensitive', False)
```
([pydantic-settings `base.py`](https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/base.py))

So `SECRET_KEY`, `Secret_Key` and `secret_key` are the same variable by default, and the 1-to-many
map exists so the library can still recover the *original* key for lookup rather than guessing
which one you meant.

The second half is a documented, silent downgrade at runtime:

```python
        if self.case_sensitive and _environ_is_case_insensitive():
            self.case_sensitive = False
```
([pydantic-settings `env.py`](https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/providers/env.py))

> # case-sensitively is therefore impossible, so we fall back to case-insensitive
> ([pydantic-settings `env.py`](https://raw.githubusercontent.com/pydantic/pydantic-settings/main/pydantic_settings/sources/providers/env.py))

On Windows `os.environ` is case-insensitive, so a model that asks for `case_sensitive=True` is
quietly given `False` instead. The consequence is not a crash — it is that a setting name differing
only in case silently resolves to a value, on one platform and not the others. The same behaviour
in a test on Linux and a deploy on Windows is a bug that reproduces for exactly one colleague.

Note the asymmetry the comment records: `.env` files *do* preserve case and are handled by a
different source that overrides this method. So the rule you must state in your own config is which
source a setting came from, not merely whether it is case-sensitive.

## What the framework ships when you do nothing

Django's `global_settings.py` is the no-library baseline, and it is worth reading as a list of
values that are dangerous when unset:

```python
DEBUG = False

# People who get code error notifications. In the format
# ["email@example.com", '"Full Name" <anotheremail@example.com>']
ADMINS = []

# Hosts/domain names that are valid for this site.
# "*" matches anything, ".example.com" matches example.com and all subdomains
ALLOWED_HOSTS = []

# A secret key for this particular Django installation. Used in secret-key
# hashing algorithms. Set this in your settings, or Django will complain
# loudly.
SECRET_KEY = ""

# List of secret keys used to verify the validity of signatures. This allows
# secret key rotation.
SECRET_KEY_FALLBACKS = []
```
([Django `global_settings.py`](https://raw.githubusercontent.com/django/django/main/django/conf/global_settings.py))

Three of those four are silent:

- `ADMINS = []` with `DEBUG=False` means an unhandled exception is logged and **emailed to nobody**.
  The 500 page is correct, the log line is correct, and no human is told. This is the same failure as
  `RULE-DJANGO-003`, and the empty list is the shipped default rather than something you set.
- `ALLOWED_HOSTS = []` is safe by construction — Django refuses to serve with it empty under
  `DEBUG=False`, which is the rare setting here that fails loudly.
- `SECRET_KEY_FALLBACKS = []` is the one to understand if you rotate keys: it is empty by default, so
  rotation is opt-in and a key removed from the list invalidates every session and every signed
  cookie signed with it, immediately, for everyone. Sessions are the Flask analogue in
  `RULE-FLASK-001`.

## The rule that generalises

1. **Decide per setting whether absence is an error**, and write that decision down. "It has a
   default" is a decision, not an oversight — but it is invisible unless it is a decision.
2. **Every secret gets no default.** Not an empty string, not `None`, not `changeme`. This is
   `SecretValue`, or a required Pydantic field, or `env.str(...)` with no default.
3. **Set `case_sensitive=True` and state which source each setting reads**, if you use
   pydantic-settings, so the Windows behaviour is a documented property rather than a surprise.
4. **Fail at startup, not at first use.** A missing variable should stop the process during
   deployment, not surface as `None` in production three weeks later.

## What to check in an existing service

```bash
# Settings that cannot be absent: the required-field / no-default declarations
grep -rn "environ_required\|SecretValue\|: *str *= *Field\|required=True\|NOTSET" --include=*.py .

# Reads with a fallback, which is where absence becomes a value
grep -rn "os.environ.get(\|os.getenv(\|env.str(.*default=\|env(.*default=\|env.bool(.*default=" --include=*.py .

# Direct environ indexing — loud, and worth knowing so you do not "fix" it to .get()
grep -rn "os.environ\[" --include=*.py .

# Django's silent-default settings
grep -rn "^DEBUG\|^ADMINS\|^ALLOWED_HOSTS\|^SECRET_KEY" --include=*.py .

# A .env file that should never be committed
git ls-files | grep -E "(^|/)\.env($|\.)|\.env\.(local|prod|production)$"

# Framework defaults still in play, meaning the library was never wired up
grep -rn "pydantic_settings\|BaseSettings\|environ.Env\|configurations" --include=*.py .
```

The second command is the audit that matters: `.get()` with a default is a decision about absence
made at a call site, unreviewable and uncountable across a codebase. Moving those defaults into a
declared, required settings object is what turns "some call sites handle it" into "the process
cannot start without it".

## Caveats

- **This asset does not cover:** secret storage and rotation providers (AWS Secrets Manager, Vault,
  `pydantic-settings`' own `secrets` source), `.env` file syntax and precedence beyond the two
  libraries quoted here, Django's `settings.py` split and `django-configurations`'s installer and
  management-command integration, Flask's own `app.config` loading order (which is
  `RULE-FLASK-002`, not this file), Twelve-Factor and external-config conventions, and
  encrypting values at rest — the settings layer reads secrets, it does not protect them.