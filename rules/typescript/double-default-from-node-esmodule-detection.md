---
title: "Node's `__esModule` handling produces a \"double default\""
rule_id: "RULE-TYPESCRIPT-007"
category: "correctness"
scope: "all"
applies_to: "esModuleInterop, __esModule, default import, named imports, CJS/ESM interop"
last_updated: "2026-10-04"
source: "https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html"
---

# Node's `__esModule` handling produces a "double default"

A transpiled CommonJS module and a native ES module in Node.js interpret the *same* default import
differently. Node.js always synthesizes a default export; a transpiled module only does so when the
`__esModule` marker is absent. With the marker present, `import x from "dep"` yields a namespace
object whose `.default` is the function — so `x()` works after transpilation and is not a function
in native ESM.

## Why

The handbook describes the divergence directly:

> Node.js wasn't able to respect the __esModule marker to vary its default import behavior. So a
> transpiled module with a "default export" behaves one way when "imported" by another transpiled
> module, and another way when imported by a true ES module in Node.js
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

> While the transpiled default import only makes the synthetic default export if the target module
> lacks an __esModule flag, Node.js always synthesizes a default export, creating a "double default"
> on the transpiled module.
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

Named imports have a matching trap, and it is a **build-time** difference rather than a runtime one:

> In addition to making a CommonJS module's exports object available as a default import, Node.js
> attempts to find properties of exports to make available as named imports. This behavior matches
> bundlers and transpilers when it works; however, Node.js uses syntactic analysis to synthesize
> named exports before any code executes, whereas transpiled modules resolve their named imports at
> runtime.
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

That last sentence is the sharpest statement in this rule. Transpiled modules resolve named imports
at **runtime**; Node.js resolves them by **syntactic analysis before execution**. So
`exports["worl" + "d"] = "hello"` is invisible to Node.js — `import { world }` works in the
transpiled build and throws in native ESM, with no type-level check to catch it under a non-`nodenext`
module setting.

```typescript
// Works after transpilation, is not a function in Node.js ESM
import doSomething from "dependency";
doSomething();

// Doesn't exist after transpilation, but works in Node.js ESM
doSomething.default();
```

The remedy is `esModuleInterop`, which the same page recommends unconditionally for applications:

> Applications with CommonJS code should always enable esModuleInterop
> ([ESM/CJS Interoperability](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html))

## Do

- Enable `esModuleInterop` in every project that touches CommonJS. It is the default under
  `esModuleInterop`-style presets in most frameworks, but verify rather than assume.
- Prefer a default import (`import pkg from "dep"`) over `import { x } from "dep"` when the
  dependency is CommonJS. Node.js's namespace synthesis means named imports from CJS are the
  fragile form, not the default.
- Mark your own compiled CJS output with `__esModule` consistently, and pick one convention per
  package. The marker is what makes the double default appear, so removing it is a real option for
  a package you own.
- Run the actual built output under `node` in CI when a package ships both CJS and ESM. This is the
  only place the two behaviours are both exercised.
- Use `type` guards (`typeof x === "function" ? x : x.default`) at any boundary where the shape is
  genuinely uncertain, and say so in a comment.
- Prefer dependencies that publish real ESM, or dual packages with correct `exports` maps, to
  interop gymnastics.

## Don't

- Don't assume the same import expression has the same meaning in both runtimes. That is precisely
  the divergence described above.
- Don't use `import { x } from "cjs-package"` where the export may be assigned dynamically. Node.js
  cannot see computed keys.
- Don't call `.default` unconditionally to "fix" interop — that is the *native ESM* shape and it
  breaks the transpiled one. The two need opposite handling.
- Don't assume `esModuleInterop` changes runtime behaviour. It changes *type* checking of the import
  expression; the divergence it protects against comes from the runtime, not the compiler.
- Don't use deep imports (`import x from "pkg/internal"`) into a CJS package as a workaround; they
  bypass whatever interop the entry point was set up for.
- Don't trust a passing build as evidence that interop is right for the *deployed* runtime when the
  two differ.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `x is not a function` under native ESM | Double default; `x` is a namespace | `esModuleInterop`, or default import shape |
| `Cannot access 'default' before initialization` | Native ESM shape used in transpiled build | Align the import form to one runtime |
| Named import is `undefined` | Computed key invisible to syntactic analysis | Export literally; use default import |
| Interop works locally, breaks in the container | Two runtimes, one import expression | Test the built output under Node |
| `.default` is `undefined` | Applied the native shape to a transpiled module | Drop the `.default` |

## Verifying

```bash
# 1. Interop flag present? -- the documented remedy
grep -rnE '"(esModuleInterop|allowSyntheticDefaultImports)"' --include=tsconfig*.json \
  --include=*.json . | grep -v node_modules | head

# 2. Default imports from bare specifiers -- where the double default bites
grep -rnE '^import\s+\w+\s+from\s+["'\''][^./]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -30

# 3. Named imports from packages -- the fragile CJS form
grep -rnE '^import\s+\{[^}]+\}\s+from\s+["'\''][^./]' --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -20

# 4. Runtime-shaped guards, for contrast
grep -rnE '\.default\b|\?\?\s*\w+\.default|typeof\s+\w+\s*===\s*["'\'']function' \
  --include=*.ts --include=*.tsx . | grep -v node_modules | head -15

# 5. Settle it at runtime -- the whole defect, three lines:
#    node -e 'const m={exports:{}}; m.exports.default=()=>1;
#      Object.defineProperty(m.exports,"__esModule",{value:true});
#      // transpiled:  x = require(m)            -> the function
#      // native ESM:  x = await import(m)        -> namespace, x.default is the function
#      console.log(typeof x, typeof x.default)'
#    -> "object function"   -- the double default, in one line of output.
```

What this check cannot see: steps 2 and 3 list every default and named import from a bare
specifier, which is most of a normal codebase — they cannot tell a CJS dependency from an ESM one,
so every hit looks like a hazard and most are not. Step 4 finds the guards but cannot tell one that
compensates for real interop uncertainty from one added for an unrelated reason. The instrument that
settles it is step 5: only executing the module under each runtime shows whether the two shapes
diverge for a *specific* dependency, and that divergence is a property of the module being imported,
not of the import site the grep can see.