---
title: "an API that is sometimes synchronous reorders its caller"
rule_id: "RULE-NODEJS-004"
category: "api-design"
scope: "backend"
applies_to: "Node.js, callbacks, promisify, sync-or-async APIs, conditional await"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/process.html"
---

# an API that is sometimes synchronous reorders its caller

The Node.js documentation names this shape a hazard rather than a style preference:

> It is very important for APIs to be either 100% synchronous or 100% asynchronous.
> ([Process](https://nodejs.org/api/process.html))

The example it gives is a callback API that fires synchronously when an argument is set and
asynchronously otherwise. A caller writes its continuation naturally:

```javascript
maybeSync(maybeTrue, () => { foo(); });
bar();
```

If `maybeSync` takes the synchronous branch, `foo()` runs **before** `bar()`. If it takes the
asynchronous branch, `bar()` runs first. Both are the documented behaviour, both compile, and
the ordering difference is decided by an argument value.

## Why

The caller cannot express which ordering it depends on. There is no type that distinguishes
"returns a value" from "returns a promise" in a way a linter rejects, and no test that fails
under only one branch unless the test happens to exercise it.

This is why the failure presents as a race that appears under load rather than as a defect. The
synchronous branch is usually the fast path — the value is already available, so a callback
fires inline. Under load the slow path takes the asynchronous branch and the ordering flips.
Tests that run fast take the synchronous branch and pass.

The same shape appears outside callbacks. A wrapper returning `value` on one path and
`Promise<value>` on another forces every caller to handle both, and the caller that forgets
gets `undefined` where it expected a promise.

## Do

- Pick one and hold it: an API either always defers or never defers.
- When adapting a callback API, normalise with `util.promisify` and expose only the promise.
- When wrapping an async function, `await` unconditionally — `return await f()` and
  `return f()` differ in try/catch context and in timing, so be deliberate.
- If a sync fast path is genuinely needed, expose **two** functions (`readFileSync` and
  `readFile`), which is what the Node.js stdlib does throughout.
- In review, treat "sometimes sync" as a defect even when both branches look correct.

```javascript
// Correct — always async: the callback never runs inline
function readConfig(path, cb) {
  fs.readFile(path, 'utf8', cb);
}

// Correct — two distinct entry points rather than a mode flag
import { readFile, readFileSync } from 'node:fs';
```

## Don't

- Don't return the raw value on a fast path and a promise on the slow path.
- Don't call the callback inline in an `if` and asynchronously in the `else`.
- Don't "fix" a maybe-sync API at the call site with `queueMicrotask`. That normalizes the
  ordering but moves a synchronous call into the microtask queue, so exceptions now surface
  after the caller returns — a bug traded for a different one.
- Don't rely on `await` to normalize a maybe-promise value. It works for the promise path and
  silently passes the bare value through, which is why the other branch looks fine.
- Don't assume an unhandled rejection is the symptom. The value branch produces no rejection at
  all; it produces `undefined` later.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Callbacks fire out of order under load | Sync branch taken on the fast path | Normalize to always-async |
| `undefined` where a promise was expected | Value returned on one branch | Return a promise on every branch |
| Test passes, production races | Tests take the sync branch | Cover the async branch explicitly |
| Exception thrown after the caller returned | Callback deferred by a wrapper | Fix the API, not the call site |
| Intermittent double execution | Caller not idempotent to ordering | Fix the ordering at the source |
| Ordering depends on an argument | Branch condition on caller input | Remove the branch |

## Verifying

```bash
# Inline callback invocations -- the sync branch of a maybe-sync API
grep -rn --include='*.{js,mjs,cjs,ts}' -E '^\s+cb\(|^\s+callback\(|^\s+done\(' src/

# Functions declared with a callback parameter
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'function \w+\([^)]*\b(cb|callback|done|next)\b' src/

# Conditional returns of a value or a promise
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'return (await )?\w+\(.*\);\s*$' src/ | head -40

# Promisify wrappers, to confirm the conversion is applied rather than assumed
grep -rn --include='*.{js,mjs,cjs,ts}' 'promisify' src/
```

The first list is the highest-signal: an `if` with a bare `cb()` in one branch and a callback
passed to an async function in the other is the exact hazard the documentation describes. The
second list finds every candidate API, each of which then needs its return path read.

These greps cannot tell you whether the ordering is observed by the caller. Each inline
`cb()` hit needs the caller read to see whether it depends on running before or after the next
statement.