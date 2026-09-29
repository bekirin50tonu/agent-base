---
title: "Every Derived Context Needs Its CancelFunc Called, On Every Path"
rule_id: "RULE-GO-001"
category: "correctness"
scope: "all"
applies_to: "Any function calling context.WithCancel, WithTimeout, or WithDeadline"
last_updated: "2026-09-30"
source: "https://pkg.go.dev/context"
---

# Every Derived Context Needs Its CancelFunc Called, On Every Path

`defer cancel()` immediately after the call, unconditionally. Not at the end of the happy
path — `defer` is the point.

## Why

The cancellation function does three things, and only the first is intuitive: it cancels the
child, **it removes the parent's reference to the child**, and it stops the associated timer.
The godoc's own words:

> Failing to call the CancelFunc leaks the child and its children until the parent is
> canceled.

A request handler that calls `WithTimeout` and returns without cancelling leaves a live child
attached to a parent that may live for the whole process. A server doing this per request
accumulates a tree of contexts it can no longer reach. The godoc names the mechanism that
catches it: **the `go vet` tool checks that CancelFuncs are used on all control-flow paths** —
this is the one context rule a linter enforces rather than a reviewer.

## Do

```go
func slowOperationWithTimeout(ctx context.Context) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel() // releases resources if the operation finishes before the timeout
	return slowOperation(ctx)
}
```

- Call `defer cancel()` on the line after the derivation, before any other work. A `cancel`
  buried at the end of a function is skipped by every early return added later.
- Create a fresh `context.Background()` **per request**, inside the handler — never a
  package-level `var ctx = context.Background()`. A shared background context has no
  deadline and no cancellation, so it defeats the entire mechanism.
- Treat `cancel()` returning as *not* meaning the work has stopped. The godoc is explicit:
  **"A CancelFunc does not wait for the work to stop."** To read memory the cancelled
  goroutine wrote, join your own `sync.WaitGroup` or channel.
- Keep `ctx` as the first parameter of every function on the path between an incoming and an
  outgoing request. Google's stated internal rule, and the reason static analysis works:
  **"At Google, we require that Go programmers pass a Context parameter as the first argument
  to every function on the call path."**

## Don't

- Return early before the `defer` is registered. Register it immediately.
- Rely on the parent being cancelled "eventually." "Eventually" is process lifetime for a
  long-lived server, and the child is not collectable until then.
- Read a shared variable after `cancel()` without synchronising. Cancellation is a signal,
  not a memory barrier.
- Assume `Done()` is closed the instant `cancel()` returns. It may not be: **"The close of
  the Done channel may happen asynchronously, after the cancel function returns."** Wait on
  `<-ctx.Done()`, do not infer it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Memory grows under sustained load, no leak in business logic | Context children never released | `defer cancel()` on every derivation |
| Data race under `-race` only after adding a timeout | Read after `cancel()` without joining | Join the work before returning |
| A goroutine never exits | Wrapper abandoned its goroutine on cancel | Drain the result channel on the cancel path |

## Verifying

```bash
go vet ./...          # enforces lostcancel: CancelFunc used on all control-flow paths
```

Run it in CI. This is the one context rule you do not have to remember.
