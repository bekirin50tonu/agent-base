---
title: ":permanent is the default, and it erases the crash before the strategy is consulted"
rule_id: "RULE-ELIXIR-003"
category: "architecture"
scope: "backend"
applies_to: "Elixir, OTP, Supervisor"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/Supervisor.html"
---

# :permanent is the default, and it erases the crash before the strategy is consulted

Every child spec that omits `:restart` gets `:permanent`. Not `:transient` — `:permanent`. The
distinction matters because the supervisor's strategy does not decide whether a child should
come back; it only decides *who else* comes back with it.

The rule that ties them together is stated in the shutdown documentation: *"In the above, process
termination refers to unsuccessful termination, which is determined by the :restart option."*
So the order is:

1. The child exits, with some reason.
2. `:restart` decides whether that counts as termination at all.
3. Only if it does is the strategy consulted, to pick the siblings that restart too.

`:temporary` short-circuits step 3 entirely. *"the child process is never restarted, regardless
of the supervision strategy: any termination (even abnormal) is considered successful."* A
`:temporary` child crashing in a `:one_for_one` supervisor restarts nothing and takes nothing
down — correct for a one-shot, and silently wrong for anything that was assumed to be supervised
merely by living under a supervisor.

`:permanent`, by contrast, restarts unconditionally. A worker that exits `:normal` — a plain
`return`, a `GenServer.stop/1` — is restarted as though it had crashed, and there is no reason
left to distinguish the two.

## Why

The intuition carried from a bare `Supervisor.start_link` is that supervision implies restart.
The child spec decides that, and the default in a child spec map written from memory is the
one that restarts everything unconditionally. A one-shot task and a request-scoped worker
compiled from the same template get identical restart semantics.

The error shows up as the opposite of what supervision is for: a resource that should have been
released on a failed attempt is instead retried forever, and the attempt's evidence is gone
each time.

## Do

- Write `:restart` explicitly in every child spec. The default is the most aggressive option and
  the least likely to be what you meant.
- Use `:temporary` for anything whose correct behaviour on a second attempt is to give up.
- Use `:transient` when a clean stop is fine but a failure must be retried — it restarts on
  abnormal exit only, which is usually what "worker" means.
- Match `:restart` to the question the child answers: does a second attempt make sense at all?

```elixir
# Correct — the one-shot job gives up; the worker is retried on failure only
children = [
  {MyApp.ImportWorker, args, restart: :transient, shutdown: 10_000},
  Supervisor.child_spec({Task, fn -> run_once_and_report() end},
    id: :one_shot, restart: :temporary)
]

# Incorrect — a one-shot that restarts forever, and a clean stop that
# is indistinguishable from a crash
children = [
  {MyApp.ImportWorker, args},                          # :permanent, always back
  {MyApp.Report, args}                                  # :permanent, always back
]
```

## Don't

- Don't rely on the implicit `:restart` — write it out; the default is not the safe one.
- Don't use `:temporary` as a way to stop a supervisor from taking siblings down; use the
  strategy, and `:temporary` on a child that must actually be supervised.
- Don't read a restart as evidence the failure was handled. Under `:permanent` the process is
  replaced before anything inspects why it exited.
- Don't assume a child under a supervisor is supervised *by virtue of being under it* — the
  child spec is where that decision lives.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| One-shot work runs in a loop, doubling writes each pass | `:permanent` default on a job that must not repeat | `restart: :temporary` |
| Worker restarts after a deliberate `GenServer.stop/1` | `:permanent` treats `:normal` as termination | `:transient` |
| `:rest_for_one` cascade starts when nothing depends on the failed child | `:temporary` was intended but defaulted to `:permanent` | Declare `:restart` per child |
| Siblings restart even though the failing child gave up cleanly | The child is `:transient` and exited abnormally — the reason is in the report | Read the exit reason before changing the strategy |
| Supervision tree looks healthy, work is silently missing | `:temporary` child exited and nothing recorded it | Alert on absence, not on crashes |

## Verifying

```bash
# Child specs written without an explicit :restart — every one inherits :permanent
grep -rn --include='*.ex' -E '\{[A-Z][A-Za-z0-9_.]*,' lib/ | grep -v 'restart:'

# The same, for module/function-form specs
grep -rn --include='*.ex' 'child_spec' lib/ | grep -v 'restart:'

# What restart values are actually in play
grep -rhoE 'restart: :[a-z_]+' lib/ config/ | sort | uniq -c

# Strategy choice, against the children order it depends on
grep -rn --include='*.ex' 'strategy:' lib/ config/
```

Every hit in the first list is a decision that was made by omission. Reading them in order and
asking "does a second attempt of this make sense?" is the whole review.

These greps cannot tell you whether `:transient` is right for a child whose failure modes you
have not enumerated, or whether a `:temporary` child's silent exit is monitored anywhere. Those
need the child's own failure analysis and a look at the alerting path.
