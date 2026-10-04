---
title: "The `module` setting decides whether Node.js compatibility is checked at all"
rule_id: "RULE-TYPESCRIPT-006"
category: "correctness"
scope: "all"
applies_to: "module, moduleResolution, nodenext, node16, esnext, bundler, ESM/CJS interop"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html"
---

# The `module` setting decides whether Node.js compatibility is checked at all

TypeScript can only check module correctness if it knows which host's rules apply, and the rules
differ between a bundler and Node.js. So the `module` compiler option gates the checking itself. If
it is not `node16`, `node18`, or `nodenext`, the compiler does not check its own output for Node.js
compatibility at all — and the code still type-checks.

## Why

The handbook states this as a parenthetical inside a longer explanation of *why* the option exists:

> Since interoperability rules differ between hosts, TypeScript can't offer correct checking behavior
> unless it understands what kind of module is represented by each file it sees, and what set of
> rules to apply to them. This is the purpose of the module compiler option. (In particular, code
> that is intended to run in Node.js is subject to stricter rules than code that will be processed
> by a bundler. The compiler's output is not checked for Node.js compatibility unless module is set
> to node16, node18, or nodenext.)
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

That parenthetical is the whole rule, and it is a **documented absence** rather than a missing
feature. `module: "esnext"` with `moduleResolution: "bundler"` is a coherent, widely-used,
recommendable configuration — and it means no Node.js checking whatsoever. Nothing errors, nothing
warns, and the failure lands on an import at runtime in production.

The resolution algorithm differs too, and the same page gives the reason the two must agree:

> Node.js introduced a new module resolution algorithm for resolving ESM imports that differed
> significantly from the long-standing algorithm for resolving require calls. While not directly
> related to interop between CJS and ES modules, this difference was one more reason why a seamless
> migration from transpiled modules to true ESM might not be possible
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

```jsonc
// A bundler target — coherent, and explicitly not Node.js-checked
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler"
  }
}

// A Node.js target — the compiler now checks what Node.js will actually do
{
  "compilerOptions": {
    "module": "nodenext"
  }
}
```

## Do

- Match `module` to the **runtime that will execute the output**. A Node.js process should be on
  `nodenext` (or `node18`/`node16` for a pinned version); a bundled browser app may use `esnext`.
- Set `module: "nodenext"` for anything published as a library or a CLI, since consumers choose the
  runtime and you do not.
- Keep `module` and `moduleResolution` coherent. `moduleResolution: "bundler"` under a `nodenext`
  `module` is a mismatch that some tooling tolerates and Node.js does not.
- Check the `package.json` `"type"` field alongside `module`. They answer a related question — how
  Node.js reads `.js` — and setting only one of the two leaves the other's assumption unchecked.
- Set `"exports"` explicitly in a published package; the resolution algorithm difference above is
  what makes a missing entry resolve differently under transpilation and native ESM.
- Run the compiled output, not just `tsc`, in CI. The gap this rule describes is invisible to
  type-checking and only appears when the code is executed as modules.

## Don't

- Don't read a clean `tsc --noEmit` as evidence that imports are correct for Node.js. Under a
  non-`nodenext` `module`, the compiler was never asked.
- Don't use `esnext` + `bundler` resolution for a server, a CLI, or a worker. The build output is
  valid TypeScript that Node.js may reject.
- Don't assume an extensionless relative import works in native ESM. It does not, and no error
  precedes it under a bundler setting.
- Don't migrate to native ESM by changing `module` alone. The resolution algorithm changes with it,
  which is the second quote's point.
- Don't treat `type: "module"` in `package.json` as equivalent to `module: "nodenext"` in tsconfig.
  The first tells Node how to read a file; the second tells the compiler to check it. Neither
  implies the other.
- Don't rely on the compiler to catch a missing `.js` extension when a bundler resolves the import
  for you today and Node.js will not tomorrow.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND` on an import that type-checked | No Node.js checking under `esnext` | `module: "nodenext"` |
| Extensionless import works locally, fails on deploy | Same | Add explicit extensions |
| Named import is `undefined` at runtime | Build-time vs runtime resolution (see rule 007) | `nodenext`, or use default import |
| `ERR_REQUIRE_ESM` on a dual package | `module` and `type` disagree | Align tsconfig and `package.json` |
| Works under ts-node, fails in the built bundle | Two different resolution algorithms | Test the built output |

## Verifying

```bash
# 1. What the compiler is actually configured to check
grep -rnE '"module"\s*:|"moduleResolution"\s*:' --include=tsconfig*.json --include=*.json . \
  | grep -v node_modules | head

# 2. The Node.js package type field -- the other half of the question
grep -rn '"type"\s*:\s*"module"' --include=package.json . | grep -v node_modules | head

# 3. Extensionless relative imports -- legal under bundler resolution, not under ESM
grep -rnE "from\s+['\"]\.\.?/[^'\"]*(?<!['\"])['\"]" --include=*.ts --include=*.tsx . \
  | grep -v node_modules | grep -v '\.js' | grep -v '\.mjs' | head -20

# 4. Directory imports, which ESM does not resolve
grep -rnE "from\s+['\"]\.\.?/[^'\"]+/['\"]" --include=*.ts . | grep -v node_modules | head -10

# 5. Settle it at the compiler and the runtime -- the whole defect, two commands:
#    npx tsc --showConfig | jq '.compilerOptions.module'   -> "esnext"  (no Node.js checking)
#    node --input-type=module -e 'import("./x.js")'        -> the import Node.js actually resolves
```

What this check cannot see: steps 1 and 2 read files, but the effective configuration is whatever
the compiler was invoked with — `tsc --showConfig` (step 5) is the only read that reflects reality,
and a build tool can still override it. Step 3's negative lookbehind for `.js`/`.mjs` is a
heuristic that a path containing `.js` mid-string will defeat, and it cannot distinguish an import
that a bundler will rewrite from one it will not. The instrument that settles it is step 5:
`--showConfig` reports what was resolved, and only running the built output as modules shows
whether Node.js agrees with the compiler. The compiler's silence under a bundler setting is the
finding, and silence is not something a grep over source files can detect.