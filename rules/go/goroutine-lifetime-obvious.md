---
title: "Make Goroutine Exit Obvious, or Document It"
rule_id: "RULE-GO-005"
category: "correctness"
scope: "all"
applies_to: "Any code starting a goroutine, especially one not owned by an errgroup"
last_updated: "2026-09-30"
source: "https://go.dev/wiki/CodeReviewComments"
---

# Make Goroutine Exit Obvious, or Document It

A reader should be able to name the condition under which each goroutine returns. If they
cannot, put it in a comment — that is the review standard, not a personal preference.

## Why

The Go code review comments are direct about the failure mode:

> Goroutines can leak by blocking on channel sends or receives: **the garbage collector will
> not terminate a goroutine even if the channels it is blocked on are unreachable.**

That is the whole hazard in one sentence. The goroutine holds the channel; the channel being
unreferenced does not matter, because the goroutine *is* the reference. Nothing reclaims it,
no stack trace points at it, and the leak shows up as memory growth under load with no
culprit.

The standard is deliberately modest:

> Try to keep concurrent code simple enough that goroutine lifetimes are obvious. If that
> just isn't feasible, **document when and why the goroutines exit.**

And the consequence of getting it wrong is not only memory:

> Sends on closed channels panic. Modifying still-in-use inputs "after the result isn't
> needed" can still lead to data races.

## Do

Give every goroutine exactly one exit path you can point at in a sentence, and make it a
`return`:

```go
func serve(ctx context.Context, ln net.Listener) {
	go func() {
		<-ctx.Done()   // exits when the caller cancels
		ln.Close()     // and that unblocks the accept below
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			return     // accept fails once the listener closes
		}
		go handle(conn)
	}
}
```

- If the exit condition is not obvious, write it above the `go`: `// exits when ctx is
  cancelled`.
- Drain on the cancel path. A producer that returns on `<-ctx.Done()` without draining its
  result channel leaves the consumer blocked forever — and the consumer is usually the
  caller waiting on a join.
- Use `errgroup` when you want the join point to be mechanical rather than argued.
  `Wait` is the proof that every task exited.
- If the goroutine must not crash the process, recover inside it. An errgroup deliberately
  does not propagate panics, because doing so *"risks deadlocks that hide the panic
  entirely."*

## Don't

- Start a goroutine as the last statement of a function that then returns, with no join.
  The caller has no way to know the work is still in flight.
- Assume an unreachable channel means the goroutine is collectable. It is not.
- Mutate a caller's input after deciding "the result isn't needed" while a goroutine may
  still be reading it. That is a data race, and it is the race the race detector will
  find three weeks later.
- Add a `Context` field to a struct to manage a goroutine's lifetime. The review comments
  are unambiguous: *"Don't add a Context member to a struct type; instead add a ctx
  parameter to each method on that type that needs to pass it along."* The one exception is
  a method whose signature must match an interface.

## Verifying

There is no linter. `go vet ./...` catches the `lostcancel` half (see RULE-GO-001) but
nothing here. The check is review, against one question: **for each `go` statement, what
makes this goroutine return?**

```bash
grep -rn '^\s*go ' --include=*.go . | grep -v '_test.go'   # then read each answer
```

Goroutines in `_test.go` are the ones most likely to be unowned.
