---
name: upgrade-toolchain-and-language-version
description: "Upgrade a Go module across releases. Use when bumping go.mod or GOTOOLCHAIN, when a newer Go is available, or when auditing behaviour changes before a version bump."
version: "1.0.0"
tags:
  - go
  - migration
  - toolchain
---

# Upgrade a Go Module: Toolchain and Language Version Are Two Axes

The single most common mistake in a Go upgrade is treating the version bump as one atomic
act. It is two acts, on different schedules, with different rollback, and only one of them
can break production.

## Why

The Go 1.21 release notes state the independence outright:

> Upgrading to a new Go toolchain but leaving the go line set to its original (older) Go
> version preserves the behavior of the older toolchain. With this compatibility support, the
> latest Go toolchain should always be the best, most secure, implementation of an older
> version of Go.
> — https://go.dev/doc/go1.21

So the two axes are:

| Axis | What it is | Risk | Rollback |
|---|---|---|---|
| **Toolchain** — the `go` binary | compiler/runtime fixes, security patches | near zero | reinstall a binary |
| **Language version** — the `go` line in go.mod | selects which semantics apply | **this is the risky one** | not one edit; behaviour may have shipped |

The safety mechanism is a precedence chain, from https://go.dev/doc/godebug:

> When a GODEBUG setting is not listed in the environment variable, its value is derived from
> three sources: the defaults for the Go toolchain used to build the program, amended to match
> the Go version listed in go.mod, and then overridden by explicit //go:debug lines.

Read that as: **toolchain defaults → amended down to your `go` line → `//go:debug`.** A newer
toolchain tries to behave like an older one.

## Step 1 — Bump the toolchain, not the `go` line

This is free and it is the officially recommended move.

```bash
go version
go get toolchain@latest    # or set GOTOOLCHAIN=go1.27.1
go build ./... && go test ./...
```

Leave the `go` line alone. This step cannot change your language semantics.

**Do not skip this step**, and do not defer it "until the migration is ready" — a newer
toolchain is the more secure implementation of your *existing* version.

## Step 2 — Read the GODEBUG history for every release you will cross

The toolchain refuses a `go` line newer than itself, and that refusal was backported into old
release lines specifically to make it loud. But that covers only Class A below. This step is
the main audit surface, and it is a *document*, not a tool.

Fetch https://go.dev/doc/godebug and list the settings for each release between your current
`go` line and your target.

## Step 3 — Classify every change as loud or silent

The classification that makes this tractable is not "additive vs. breaking". It is **loud vs.
silent**. A change that fails to compile costs one CI cycle. A change that compiles and
behaves differently is the only thing that can reach production.

**Class A — loud. Let the compiler find them.** Anything the compiler gates on the language
version. Since 1.23 there is a named analyzer:

> The go vet subcommand now includes the stdversion analyzer, which flags references to symbols
> that are too new for the version of Go in effect in the referring file.
> — https://go.dev/doc/go1.23

**Class B — silent, `go`-line-gated, with a GODEBUG rollback.** The workhorses. Audit each
against your code:

| Release | Setting | Behaviour change |
|---|---|---|
| 1.21 | `panicnil` | `panic(nil)` is a run-time error |
| 1.22 | `httpmuxgo121` | ServeMux accepts extended patterns |
| 1.22 | `httplaxcontentlength` | empty `Content-Length` is an error |
| 1.22 | `tls10server` | default minimum TLS raised to 1.2 |
| 1.22 | `tlsrsakex` | RSA key-exchange suites removed from defaults |
| 1.23 | `asynctimerchan` | timer channels become unbuffered; `len`/`cap` return 0 |
| 1.23 | `x509keypairleaf` | `tls.X509KeyPair` populates `Certificate.Leaf` |
| 1.24 | `randseednop` | global `math/rand.Seed` becomes a no-op |
| 1.25 | `containermaxprocs` | cgroup CPU limit considered for `GOMAXPROCS` |
| 1.25 | `updatemaxprocs` | `GOMAXPROCS` updated periodically |

The TLS rows are the ones that bite hardest: they change which handshakes succeed against old
servers, which is an infrastructure-visible failure, not a code-visible one.

**Class C — silent, gated, and NO GODEBUG rollback. These need human judgement.**

**Loop variables (1.22) has no GODEBUG setting.** The `go` line itself was the switch:

> To make the breakage completely user controlled, the way the rollout would work is to change
> the semantics based on the go line in each package's go.mod file […] Just this once, we would
> use the line for changing semantics instead of for adding a feature or removing a feature.
> — rsc, https://github.com/golang/go/discussions/56010

**Package init order (1.21) also has no GODEBUG**, and the notes flag it:

> This may change the behavior of some programs that rely on a specific initialization ordering
> that was not expressed by explicit imports. **The behavior of such programs was not well
> defined by the spec in past releases.**
> — https://go.dev/doc/go1.21

"not well defined by the spec in past releases" is the tell — the Go team is saying those
programs relied on undefined behaviour and will not spend a compatibility knob on them.

**Class D — silent, and NOT gated by the `go` line at all.** These arrive with the toolchain,
which is why Step 1 is not *entirely* free. **They are invisible in a `go.mod` diff.**

- **1.22 allocator alignment** — some objects drop from 16-byte to 8-byte alignment. Revert:
  `GOEXPERIMENT=noallocheaders`.
- **1.22 transparent huge pages** — *"a common default Linux kernel configuration can result in
  significant memory overheads"*. Revert: `disablethp`.
- **1.26 Green Tea GC on by default** — a GC algorithm swap. Revert: `GOEXPERIMENT=nogreenteagc`,
  and *"expected to be removed in Go 1.27"*.

## Step 4 — Audit the code shapes for Class C

```bash
# Class C: the classic loop-var capture shape — a closure or pointer escaping the iteration
grep -rn 'go func\|&[a-z]' --include=*.go . | grep -v _test.go
grep -rn 'for .*:= range' --include=*.go . | wc -l

# Class C: implicit init-order reliance
grep -rn 'func init()' --include=*.go . | wc -l
```

Go's own corpus measured roughly **1 in 2,000 tests** failing under the new loop semantics, with
most being genuine latent bugs. Rare per release, cumulative across five releases.

## Step 5 — Stage the `go` line one release at a time

**You cannot hold the `go` line back if a dependency moved forward:**

> A module's go line must declare a version greater than or equal to the go version declared by
> each of the modules listed in require statements. […] if module M requires a dependency D with
> a go.mod that declares go 1.22.0, then M's go.mod cannot say go 1.21.3.
> — https://go.dev/doc/toolchain

The `go` line is a floor that ratchets upward under dependency pressure, ready or not. Treat
staging as a plan, not a deferral.

Per-file staging is available when one module is too coarse — the language version can be
changed per file with a build constraint, so a risky semantic change can be enabled **one file
at a time**.

## Step 6 — Verify by running under the new semantics

Green tests after a `go.mod` bump are not evidence. The loop-var change, the TLS changes, and
the init-order change all compile and pass tests that do not exercise them.

```bash
go vet ./...                    # catches Class A via stdversion
go test -race ./...             # Class D: races the old toolchain hid
go test -count=1 ./...          # no cache
```

## When to stop and escalate

- **A dependency has already forced your `go` line forward** past releases you have not
  audited. Stop; the floor moved without your consent.
- **A GODEBUG you rely on has hit its two-release loan.** Settings are maintained *"for a minimum
  of two years (four Go releases)"*, and Go 1.27 rejects stale values. A `godebug` line is a
  pressure-relief valve for one increment, not a destination.
- **You are on `go 1.18` or earlier.** The GODEBUG floor is Go 1.20, so a `go 1.18` module gets
  1.20 semantics and the `go` line offers you no protection below that. Get to 1.20 first.

## The override that sits above all four classes

**Security-motivated changes apply regardless of the `go` line.**

> As an exception, GODEBUGs introduced for security releases will have the new behavior apply to
> all versions.
> — https://go.dev/doc/godebug

`tlsmaxrsasize` is the canonical example — it was backported to Go 1.19.13, 1.20.8, and 1.21.1.
A module on `go 1.20` gets the new limit anyway, with no opt-out. **No staging strategy
protects against these; they arrive when the security release arrives.**

## Failure modes

| Symptom | Class | Fix |
|---|---|---|
| Build fails naming a too-new symbol | A | expected; let it, then bump deliberately |
| TLS handshake fails against an old server after a bump | B | `tls10server` / `tlsrsakex`; audit TLS config, not code |
| Timer `len`/`cap` returns 0 | B | `asynctimerchan`; unbuffered channels are now the norm |
| `panic(nil)` now aborts | B | `panicnil`; recover will not save you |
| Goroutine closes over the wrong loop value | C | loop-var change; no GODEBUG exists, audit shapes |
| Init order differs, a package sees a zero value | C | 1.21 init-order rule; was never spec-defined |
| Memory grows, `GOMAXPROCS` surprising | D | `containermaxprocs`; Class D, not in your go.mod diff |
| 8-byte assembly assumptions break | D | `GOEXPERIMENT=noallocheaders` |
| Shutdown hangs on a fresh deploy | D | `disablethp`; check kernel THP config |

## Verifying

```bash
# Where you actually are on both axes
go version; grep '^go ' go.mod; go env GOTOOLCHAIN

# Which GODEBUGs are in force right now
go doc runtime 2>/dev/null | head -5
grep -rn '//go:debug' --include=*.go . || echo "no godebug lines pinned"

# Class A sweep
go vet ./...

# Class D: you cannot see these in go.mod — they come with the binary
go env GOEXPERIMENT
```
