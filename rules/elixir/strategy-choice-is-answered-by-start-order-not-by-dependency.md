---
title: "Strategy choice is answered by start order, not by dependency"
rule_id: "RULE-ELIXIR-004"
category: "architecture"
scope: "backend"
applies_to: "Elixir, OTP, Supervisor"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/Supervisor.html"
---

# Strategy choice is answered by start order, not by dependency

The three supervisor strategies are documented in terms of the `children` **list**, not in terms
of what depends on what. `:one_for_all` restarts all children when one terminates. `:rest_for_one`
restarts the child that terminated and *"the children started after it"*. `:one_for_one` restarts
only the child that terminated.

Read that carefully: `:rest_for_one`'s unit of restart is a **position in the list**. There is no
dependency graph anywhere in `Supervisor` — nothing inspects what a child talks to, nothing
verifies that a child listed after another one actually needs it. The dependency declaration *is*
the ordering of the list, and it is enforced only by the fact that a human wrote the list in
that order.

Two consequences follow directly:

- Children are started in list order and terminated in **reverse** order. Putting a dependent
  before its dependency is not caught at boot; it shows up as a dependent connecting to
  something that is not listening yet.
- Choosing `:rest_for_one` for "these three need each other" restarts the *tail* of the list,
  including any unrelated worker that happens to be written after them. A cold cache or an open
  connection pool is paid on every restart of an unrelated sibling.

`:one_for_all` avoids the over-restart and pays for it with a full-tree restart whenever any
member fails. For a group that genuinely share state, that is usually cheaper than the
alternative; for a group that only shares a database, it is not.

## Why

The strategies read like blast-radius controls, and reviewers pick them by asking "how much do
I want restarted". The actual mechanism is positional, so the question that matters is "what is
written below this line in the list" — which is a question about the file, not about the
runtime behaviour being reasoned about.

The failure is asymmetric: `:rest_for_one` over-restarts silently and looks safe; `:one_for_all`
under-restarts loudly and looks wrong. Both are chosen for the wrong reason.

## Do

- Order the `children` list so every dependent follows what it depends on. That order is the only
  dependency declaration the supervisor has.
- Group by restart domain, not by feature. Everything in one supervisor shares one strategy, so
  a supervisor's children are exactly the set that restarts together.
- Use `:one_for_all` for children that share in-memory state and cannot run half-initialised.
- Use `:rest_for_one` when the list is strictly layered, and accept that a layer restart restarts
  everything beneath it.

```elixir
# Correct — one restart domain, ordered so dependencies come first
children = [
  {MyApp.Repo, []},
  {MyApp.Cache, []},
  {MyApp.SessionStore, []},
  {MyApp.Web.Endpoint, []}
]
# :rest_for_one is safe here: the Repo is at the top, so nothing above
# the failure can have been depending on it.

# Incorrect — four unrelated workers that all lose a warm cache
# because one unrelated worker exited
children = [
  {MyApp.ExportWorker, []},
  {MyApp.ImportWorker, []},
  {MyApp.ReportWorker, []},
  {MyApp.EmailWorker, []}
]
strategy: :rest_for_one   # an ExportWorker crash restarts EmailWorker
```

## Don't

- Don't pick a strategy by asking how much you'd like restarted; ask what is listed after the
  failing child.
- Don't assume the supervisor knows your dependencies — it has a list, not a graph.
- Don't split children across supervisors purely for file organisation; that changes the restart
  domain, which is the only thing the strategy controls.
- Don't list a dependent before its dependency and rely on lazy connection to make it work at
  boot. Reverse-order termination means it is stopped after the thing it needs.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Unrelated workers lose warm state after a failure | `:rest_for_one` restarting the list tail | Regroup by restart domain, or use `:one_for_all` deliberately |
| `{:already_started, pid}` at boot, intermittently | Dependent listed before its dependency | Reorder the list; there is no other mechanism |
| Everything restarts for a failure contained to one component | `:one_for_all` on a group that only shares a database | Split into two supervisors with different domains |
| A dependency stops *after* the dependent it serves | Reverse-order termination, list written in feature order | Reorder so serving components precede served ones |
| Strategy change has no effect | The child is `:temporary`, so it never counts as terminating | Fix `:restart` first — see `RULE-ELIXIR-003` |

## Verifying

```bash
# Every supervisor and the strategy it uses
grep -rn --include='*.ex' -E 'strategy: :[a-z_]+' lib/ config/

# The children list of each, so positions can be read against the strategy
grep -rln --include='*.ex' 'children = \[' lib/ | xargs grep -n -A20 'children = \['

# Children written without an explicit :restart (position is meaningless without this)
grep -rn --include='*.ex' -E '^\s*\{[A-Z][A-Za-z0-9_.]*,' lib/ | grep -v 'restart:'

# Supervisors in a tree: one strategy each, inherited by every child below it
grep -rn --include='*.ex' 'Supervisor.start_link\|Supervisor.init' lib/
```

For each `:rest_for_one` hit, read the children list and check that everything below the most
likely failure point is either genuinely dependent or cheap to rebuild. That reading is the
whole check; the runtime cannot make it for you.

These greps cannot tell you whether two children in a list actually share state, or whether the
order matches a dependency that only exists at runtime. Those need a read of what each child
touches.
