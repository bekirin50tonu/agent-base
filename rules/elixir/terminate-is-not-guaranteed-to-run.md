---
title: "terminate/2 is documented as guaranteed and is not"
rule_id: "RULE-ELIXIR-001"
category: "architecture"
scope: "backend"
applies_to: "Elixir, OTP, GenServer"
last_updated: "2026-10-04"
source: "https://hexdocs.pm/elixir/GenServer.html"
---

# terminate/2 is documented as guaranteed and is not

A GenServer's `terminate/2` callback is the place cleanup belongs, and its documentation
says so in the first sentence: *"Invoked when the server is about to exit. It should do any
cleanup required."* Twenty words later the same entry states that it *"is not guaranteed that
terminate/2 is called when a GenServer exits. Therefore, important cleanup should be done using
process links and/or monitors."*

The default reading of that callback is "the shutdown hook". It is not. It is one of five
conditions under which cleanup may run, and the case that fires most often in production — an
exit signal from a linked process — is one of the four that skip it. A supervisor escalating
after a timeout, a `:brutal_kill` child spec, a `:kill` from a peer: each produces a shutdown
that looks orderly in the logs and releases nothing.

Because `terminate/2` runs *after* the mailbox drains, even the cases where it does run are
not a clean stop. It is a hook for a process that got to finish what it already had.

## Why

Cleanup that only exists in `terminate/2` is cleanup that is skipped exactly when it is most
needed — during the failures cleanup exists for. The resource being released (a connection, a
subscription, a temp file, a lease) has no other owner, so the skip is invisible: the handle is
gone from the process table and still live in the world.

The four documented skips are not edge cases to be defended against individually. Two of them —
a timeout that expires mid-cleanup, and a non-`:normal` signal from any linked process — are
ordinary operating conditions of a supervised system, and the fourth (a `:kill` before the
mailbox drains) is what a supervisor's own shutdown sequence can produce.

## Do

- Put the authoritative cleanup behind a linked owner: the supervision tree, a linked process
  that traps exits, or a monitor in a separate process that owns the resource.
- Treat `terminate/2` as a convenience for the graceful path only — flushing a buffer,
  closing a socket you opened in the same callback.
- Give child specs a `:shutdown` timeout long enough for the cleanup that actually needs to run;
  `:worker` defaults to 5,000 ms.
- Set `:brutal_kill` only where there is genuinely nothing to release, and say which that is.

```elixir
# Correct — the linked supervisor owns the handle; terminate/2 is a courtesy
def start_link(opts) do
  GenServer.start_link(__MODULE__, opts, name: __MODULE__)
end

def init(opts) do
  conn = open_connection(opts)
  # The link to the caller is the lifetime guarantee. If this process is
  # killed outright, the caller's own shutdown runs and closes the handle.
  {:ok, conn}
end

def terminate(_reason, conn) do
  graceful_close(conn)   # runs only on the paths that allow it
end

# Incorrect — sole ownership, and no link carries it out
def init(opts) do
  {:ok, File.open!(opts[:path], [:write])}
end

def terminate(_reason, file) do
  File.close(file)   # skipped on :kill, on brutal_kill, on timeout escalation
end
```

## Don't

- Don't put the only release of an externally-held resource in `terminate/2`.
- Don't assume a logged `GenServer ... terminating` means cleanup ran — read the exit reason.
- Don't rely on `terminate/2` for work that must complete before the caller proceeds; use a
  `GenServer.stop/3` with an explicit reason and wait for the `:DOWN`.
- Don't set a short `:shutdown` on a child whose `terminate/2` does real work — the timeout
  escalates to an immediate kill partway through it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Port or subscription leak count climbs with restarts | Cleanup only in `terminate/2`, skipped on the signalling path | Move ownership to a linked or monitored process; keep `terminate/2` for the graceful case |
| `terminate/2` logs appear on clean deploys but not on crashes | Documented skip — signal from a linked process, or `:kill` before the mailbox drained | Not a bug in the callback; the resource needs a second owner |
| Child exits `:killed` during shutdown, no cleanup log | Supervisor timeout expired while `terminate/2` was still running | Raise the child spec's `:shutdown` to cover the real cleanup time |
| Cleanup runs twice | Resource held by two owners, one of which also cleans up | Give it exactly one owner; the monitor observes, it does not release |
| Graceful restart leaves stale rows | `terminate/2` never ran, so the release step was skipped | Same as the first row — an owner outside the process |

## Verifying

```bash
# Every terminate/2 in the codebase — these are the cleanup paths that can be skipped
grep -rn --include='*.ex' --include='*.exs' 'def terminate' lib/ test/

# Where those cleanups acquire something external that must be released
grep -rn --include='*.ex' -A20 'def init' lib/ | grep -E 'File\.open|:gen_tcp\.connect|Phoenix\.PubSub\.subscribe|HTTPoison\.(get|post)|Ecto\.Adapters\.SQL\.query|:ets\.new|:global\.register'

# brutal_kill children: no cleanup path exists at all for these
grep -rn --include='*.ex' 'brutal_kill' lib/ config/

# Explicit exit signals — the other documented way to skip terminate/2
grep -rn --include='*.ex' --include='*.exs' 'Process\.exit(' lib/ test/
```

For each hit in the second list, ask who releases the handle if the process is killed with
`:kill`. If the answer is only "the `terminate/2` callback", the resource leaks on that path.

This grep set cannot tell you whether a cleanup is fast enough to finish inside its `:shutdown`
window, or whether a link actually exists for the owner you have in mind. Those need a
measurement and a reading of the supervision tree respectively.
