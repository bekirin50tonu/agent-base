---
title: "write() returning false is not backpressure enforcement"
rule_id: "RULE-NODEJS-001"
category: "correctness"
scope: "backend"
applies_to: "Node.js, streams, backpressure, highWaterMark, socket writes"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/stream.html"
---

# write() returning false is not backpressure enforcement

`writable.write()` returning `false` is a signal, not a gate. The stream does not stop
accepting data because a caller ignored it — it buffers everything and keeps going:

> While calling write() on a stream that is not draining is allowed, Node.js will buffer all
> written chunks until maximum memory usage occurs, at which point it will abort unconditionally.
> ([Stream](https://nodejs.org/api/stream.html))

So the failure mode is not a stall or a warning. It is unbounded memory growth followed by a
process abort, which surfaces as an out-of-memory kill with no reference to the code that
caused it.

The correct handling is stated in the same page:

> Once write() returns false, do not write more chunks until the 'drain' event is emitted.
> ([Stream](https://nodejs.org/api/stream.html))

And the size that triggers it is not the same on every platform:

> For byte streams, it defaults to 65536 (64 KiB) on non-Windows platforms and 16384 (16 KiB)
> on Windows.
> ([Stream](https://nodejs.org/api/stream.html))

A pipeline tuned on Linux against a 64 KiB threshold begins accumulating at 16 KiB on Windows,
so it can pass every test and still buffer four times more in production.

## Why

The return value is easy to read as a boolean flag and drop, because nothing enforces it. In a
producer loop the call looks the same either way — the data still arrives, in the same order,
with the same contents. There is no test that distinguishes a program respecting backpressure
from one that does not, because the difference only appears under a slowdown the test does not
produce.

The `highWaterMark` platform split makes it worse. It is a compile-time-ish default that no
code mentions, so the buffer depth is not knowable from reading the source. Teams size their
own timeouts and buffer limits against the platform they develop on.

## Do

- Check the return value of every `write()` and pause on `false`, resuming on `'drain'`.
- Prefer `stream.pipeline()`, which composes the drain handling for you and propagates errors.
- Use `stream/promises` (`pipeline`, `finished`) when the flow is async.
- Set `highWaterMark` explicitly when the memory budget matters — do not inherit the
  platform default.
- For request/response frameworks, check whether the framework already handles this; Express's
  `res.write` does not, and the socket below it will buffer regardless.

```javascript
// Correct — write() false pauses the producer until 'drain'
import { once } from 'node:events';

for (const chunk of source) {
  if (!dest.write(chunk)) {
    await once(dest, 'drain');
  }
}

// Correct — pipeline handles drain, errors and teardown together
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

await pipeline(
  createReadStream('in.txt'),
  createWriteStream('out.txt', { highWaterMark: 1 << 20 })
);
```

## Don't

- Don't ignore the `write()` return value in a loop. This is the defect, not a style choice.
- Don't write to a socket after `false` "just a little" — every chunk past the mark is buffered.
- Don't raise `highWaterMark` to make the warning go away. It delays the same abort and costs
  the same memory when the consumer stalls for good.
- Don't assume `console.log` participates in backpressure. It writes to `process.stdout`, whose
  sync/async behaviour is platform- and target-dependent (`RULE-NODEJS-002`).
- Don't treat `write()` returning `true` as "flushed". It means "under the mark", not "written".

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| OOM abort under sustained load | `write()` false ignored | Await `'drain'` on false |
| RSS climbs with no error logged | Unbounded write buffering | Same — the buffer is the leak |
| Fails only on Windows | 16 KiB vs 64 KiB default HWM | Set `highWaterMark` explicitly |
| Latency spike, memory fine | Large `highWaterMark` | Lower it to a measured budget |
| Writes lost on exit | `process.exit()` mid-drain | Set `process.exitCode`, let it drain |
| Slow consumer never resumes | No `'drain'` listener registered | `stream.pipeline()` |

## Verifying

```bash
# Writes whose return value is discarded -- each hit needs a drain check
grep -rn --include='*.{js,mjs,cjs,ts}' -E '\.write\(' src/ | grep -v 'if\s*(!\?\s*\|await\|return\s'

# Explicit highWaterMark sites, to compare against the platform default
grep -rn --include='*.{js,mjs,cjs,ts}' 'highWaterMark' src/

# Raw socket writes, which have no drain handling at all
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'socket\.write\(|net\.connect' src/

# process.exit(), which discards whatever was still buffered
grep -rn --include='*.{js,mjs,cjs,ts}' 'process\.exit(' src/
```

The first list is the whole defect surface. `pipeline()`-based code does not appear there,
which is how you tell which parts of the codebase have already solved it.

These greps cannot tell whether the consumer behind a `write()` is actually slow — that is a
runtime property. The first list's hits need each producer loop read to see whether `false` is
handled by an `await`, a `once('drain')`, or an event listener registered elsewhere.