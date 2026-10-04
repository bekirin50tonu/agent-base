---
title: "`isolatedModules`' default follows `verbatimModuleSyntax`, not a constant"
rule_id: "RULE-TYPESCRIPT-008"
category: "correctness"
scope: "all"
applies_to: "isolatedModules, verbatimModuleSyntax, preserveConstEnums, incremental, noImplicitAny, tsconfig"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/compiler-options.html"
---

# `isolatedModules`' default follows `verbatimModuleSyntax`, not a constant

Some compiler options have defaults that are themselves derived from other options. The reference
states them as expressions rather than literals, so setting one flag silently changes what the
others mean — and the effective value of `isolatedModules` depends on a flag a config may not
mention at all.

## Why

The compiler options reference gives `isolatedModules` its definition:

> Ensure that each file can be safely transpiled without relying on other imports.
> ([tsc CLI Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html))

and records its default as **`true if verbatimModuleSyntax; false otherwise`** — an expression, not a
literal. `preserveConstEnums` carries the identical conditional default. Two further entries on the
same page derive the same way: `incremental` is `true if composite; false otherwise`, and
`noImplicitAny`/`noImplicitThis` are `true if strict; false otherwise`.

```jsonc
// What the config says:
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}

// What the compiler resolves:
//   isolatedModules      -> true  (derived)
//   preserveConstEnums  -> true  (derived)
// A config that "doesn't set isolatedModules" has it on.
```

So setting one flag turns on two others as a side effect, and neither appears in the config file. A
config that reads `isolatedModules` as "off unless I set it" is wrong in one direction; a config
that reads it as "on because we're modular" is wrong in the other. Neither mistake is visible in
the source, and both surface as a build error from a *transpiler* (`esbuild`, `swc`, Babel, ts-jest)
that honours `isolatedModules` — not from `tsc`, which applies different rules when compiling a
whole program at once.

The related option, for contrast, is `verbatimModuleSyntax` itself:

> Do not transform or elide any imports or exports not marked as type-only, ensuring they are
> written in the output file's format based on the 'module' setting.
> ([tsc CLI Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html))

It governs whether `import type` is erased, which is why it is the one whose default propagates:
turning it on makes the erasure rule uniform across tools, and `isolatedModules` follows from that.

## Do

- Read `--showConfig` output rather than the tsconfig file when you need to know an effective
  option value. It is the only place derived defaults are resolved.
- Set the options whose values your build depends on **explicitly**, even when the derived default
  happens to match. An explicit `false` overrides the derivation and makes the intent readable.
- Enable `isolatedModules` in any project that runs a transpiler per-file (`esbuild`, `swc`,
  Babel, `ts-jest`, Vite, Next.js). It is the flag that tells the compiler the per-file constraint
  it cannot otherwise assume.
- Keep `verbatimModuleSyntax` and `isolatedModules` in agreement; they are documented to move
  together and a mismatch produces per-file errors that do not reproduce under `tsc`.
- Use `import type` for type-only imports in a project with `verbatimModuleSyntax` on, so the
  import is erased rather than left in the output.
- Check the effective options of a published library as well as an application — a library's
  `isolatedModules` affects every consumer's transpiler.

## Don't

- Don't read a missing key in `tsconfig.json` as a fixed default. For derived options, absence
  means "whatever the other flag says".
- Don't assume `isolatedModules: false` is the state of a config that omits it while
  `verbatimModuleSyntax: true` is set — it is on.
- Don't toggle `verbatimModuleSyntax` in one package of a monorepo without checking the others; the
  derivation makes it a per-package build-behaviour change.
- Don't rely on `tsc` alone to validate a per-file-transpiled setup. Add `tsc --noEmit
  --isolatedModules` to CI if you use a per-file transpiler.
- Don't infer option behaviour from a framework's "recommended" tsconfig without reading it —
  presets set these derived flags in ways that are not obvious from the option names.
- Don't treat a derived default as a bug once you have found it. It is documented behaviour; the
  only defect is the assumption.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Per-file transpiler errors, `tsc` clean | `isolatedModules` derived on or off unexpectedly | Set it explicitly; add `--isolatedModules` to CI |
| Config "doesn't set" a flag yet the behaviour is on | Conditional default | Read `--showConfig` |
| `import type` not erased in output | `verbatimModuleSyntax` off | Turn it on; mark type imports |
| Monorepo packages behave differently | Per-package derived defaults | Align explicitly across packages |
| Const enums preserved unexpectedly | `preserveConstEnums` derived on | Set it explicitly if unwanted |

## Verifying

```bash
# 1. The flags whose defaults are derived -- read, do not assume
grep -rnE '"(isolatedModules|verbatimModuleSyntax|preserveConstEnums|incremental|noImplicitAny)"' \
  --include=tsconfig*.json --include=*.json . | grep -v node_modules | head

# 2. Which per-file transpiler is actually in use -- the ones that honour the flag
grep -rnE '"(esbuild|swc|@swc/core|babel-jest|ts-jest|vite|next)"' --include=package.json . \
  | grep -v node_modules | head

# 3. Type-only imports that would need marking under verbatimModuleSyntax
grep -rnE "^import\s+\{[^}]*\}\s+from" --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -v 'import type' | head -20

# 4. Effective values -- the only read that resolves a derived default:
#    npx tsc --showConfig -p tsconfig.json | jq '.compilerOptions | \
#      {isolatedModules, verbatimModuleSyntax, preserveConstEnums, incremental}'

# 5. Settle it at the compiler -- the derivation, one command:
#    npx tsc --showConfig | jq .compilerOptions.isolatedModules
#    # with verbatimModuleSyntax unset -> false
#    # with verbatimModuleSyntax: true  -> true   (a flag nobody set)
```

What this check cannot see: steps 1–3 read the config file and the manifest, but the effective
options are whatever the compiler resolved — an extends chain, a CLI flag, or a build tool's own
synthesised config can set any of these without appearing in `tsconfig.json`. Step 1's grep also
cannot express "this key is absent", which is exactly the state that makes a derived default
active, so a clean-looking config and an actively-disabled option look identical. The instrument that
settles it is steps 4 and 5: `--showConfig` is the only source that reports a resolved value rather
than a written one, and comparing its output before and after the governing flag is the only way to
observe the derivation.