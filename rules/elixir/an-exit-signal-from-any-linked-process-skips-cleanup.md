---
title: "An exit signal from any linked process is an unannounced crash trigger"
rule_id: "RULE-ELIXIR-002"
category: "architecture"
scope: "backend"
applies_to: "Elixir, OTP, GenServer, Task, Process"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/Process.html"
---

# An exit signal from any linked process is an unannounced crash trigger

A process that is not trapping exits dies when *any* linked process exits with a reason other
than `:normal`. That is not a supervision relationship with a policy attached — it is the
default for every link in the system, and the reason a process whose own code never raises can
still die mid-request.

Two properties make this hard to see in review:

- The reason is not `:normal`, so it counts as an **abnormal** exit for restart purposes — the
  supervisor restarts the child, and a cascade looks like a crash loop with no crash in it.
- `:kill` cannot be trapped at all. There is no handler, no `try`, and no `rescue` for it. A
  supervisor that escalates after its `:shutdown` timeout uses exactly this.

`Task.async` rides on the same mechanism deliberately: *"Async tasks link the caller and the
spawned process. This means that, if the caller crashes, the task will crash too and vice-versa.
This is on purpose: if the process meant to receive the result no longer exists, there is no
purpose in completing the computation."* Correct, and the consequence is that a fire-and-forget
helper written on top of `Task.async` takes down its caller when *it* fails.

Trapping exits changes the signal into an ordinary `{:EXIT, from, reason}` message — which
means the process no longer dies on a linked crash, and must handle the message instead. That
trades an unannounced exit for an unhandled one.

## Why

The failure mode is a request that fails for a reason that appears nowhere in its own code path.
A background job started with `Task.async` raises; the linked caller dies mid-request; the web
layer logs a connection error; the supervisor restarts both. Nothing in the request handler
points at the actual cause, and nothing in the job's logs points at the process it killed.

## Do

- Use `Task.Supervisor.async_nolink/2` for anything whose failure must not reach the caller,
  then `Task.yield/2` and `Task.shutdown/2` for the result.
- Trap exits in long-lived processes that must survive a peer's crash, and match explicitly on
  the `{:EXIT, _from, reason}` messages you intend to act on.
- Treat any process started with `Task.async` as part of the caller's crash domain — that is
  the feature, not a bug to work around.
- Use `:normal` when a linked process is exiting on purpose and the peer should survive it.

```elixir
# Correct — failure is contained; the caller learns of it by asking
{:ok, pid} = Task.Supervisor.start_child(MyApp.TaskSupervisor, fn ->
  expensive_reconciliation()
end)

case Task.yield(pid, 5_000) || Task.shutdown(pid, :brutal_kill) do
  {:ok, result} -> {:ok, result}
  {:exit, reason} -> {:error, reason}
  nil -> {:error, :timeout}
end

# Incorrect — a failure here becomes the caller's failure
task = Task.async(fn -> expensive_reconciliation() end)
Task.await(task)   # reconciliation raised -> this process is killed too
```

## Don't

- Don't wrap `Task.async` in something that "handles" errors and then forget it is still
  linked — the link is on the spawned process, not on the failure handling.
- Don't assume `trap_exit` makes a process safe. It converts the exit into a message that is
  silently dropped if the receive doesn't match it.
- Don't expect to catch `:kill` in a `try`, a `rescue`, or a `catch`.
- Don't link processes for lifecycle convenience and then be surprised that either one's crash
  kills the other — link means exactly that, in both directions.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Request dies with an exit reason from a module it never called | `Task.async` link — the task failed, the caller died with it | `Task.Supervisor.async_nolink/2` + `yield`/`shutdown` |
| Supervisor restart loop, no exceptions in the log | A linked peer died abnormally; restart policy treated it as a crash | Find the link, or `:normal` the intentional exit |
| Process ignores a peer it should have died with | Trapping exits on, `{:EXIT, ...}` message unmatched | Match the messages you mean to handle; restart is now your job |
| Cleanup skipped on a shutdown that looked clean | Signal was `:kill` from supervisor escalation | See `RULE-ELIXIR-001` |
| A supervision child kills its supervisor's siblings | Linked under a plain link rather than started as a supervised child | Use a child spec; the link is for lifecycles you want coupled |

## Verifying

```bash
# Task.async — every call site joins the caller's crash domain
grep -rn --include='*.ex' --include='*.exs' 'Task\.async\b' lib/ test/

# The contained alternative, for comparison
grep -rn --include='*.ex' 'async_nolink\|Task\.yield\|Task\.shutdown' lib/

# Processes that trap exits and must therefore handle messages they may drop
grep -rn --include='*.ex' 'Process\.flag(:trap_exit' lib/

# Direct signalling, including supervisor escalation paths
grep -rn --include='*.ex' --include='*.exs' 'Process\.exit(' lib/ test/
```

Each `Task.async` hit needs one of two answers, in the code: either "a failure here is
acceptable because the caller was going away anyway", or "this is wrong, use `async_nolink`".
Comments asserting the first do not make it true — the link decides.

These greps cannot tell you whether a trap-exit process actually matches every reason it can
receive, or whether a `Task.await` sits far enough from its `Task.async` for a crash in between
to matter. Those need a read of the receive clauses and of the call distance.
