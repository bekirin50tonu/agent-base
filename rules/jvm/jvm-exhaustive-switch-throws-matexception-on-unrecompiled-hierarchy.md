---
title: "An exhaustive switch throws MatchException when the sealed hierarchy changed but the switch did not get recompiled"
rule_id: "RULE-JVM-012"
category: "correctness"
scope: "backend"
applies_to: "switch expressions, MatchException, sealed hierarchies, exhaustiveness, type coverage, enum switches"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html"
---

# An exhaustive switch throws MatchException when the sealed hierarchy changed but the switch did not get recompiled

An exhaustive `switch` is a compile-time proof, and the proof is only valid against the bytecode it
was compiled from. The fix for the failure is not in the switch — it is recompiling the class that
contains it, and the compiler cannot find every affected class for you.

## Why

The documented failure is exactly this shape, and the documentation names the remedy:

> If a switch expression or statement is exhaustive at compile time but not at run time, then a
> MatchException is thrown. This can happen when a class that contains an exhaustive switch
> expression or statement has been compiled, but a sealed hierarchy that is used in the analysis of
> the switch expression or statement has been subsequently changed and recompiled. Such changes
> are migration incompatible and may lead to a MatchException being thrown when running the switch
> statement or expression. Consequently, you need to recompile the class containing the switch
> expression or statement.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

Note "migration incompatible". Adding a permitted subclass to a widely-used sealed interface is a
one-line change with an N-class blast radius, and nothing in the build fails.

Exhaustiveness itself is a type-coverage property, not a value-matching one:

> Consequently, for a switch expression or statement to be exhaustive, the type coverage of its
> labels must include the type of the selector expression.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

> The compiler can also determine the type coverage of a switch expression or statement if the type
> of its selector expression is a generic sealed class.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

A generic selector narrows the obligation, which is the second way a switch can be exhaustive in
one place and incomplete in another:

> However, because the selector expression is of type I<Integer>, the switch block requires only
> class B in its type coverage to be exhaustive:
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

And an enum switch behaves differently from a type switch, because the compiler inserts an implicit
default — which is why enums degrade quietly where sealed types fail loudly:

> However, for an enum switch expression that covers all known constants, the compiler inserts an
> implicit default clause, like the examples at the beginning of this section that print the number
> of letters in name of a day of the week.
> ([12 Switch Expressions and Statements](https://docs.oracle.com/en/java/javase/25/language/switch-expressions-statements.html))

That asymmetry matters: an enum gaining a constant silently takes the implicit default, while a
sealed type gaining a subclass throws. Same change shape, opposite failure modes.

## Do

- Recompile **everything** that switches over a sealed hierarchy when the hierarchy changes. A
  clean build is the requirement; incremental compilation is not sufficient.
- Keep sealed hierarchies and their consumers in one module where you can, so the blast radius is
  bounded.
- Treat a new permitted subclass as a source-breaking change requiring a full rebuild in CI, not
  just a green compile of the changed files.
- Add a test that asserts the `MatchException` path for an unhandled type, if any code path can
  deliver one.
- Prefer no `default` at all on a sealed-type switch. See `RULE-JVM-011`.

## Don't

- Don't ship an incremental build artifact in which a sealed hierarchy was recompiled and its
  switch consumers were not. That is the exact configuration that throws.
- Don't rely on the switch being recompiled because the *file* was in the change set — the consumer
  may be in a different module or a different jar.
- Don't expect an enum switch to fail loudly on a new constant. It takes the implicit default.
- Don't add a `default` branch to an exhaustive sealed-type switch as a "safety net". That is the
  failure this rule is about.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `java.lang.MatchException` in production | Hierarchy recompiled, switch class not | Full clean rebuild and redeploy |
| `MatchException` only after a dependency bump | A transitive jar changed the sealed type | Rebuild the consumer, do not assume the bump is safe |
| New enum constant silently handled by a default | Implicit default clause | Add the constant explicitly; treat as breaking |
| Local build fine, CI or prod throws | Incremental compilation in one environment | Clean build everywhere |
| Intermittent `MatchException` under load | One path reaches a type the labels do not cover | Full rebuild, then audit for a `default` |

## Verifying

```bash
# 1. Which sealed hierarchies exist -- these are the ones with a stale-proof risk
grep -rn 'sealed \(class\|interface\)' src/main/java/

# 2. Which files switch over them (the blast radius)
for t in $(grep -rhoE 'sealed (class|interface) [A-Z]\w+' src/main/java/ | awk '{print $3}' | sort -u); do
  echo "== $t"
  grep -rl "$t" src/main/java/ | xargs grep -ln 'switch' 2>/dev/null
done

# 3. Incremental compilation in the build -- this is what leaves stale classes behind
grep -rn 'incremental\|useIncrementalCompilation' build.gradle* pom.xml .mvn/ 2>/dev/null

# 4. Modules that could ship separately
grep -rn 'module-info.java' src/ || echo "single module"

# 5. Prove it: a clean build must be the default
./gradlew clean build     # or: mvn clean verify
```

What this check cannot see: nothing static can tell that a compiled artifact is stale — the
defect lives in the *relationship between two build outputs*, not in any source file. Step 3 is a
search for the mechanism, not the condition; a build that always cleans is safe regardless of what
it sets, and a build that does not is unsafe only when the hierarchy changed. The instrument that
actually catches it is a CI job that does a clean build after a sealed-hierarchy change and runs
the tests, which is why that is the `Do`.