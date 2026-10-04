---
title: "app.run(debug=False) Is Not a Guarantee; FLASK_DEBUG and .flaskenv Set It From the Environment"
rule_id: "RULE-FLASK-003"
category: "security"
scope: "backend"
applies_to: "Any Flask app started with app.run or flask run; any .flaskenv or .env file; any deploy where FLASK_DEBUG could be set; any process exposing the Werkzeug server"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py,https://raw.githubusercontent.com/pallets/flask/main/docs/debugging.rst,https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst,https://raw.githubusercontent.com/pallets/flask/main/docs/server.rst"
---

# app.run(debug=False) Is Not a Guarantee; FLASK_DEBUG and .flaskenv Set It From the Environment

The folklore is "`flask run` serves the debugger in production". The debugger risk is real and
documented; the sharper edge is that a `debug=False` argument is not the mechanism that decides.
Debug mode is resolved from the environment and from `.flaskenv`, and the file that sets it is
loaded by default.

## Why

The docs state the production risk without hedging:

> Do not run the development server, or enable the built-in debugger, in a production environment.
> The debugger allows executing arbitrary Python code from the browser. It's protected by a pin, but
> that should not be relied on for security.
> ([Flask debugging](https://raw.githubusercontent.com/pallets/flask/main/docs/debugging.rst))

and the deployment server is not an alternative either:

> Do not use the development server when deploying to production. It is intended for use only during
> local development. It is not designed to be particularly efficient, stable, or secure.
> ([Flask server](https://raw.githubusercontent.com/pallets/flask/main/docs/server.rst))

The precedence is in `Flask.run`:

```python
        if get_load_dotenv(load_dotenv):
            cli.load_dotenv()

            # if set, env var overrides existing value
            if "FLASK_DEBUG" in os.environ:
                self.debug = get_debug_flag()

        # debug passed to method overrides all other sources
        if debug is not None:
            self.debug = bool(debug)
```
([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

Read the order, because it is the opposite of the folklore in one direction and identical in the
other. The environment is applied **first** and the argument **second**, so `app.run(debug=False)`
does win inside that call. What that does not do is clear `self.debug`, which is per-instance state
that anything earlier may have set — a config value, an extension, a test setup. The documented
contract puts the environment first in the sense that matters:

> The :envvar:`FLASK_DEBUG` environment variable will override :attr:`debug`.
> ([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

And Flask's config entry says so more bluntly than the docs do anywhere:

> It may not behave as expected if set in code.
> ([Flask config](https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst))

That sentence is the rule. `app.debug` after a set `FLASK_DEBUG` is not reliably what the argument
said.

### The file that sets it without anyone noticing

`run()` calls `cli.load_dotenv()` by default, which loads `.env` **and `.flaskenv`**. A `.flaskenv`
setting `FLASK_DEBUG=1` for developer convenience is a file created once during onboarding and never
revisited; if it is copied into the image — or if a developer's working directory becomes the
container's working directory — debug mode is on in production, and the check everyone writes
(`if app.debug:` in a health endpoint) reads the attribute that the environment path has just
mutated.

Debug mode is not only the traceback page. It is also the auto-reloader, a subprocess watcher that
restarts the app on file change. In production that is a watchdog restarting on any write, including
log rotation. With the debugger attached it becomes remotely interactive code execution, protected
only by a pin the docs twice decline to rely on.

## Do

- Serve production with a real WSGI server, so the debugger and reloader are unreachable by
  construction:
  ```bash
  gunicorn 'project:create_app()' --bind 0.0.0.0:8000 --workers 4
  ```
  This is the fix that does not depend on any flag being right.
- Assert the environment in the process that will actually serve, which is the check that matches the
  mechanism:
  ```python
  import os

  if __name__ == "__main__":
      assert os.environ.get("FLASK_DEBUG", "").lower() in {"", "0", "false", "no"}, \
          "FLASK_DEBUG is set in this environment"
      app.run(host="0.0.0.0", port=8000, debug=False)
  ```
- Grep the environment files and the image for the variable, and make the grep a CI step:
  ```bash
  grep -rE '^[[:space:]]*FLASK_DEBUG' .env .flaskenv Dockerfile* Procfile* 2>/dev/null
  ```
- Keep `DEBUG` out of the committed config file and out of the image. Read it from the environment
  with a hard default, so the value is visible where the deploy sets it.
- Choose the production server's worker type deliberately. `gunicorn`'s default sync worker handles
  one request at a time per worker, so a slow endpoint halves effective throughput;
  `--worker-class gthread --threads N` or an async worker class is a decision, not a default to
  inherit.

## Don't

- Trust `debug=False` as a guarantee. It overrides the environment for that one call and leaves
  whatever was on the instance before it.
- Ship a `.flaskenv` in the image. It is loaded by default and is the most likely place for
  `FLASK_DEBUG=1` to enter a production environment without a deploy change.
- Check `app.debug` in a health endpoint and conclude the process is safe. That is the attribute the
  environment path mutates; check the environment.
- Treat the debugger's pin as a control. The docs mention it and explicitly decline to rely on it,
  twice.
- Buy rate limiting as the fix for an exposed debugger. `Flask-Limiter` reduces how often the
  endpoint can be reached; it does not prevent arbitrary code execution, and it is not a substitute
  for not exposing it.
- Assume `uvicorn`-style concurrency flags transfer. This is the sync Werkzeug path throughout.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Werkzeug debugger reachable in production | `FLASK_DEBUG` set, via env or `.flaskenv` | Serve with gunicorn; grep and unset the variable |
| Process restarts on its own in production | Auto-reloader active from debug mode | Same |
| `app.debug` is `False` but behaviour says otherwise | Environment applied before the argument; instance state retained | Assert the environment, not the attribute |
| Debugger enabled after a config change | `DEBUG` written into the config file | Source it from the environment only |
| Throughput halves under load | `gunicorn` default sync worker | Pick a worker class deliberately |
| Local settings differ from CI with no code diff | `.flaskenv` committed and auto-loaded | Keep it out of the repo and the image |

## Verifying

```bash
# The variable, in every file that could carry it into a process
grep -rE '^[[:space:]]*FLASK_DEBUG' .env .flaskenv Dockerfile* Procfile* docker-compose* 2>/dev/null

# Every way the app can be started
grep -rn "app.run(\|flask run\|FLASK_RUN_CERT\|--debug" --include=*.py --include=*.sh --include=Dockerfile* --include=Procfile* .

# DEBUG written into config rather than read from the environment
grep -rn "DEBUG *=" --include=*.py .

# Production servers, and their worker configuration
grep -rn "gunicorn\|waitress\|uwsgi\|WORKERS\|--workers" --include=Dockerfile* --include=*.sh --include=*.service .
```

The first command is the check that matches the mechanism, because the mechanism is the
environment. The third finds the setting in the place it should not live. The fourth tells you
whether a production server is configured at all — if nothing matches, `app.run()` is serving
production, and every other finding here is downstream of that. Nothing here can tell you the value
of `app.debug` inside a running process; only the assert can.