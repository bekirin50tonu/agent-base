---
title: "DEBUG=False with an Empty ADMINS Reports Errors to Nobody"
rule_id: "RULE-DJANGO-003"
category: "correctness"
scope: "backend"
applies_to: "Any Django deployment with DEBUG=False, and any setting whose name is expected to be redacted from a debug page"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/ref/settings/,https://docs.djangoproject.com/en/6.1/howto/error-reporting/,https://raw.githubusercontent.com/django/django/6.1/django/conf/global_settings.py,https://raw.githubusercontent.com/django/django/6.1/django/utils/log.py"
---

# DEBUG=False with an Empty ADMINS Reports Errors to Nobody

Django ships two settings that together decide whether a production exception is ever seen by a
human. In `global_settings.py` both are the safe-looking value:

```python
DEBUG = False
ADMINS = []
```

`DEBUG = False` is correct. The problem is what it *replaces*: the traceback page that made
`DEBUG = True` useful is not emitted anywhere else by default, and `ADMINS = []` is empty. So a 500
in production returns a generic error page, logs at `ERROR` to whatever `LOGGING` configures, and
notifies nobody.

## Why

The mechanism is `ADMINS` plus a log handler, and both halves are opt-in:

> When `DEBUG` is `False`, Django will email the users listed in the `ADMINS` setting whenever your
> code raises an unhandled exception and results in an internal server error (strictly speaking,
> for any response with an HTTP status code of 500 or greater). This gives the administrators
> immediate notification of any errors.
> ([Django 6.1 Error reporting](https://docs.djangoproject.com/en/6.1/howto/error-reporting/))

The shipped `AdminEmailHandler` is a plain `logging.Handler` subclass. An empty `ADMINS` list gives
it no recipients, and it emits nothing — no error, no warning, no log line saying it had nowhere
to send.

### The redaction filter is a substring denylist, not taint analysis

`DEBUG=True` in production is usually discussed as an information leak. The mechanism is narrower
than that, and the documentation says so:

> As a security measure, Django will not include settings that might be sensitive, such as
> `SECRET_KEY`. Specifically, it will exclude any setting whose name includes any of the following:
> `'API'` `'KEY'` `'PASS'` `'SECRET'` `'SIGNATURE'` `'TOKEN'`
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/ref/settings/))

> Note that these are partial matches. `'PASS'` will also match `PASSWORD`, just as `'TOKEN'` will
> also match `TOKENIZED` and so on.
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/ref/settings/))

The list is a set of name *fragments*. So `DATABASE_DSN` or `AUTHORIZATION_HEADER` is **not**
redacted — neither name contains any of the six substrings. `KEYBOARD_SHORTCUTS` and
`PASSENGER_COUNT` are redacted, harmlessly. That is the genuinely silent part: the filter looks
like protection, and it is a naming convention rather than a mechanism.

Two further documented costs of `DEBUG=True` beyond disclosure:

> It is also important to remember that when running with `DEBUG` turned on, Django will remember
> every SQL query it executes. This is useful when you're debugging, but it'll rapidly consume
> memory on a production server.
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/ref/settings/))

> Note the default `settings.py` file created by `django-admin startproject` sets `DEBUG = True`
> for convenience.
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/ref/settings/))

That last line is why this is a real failure mode rather than a hypothetical one. The generated
`settings.py` ships `DEBUG = True`, and the deployment that edits everything except that line is
the ordinary case.

### The one failure that is loud

`DEBUG=False` has a coupling that makes the *correct* configuration fail visibly if half-applied:

> Finally, if `DEBUG` is `False`, you also need to properly set the `ALLOWED_HOSTS` setting. Failing
> to do so will result in all requests being returned as "Bad Request (400)".
> ([Django 6.1 Settings](https://docs.djangoproject.com/en/6.1/ref/settings/))

So flipping `DEBUG` and forgetting `ALLOWED_HOSTS` produces a 100% failure rather than a partially
broken app. That is the good case, and it is worth knowing precisely because everything else in
this rule fails quietly.

## Do

- Configure `ADMINS` — it is what turns `AdminEmailHandler` into a real notification path:
  ```python
  DEBUG = False
  ADMINS = [("Ops", "ops@example.com")]
  EMAIL_HOST = "smtp.example.com"
  SERVER_EMAIL = "django@example.com"   # otherwise Django sends from root@localhost
  ```
- Name secrets so the denylist catches them, or keep them out of the settings module entirely. If a
  secret's name contains none of `API`, `KEY`, `PASS`, `SECRET`, `SIGNATURE`, `TOKEN`, rename it:
  ```python
  # These are NOT redacted by Django's DEBUG filter — no fragment matches.
  DATABASE_DSN = os.environ["DATABASE_DSN"]
  AUTHORIZATION_HEADER = "..."
  INTERNAL_SIGNING_SECRET_V2 = "..."   # redacted only because of the SECRET fragment
  ```
- If you adopt an error reporter, write its scrub hook in the same commit that adds the SDK. See
  the package-matching note below — this is the second-order failure.
- Assert the production configuration in a test or a startup check. A `DEBUG = True` that only
  appears in the deploy environment is not caught by any Django tool.

## Don't

- Read `DEBUG = False` as "errors are now reported." It means the traceback page is gone. Reporting
  is `ADMINS` plus a handler, which is a separate configuration.
- Assume application logging covers the gap. `logger.exception()` covers the handlers someone
  remembered; `AdminEmailHandler` covers the unhandled exception in a view nobody touched. The gap
  is precisely the uninstrumented code.
- Assume `ALLOWED_HOSTS` falls back to something permissive when `DEBUG=False`. It does not — every
  request becomes a 400.
- Treat the redaction list as a guarantee. It is a substring denylist and it is not complete.
- Install an error-reporting SDK and consider PII handled. Its `before_send` hook is off by
  default, so request bodies and headers ship as-is until you write it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 500s in production, nobody notified | `DEBUG=False` with `ADMINS = []` | Configure `ADMINS` and an email backend, or an error reporter |
| Emails from `root@localhost` | `SERVER_EMAIL` unset | Set `SERVER_EMAIL` explicitly |
| A secret appears in a debug page | Name contains none of the six redacted fragments | Rename the setting, or move the value out of settings |
| Every request returns 400 after a deploy | `DEBUG=False` with `ALLOWED_HOSTS` unset | Set `ALLOWED_HOSTS` — this one is loud by design |
| Memory grows without traffic | `DEBUG=True` retains every executed query | `DEBUG=False`; use `connection.queries` deliberately |
| Tracebacks reach a third party with secrets in them | Reporter's scrub hook is off by default | Write `before_send` in the same change that adds the SDK |

## Verifying

```bash
# The two settings that decide whether a 500 is seen
grep -rn "^DEBUG\|^ADMINS\|^SERVER_EMAIL\|^ALLOWED_HOSTS" --include=*.py .

# Settings whose names contain none of Django's six redacted fragments
grep -rhoP "^\s*[A-Z_]+\s*=" --include=*.py . | tr -d ' =' | sort -u \
  | grep -vE 'API|KEY|PASS|SECRET|SIGNATURE|TOKEN'

# DEBUG left on outside development
grep -rn "DEBUG.*True" --include=*.py --include=*.env --include=*.yml .
```

The second command is the naming check, and it lists every setting in the project rather than only
the ones you suspected — a name that matches nothing above is a name a debug page will print. None
of these greps can tell you whether a log handler is actually wired to `AdminEmailHandler`; that is
the one thing to read by hand, because it is the difference between an error being reported and
being logged.
