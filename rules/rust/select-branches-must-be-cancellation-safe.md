---
title: "Every select! Branch Is a Cancellation Point, and Tokio Publishes Which Futures Survive One"
rule_id: "RULE-RUST-003"
category: "concurrency"
scope: "backend"
applies_to: "Any tokio::select! with a branch that can be cancelled while incomplete; any socket read or write inside a select; any lock, semaphore, or Notify wait inside a select; any framed protocol read racing a shutdown or timeout"
last_updated: "2026-10-04"
source: "https://docs.rs/tokio/latest/tokio/macro.select.html"
---

# Every select! Branch Is a Cancellation Point, and Tokio Publishes Which Futures Survive One

`tokio::select!` polls its branches until one completes; the rest are dropped. Whether that drop is
harmless is a property of the future, not of your code — and Tokio publishes the test, plus two
lists of futures that fail it.

## Why

The test is precise, and "no-op" is the word that carries the whole rule:

> Cancellation safety can be defined in the following way: If you have a future that has not yet
> completed, then it must be a no-op to drop that future and recreate it.
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

Dropping and recreating `recv()` costs nothing — the message is still queued. Dropping and
recreating `read_exact()` does not: the bytes already pulled into the partial buffer are gone, and
the recreated call resumes mid-message, reading the tail of one frame as the header of the next.

Tokio then splits the failures into two kinds, and the split matters because the fixes differ:

> The following methods are not cancellation safe and can lead to loss of data:
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

> The following methods are not cancellation safe because they use a queue for fairness and
> cancellation makes you lose your place in the queue:
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

The first list — `read_exact`, `read_to_end`, `write_all` — loses bytes, and the failure appears
downstream as a protocol desync in a component with no reason to suspect this loop. The second —
`Mutex::lock`, `RwLock::read`, `Semaphore::acquire`, `Notify::notified` — loses your position. It is
recoverable, but every cancellation pushes you to the back of the fairness queue, so a `select!`
around a lock can starve the branch that was meant to win.

There is a third hazard in the same macro that is a runtime panic rather than data loss:

> The select! macro panics if all branches are disabled and there is no provided else branch.
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

and a fairness detail that makes select loops non-deterministic by design:

> By default, select! randomly picks a branch to check first.
> ([tokio::select!](https://docs.rs/tokio/latest/tokio/macro.select.html))

## Do

- Check every branch against Tokio's own lists before committing it. The safe set includes
  `mpsc::Receiver::recv`, `broadcast::Receiver::recv`, `watch::Receiver::changed`,
  `TcpListener::accept`, `AsyncReadExt::read`, `AsyncWriteExt::write` and `StreamExt::next`.
- Read a framed protocol one cancellation-safe chunk at a time and reassemble outside the select:
  ```rust
  loop {
      let mut frame = Vec::new();
      let n = tokio::select! {
          n = socket.read_buf(&mut frame) => n,
          _ = shutdown.recv() => return Ok(()),
      }?;
      if feed(&mut frame, n)? { break; }
  }
  ```
  The partial read is now buffer state rather than a lost operation.
- Acquire a lock *outside* the select, so the guard is held or not and is never lost to a
  cancellation:
  ```rust
  let _guard = mutex.lock().await;
  tokio::select! {
      _ = work(&mut _guard) => {},
      _ = shutdown.recv() => return Ok(()),
  }
  ```
- Use `Framed` with a bounded length codec when the protocol is length-prefixed. The codec owns the
  buffer across awaits, which removes the hazard rather than working around it — but bound the
  length field, or a bad frame pre-allocates.
- Provide an `else` branch whenever branches are conditionally enabled, so the all-disabled case is
  a decision rather than a panic.

## Don't

- Put `read_exact`, `read_to_end`, `write_all` or `write_all_buf` in a `select!` with a shutdown or
  timeout branch. The partial operation is discarded, not resumed.
- Assume `Mutex::lock` inside a `select!` is "lock with a deadline". Under contention it is lock
  with a deadline *and* a queue position penalty on every retry.
- Wrap a plain `await` in a one-armed `select!`. If the other branch cannot fire, it is an `await`
  with extra syntax and an extra place to get cancellation wrong.
- Rely on branch order for determinism. The macro randomises the first branch by default, which is
  correct and which means a bug that only reproduces when two branches are ready at once will
  reproduce intermittently.
- Assume a frame reassembled by hand outside the select is bounded. The reassembly buffer needs
  the same limit the codec would have enforced.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Protocol desync, garbage in a later field | `read_exact` cancelled mid-message | Cancellation-safe read loop, or `Framed` |
| Truncated write that the peer never acked | `write_all` cancelled after a partial write | Await the write outside the select |
| A lock branch wins far less often than expected | Cancellation lost its place in the fairness queue | Acquire outside the select |
| Panic: "all branches are disabled" | Conditional branches with no `else` | Add an `else` branch |
| Bug reproduces maybe 1 run in 10 | `select!` randomises the first branch polled | Pin the order deliberately, or make the branches mutually exclusive |
| Latency spikes only under contention | `Semaphore::acquire` re-queued on every timeout | Acquire outside the select, or accept the throughput trade knowingly |
| Works on a fast local socket, corrupts on a slow one | Partial reads are rare locally | Read in cancellation-safe units regardless of environment |

## Verifying

```bash
# Every select branch, so each can be checked against Tokio's own lists
grep -rn --include='*.rs' -A6 'select!' src/ | grep -E '= .*\.await|=> *$' \
  | grep -oP '\b\w+(?=\.await)' | sort -u

# The explicitly unsafe methods, wherever they appear
grep -rn --include='*.rs' 'read_exact\|read_to_end\|write_all\|read_buf' src/

# Locks and semaphores that might be inside a select
grep -rn --include='*.rs' -B8 '\.lock()\|\.acquire()\|notified()' src/ | grep -c 'select!'

# select! with no else, where branches may be disabled
grep -rn --include='*.rs' -A20 'select!' src/ | grep -c 'else\s*=>'

# Deterministic-order variants, which are the deliberate exception
grep -rn --include='*.rs' 'biased;' src/
```

The first command produces the list to check by hand against Tokio's documentation — it is the
audit, and the answer is not always in your favour. The second is a blunt instrument on purpose:
a `read_exact` outside a `select!` is fine, and the grep tells you where to look, not what to
change. Nothing here can tell you whether a branch's future has been made cancellation-safe by a
wrapper you wrote; only the type at the call site and Tokio's list can.
