---
title: "process.exit() discards writes that are still pending"
rule_id: "RULE-NODEJS-002"
category: "correctness"
scope: "backend"
applies_to: "Node.js, process.exit, stdout, stderr, shutdown paths, exit codes"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/process.html"
---

# process.exit() discards writes that are still pending

`process.exit()` terminates the process synchronously. It does not wait for queued I/O, and
the writes it abandons include everything `console.log` produced:

> Calling process.exit() will force the process to exit as quickly as possible even if there
> are still asynchronous operations pending that have not yet completed fully, including I/O
> operations to process.stdout and process.stderr.
> ([Process](https://nodejs.org/api/process.html))

The exit code still reaches the parent shell correctly, so from outside the process this looks
like a clean, deliberate shutdown. The loss is only visible by counting what was written.

Whether there was anything to lose depends on where stdout points:

> Writes may be synchronous depending on what the stream is connected to and whether the system
> is Windows or POSIX
> ([Process](https://nodejs.org/api/process.html))

to a file or a TTY on POSIX the write completes before the call returns, and the bug is
invisible; to a pipe or a socket the write is asynchronous, and the log line is dropped. A
service whose stdout is a pipe under systemd, Docker or Kubernetes is exactly the deployment
where it loses data, and that is where its logs are read from.

The synchronous cases carry a second cost:

> Synchronous writes block the event loop until the write has completed.
> ([Process](https://nodejs.org/api/process.html))

## Why

The idiom comes from languages where exit is immediate and there is no queue to drain. In
Node.js the queue exists, and the most common place to exit is a `catch` block or a signal
handler — exactly where the last thing written is the explanation of what went wrong.

The bug is intermittent by construction. It reproduces when logging is high-volume (the queue
is deep), under load (the pipe is slow), and on a platform where the target is a pipe. A
developer on a terminal sees none of it. The three conditions that trigger it are all
environmental, and none of them are visible at the call site.

## Do

- Set `process.exitCode` and return, so the loop drains and stdout flushes naturally.
- For a hard exit that still needs its log out, `await` the write completion before exiting.
- Use `stream/promises.finished(process.stdout)` when you need to know the pipe is flushed.
- In a worker, `parentPort.close()` after posting the final message.
- Handle signals by *starting* shutdown, not by exiting: close servers, then let the loop
  empty.

```javascript
// Correct — set the code, return, let the loop drain and stdout flush
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// Correct — a shutdown handler that initiates rather than terminates
process.on('SIGTERM', async () => {
  server.close();
  await finished(process.stdout);
  process.exitCode = 0;
});
```

## Don't

- Don't call `process.exit()` in a `catch` block that just logged the error. That log line is
  the one most likely to be lost.
- Don't call `process.exit()` after enqueuing a write to a pipe or socket.
- Don't assume a `console.log` before `exit()` reached the log collector. Verify it.
- Don't use `process.exit()` to "be safe" after cleanup — the cleanup it cuts short is the
  cleanup that was flushing.
- Don't read a non-zero exit code as proof the failure was reported. Both can be true, and both
  can be false independently.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Error logged but absent from logs | `process.exit()` dropped the write | `process.exitCode` + return |
| Works locally, silent in Docker | Pipe target is async on POSIX | Same |
| Missing lines only under load | Queue deeper, discard window wider | Same |
| Interleaved or reordered output | Sync/async target mismatch | Route through one stream |
| Shutdown hangs | Never exiting, so waiting on a live handle | Close handles, then let it drain |
| Event loop stalls on logging | Synchronous stdout write | Batch writes, use a queue |

## Verifying

```bash
# Hard exits -- each hit needs the preceding writes checked for flush
grep -rn --include='*.{js,mjs,cjs,ts}' 'process\.exit(' src/

# Exit code assignments, the non-destructive form
grep -rn --include='*.{js,mjs,cjs,ts}' 'process\.exitCode' src/

# Shutdown handlers that should drain rather than exit
grep -rn --include='*.{js,mjs,cjs,ts}' -E "process\.on\(\s*['\"]SIG" src/

# Direct writes to the standard streams, which the rules above concern
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'process\.(stdout|stderr)\.write' src/
```

The first list is the defect surface and the third is where the correct pattern already lives.
Where both a `SIGTERM` handler and a `process.exit()` appear in the same file, the handler is
usually the one to fix.

These greps cannot tell whether a queued write was actually still pending at exit — that
depends on the target and the timing. Confirm by running under a pipe (`node app.js | cat`) and
counting lines, which is the only way to reproduce the asynchronous case locally.