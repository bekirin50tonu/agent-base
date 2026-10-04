---
title: "The Session Cookie Is Signed, Not Encrypted, and It Has a ~4 KB Budget"
rule_id: "RULE-FLASK-001"
category: "security"
scope: "backend"
applies_to: "Any Flask app using session; any value written to session; any SECRET_KEY change; any app relying on the default cookie session"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/pallets/flask/main/docs/quickstart.rst,https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst,https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py"
---

# The Session Cookie Is Signed, Not Encrypted, and It Has a ~4 KB Budget

Flask's session is a signed cookie. The signature prevents *modification*; it does nothing about
*disclosure*. Everything written to `session` is readable in the browser, in a proxy log, and in
anything that emits `Set-Cookie` — and the same cookie has a hard size budget enforced by the
browser, not by Flask.

## Why

The docs are exact about what the signing does:

> In addition to the request object there is also a second object called
> :class:`~flask.session` which allows you to store information specific to a user from one request
> to the next. This is implemented on top of cookies for you and signs the cookies cryptographically.
> What this means is that the user could look at the contents of your cookie but not modify it,
> unless they know the secret key used for signing.
> ([Flask quickstart](https://raw.githubusercontent.com/pallets/flask/main/docs/quickstart.rst))

That is the whole contract, and the last sentence is the operative one: the user **could look at the
contents**. `session["user_email"]`, `session["role"]`, a permissions cache — all cleartext in the
`Set-Cookie` header. Signed is often read as secure, and it is tamper-evident rather than
confidential.

The size limit lives in config, not in the session docs:

> .. py:data:: MAX_COOKIE_SIZE
>
> Warn if cookie headers are larger than this many bytes. Defaults to ``4093``. Larger cookies may
> be silently ignored by browsers. Set to ``0`` to disable the warning.
> ([Flask config](https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst))

Read the actors carefully. Flask **warns**. The browser is what **silently ignores**. So the
sequence is: the session grows past ~4 KB as items accumulate → Werkzeug logs a warning nothing
reads → the browser drops the cookie → the user is logged out. No error anywhere, and the session
was working an hour ago. The commonly cited "4090 bytes, hard limit" is wrong on both counts; the
value in the shipped config is 4093 and it is a warning:

```python
        "SECRET_KEY": None,
        "SECRET_KEY_FALLBACKS": None,
        "SESSION_COOKIE_SECURE": False,
        "MAX_CONTENT_LENGTH": None,
        "MAX_COOKIE_SIZE": 4093,
```
([Flask `app.py`](https://raw.githubusercontent.com/pallets/flask/main/src/flask/app.py))

Those are the defaults of a project that has not thought about sessions: no key, no rotation list,
cookies allowed over plain HTTP.

### Two ways this fails, and they are unrelated

**Disclosure** is the security failure, and it is per-value: any session entry that would be
unacceptable in a header — an email, a role, an internal id, anything from a partner's token — is
disclosed by writing it. **Size** is the reliability failure, and it is cumulative: five individually
innocuous writes are fine, and the cart that grows without a bound is not. An app can be perfectly
fine on confidentiality and still log users out at random.

### Key rotation is opt-in, not forced

Since 3.1, rotating `SECRET_KEY` need not invalidate active sessions:

> A list of old secret keys that can still be used for unsigning. This allows a project to implement
> key rotation without invalidating active sessions or other recently-signed secrets. Keys should be
> removed after an appropriate period of time, as checking each additional key adds some overhead.
> ([Flask config](https://raw.githubusercontent.com/pallets/flask/main/docs/config.rst))

The folklore says rotation logs everyone out. Both are true: the mechanism is opt-out, and you have to
implement it — nothing sets `SECRET_KEY_FALLBACKS` for you.

## Do

- Keep the cookie small and non-sensitive; bound anything that accumulates by construction:
  ```python
  @app.get("/product/<int:pid>")
  def product(pid: int):
      seen = session.get("seen", [])
      session["seen"] = (seen + [pid])[-5:]      # bounded, not truncated later
      return render_template("product.html", product=Product.query.get(pid))
  ```
- Store an identifier in the session and the data server-side. This is the fix for both halves at
  once, and it is what the disclosure half actually requires:
  ```python
  session["user_id"] = user.id            # the only thing that belongs here
  ```
- Surface the size at the point it is filled, so the warning lands in an application's own logs:
  ```python
  @app.after_request
  def check_session_size(response):
      cookie = response.headers.get("Set-Cookie", "")
      if cookie and len(cookie) > 3800:
          app.logger.warning("session cookie %d bytes — near the 4093 limit", len(cookie))
      return response
  ```
- On a rotate, keep the old key for the overlap window rather than swapping it out:
  ```python
  SECRET_KEY = _new_key()
  SECRET_KEY_FALLBACKS = [_previous_key]     # removed after the max session lifetime
  ```
- Set `SESSION_COOKIE_SECURE=True` and `SESSION_COOKIE_HTTPONLY=True` behind TLS, and set
  `SESSION_COOKIE_SAMESITE` deliberately.

## Don't

- Store anything you would not paste into a public header. Email addresses, roles, permission lists,
  anything identifying, and — the common reflex — a growing `recently_viewed` list.
- Assume "secure cookie session" means unreadable. It means untamperable.
- Rely on the 4093 warning to catch a size problem. It is a log line in Werkzeug, on the path where
  nobody is looking, and the enforcement that actually logs the user out is the browser's.
- Rotate `SECRET_KEY` by replacing it outright when active sessions matter, and treat the resulting
  logout wave as expected. The mechanism for not doing that ships in the framework.
- Keep the fallback list forever to be safe. Each key adds per-request check overhead, so it is a
  time window the size of your longest session.
- Install `flask-session` and assume the problem is solved. Its `SESSION_TYPE` defaults to `null`,
  which is Flask's own cookie backend — an unconfigured install changes nothing and looks successful.
  Setting `SESSION_TYPE="redis"` is required.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Users logged out at random, no error | Cookie passed the browser limit and was dropped | Bound the session; move bulk server-side |
| A user's role or email visible in devtools | Values written to `session` | Store an id, resolve server-side |
| Logout wave after a deploy | `SECRET_KEY` rotated with no fallback list | Set `SECRET_KEY_FALLBACKS` for the overlap window |
| `flask-session` installed, still cookie-backed | `SESSION_TYPE` left at `null` | Set `SESSION_TYPE="redis"` |
| Session cookie sent over plain HTTP | `SESSION_COOKIE_SECURE` ships `False` | Set it `True` behind TLS |
| Warning logged, nobody logged out, still too big | Warning is a warning; the browser enforces | Bound the data, do not rely on the log |

## Verifying

```bash
# Everything written to the session — the disclosure audit
grep -rn "session\[" --include=*.py .

# Writes that append to something, which is how the size grows
grep -rn "session\[.*\] *=\|session\.setdefault\|session\.update" --include=*.py .

# Session and key configuration
grep -rn "SECRET_KEY\|SESSION_TYPE\|SESSION_COOKIE_SECURE\|MAX_COOKIE_SIZE" --include=*.py --include=*.cfg --include=*.toml --include=*.env* .

# A size check that would notice before the browser does
grep -rn "Set-Cookie\|after_request" --include=*.py .
```

The first command is the security check — every hit is a value readable by the client, so read the
list and decide per entry whether it belongs. The second is the size check: an assignment whose
right-hand side is `get(...) + [...]` is unbounded unless it is sliced. Nothing here tells you the
serialised size of what a session actually contains; only the `after_request` measurement does that.