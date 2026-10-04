---
title: "max_children defaults to :infinity"
rule_id: "RULE-ELIXIR-005"
category: "concurrency"
scope: "backend"
applies_to: "Elixir, OTP, DynamicSupervisor"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/DynamicSupervisor.html"
---

# max_children defaults to :infinity

`DynamicSupervisor.start_link/1` is called with a name and nothing else across most codebases,
and the process it starts is unbounded. `:max_children` is optional and its default is
`:infinity`. Nothing in the process count, the memory profile, or the supervision tree tells you
the limit is gone, because there is no limit.

The same shape appears in `Task.Supervisor` and `Agent` — a documented note in the Task case is
that the supervisor is *"a single process"* and that high-volume fan-out should use
`PartitionSupervisor` keyed on `self()`. That is not a performance note: a single process is a
single mailbox, and every message it handles is work every other caller waits behind.

`DynamicSupervisor` supports only the `:one_for_one` strategy. A child that crashes restarts
alone and its siblings are untouched — which is right for a pool of interchangeable workers and
wrong the moment two children share state. Combined with `max_children: :infinity`, the pool
grows to whatever concurrency the traffic arrives at, and the bound that would have limited the
damage is the one setting that was left out.

## Why

An unbounded dynamic supervisor converts a traffic spike into a resource exhaustion with no
error. Each `start_child/2` succeeds, the return value is `{:ok, pid}`, and nothing accumulates
a counter. The failure arrives later, as scheduler collapse or an out-of-memory kill, from a
cause line that names a different subsystem.

The `max_children` error the documentation describes never fires, so the code path that would
have handled the overload is untested — and untested is the same as absent when the bound is
`:infinity`.

## Do

- Set `max_children` to the number you are willing to have running at once, and treat exceeding
  it as a load signal rather than an error to swallow.
- Use `PartitionSupervisor` keyed on `self()` when the fan-out is per-request or per-key; the
  single-process supervisor is a documented bottleneck, not a default.
- Keep a count in the calling process when you start children dynamically, so the bound is
  enforced by something you can observe.

```elixir
# Correct — a real bound, and a caller that handles the refusal
{:ok, sup} = DynamicSupervisor.start_link(
  strategy: :one_for_one,
  name: MyApp.WorkerSupervisor,
  max_children: 50
)

case DynamicSupervisor.start_child(sup, {MyApp.Worker, arg}) do
  {:ok, pid} -> {:ok, pid}
  {:error, :max_children} -> {:error, :overloaded}
end

# Incorrect — unbounded, and every refusal case is a crash
{:ok, sup} = DynamicSupervisor.start_link(name: MyApp.WorkerSupervisor)

DynamicSupervisor.start_child(sup, {MyApp.Worker, arg})   # :infinity children
```

## Don't

- Don't leave `max_children` unset on a supervisor whose children are created per request.
- Don't put per-request fan-out behind a single `Task.Supervisor` and call it a scale-out; the
  documentation names `PartitionSupervisor` for this.
- Don't use `DynamicSupervisor` for children that share state — it only offers `:one_for_one`,
  so there is no way to restart the group.
- Don't swallow `{:error, :max_children}`; with the default it never arrives, and swallowing it
  leaves you with no signal when you add the bound.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Scheduler latency spikes under load, no errors | Unbounded children on a single-process supervisor | `max_children` plus `PartitionSupervisor` |
| Memory climbs with request rate, GC pressure | `:infinity` children accumulating | Bound the pool; reject excess work explicitly |
| Siblings share state and drift apart after a restart | `DynamicSupervisor` is `:one_for_one` only | Use a regular `Supervisor` with `:one_for_all` |
| Latency per request grows with concurrency | One process serialising every mailbox message | Partition by `self()` |
| No overload handling in any code path | The `{:error, :max_children}` branch is dead with `:infinity` | Set the bound, then handle the refusal |

## Verifying

```bash
# Dynamic supervisors started without a bound
grep -rn --include='*.ex' -A4 'DynamicSupervisor.start_link' lib/ | grep -v 'max_children'

# Single-process supervisors on a per-request path
grep -rn --include='*.ex' 'Task.Supervisor\|AsyncSupervisor' lib/

# Partitioned alternatives already in use, for comparison
grep -rn --include='*.ex' 'PartitionSupervisor' lib/

# Children created per request without a count in the caller
grep -rn --include='*.ex' 'DynamicSupervisor.start_child' lib/

# Strategy on dynamic supervisors -- :one_for_one is the only one
grep -rn --include='*.ex' -A3 'DynamicSupervisor.start_link' lib/ | grep 'strategy:'
```

Every hit in the first list is a pool with no ceiling. Every hit in the third list is a caller
that does not know how many children it already has.

These greps cannot tell you what the right bound is, or whether two children share state. The
first needs the concurrency you intend to serve; the second needs a read of what each child
touches.
