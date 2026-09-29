---
title: "errgroup.Go Blocks at the Limit — It Is Not a Queue"
rule_id: "RULE-GO-003"
category: "concurrency"
scope: "all"
applies_to: "Any use of golang.org/x/sync/errgroup, especially with SetLimit"
last_updated: "2026-09-30"
source: "https://pkg.go.dev/golang.org/x/sync/errgroup"
---

# errgroup.Go Blocks at the Limit — It Is Not a Queue

`SetLimit` caps goroutines by blocking the *caller*. Anything that calls `Go` from inside a
goroutine already in the group deadlocks. Cancelling the group does not stop work either.

## Why

The blocking is deliberate, and the Go team has said so plainly:

> It blocks until the new goroutine can be added without the number of goroutines in the
> group exceeding the configured limit.

The alternative was considered and rejected: *"enqueuing tasks to a bounded executor is much
too prone to deadlocks."* (bcmills, [golang/go#27837](https://github.com/golang/go/issues/27837))

So the deadlock is structural, not a bug. A task that holds a slot and then needs a *new*
`Go` on the same group waits for a slot only it can free.

Three further facts that make this fail in production rather than in review:

1. **`Go` runs your function even after the group has errored.** *"All funcs are called, even
   those created after the group was cancelled. group.Wait() waits for all funcs to complete
   before returning."* ([golang/go#54045](https://github.com/golang/go/issues/54045)) A
   proposal to skip post-cancel work was closed as a duplicate — it will not happen.
2. **`go g.Go(f)` is always a bug.** There is no synchronisation between `Wait` and that
   call, so `Wait` can return before the goroutine even starts. The `Go` doc now says
   **"The first call to Go must happen before a Wait."** ([golang/go#70284](https://github.com/golang/go/issues/70284))
3. **`Wait` returns only the *first* error.** Collecting all of them was declined: it would
   make storage O(N) instead of O(1), and *"all errors after the first will be caused by the
   cancellation triggered by the first error, and thus unreliable"*
   ([golang/go#72101](https://github.com/golang/go/issues/72101)).

## Do

Call `SetLimit` **before** any `Go`, and check `TryGo`'s return value:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8) // before any Go — it panics if goroutines are already active

for _, item := range items {
    item := item
    if !g.TryGo(func() error { return process(ctx, item) }) {
        // saturated: do something that does not need a new goroutine
        break
    }
}
return g.Wait()
```

- Select on `ctx.Done()` in **every** blocking send and receive inside a task. Group
  cancellation is advisory; only your `select` stops the work.
- Use `var g errgroup.Group` (no `WithContext`) for batch jobs where one bad item must not
  abort the rest: *"A zero Group is valid, has no limit on the number of active goroutines,
  and does not cancel on error."*
- Treat `Wait` as the join point that proves every goroutine exited. The canonical
  `MD5All` example leans on exactly this — `ctx` is cancelled when `Wait` returns, *"so we
  know that all of the goroutines have finished and the memory they were using can be
  garbage-collected."*
- `TryGo` always succeeds when no limit is set. Ignoring its return value is fine only in
  that case.

## Don't

- **Call `g.Go` from inside a goroutine already in the group when a limit is set.** That is
  the deadlock. Run the producer itself as a group member instead.
- Write `go g.Go(f)`, or `if !g.TryGo(f) { go g.Go(f) }` — the second is the exact pattern
  that produced [golang/go#70284](https://github.com/golang/go/issues/70284).
- Put a semaphore `Acquire` *inside* the `g.Go` body. As alexaandru put it in
  [#27837](https://github.com/golang/go/issues/27837): *"it does NOT prevent the launching of
  50 simultaneous goroutines, it only prevents them to actually do their work."* If you
  need a limit that is not the group, acquire before `Go` — and `break` on `ctx.Err()`
  rather than returning the acquire error, which would mask the real failure behind
  `context.Cancelled`.
- Call `SetLimit` while goroutines are active. It panics, by design, because a silently
  blocking call has no rescue.
- Expect `Wait`'s error to describe everything that failed. Accumulate with `errors.Join`
  inside the task bodies if you need the full set.
- Expect the group to recover a panic. It deliberately does not — propagation *"risks
  deadlocks that hide the panic entirely"*. Recover inside the task body.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Hangs at exactly N concurrent tasks | `Go` called from inside a group goroutine under a limit | Make the producer a group member |
| `Wait` returns, then work starts | `go g.Go(f)` — no happens-before with `Wait` | Call `Go` synchronously; use `TryGo` |
| `context.Cancelled` as the only error | Semaphore acquire error returned, real error lost | `break` on `ctx.Err()`; return the group's own error |
| Runtime panic in `SetLimit` | Limit changed after work started | Move `SetLimit` above the first `Go` |
| Memory grows after `Wait` | Goroutines still running past the join | `Wait` before the data goes out of scope |

## Verifying

`go vet` does not check any of this. What is checkable:

```bash
go test -race ./...                              # catches the unjoined-goroutine reads
grep -rn 'go .*\.Go(' --include=*.go .           # Rule: never
grep -rn '\.SetLimit(' --include=*.go .          # must appear before the first .Go( on that group
```

The `go g.Go` grep is the highest-value one — it is a one-line rule with no false positives.
