---
title: "Elixir / OTP — what to reach for, and what its default costs you"
category: "concurrency"
scope: "backend"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/Supervisor.html"
---

# Elixir / OTP — what to reach for, and what its default costs you

Five questions decide nearly every case in an OTP codebase. They do not line up with the module
names — `:restart` lives in a child spec, the strategy lives in the supervisor, and neither is
mentioned by the callback you are writing — so each answer below names the mechanism *and* the
default it ships with, because in OTP the default is nearly always the more permissive choice and
the failure is the default behaving exactly as documented.

This sits one level below `RULE-ELIXIR-001` … `RULE-ELIXIR-006`, which explain each mechanism.
This matrix is for choosing between them.

## The five questions

1. **May this process's state be lost?** No → `:restart: :permanent` (the default). If it holds a
   connection or lease → `:transient`. Once per boot → `:temporary`. (`RULE-ELIXIR-003`)
2. **Must cleanup survive a crash?** Yes → `Process.monitor/1` from a process that outlives it,
   not `terminate/2`. (`RULE-ELIXIR-001`)
3. **Should this work's failure reach the caller?** Yes → `Task.async` (linked, on purpose). No →
   `Task.Supervisor.async_nolink` + `Task.yield` + `Task.shutdown`. (`RULE-ELIXIR-002`)
4. **Is the fan-out bounded?** No → set `:max_children` explicitly; consider `PartitionSupervisor`
   once the single supervisor is the bottleneck. (`RULE-ELIXIR-005`)
5. **Are the children independent?** No → `:rest_for_one` with the list in dependency order.
   Peers → `:one_for_all`. Truly independent → `:one_for_one`. (`RULE-ELIXIR-004`)

## The defaults, in one table

Each is correct for the common case, and each is a silent failure in the other one.

| Decision | Shipped default | The default's failure |
|---|---|---|
| `:restart` | `:permanent` | State silently reset; a restart is indistinguishable from a cold start |
| `:shutdown` (worker) | `5_000` | A slow `terminate/2` is killed partway through its cleanup |
| `:shutdown` (supervisor) | `:infinity` | A hung sub-tree never lets the application terminate |
| `:type` | `:worker` | The `:shutdown` default read in isolation is the wrong number |
| `:max_children` | `:infinity` | Unbounded growth; the documented `{:error, :max_children}` is unreachable |
| `DynamicSupervisor` strategy | `:one_for_one` only | No wider restart scope exists for dynamically-started work |
| `select!` branch order | randomised | Order-dependent bugs are intermittent, not fixed |
| Endpoint `:server` | `false` | Fine — `mix phx.server` sets it; a bare `mix run` serves nothing while looking started |
| Endpoint `:secret_key_base` | `nil` | Fails at the first signed cookie, not at boot |
| `Ecto.Multi` function variants | skip validation | The transaction starts before changesets are checked |

The last two rows are from the framework layer and belong here because they are the same shape of
defect: a default that is right in development and fails in production, at a moment far from boot.

## The package-matching trap

The pattern this matrix is built around is not "which module is recommended" but whether that
module's own default is a *second* silent failure. `Ecto.Multi` is the clearest case — the same
operation validates differently depending on its argument shape:

> If a Multi contains operations that accept changesets (like insert/4, update/4 or delete/4), they
> will be checked before starting the transaction. If any changeset has errors, the transaction will
> not be started and the error will immediately be returned.
> ([Ecto.Multi](https://hexdocs.pm/ecto/Ecto.Multi.html))

> Note: insert/4, update/4, insert_or_update/4 and delete/4 variants that accept a function do not
> perform these checks since the functions are executed after the transaction has started.
> ([Ecto.Multi](https://hexdocs.pm/ecto/Ecto.Multi.html))

| Problem class | Package | Its default's second-order risk |
|---|---|---|
| Cleanup that must survive a crash | `Process.monitor/1` (stdlib) | The monitor must be registered by a process that survives |
| Bounded dynamic work | `Task.Supervisor` | `max_children` is `:infinity`; it is a single process |
| Fan out dynamic supervisors | `PartitionSupervisor` | Key by `self()` or the routing benefit disappears |
| Retry a crashed process | the `restart:` child-spec key | `:permanent` erases the distinction between crash and stop |
| Observe restarts | `:telemetry` supervisor events | A handler attaches by event name; a typo drops it silently |
| Multi-write transaction | `Ecto.Multi` | The function variants skip pre-transaction validation |
| Share mutable state | `Agent` | Read-then-compute outside loses updates |
| Configure the web tier | `Phoenix.Endpoint` | Compile-time vs runtime split; `secret_key_base` is `nil` |

## Three rules that hold across the whole matrix

1. **Write the non-default explicitly at every call site.** `restart:`, `:max_children`,
   `strategy:`. The defaults are correct and their silence is the defect.
2. **Cleanup that must not be skipped cannot live in the process it protects.**
3. **Any list order that encodes a dependency is unenforced** — the supervisor has a list, not a
   graph.

## Verifying

```bash
# Decisions made by omission -- each inherits the shipped default
grep -rn --include='*.ex' -E '^\s*\{[A-Z][A-Za-z0-9_.]*,' lib/ | grep -v 'restart:'
grep -rn --include='*.ex' -A4 'DynamicSupervisor.start_link' lib/ | grep -v 'max_children'

# Strategies in play, against the children lists they act on
grep -rn --include='*.ex' -E 'strategy: :[a-z_]+' lib/ config/
grep -rln --include='*.ex' 'children = \[' lib/ | xargs grep -n -A20 'children = \['

# Failure containment
grep -rn --include='*.ex' 'Task\.async\b' lib/ test/

# Cleanup that only exists where it can be skipped
grep -rn --include='*.ex' 'def terminate' lib/ test/
```

Read the first list in order and ask, for each entry, whether a second attempt makes sense. Read
the strategy list against the children lists and ask what is written *below* each entry — that
positional question, not a blast-radius one, is what `:rest_for_one` acts on.

None of these greps can tell you whether `:transient` is right for a child whose failure modes
you have not enumerated, whether an `Agent` value is genuinely write-once, or whether two
children in a list actually share state. Those need the child's own failure analysis and a read
of what each child touches.
