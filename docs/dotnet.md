---
language: ".NET/C#"
tag: "csharp"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for .NET / C# assets."
---

# Documentation Hub: .NET/C#

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`*.csproj`,
> `*.sln`). Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.
>
> **Status**: 5 rules covering cancellation, discarded tasks, task composition, the
> thread-pool starvation folklore, and hosted background work. Synthesized against .NET 10 /
> ASP.NET Core 10 documentation. The async sections (1–3) apply to any C# with `async`; rule 4
> applies wherever the thread pool is contended; rule 5 is ASP.NET Core only.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/dotnet/cancellation-token-is-a-parameter-not-ambient-state.md`
  - **Why**: A `CancellationToken` is delivered through a parameter, never ambiently. The single highest-value sentence in the docs is on `Task.Run`: *"Run(Action, CancellationToken) does not pass cancellationToken to action."* — the overload's token gates scheduling only, so a delegate that looks cancellable is not.
  - **When**: Target project has `async` methods that accept a `CancellationToken`, or any `Task.Run` in the source.
  - **Target Location**: `docs/rules/dotnet/cancellation-token-is-a-parameter-not-ambient-state.md`

- **Path**: `rules/dotnet/fire-and-forget-hides-exceptions.md`
  - **Why**: A faulted task holds its exception until something applies `await`. Nobody awaits a discarded task, so the failure is unobservable — and since .NET 4.5 it does not crash the process. Discarding the return value is the anti-pattern, not `Task.Run` itself.
  - **When**: Target project discards a `Task` (fire-and-forget, `_ =`, or an un-awaited `Task.Run`), or shows CS4014 suppressions.
  - **Target Location**: `docs/rules/dotnet/fire-and-forget-hides-exceptions.md`

- **Path**: `rules/dotnet/whenall-does-not-cancel-and-linked-cts-is-or-only.md`
  - **Why**: Aggregating work is not aggregating cancellation. `Task.WhenAll` completes but does not cancel; `CreateLinkedTokenSource` is OR-only across all four overloads with no AND variant; and `await Task.WhenAny(...)` alone surfaces no exception because you awaited the wrapper, not the inner task.
  - **When**: Target project uses `Task.WhenAll`, `Task.WhenAny`, or `CreateLinkedTokenSource` — fan-out/fan-in code of any shape.
  - **Target Location**: `docs/rules/dotnet/whenall-does-not-cancel-and-linked-cts-is-or-only.md`

- **Path**: `rules/dotnet/setminthreads-is-not-the-starvation-fix.md`
  - **Why**: The docs document the folklore remedy and then name five mechanisms by which it degrades performance. The first — more worker threads scheduled even when nothing is blocked — makes a *healthy* pool look starved, which is how the folklore got written. Scoped as a temporary workaround for blocking, with a caution attached.
  - **When**: Target project calls `ThreadPool.SetMinThreads`, or shows thread-pool queue latency alongside blocking calls (`.Result`, `.Wait()`, `Task.Run` around I/O).
  - **Target Location**: `docs/rules/dotnet/setminthreads-is-not-the-starvation-fix.md`

- **Path**: `rules/dotnet/backgroundservice-over-task-run-for-hosted-work.md`
  - **Why**: `BackgroundService` makes the host block in `StopAsync` waiting on your task — the reference a fire-and-forget lacks. Cancellation arrives as a required parameter, the 30-second `ShutdownTimeout` bounds non-cooperation, and the `Func<CancellationToken, ValueTask>` work-item signature makes non-propagation a compile error. `PeriodicTimer` replaces `System.Threading.Timer` because the tick is awaited, so iterations cannot overlap.
  - **When**: Target project is ASP.NET Core and has work outliving a request — background jobs, polling loops, timers, queue consumers.
  - **Target Location**: `docs/rules/dotnet/backgroundservice-over-task-run-for-hosted-work.md`

## 2. Skills (`skills/`)

- **Path**: `skills/dotnet/modernize-net-framework-to-sdk/SKILL.md`
  - **Why**: The migration tooling landscape shifted under the old guides — `try-convert` is archived and .NET Upgrade Assistant is deprecated in favour of the GitHub Copilot upgrade agent. The skill stages prepare-under-Framework, assess with the Platform Compatibility Analyzer, convert to SDK-style, then validate before modernizing — so the conversion is not mistaken for the migration.
  - **When**: Target project still targets .NET Framework (pre-.NET 5 `TargetFrameworkVersion` csproj) and is moving to .NET 8+, or builds against Windows-only APIs during such a port.
  - **Target Location**: `docs/skills/dotnet/modernize-net-framework-to-sdk/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/dotnet/agent.json`
  - **Why**: Helps with .NET/C#-related tasks, such as migration, cancellation patterns, and other .NET best practices.
  - **When**: Target project has a `.csproj` or `.sln` file.
  - **Target Location**: `docs/agents/dotnet/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/git/machine-generated-files.md`
  - **Why**: Most ecosystems commit at least one file their own toolchain rewrites. A merge conflict in those files is not a prose conflict, and the three-field diff tool you would reach for is the wrong tool. This is about telling generated files from authored ones, and knowing which regeneration command belongs to each.
  - **When**: A merge or rebase stops with a conflict in `go.sum`, `uv.lock`, `packages.lock.json`, `gradle-wrapper.jar`, or a similar artifact.
  - **Target Location**: `docs/git/machine-generated-files.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
