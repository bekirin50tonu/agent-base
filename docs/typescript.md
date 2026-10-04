---
language: "TypeScript"
tag: "typescript"
ecosystem: "frontend"
last_updated: "2026-10-04"
summary: "Routing hub and decision matrix for TypeScript assets."
---

# Documentation Hub: TypeScript

> **Agent Directive (Phase 4)**: Inspect the target project's dependencies (`package.json`,
> `tsconfig.json`, `compilerOptions`). Match the conditions below to determine which `rules`,
> `skills`, `agents`, or `shared` assets to inject.
>
> **Scope**: this hub is the TypeScript *type system and compiler configuration* — how the checker
> decides what is safe, and what it declines to check. It does **not** cover the JavaScript language
> semantics every TypeScript program runs on (`rules/javascript/`, `docs/javascript.md`), the
> runtime (`rules/nodejs/`, `docs/nodejs.md`), or any framework (`docs/react.md`, `rules/nestjs/`).
> If the defect is "the language did something JavaScript specifies", this is not the hub. If the
> defect is "the compiler agreed to code it will not check at runtime", it is.
>
> **Overlap**: the strict-adoption skill and the agent are routed here *and* from `docs/react.md`
> and `docs/javascript.md`, deliberately — a non-React TypeScript project should not have to
> resolve a framework hub to reach them. The files are one; a manifest may point at them from more
> than one hub.
>
> **Status**: nine rules, all on places where a type check either did not run, ran on a different
> axis than the author expects, or reported nothing they were reading for. No new `skills` and no
> `shared` assets yet.
>
> **Version note**: written against the TypeScript handbook's current documentation. Two rules turn
> on options whose defaults are *derived from other options* rather than fixed — `isolatedModules`
> and `preserveConstEnums` both default to `true if verbatimModuleSyntax; false otherwise` — so
> read `--showConfig` rather than assuming a value from an absent key. TypeScript 7.0 is released,
> so any config-level default below must be re-checked against the deployed version.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/typescript/any-is-assignable-in-both-directions.md`
  - **Why**: `any` is the only type assignable in *both* directions — the handbook states that
    `any` and `unknown` are "the same in terms of what is assignable to them, different in that
    unknown is not assignable to anything except any." So `unknown` is permissive inbound and
    inert outbound, while `any` is inert neither way and one `any` in a return type makes the whole
    call chain unchecked, with nothing red in the build.
  - **When**: Target project uses `any`, `as any`, `Array<any>`, or `JSON.parse` without an
    `unknown` annotation.
  - **Target Location**: `docs/rules/typescript/any-is-assignable-in-both-directions.md`

- **Path**: `rules/typescript/no-unchecked-indexed-access-is-off-by-default.md`
  - **Why**: The flag defaults to `false`, so `arr[0]` and `record[key]` are typed `T` rather than
    `T | undefined` — the compiler has promised a value that may not exist, which is the mechanism
    behind a large share of clean-build `TypeError: Cannot read properties of undefined` reports.
  - **When**: Target project indexes into arrays, tuples, or `Record`s, or reads `arr[0]` /
    `arr[arr.length - 1]` as a "safe" form.
  - **Target Location**: `docs/rules/typescript/no-unchecked-indexed-access-is-off-by-default.md`

- **Path**: `rules/typescript/strict-null-checks-decides-whether-null-is-a-value.md`
  - **Why**: With `strictNullChecks` off, "values that might be null or undefined can still be
    accessed normally, and the values null and undefined can be assigned to a property of any
    type" — the handbook calls that "a major source of bugs." The flag is part of `strict`, so
    `strict: false` to adopt one other option silently disables it too.
  - **When**: Target project sets `strict: false`, annotates a field `T` that can be absent, or has
    nullable annotations that no compiler error ever enforces.
  - **Target Location**: `docs/rules/typescript/strict-null-checks-decides-whether-null-is-a-value.md`

- **Path**: `rules/typescript/assignability-is-checked-against-the-declared-type.md`
  - **Why**: Narrowing is a read property that follows control flow; assignability is a write
    property that does not. The handbook's own example assigns a string to a variable the compiler
    has just displayed as `number`, because "assignability is always checked against the declared
    type." That gap is what makes closure-captured reassignment fail silently.
  - **When**: Target project reassigns a narrowed `let`, captures a narrowed binding in a closure,
    or mutates a parameter its caller also holds.
  - **Target Location**: `docs/rules/typescript/assignability-is-checked-against-the-declared-type.md`

- **Path**: `rules/typescript/in-narrowing-keeps-optional-properties-in-both-branches.md`
  - **Why**: "optional properties will exist in both sides for narrowing" — a member with an
    optional property survives an `in` check on *both* branches, so the narrowing looks like it
    discriminated and did not. With `Fish | Bird | Human`, both branches still contain `Human`.
  - **When**: Target project narrows a union with the `in` operator, especially where the union has
    optional members, and there is no discriminant property.
  - **Target Location**: `docs/rules/typescript/in-narrowing-keeps-optional-properties-in-both-branches.md`

- **Path**: `rules/typescript/module-setting-decides-whether-node-compatibility-is-checked.md`
  - **Why**: "The compiler's output is not checked for Node.js compatibility unless `module` is set
    to `node16`, `node18`, or `nodenext`" — a documented absence. `module: esnext` with
    `moduleResolution: bundler` is coherent and widely used, and it means imports are never
    validated for the runtime that will execute them.
  - **When**: Target project has `module` set to anything other than `node16`/`node18`/`nodenext`,
    and runs in Node.js, ships as a CLI or library, or uses extensionless or directory imports.
  - **Target Location**: `docs/rules/typescript/module-setting-decides-whether-node-compatibility-is-checked.md`

- **Path**: `rules/typescript/double-default-from-node-esmodule-detection.md`
  - **Why**: Node.js "always synthesizes a default export" while a transpiled module only does so
    without the `__esModule` flag, "creating a 'double default'." Named imports diverge more
    sharply: transpiled modules resolve them at *runtime*, Node.js "uses syntactic analysis to
    synthesize named exports before any code executes," so a computed key works in the build and
    throws in native ESM.
  - **When**: Target project default-imports or named-imports from a CommonJS dependency, or ships
    both CJS and ESM builds.
  - **Target Location**: `docs/rules/typescript/double-default-from-node-esmodule-detection.md`

- **Path**: `rules/typescript/isolated-modules-default-follows-verbatim-module-syntax.md`
  - **Why**: Some option defaults are expressions, not literals: `isolatedModules` and
    `preserveConstEnums` are both "`true if verbatimModuleSyntax; false otherwise`," `incremental`
    is "`true if composite; false otherwise`." A config that "doesn't set isolatedModules" may have
    it on, and the difference surfaces only in a per-file transpiler, not under `tsc`.
  - **When**: Target project runs esbuild, swc, Babel, `ts-jest`, Vite, or Next.js, or reads any
    compiler option's value from `tsconfig.json` rather than from `--showConfig`.
  - **Target Location**: `docs/rules/typescript/isolated-modules-default-follows-verbatim-module-syntax.md`

- **Path**: `rules/typescript/non-null-assertion-changes-no-runtime-behaviour.md`
  - **Why**: `!` "remove[s] null and undefined from a type without doing any explicit checking," and
    "doesn't change the runtime behavior of your code" — so it is a claim, never a guard. It
    converts a compile error you would have received into a `TypeError` you will receive.
  - **When**: Target project uses `!` on a parameter, an external value, or an index access, or uses
    `as` to silence a mismatch at a trust boundary.
  - **Target Location**: `docs/rules/typescript/non-null-assertion-changes-no-runtime-behaviour.md`

## 2. Skills (`skills/`)

- **Path**: `skills/typescript/adopt-strict-checking-gradually/SKILL.md`
  - **Why**: Provides a gradual migration path to strict TypeScript checking, helping teams
    adopt stricter type safety without blocking development on immediate breaking changes.
  - **When**: Target project uses TypeScript and wants to incrementally increase type
    checking strictness (e.g., moving from `noImplicitAny: false` to `true`).
  - **Target Location**: `docs/skills/typescript/adopt-strict-checking-gradually/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/typescript/agent.json`
  - **Why**: TypeScript tasks where a type check did not run, ran on a different axis than expected,
    or reported nothing that was being read for — `any` where `unknown` keeps the chain checked,
    indexing with `noUncheckedIndexedAccess` off, `strictNullChecks` off, narrowing read as a
    constraint on assignment, `in` checks that do not exclude, a `module` setting that leaves
    Node.js unchecked, the `__esModule` double default, derived option defaults, and `!`/`as`
    performing no runtime check.
  - **When**: Target project has a `tsconfig.json` and any of `any`, index access, nullability,
    narrowing, or `module`/`moduleResolution` configuration.
  - **Target Location**: `docs/agents/typescript/agent.json`

## 4. Shared Assets (`shared/`)

_None yet._

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.