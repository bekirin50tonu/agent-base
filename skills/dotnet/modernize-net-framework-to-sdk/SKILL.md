---
name: modernize-net-framework-to-sdk
description: "Migrate a legacy .NET Framework project to SDK-style .NET 8+. Use when a solution still targets .NET Framework and needs to move to modern .NET, including project-file conversion and dependency updates."
version: "1.0.0"
tags:
  - dotnet
  - migration
  - modernization
---

# Modernize .NET Framework to SDK-Style .NET 8+

The tooling landscape changed after most migration guides were written: `try-convert` is
archived (read-only since May 2024), and .NET Upgrade Assistant is officially deprecated
— Microsoft's current guidance says to use it "only if you can't use the modernization
agent." The successor is the GitHub Copilot upgrade / app modernization agent (VS 2026,
VS 2022 17.14.16+), which drives a three-stage workflow of assessment, planning, and
execution. This skill follows the vendor-documented order: **prepare, convert, validate**
— with the compatibility gate being the Platform Compatibility Analyzer plus the
`Microsoft.Windows.Compatibility` pack, not the older `.NET Portability Analyzer`.

## Why

Microsoft's porting overview frames the work in one sentence:

> Porting to .NET from .NET Framework is relatively straightforward for many projects.
> The complexity of your projects dictates how much work you'll need to do after the
> initial upgrade of the project files.
> — https://learn.microsoft.com/en-us/dotnet/core/porting/framework-overview

The load-bearing claim is that the *project file conversion* is the small part, and the
real work is dependency and API compatibility. Teams that treat the conversion as the
migration get a solution that builds and throws `PlatformNotSupportedException` in
production.

## Step 1 — Prepare the project while it still targets .NET Framework

From Microsoft's pre-migration guidance, all of this is doable *before* the port:

- Upgrade tooling (MSBuild / Visual Studio version that also supports the .NET 8 SDK).
- Update the .NET Framework target to 4.7.2 or later.
- Convert `packages.config` to `PackageReference`.
- Update NuGet dependencies to versions that support .NET Standard 2.0.

```xml
<!-- packages.config → PackageReference, in the .csproj: -->
<ItemGroup>
  <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
</ItemGroup>
```

**Exit criterion:** the solution still builds and runs on .NET Framework 4.7.2+, with
`PackageReference`-based dependencies, and the latest packages that still install.

## Step 2 — Assess compatibility before converting

Run the **Platform Compatibility Analyzer** (part of the .NET SDK since .NET 5 — no
separate install) on the project. It flags Windows-only and API-difference call sites
against the target framework:

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>
  <TargetPlatformIdentifier>Windows</TargetPlatformIdentifier>
</PropertyGroup>
```

Review the analyzer warnings and produce a compatibility list:
- Windows-only APIs in use (registry, WMI, `System.Drawing`, etc.).
- Packages with no .NET Standard 2.0 / .NET target.
- App.config / Web.config settings that have no .NET counterpart.

**Exit criterion:** a written inventory of blocking dependencies and Windows-only API
call sites, with a decision for each (replace, shim with the compatibility pack, or
platform-guard).

## Step 3 — Convert the project file to SDK-style

Two paths, in the order Microsoft now recommends:

1. **GitHub Copilot upgrade agent** (preferred when available — VS 2022 17.14.16+ or
   VS 2026). Run it from the solution. It writes its plan under
   `.github/upgrades/{scenarioId}/` as `assessment.md`, `plan.md`, and `tasks.md`, and
   applies the file changes stage by stage. Strategies: `bottom-up` (leaf projects
   first), `top-down`, or `all-at-once`.
2. **Manual SDK-style conversion** (no agent available). Replace the .csproj with the
   SDK-style equivalent and let the defaults absorb what the old file spelled out:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

With SDK-style projects, `AssemblyInfo.cs` attributes, default globs (`**/*.cs`), and
namespace-folder alignment are all implicit — delete the hand-maintained versions
rather than porting them.

**Exit criterion:** every project file carries `<Project Sdk="...">`, targets
`net8.0` (or later), and `dotnet build` succeeds with zero errors.

## Step 4 — Resolve dependencies and Windows-only APIs

For each item on the Step 2 inventory:

- **Cross-platform replacement**: prefer it when one exists.
- **Windows-only API, app stays Windows-only**: add the compatibility pack:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.Windows.Compatibility" Version="8.0.x" />
</ItemGroup>
```

  The pack surfaces ~20,000 Windows-specific APIs (registry, WMI, EventLog,
  DirectoryServices, `System.Drawing`...) as .NET-compatible — it makes the code
  *build*, not *run on Linux*.
- **Windows-only API, cross-platform target needed**: platform-guard the call site:

```csharp
if (OperatingSystem.IsWindows())
{
    // Windows-only API call
}
```

**Exit criterion:** `dotnet build` succeeds with no CA1416 (platform-compat)
warnings suppressed wholesale, and every inventory item has a resolution recorded.

## Step 5 — Migrate configuration

`App.config` / `Web.config` and their transforms have no .NET counterpart. Move
settings to `appsettings.json` with the `IOptions<T>` pattern:

```csharp
builder.Services.Configure<MyOptions>(builder.Configuration.GetSection("MySection"));
```

**Exit criterion:** no runtime configuration read from `System.Configuration`
remains; configuration loads from the new provider.

## Step 6 — Validate, then modernize

Validation first — the app runs, the test suite passes, manual smoke tests on the
platforms you ship to. Modernization is deliberately *after* validation, not mixed
into it: dependency injection, `appsettings.json`, host startup, cloud readiness.

**Exit criterion:** the application runs on the new target framework, tests pass, and
the team has explicitly accepted or deferred each modernization item.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Build succeeds, runtime throws `PlatformNotSupportedException` | Windows-only API used without the compatibility pack or a platform guard | Add `Microsoft.Windows.Compatibility` if the app stays Windows-only; platform-guard or replace otherwise |
| Dependency resolution fails after SDK conversion | `packages.config` not converted, or a package has no .NET-compatible target | Re-run the Step 1 package conversion; check each package's TFM support on nuget.org |
| Analyzer floods with CA1416 warnings | Compatibility analyzer enabled without an inventory | Do Step 2 first; suppress per-call-site with justification, never wholesale |
| Missing app settings at runtime | `App.config` transforms not migrated | Move the values to `appsettings.json`; the old transform pipeline does not run |
| Copilot upgrade agent produces a plan but no changes | Agent stops at the assessment/planning stage and waits for approval | Open `.github/upgrades/{scenarioId}/plan.md`, review, and approve the tasks |

## Verifying

- `dotnet build` succeeds with no errors and no unsuppressed CA1416 warnings.
- `git grep -l "System.Configuration"` returns nothing (config migration complete).
- `dotnet list package --include-transitive | grep -i netstandard` — every direct
  dependency resolves to a .NET-compatible target.
- The application's smoke tests pass on every platform you ship.

## When to stop and escalate

- The Platform Compatibility Analyzer inventory lists an API with no replacement and
  no compatibility-pack coverage — that is a redesign decision, not a migration step.
- A core dependency has no .NET target and no maintained successor — the migration is
  blocked until it is replaced or forked.
- The solution mixes web, desktop, and service projects with different target
  platforms — split the migration per project type before proceeding.

## Limits of this skill

- Covers .NET Framework → .NET 8+. Not verified for .NET Core 1.x–3.1 → 8+ paths
  (broadly similar, but the tooling guidance predates the agent workflow).
- Azure migration specifics are out of scope — Microsoft documents that as a separate
  Copilot modernization path.
- The Copilot upgrade agent's exact capabilities were sourced from vendor docs only;
  no practitioner corroboration is included.
- Does not cover IIS-specific hosting migration to ASP.NET Core hosting in depth.