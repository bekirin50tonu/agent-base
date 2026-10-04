---
title: "A sealed type's permitted-subclass list is a compile-time contract, and switch over it stops being exhaustive when a subclass is added"
rule_id: "RULE-JVM-011"
category: "correctness"
scope: "backend"
applies_to: "sealed classes, permits clause, non-sealed, switch expressions, exhaustiveness, default branch"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html"
---

# A sealed type's permitted-subclass list is a compile-time contract, and switch over it stops being exhaustive when a subclass is added

`sealed` closes the first step of a hierarchy, not the whole thing. One `non-sealed` link reopens it
to arbitrary subclasses — and the compiler accepts it.

The consequence for `switch` is the hazard: adding a permitted subclass is source-compatible for
the hierarchy and source-incompatible for every `switch` written against the old list. With a
`default` branch, those switches keep compiling and silently absorb the new case.

## Why

Every permitted subclass must declare how the sealing continues, with exactly one of three
modifiers — and one of them is an escape hatch the supertype cannot close:

> They must have exactly one of the following modifiers to describe how it continues the sealing
> initiated by its superclass:
> ([7 Sealed Classes](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html))

> non-sealed: Can be extended by unknown subclasses; a sealed class cannot prevent its permitted
> subclasses from doing this
> ([7 Sealed Classes](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html))

So `permits` bounds one level. `non-sealed` below that level means arbitrary further subclasses,
and the compiler's proofs downstream of the gap are correspondingly weaker.

The reachability requirement is not "same file" — it is "accessible by the sealed class at compile
time" — and it propagates:

> They must be accessible by the sealed class at compile time.
> ([7 Sealed Classes](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html))

> They must be in the same module as the sealed class (if the sealed class is in a named module) or
> in the same package (if the sealed class is in the unnamed module, as in the Shape.java
> example).
> ([7 Sealed Classes](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html))

Sealing also makes some casts compile errors that would otherwise be run-time failures, which is
its practical value:

> The first cast statement UtahTeapot u = (UtahTeapot) s isn't allowed; a Shape can only be a
> Polygon because Shape is sealed.
> ([7 Sealed Classes](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html))

The exhaustiveness obligation rests on that same compile-time knowledge — and it is computed
against the version of the code the compiler saw:

> The cases of a switch expression or statement must be exhaustive, which means that for all
> possible values, there must be a matching case label.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

> If a switch expression or statement is exhaustive at compile time but not at run time, then a
> MatchException is thrown. [...] you need to recompile the class containing the switch expression
> or statement.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

Add a subclass, recompile the hierarchy, leave the switches alone, and a `default` branch silently
takes the new path. Remove the `default` and the compiler turns that class of bug into a build
failure — the only mechanism the language offers for making the obligation enforced rather than
merely available. *(paraphrase — the sources document the exhaustiveness requirement and document
`permits`, but neither spells out their interaction.)*

## Do

- **Omit the `default` branch** on a `switch` over a sealed type. That is what makes the
  exhaustiveness obligation enforced.
- Add new permitted subclasses and the consuming switches **in the same commit**, so the compiler
  names every site that needs a case.
- Keep `permits` lists short enough to read. A list you cannot hold in your head will not be kept
  in sync.
- Prefer `sealed` over `non-sealed` when the hierarchy really is closed. Reserve `non-sealed` for
  genuine extension points.
- Recompile the whole module — not just the hierarchy — when the hierarchy changes. See
  `RULE-JVM-012` for what happens when you do not.

## Don't

- Don't put `default ->` on a switch over a sealed type. It converts a compile error into a wrong
  answer, which is the worse trade at any point.
- Don't mark a permitted subclass `non-sealed` without deciding who will extend it. The compiler
  will not remind you.
- Don't assume the `permits` list is the full hierarchy. It is the first level.
- Don't rely on a sealed hierarchy for run-time exhaustiveness. The proof is compile-time and goes
  stale.
- Don't spread a sealed hierarchy across modules without checking the named-module constraint.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `MatchException` at run time | Hierarchy recompiled, switch class not | Recompile the switch's module (`RULE-JVM-012`) |
| New type silently takes the `default` path | `default` branch present | Remove `default`; let the compiler find every site |
| Unknown subclass appears at run time | A `non-sealed` link below the boundary | Close it with `sealed` |
| Compiles locally, fails in CI with a different module layout | Named-module / same-package constraint | Co-locate or export the package |
| A cast that "should" compile is rejected | Sealing narrowed the hierarchy | Expected; the rejection is the feature |

## Verifying

```bash
# 1. Every sealed hierarchy in the tree, with its permits list
grep -rn -A3 'sealed \(class\|interface\)' src/main/java/ | grep -E 'sealed|permits'

# 2. non-sealed links -- each one reopens the hierarchy below it
grep -rn 'non-sealed' src/main/java/

# 3. default branches on switches over sealed types. This is the bug.
#    Compare each switch's selector against the sealed types above.
grep -rn -A2 'switch\s*(\|case .*->\|default\s*->\|default\s*:' src/main/java/ \
  | grep -B1 'default' | grep 'switch\|case'

# 4. Per-file coupling: which files mention the same sealed type?
for t in $(grep -rhoE '\b(sealed|permits) [A-Z]\w+' src/main/java/ | awk '{print $2}' | sort -u); do
  echo "== $t"; grep -rl "$t" src/main/java/
done

# 5. Switches with no default at all, over a type that looks like a domain model
grep -rn 'switch\s*(' src/main/java/ | wc -l
```

What this check cannot see: the defect is the *absence* of a branch for a type that does not exist
yet, so no static check can find it before the type is written. Step 3 is a heuristic — matching a
`switch` to its sealed type requires knowing which switches are which, and the grep pairs them by
proximity. The check that actually enforces the obligation is deleting `default` and letting the
compiler report every site, which is why that is a `Do` and not merely a suggestion.