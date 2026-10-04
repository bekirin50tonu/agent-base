---
title: "an unmarked .js file has its module format inferred from its source"
rule_id: "RULE-NODEJS-005"
category: "correctness"
scope: "backend"
applies_to: "Node.js, ESM, CommonJS, package.json type field, require(esm), top-level await"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/esm.html"
---

# an unmarked .js file has its module format inferred from its source

A `.js` file with no `"type"` field in its nearest `package.json` is not CommonJS by
declaration. Node.js reads the source and decides:

> When code lacks explicit markers for either module system, Node.js will inspect the source
> code of a module to look for ES module syntax.
> ([ECMAScript modules](https://nodejs.org/api/esm.html))

The explicit markers that avoid the inference are:

> Authors can tell Node.js to interpret JavaScript as an ES module via the .mjs file
> extension, the package.json "type" field with a value "module", or the --input-type flag with
> a value of "module".
> ([ECMAScript modules](https://nodejs.org/api/esm.html))

So the format of a `.js` file is a function of its contents plus the nearest `package.json`.
Adding one `export` line to share a constant reclassifies the file, and the failure appears at
the consumer as `require() is not defined in ES module scope` — not at the edit.

Two interop facts sit on top of this:

> To support this, when importing CommonJS from an ECMAScript module, a namespace wrapper for the
> CommonJS module is constructed, which always provides a default export key pointing to the
> CommonJS module.exports value.
> ([ECMAScript modules](https://nodejs.org/api/esm.html))

> The CommonJS module require currently only supports loading synchronous ES modules (that is,
> ES modules that do not use top-level await).
> ([ECMAScript modules](https://nodejs.org/api/esm.html))

## Why

The inference is a parse, so it is sensitive to edits that nobody would classify as a module
system change. Sharing one constant becomes `export const`, a file becomes ESM, and every
CommonJS consumer of it stops working. Nothing in the diff mentions module format.

The reverse direction has a harder limit. `require()` cannot load an ESM module with top-level
await, so a library that adopts `await` at the top level becomes unloadable from CommonJS — a
constraint that is invisible until a consumer uses `require`.

The namespace wrapper is the subtle half. Importing a CJS module from ESM gives a namespace
whose `default` is `module.exports`, and a synthetic `'module.exports'` named export when the
value is not an object. Code that works with a bundled build can get a different shape under
bare Node.js, because the bundler resolved it differently.

## Do

- Declare `"type": "module"` (or `"commonjs"`) explicitly in every `package.json`.
- Use `.mjs` / `.cjs` extensions for files whose format must not depend on `package.json`.
- Keep `main`, `exports`, and `type` consistent; the resolution order between them is
  deterministic and worth knowing before debugging.
- Check top-level `await` before adding it to a file anything `require()`s.
- Verify the real runtime, not only the bundler: `node -e "require('./mod.js')"`.

```javascript
// Correct — the format is declared, not inferred
// package.json
{ "name": "svc", "type": "module", "exports": { "." : "./src/index.js" } }
```

## Don't

- Don't rely on detection for anything a `package.json` will eventually govern.
- Don't add `export` to a CommonJS file to share one symbol. Duplicate the constant or convert
  the file deliberately.
- Don't assume `import cjs from 'x'` yields the same object `require('x')` returns. Check which
  interop path the runtime takes.
- Don't add top-level `await` to a library without checking that nothing `require()`s it.
- Don't test only through a bundler. It resolves modules its own way and hides the runtime
  classification.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `require is not defined` after a small edit | File became ESM by inference | Declare `"type"`, use explicit extensions |
| Import shape differs from `require` | Namespace wrapper around CJS | Use the documented interop path |
| `ERR_REQUIRE_ESM` | `require()` cannot load a TLA module | Remove the top-level await, or stay ESM |
| Works bundled, fails under `node` | Bundler and runtime resolve differently | Test the bare runtime |
| Only some files affected | Per-file inference, differing `package.json` scope | Declare the type per package |
| Tooling disagrees on the format | Bundler vs Node classification | Align `type` and `exports` |

## Verifying

```bash
# The declared format per package
grep -rn --include='package.json' '"type"' .

# Files whose format is decided by inference rather than declared
find . -name '*.js' -not -path './node_modules/*' -exec sh -c '
  d=$(dirname "$1"); while [ "$d" != "." ] && [ ! -f "$d/package.json" ]; do d=$(dirname "$d"); done
  if [ ! -f "$d/package.json" ]; then echo "NO PACKAGE.JSON: $1"; fi' _ {} \;

# Files that mix both systems, the actual collision risk
grep -rln --include='*.js' -E "^(import .* from |const .* = require\()" src/ \
  | xargs grep -ln --include='*.js' -E "^(import .* from |module\.exports)" 2>/dev/null

# Top-level await, which blocks require()
grep -rn --include='*.{js,mjs}' -E '^await |^const \w+ = await ' src/
```

The mixed-systems list is the practical one: a file containing both an `import` and a
`module.exports` is classified as ESM, and its `module.exports` line becomes dead code that
nothing reports.

These greps cannot tell you how the format was resolved in a specific import, because that
depends on the importer's own resolution. Confirm with `node --input-type=module -e "import x
from './f.js'"` and `node -e "require('./f.js')"` — one of the two failing is the answer.