---
name: adopt-strict-checking-gradually
description: "Adopt TypeScript strict checking on a JS or loose-TS codebase. Use when enabling strict, noImplicitAny, or checkJs, or when a TS 6.0 upgrade brings errors you did not ask for."
version: "1.0.0"
tags:
  - typescript
  - migration
  - type-checking
---

# Adopt Strict Checking Gradually — and Know Which Direction You Are Walking

A loose TypeScript codebase does not adopt `strict` in one step. But the direction of travel
changed in TypeScript 6.0, and a migration written for 5.x is now walking backwards.

## Why

**TypeScript 6.0 makes `strict` the default.** This is a shipped release note, not a proposal:

> strict is now true by default: The appetite for stricter typing continues to grow, and we've
> found that most new projects want strict mode enabled. If you were already using "strict": true,
> nothing changes for you. **If you were relying on the previous default of false, you'll need to
> explicitly set "strict": false in your tsconfig.json.**
> — https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html

So the gradual path is no longer *opting in* to strictness. On 6.0 it is **opting out**, and the
order the handbook documents is a walk-back for anyone upgrading into it. Check your `strict`
setting before anything else — the flag you thought was off may already be on.

Two companion defaults arrive in the same release, and both have a fix:

> module defaults to esnext: Similarly, the new default module is esnext, acknowledging that ESM
> is now the dominant module format.

> target defaults to current-year ES version: […] Right now, that target is es2025. This reflects
> the reality that most develop

*(`target` now floats with the calendar year — pin it explicitly or your output changes under you.)*

**The documented order starts at `noImplicitAny`, not `strictNullChecks`.** The handbook's advice,
placed before file modification begins:

> If you plan on using the stricter settings that are available, it's best to turn them on now […]
> if you never want TypeScript to silently infer any for a type without you explicitly saying so,
> you can use noImplicitAny before you start modifying your files.
> — https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html

The reason is **error locality**, and this is the whole reason the migration is survivable:

| | `noImplicitAny` | `strictNullChecks` |
|---|---|---|
| Fires where | a type annotation is missing | a value's *flow* reaches a non-null assumption |
| Error location | one syntactic site | crosses function, module, and return boundaries |
| The fix | always local: annotate the parameter | at the call site, not where the bug is |
| Exit criterion | none of the above | see step 5 — may be unreachable |

A flag whose errors are all at one site can be adopted across a codebase without triage. A flag
whose errors track data flow requires you to understand the program.

## Step 1 — Establish which direction you are walking

```bash
npx tsc --version
cat tsconfig.json | grep -E '"strict"|"noImplicitAny"|"strictNullChecks"'
```

**On TS 6.0+, an absent `strict` means `true`.** If you are upgrading and did not set it, you are
already strict and the errors are already yours. Decide deliberately:

- **Keep strict** → this workflow, starting at step 3.
- **Pin it off** → `"strict": false` in `tsconfig.json`, and record why. This is a delay, not a
  decision.

## Step 2 — Run the codemod before you read a single error

6.0 ships a migration tool, and the release notes are explicit that some adjustments are
mechanical:

> Some necessary adjustments can be automatically performed with a codemod or tool. For example, the
> experimental ts5to6 tool can automatically adjust baseUrl and rootDir across your codebase.
> — https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html

There is a second up-front adjustment the notes call out because **it has no error message
pointing at it** — you will not find it by reading errors:

> Set "rootDir": "./src" if you were previously relying on this being inferred
>
> You'll often know this is the issue if you see files being written to ./dist/src/index.js instead
> of ./dist/index.js.

That `dist/src` nesting is the symptom. Set `rootDir` explicitly.

## Step 3 — Adopt `noImplicitAny` first

```jsonc
{ "compilerOptions": { "noImplicitAny": true } }
```

Adopt it **before** touching files, per the handbook quote above. Note the reference says it
`Released: 1.0` while `strict` is `Released: 2.3` — the flag you adopt first is the oldest in the
family, which is consistent with it being the mechanically simplest.

**Exit criterion: no inferred `any` remains.** This one is real and mechanically checkable.

```bash
npx tsc --noEmit 2>&1 | grep -c 'implicitly has an .any. type'
```

## Step 4 — Enable `checkJs` last, and know that it has no exit criterion

`allowJs` + `checkJs` type-checks JavaScript files. It is the natural next rung and it is a trap,
for one specific reason: the `// @ts-nocheck` and `// @ts-check` directives let you silence
individual files.

**That means "zero errors" is reachable by silencing, not by fixing.** A team can report `checkJs`
as complete while having annotated nothing. So do not treat error count as the exit criterion for
this step — track instead:

```bash
# How much JS is still un-checked (silenced or excluded)?
grep -rln '@ts-nocheck' --include=*.js --include=*.ts src/ | wc -l
grep -rn '"checkJs"' tsconfig.json || echo "checkJs not on"
```

**Exit criterion: the count of `@ts-nocheck` files is falling, and you can name what each one is.**

## Step 5 — `strictNullChecks` last, and expect it never to fully converge

`strictNullChecks` fires on flow, so on an existing JS codebase its errors are not exhaustively
fixable — the escape hatches in step 4 guarantee an unbounded tail. Adopt it, work it, and expect
to stop at a documented point rather than zero.

This is the one step where "done" is a judgement, not a count. Write down where you stopped.

## When to stop and escalate

- **You are on TS 7.0 or later.** The 6.0 deprecations are gone:
  > these deprecations can be ignored by setting `"ignoreDeprecations": "6.0"` in your tsconfig;
  > however, note that **TypeScript 7.0 will not support any of these deprecated options.**
- **A dependency forces a jump past releases you did not audit.** Check `types` and `exports` in
  its `package.json`; a dependency's own requirements are a floor, like Go's `go` line.
- **`checkJs` is being used as a progress metric.** Stop — the escape hatches make the number
  unfalsifiable.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Hundreds of errors after a version bump, none requested | 6.0 defaults `strict` to true | decide: adopt, or set `strict: false` deliberately |
| Output lands in `dist/src/index.js` | `rootDir` was inferred | set `"rootDir": "./src"` |
| Build output changes with no code change | `target` now floats with the current year | pin `target` explicitly |
| `checkJs` "passes", nothing was fixed | `@ts-nocheck` silenced it | count silenced files, not errors |
| `strictNullChecks` errors never reach zero | escape hatches by construction | stop at a documented point |
| A removed option still works in CI | 6.0 `ignoreDeprecations` shim | it will not work on 7.0; remove it now |

## Verifying

```bash
npx tsc --version
npx tsc --noEmit

# Which of the strict family is actually on?
npx tsc --showConfig | grep -E '"strict"|"noImplicitAny"|"strictNullChecks"|"checkJs"|"rootDir"|"target"'

# The un-checked surface
grep -rln '@ts-nocheck' --include=*.js --include=*.ts src/ | wc -l
```

`--showConfig` is the one that matters: it prints the *resolved* config, so a default you did not
write down shows up as an explicit value. That is how a 6.0 upgrade reveals itself.
