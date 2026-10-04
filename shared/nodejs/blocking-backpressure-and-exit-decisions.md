---
title: "Node.js — blocking, backpressure, and exit decisions"
category: "architecture"
scope: "backend"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/stream.html"
---

# Node.js — blocking, backpressure, and exit decisions

Five questions decide most Node.js backend architecture. In every one of them the shipped
default is the permissive option, and the failure is the default behaving exactly as
documented.

This sits one level below `RULE-NODEJS-001` … `RULE-NODEJS-006`, which explain each mechanism.
This matrix is for choosing between them.

## The five questions

1. **Does this write wait for drain?** A stream, a pipe, a socket — all buffer past `false`
   and abort at maximum memory. The answer is `pipeline()`, which composes the handling.
   (`RULE-NODEJS-001`)
2. **What keeps the process alive?** Anything with a ref'd handle: a timer, a server, a
   pending I/O. `unref()` on a timer, `AbortSignal` on cancellable work. (`RULE-NODEJS-003`)
3. **Does this exit flush?** `process.exitCode` and return; `process.exit()` discards queued
   writes. (`RULE-NODEJS-002`)
4. **Is this API one or the other?** Never both — a maybe-sync callback reorders its caller.
   (`RULE-NODEJS-004`)
5. **Is this buffer's tail private?** `allocUnsafe` is not, below the pool threshold.
   (`RULE-NODEJS-006`)

## The defaults, in one table

Each is correct for the common case, and each is a silent cost or a silent hole in the other one.

| Decision | Shipped default | The default's cost |
|---|---|---|
| Writing past the mark | Ignore `write()` returning `false` | Buffers to OOM, then aborts |
| `highWaterMark`, byte streams | 64 KiB POSIX / 16 KiB Windows | Platform-dependent, unstated in source |
| Hard exit | `process.exit()` | Discards queued stdout/stderr |
| Shutdown | `beforeExit`, not a drain | Never waits for the pipe |
| Microtask choice | `process.nextTick()` | Legacy; starves I/O if self-rescheduling |
| Blocking I/O | Sync `fs` calls | Stalls the whole loop, no error |
| Callback timing | Sometimes inline | Caller ordering depends on a branch |
| Buffer contents | `allocUnsafe` | Pooled memory may hold prior secrets |
| Module format | Inferred from source | One `export` reclassifies the file |
| Worker per task | One `Worker` each | Creation overhead exceeds the benefit |
| Shared memory | `SharedArrayBuffer` | Two "copies" share one `ArrayBuffer` |
| Test parallelism | One file at a time | No speedup from adding cores |

## Choosing, by need

| Need | Use | Not | Its own default failure |
|---|---|---|---|
| Pipe two streams | `stream.pipeline()` | `.pipe()` | Error handling is manual |
| Control a slow consumer | Await `'drain'` on `false` | Fire-and-forget write | OOM abort |
| A precise memory budget | Explicit `highWaterMark` | The default | Varies by platform |
| Exit with a status | `process.exitCode = 1` | `process.exit(1)` | Log line dropped |
| A grace period | `server.close()` then drain | `process.exit()` | Requests cut mid-response |
| Retry with a delay | `timers/promises` + `signal` | `process.nextTick` loop | Starves the loop |
| Ordering within a turn | `queueMicrotask()` | `process.nextTick()` | Legacy API |
| Let I/O between attempts | `setImmediate` / `setTimeout` | Any microtask | Still unbounded |
| Wrap a callback API | `util.promisify` | A hand-rolled `new Promise` | Maybe-sync leak |
| Need a sync variant | A separate `*Sync` function | A mode flag | Two contracts, one name |
| Parse untrusted bytes | `Buffer.alloc()` | `allocUnsafe()` | Tail holds old data |
| Avoid sharing, keep speed | `allocUnsafeSlow()` | `allocUnsafe()` | Overlaps the pool |
| Freeze safe defaults | `--zero-fill-buffers` | Per-call discipline | One miss is a leak |
| Guarantee module format | `"type"` in `package.json` | Detection | One `export` flips it |
| CPU work off the loop | A `Worker` pool | A `Worker` per task | Overhead exceeds benefit |
| Parallel tests | `--test-concurrency=N` | The default | Runs serially |

## The pattern shared by most of these rows

Eight rows above have the same shape, and it recurs across Node.js: **the default is
documented, correct, and silently not what the caller assumes.**

- `write()` returning `false` is documented as a signal to stop, and nothing enforces it.
- `allocUnsafe` is documented as possibly holding old data, and it is read as "uninitialized",
  which reads like zeros.
- `process.exit()` is documented as abandoning pending I/O, and it is read as "exit now".
- A callback is documented as maybe-sync, and the caller reads its own branch.
- Module format is documented as inferred, and it is read as declared.
- A `Worker` per task is documented as wasteful, and it is written because it is the short form.

The instrument is never the problem. In each case the *API is correct* and the thing that
under-reports is the caller's belief about it. When adopting any new Node.js facility, the
question worth asking is not "does this detect the problem" but "what must the caller do for
the guarantee to be reported at all."

## The one diagnostic that finds four of them

```bash
node --trace-sync-io app.js
```

> Prints a stack trace whenever synchronous I/O is detected after the first turn of the event
> loop.
> ([CLI](https://nodejs.org/api/cli.html))

Worth enabling in any staging environment. It names the call site, which is exactly what the
silent defaults above deny you.

## Sources

- [Stream — Node.js](https://nodejs.org/api/stream.html) — backpressure, `highWaterMark`
- [Process — Node.js](https://nodejs.org/api/process.html) — `exit`, `nextTick`, stdout
- [Buffer — Node.js](https://nodejs.org/api/buffer.html) — pooling, `allocUnsafe`
- [ECMAScript modules — Node.js](https://nodejs.org/api/esm.html) — format inference, interop
- [Global objects — Node.js](https://nodejs.org/api/globals.html) — queue ordering
- [Worker threads — Node.js](https://nodejs.org/api/worker_threads.html) — pooling, shared memory
- [CLI — Node.js](https://nodejs.org/api/cli.html) — `--trace-sync-io`
- [Test runner — Node.js](https://nodejs.org/api/test.html) — isolation and concurrency

## Version note

Written against the **v26.10.0** API documentation. `process.nextTick()` is documented as
`Stability: 3 - Legacy` and names `queueMicrotask()` as its replacement, so the ordering
recommendation here is a moving target: the queue relationship is stable, the preferred API is
not. Test runner defaults (`concurrency: false`, per-file child processes) have changed across
major versions — re-check before relying on them.