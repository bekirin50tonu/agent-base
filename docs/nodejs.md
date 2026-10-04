---
language: "Node.js"
tag: "nodejs"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for Node.js stream, process, buffer and module assets."
---

# Documentation Hub: Node.js

> **Agent Directive (Phase 4)**: Inspect the target project's `package.json` and grep for
> `.pipe(`, `write(`, `process.exit(`, `process.nextTick(`, `allocUnsafe`, `new Worker(`,
> `require(`, `from '`, and any `"type"` field. Match the conditions below to determine which
> `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: rules cover the places where Node.js's defaults are documented, correct, and
> silently not what the caller assumes — backpressure, exit, microtask scheduling, sync/async
> shape, module format inference, and buffer pooling. No `skills` yet.
>
> **Version note**: verified against the **v26.10.0** API documentation. `process.nextTick()` is
> marked `Stability: 3 - Legacy` with `queueMicrotask()` named as its replacement, so the queue
> ordering is stable but the preferred API is a moving target. Test runner defaults
> (`concurrency: false`, per-file child processes) have changed across major versions — re-check
> before relying on them. There is a separate `docs/javascript.md` hub, scoped `frontend`; this
> one covers the runtime.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/nodejs/write-returns-false-is-not-backpressure-enforcement.md`
  - **Why**: `write()` returning `false` is advisory — the stream "will buffer" until it aborts
    at maximum memory, so nothing enforces it. The same page makes `highWaterMark` a
    platform-dependent quantity: 65536 bytes on non-Windows and 16384 on Windows, with no
    statement to that effect. Ignoring the return value is therefore a memory ceiling the code
    never wrote down, and it differs by deployment OS.
  - **When**: Target project calls `.write(` on a stream, socket, or pipe and does not handle the
    return value; or uses `.pipe(` rather than `pipeline()`.
  - **Target Location**: `docs/rules/write-returns-false-is-not-backpressure-enforcement.md`

- **Path**: `rules/nodejs/process-exit-discards-pending-writes.md`
  - **Why**: `process.exit()` forces exit "even if there are still asynchronous operations
    pending" — including stdout and stderr — and whether a stdout write is synchronous or
    asynchronous depends on the target: files and TTYs are synchronous on POSIX, pipes and sockets
    are not. So the log line written just before `process.exit(1)` is dropped on a pipe, which is
    exactly where it is deployed. Sync writes "block the event loop until the write has completed",
    so the workaround trades a dropped log for a stalled loop.
  - **When**: Target project calls `process.exit()`, or relies on a log line surviving shutdown.
  - **Target Location**: `docs/rules/process-exit-discards-pending-writes.md`

- **Path**: `rules/nodejs/nexttick-starves-the-event-loop.md`
  - **Why**: The next-tick queue "is fully drained ... before the event loop is allowed to
    continue", and the docs state the consequence outright: "It's possible to create an infinite
    loop if one were to recursively call process.nextTick()". A self-rescheduling retry is not a
    slow path — it is a stopped event loop: I/O callbacks never run, timers never fire, the socket
    stays open, and the CPU profiler shows a flat loop with no recursion to find.
  - **When**: Target project uses `process.nextTick()` or `queueMicrotask()` inside a loop, or has a
    retry helper whose bound is an optional parameter.
  - **Target Location**: `docs/rules/nexttick-starves-the-event-loop.md`

- **Path**: `rules/nodejs/async-apis-that-are-sometimes-sync-break-callers.md`
  - **Why**: The docs call this shape a hazard rather than a style preference — "It is very
    important for APIs to be either 100% synchronous or 100% asynchronous" — and demonstrate it
    with a callback API that fires inline when an argument is set. The caller's ordering then depends
    on an argument value, the sync branch is the fast path, so tests pass and production races.
  - **When**: Target project has an `if` with a bare callback invocation in one branch and a
    callback passed to an async function in the other; or a function that returns a value on one
    path and a promise on another.
  - **Target Location**: `docs/rules/async-apis-that-are-sometimes-sync-break-callers.md`

- **Path**: `rules/nodejs/module-format-is-inferred-when-unmarked.md`
  - **Why**: "When code lacks explicit markers for either module system, Node.js will inspect the
    source code of a module to look for ES module syntax" — so a `.js` file's format is a function of
    its contents, and adding one `export` to share a constant reclassifies it with no mention of
    module format in the diff. Two interop facts ride on top: `require()` "only supports loading
    synchronous ES modules", and importing CommonJS from ESM gets a namespace wrapper whose
    `default` is `module.exports` — so a build that resolves modules differently from bare Node.js
    looks correct.
  - **When**: Target project has `.js` files with no `"type"` field in `package.json`, mixes `import`
    and `module.exports` in one file, or only tests through a bundler.
  - **Target Location**: `docs/rules/module-format-is-inferred-when-unmarked.md`

- **Path**: `rules/nodejs/allocunsafe-returns-pooled-previous-data.md`
  - **Why**: The skipped zeroing is the point of `allocUnsafe`, so its memory "might contain old
    data that is potentially sensitive", and below half `poolSize` it is a slice of shared memory
    another live buffer still holds — a cross-request leak, not a local one. It shows only for small
    payloads (the pooling threshold), and in tests the pool often holds zeros, so it produces no
    visible output at all.
  - **When**: Target project calls `allocUnsafe` or `allocUnsafeSlow`, sizes a buffer from a length
    read off the wire, or does not run with `--zero-fill-buffers`.
  - **Target Location**: `docs/rules/allocunsafe-returns-pooled-previous-data.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/nodejs/agent.json`
  - **Why**: Helps with Node.js-related tasks, such as applying backpressure when write() returns
    false, exiting without discarding queued stdout writes, bounding process.nextTick() retry
    loops, keeping an API either fully sync or fully async, declaring the module format instead of
    letting it be inferred, and knowing when Buffer.allocUnsafe() memory may still hold prior data.
  - **When**: Target project is a Node.js project (has a `package.json` with Node scripts, or
    `.js` / `.mjs` / `.cjs` sources).
  - **Target Location**: `docs/agents/nodejs/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/nodejs/blocking-backpressure-and-exit-decisions.md`
  - **Why**: Five questions decide most Node.js backend architecture — does this write wait for
    drain, what keeps the process alive, does this exit flush, is this API one or the other, is this
    buffer's tail private — and in every one of them the shipped default is the permissive option.
    The matrix names each default *and* its cost, because the recurring shape is that the API is
    correct and the thing under-reporting is the caller's belief about it.
  - **When**: Target project pipes streams, exits on a signal, wraps a callback API, parses bytes
    off a socket, spawns a `Worker`, or has a test suite that runs serially by default.
  - **Target Location**: `docs/nodejs/blocking-backpressure-and-exit-decisions.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.