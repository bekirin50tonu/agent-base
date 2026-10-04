---
title: "Object.freeze() is shallow, and its violations are silent outside strict mode"
rule_id: "RULE-JAVASCRIPT-003"
category: "correctness"
scope: "all"
applies_to: "Object.freeze, Object.seal, immutability, strict mode, private fields, accessors"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze"
---

# Object.freeze() is shallow, and its violations are silent outside strict mode

`freeze()` is routinely used as an immutability guarantee — in Redux reducers, in cache wrappers,
in "we hand back a frozen object so callers cannot touch our state" APIs. It is shallow, and the
documented statement of what it does does not imply what it does not do.

## Why

The definition is precise, and the last clause is where both failures live:

> Freezing an object is equivalent to preventing extensions and then changing all existing
> properties' descriptors' configurable to false — and for data properties, writable to false as
> well. Nothing can be added to or removed from the properties set of a frozen object. Any attempt to
> do so will fail, either silently or by throwing a TypeError exception (most commonly, but not
> exclusively, when in strict mode).
> ([Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze))

**"Either silently or by throwing"** is the same operation behaving differently by mode. Code
tested as an ES module and shipped as a sloppy-mode script mutates without error in one and throws
in the other, and the shipped one is the one nobody tested.

**Shallow** is the other half: the freeze applies to the property set of *that* object, and a
nested object's properties are a different property set.

> Accessor properties (getters and setters) work the same — the property value returned by the
> getter may still change, and the setter can still be called without throwing errors when setting
> the property. Note that values that are objects can still be modified, unless they are also
> frozen. As an object, an array can be frozen; after doing so, its elements cannot be altered and
> no elements can be added to or removed from the array.
> ([Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze))

And a frozen object can hold state that `freeze()` cannot reach at all:

> Private elements are not properties and do not have the concept of property descriptors. Freezing
> an object with private elements does not prevent the values of these private elements from being
> changed. (Freezing objects is usually meant as a security measure against external code, but
> external code cannot access private elements anyway.) Private elements cannot be added or removed
> from the object, whether the object is frozen or not.
> ([Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze))

## Do

- Use `freeze()` for what it is: preventing property *reassignment* on the object you froze. Do not
  describe it as making the value immutable in a comment or a docstring.
- Deep-freeze explicitly when the guarantee must hold transitively, or copy with a structured clone
  (`structuredClone`) when you are handing state across a trust boundary.
- Keep the whole codebase strict. Every module, class body, and file should be strict — `"use
  strict"` in a script, `"type": "module"` in a package — so a violation throws where it happens
  rather than silently doing nothing in production.
- Freeze in development and assert in production. A frozen object that a reducer mutates is a
  reducer bug the freeze can only catch in strict mode; a test that mutates it and expects a throw
  catches it in both.
- Use `Object.isFrozen()` when you need to check, and remember it says nothing about depth.
- Prefer immutable update patterns (`{ ...state, changed }`) over freezing-and-mutating.

## Don't

- Don't use `freeze()` as a security boundary. It is a shallow property-descriptor change and the
  same script that holds the object can usually get at nested values.
- Don't assume a frozen object is deep-frozen. `Object.freeze(state)` leaves `state.user.name`
  writable, and that is the field most often mutated by accident.
- Don't rely on a violation throwing. In sloppy mode it is a no-op, and the difference between your
  test environment and production is the whole failure.
- Don't expect `freeze()` to stop a getter or setter from changing the value it returns.
- Don't expect `freeze()` to protect `#private` fields — they are not properties and are unaffected
  by design.
- Don't freeze an object you still intend to mutate "temporarily"; there is no unfreeze, and the
  next `delete` is a silent no-op too.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Nested field of a "frozen" object changed | `freeze()` is shallow | Deep-freeze, or copy at the boundary |
| Mutation throws in tests, silent in production | Strict mode differs between environments | Make the whole codebase strict |
| A setter on a frozen object still runs | Accessor properties keep working | Freeze is not an accessor contract; close the accessor |
| `#private` state changed after freezing | Private fields are not properties | Do not treat `freeze()` as covering them |
| `delete obj.x` did nothing, no error | Silent no-op in sloppy mode | Strict mode; assert with `Object.isFrozen` |
| Frozen object's getter returns a new value each call | Getter is a function, not a property | Not a freeze problem — fix the getter |

## Verifying

```bash
# 1. Every freeze call in the project
grep -rn 'Object.freeze' --include=*.js --include=*.mjs --include=*.cjs --include=*.ts --include=*.tsx . \
  | grep -v node_modules | head -30

# 2. Deep-freeze implementations already in the codebase -- is the guarantee transitive?
grep -rnE 'function deepFreeze|const deepFreeze|deepFreeze\(' --include=*.js --include=*.ts . | grep -v node_modules

# 3. Frozen objects that are still mutated somewhere -- the shallow trap
grep -rn 'Object.freeze' --include=*.js --include=*.ts . | grep -v node_modules | cut -d: -f1 | sort -u \
  | while read -r f; do grep -nE '\.[A-Za-z_$][A-Za-z0-9_$]*\s*(\+\+|--|\+=|-=|\*=|/=)' "$f"; done | head -20

# 4. Modules/sloppiness: strict mode must not be optional
grep -rL '"use strict"\|type.*:.*"module"' --include=*.js --include=*.cjs . 2>/dev/null | grep -v node_modules | head -20

# 5. Settle it at runtime -- both failures in two lines:
#    node -e 'const o=Object.freeze({n:{v:1}}); o.n.v=2; console.log(o.n.v)'          ->  2
#    node -e '"use strict"; const o=Object.freeze({a:1}); try{o.a=2}catch(e){console.log(e.constructor.name)}'
#    node -e 'console.log(Object.isFrozen(Object.freeze({n:{}})), Object.isFrozen(Object.freeze({n:{}}).n))'
```

What this check cannot see: steps 1–4 cannot tell whether a given freeze *needed* to be deep —
that depends on whether any caller mutates a nested value, which is not visible in the freezing
file. Step 3 pairs by filename, so a frozen object mutated from a different module is invisible to
it. The instrument that settles it is step 5: attempt the nested mutation in both modes and read
what happened, which is the only place shallowness and mode-dependence are observable at once.