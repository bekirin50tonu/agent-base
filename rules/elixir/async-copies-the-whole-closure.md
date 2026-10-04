---
title: "Task.async copies the whole closure, and Agent's read is not a lock"
rule_id: "RULE-ELIXIR-006"
category: "correctness"
scope: "backend"
applies_to: "Elixir, OTP, Task, Agent"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/Task.html"
---

# Task.async copies the whole closure, and Agent's read is not a lock

`Task.async/1` runs the function in a new process, and starting a process means copying the
environment it closes over. The documentation is explicit that a task receives *"a copy of all
the variables and aliases in the caller's context"* — so a `Task.async` inside a request handler
copies the entire request state into a fresh heap, and the fan-out cost is per-task, not per-byte
of what the task actually reads.

The other half is `Agent`. `Agent.get/2` is a read and `Agent.update/2` is a read-modify-write,
each serialised through the agent process. That is atomicity for the *call*, not for the
*operation around it*: `Agent.get/2` returns a value, and any computation performed on that value
happens outside the agent. Two callers can both read version 3, both compute, and both write —
and the second write silently discards the first. `Agent.update/2` fixes this because the function
runs inside the agent; `Agent.get/2` followed by `Agent.update/2` does not.

It also blocks. `Agent.get/2` waits for the agent to finish whatever it is doing, so an expensive
computation inside `Agent.update/2` makes every reader wait for it.

## Why

Both defaults produce working code in development and wrong code under concurrency. The copy is
invisible — no line says "this heap is duplicated" — and the lost update is invisible by
construction: two writers each see a consistent state and produce a consistent state.

The lost update is the one that reaches production. It appears as a counter that drifts, a
setting that reverts, or a limit that a concurrent request exceeded, with no error at any layer.

## Do

- Use `Task.Supervisor.async_nolink/2` from a supervised task supervisor rather than `Task.async`
  when the caller must survive the task's failure (`RULE-ELIXIR-002`).
- Pass the data a task needs as an explicit argument rather than closing over the request context.
- Use `Agent.update/2` for read-modify-write; use `Agent.get/2` only when the value is
  immutable once written.
- Keep expensive computation out of `Agent.update/2` — it runs inside the agent and every
  reader waits for it.

```elixir
# Correct — the whole operation runs inside the agent, so no lost update
Agent.update(state, fn s -> %{s | count: s.count + 1} end)

# Incorrect — two callers both read 3, both write 4
current = Agent.get(state, & &1.count)
Agent.update(state, &%{&1 | count: current + 1})

# Correct — the task is handed what it needs
Task.Supervisor.async_nolink(sup, fn ->
  process_rows(limit: 500)   # no copy of the request state
end)

# Incorrect — the whole request context is copied into a new heap
Task.async(fn -> process_rows(conn: conn, session: session, user: user) end)
```

## Don't

- Don't wrap request state in a closure and pass it to `Task.async`; the copy is the cost and
  the staleness is the bug.
- Don't compose `Agent.get/2` with a separate write; the agent serialises the calls, not the
  sequence.
- Don't put a network call or a large sort inside `Agent.update/2` — every concurrent reader
  blocks behind it.
- Don't assume an `Agent` is a cache with atomic semantics; it is a serialised process with an
  atomic API for the *function you hand it*.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Counter drifts low under concurrency | `get` then `update` outside the agent | Move the whole operation into `Agent.update/2` |
| A setting reverts to an earlier value | Lost update from two writers | Same fix; or use `:ets` with a compare-and-swap |
| Readers stall on a write | Expensive work inside `Agent.update/2` | Compute outside, store the result |
| Memory spikes proportional to request count | Full context copy per `Task.async` | Pass explicit arguments |
| Caller dies with an error from a task it did not call | `Task.async` link in both directions | `async_nolink` + `yield`/`shutdown` |
| Fan-out is slower than doing it inline | Per-task heap copy plus scheduling | Partition the work, or batch it |

## Verifying

```bash
# Task.async call sites -- each one copies the caller's context
grep -rn --include='*.ex' --include='*.exs' 'Task\.async\b' lib/ test/

# Agent read followed by a separate write: the lost-update shape
grep -rn --include='*.ex' -A3 'Agent\.get' lib/ | grep 'Agent\.update'

# Agent.update bodies that do more than transform
grep -rn --include='*.ex' -A6 'Agent\.update' lib/ | grep -E 'Req\.|HTTPoison|:httpc|Enum\.sort|Files\.|File\.read'

# Contended state that is not an Agent
grep -rn --include='*.ex' ':ets\.new\|:global\.register\|:persistent_term\.put' lib/
```

Each hit in the second list is a read-modify-write split across two agent calls. That is the
pattern to fix first; the third list is where the blocking risk lives.

These greps cannot tell you whether an `Agent` value is genuinely write-once, or how large a
closure's copy actually is. Those need a read of the writers and a measurement of the state.
