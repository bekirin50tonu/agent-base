---
title: "StructuredTaskScope is preview and its shape drifts with every JEP"
rule_id: "RULE-JVM-004"
category: "api-design"
scope: "backend"
applies_to: "StructuredTaskScope, structured concurrency, preview APIs, --enable-preview, JEP 480, JEP 505"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/480"
---

# StructuredTaskScope is preview and its shape drifts with every JEP

`StructuredTaskScope` reads like a stable JDK class, the way `ExecutorService` does. It is not. It
is a preview API that has been re-proposed under five JEP numbers across seven releases, replaced
its two concrete subclasses with a different abstraction, and changed the return type of the one
method every caller must call.

Treat it as a spike. Prototype against it, keep the boundary narrow, and be prepared to translate.

## Why

The lineage is not a series of bug fixes — it is a series of re-designations, and the JEP says so:

> Structured Concurrency was proposed by JEP 428 and delivered in JDK 19 as an incubating API. It
> was re-incubated by JEP 437 in JDK 20 with a minor update to inherit scoped values (JEP 429). It
> first previewed in JDK 21 via JEP 453 with StructuredTaskScope::fork(...) changed to return a
> Subtask rather than a Future. It re-previewed in JDK 22 via JEP 462, without change. We here
> propose to re-preview the API once more in JDK 23, without change, in order to gain more
> feedback.
> ([JEP 480: Structured Concurrency (Third Preview)](https://openjdk.org/jeps/480))

The `fork` change is the sharpest instance, because it is source-incompatible with no deprecation
window:

> When the StructuredTaskScope API was incubating, the fork(...) method returned a Future. This
> provided a sense of familiarity, by making fork(...) resemble the existing
> ExecutorService::submit method. However, given that StructuredTaskScope is intended to be used
> differently from ExecutorService — in a structured way, as described above — the use of Future
> brought more confusion than clarity.
> ([JEP 480: Structured Concurrency (Third Preview)](https://openjdk.org/jeps/480))

> In the current API, Subtask::get() behaves exactly as Future::resultNow() did when the API was
> incubating.
> ([JEP 480: Structured Concurrency (Third Preview)](https://openjdk.org/jeps/480))

Old code's blocking `get()` became a non-blocking `get()` with different legality rules. Nothing
about the *name* `fork` signals a return-type swap.

And the drift continued past JDK 23 — the JDK 25 documentation points at JEP 505, so the shape your
code compiles against depends on the release you build with:

> For background information about structured concurrency, see JEP 505.
> ([Structured Concurrency](https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html))

Preview status carries no promise that any of it survives:

> This is a preview feature. A preview feature is a feature whose design, specification, and
> implementation are complete, but is not permanent. A preview feature may exist in a different
> form or not at all in future Java SE releases.
> ([Structured Concurrency](https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html))

Preview features are not deprecated — they are *replaced*. You get no compile warning and no
release cycle in which to migrate.

## Do

- Enable previews explicitly and record it in the build file, so a missing flag fails loudly:

  > To use the StructuredTaskScope API you must enable preview APIs, as follows:
  >
  > Compile the program with javac --release 23 --enable-preview Main.java and run it with java
  > --enable-preview Main; or,
  >
  > When using the source code launcher, run the program with java --source 23
  > --enable-preview Main.java; or,
  >
  > When using jshell, start it with jshell --enable-preview.
  > ([JEP 480: Structured Concurrency (Third Preview)](https://openjdk.org/jeps/480))

- Confine usage to one adapter class per use case. That is the migration surface when the shape
  moves again.
- Check `JAVA_TOOL_OPTIONS` / the start script in CI, not only in the build — the compile-time
  flag and the run-time flag are separate and both required.
- Write the fallback as `ExecutorService` plus explicit `Future` cancellation. That is the model
  the JEP set out to replace, and it is what you translate back to.

## Don't

- Don't put `StructuredTaskScope` in a public API signature or a library others compile against.
  Every consumer inherits your preview-flag requirement.
- Don't assume `ShutdownOnFailure`, `ShutdownOnSuccess`, `throwIfFailed()`, `result()`,
  `joinUntil()` or `shutdown()` exist — they are from the JDK 23 shape and are absent from the
  JDK 25 documentation, which instead uses a `Joiner<T,R>` passed to a static `open()` factory.
- Don't treat a preview feature as deprecated. There is no warning and no removal notice.
- Don't mix the shape from one JDK with a blog post from another. Both compile; only one runs on
  your release.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Subtask` does not exist after a JDK upgrade | Code written against the JEP 453 or earlier `Future` return | Port to the current shape, or drop to `ExecutorService` |
| `throwIfFailed()` / `result()` missing | JDK 23 subclass-per-policy shape; JDK 25 uses `Joiner` | Use the joiner factories for the release you build against |
| `unsupportedClassVersionError` on `Joiner` | Compiled against a newer preview than the runtime | Align `--release` and the runtime |
| ClassNotFoundException only in production | `--enable-preview` present at build, absent at run | Set the run-time flag too, in CI and in the image |
| A consumer's build breaks on a patch-level JDK bump | Preview surface you exposed publicly | Stop exposing it; wrap it |

## Verifying

```bash
# 1. Any production source touching structured concurrency
grep -rn 'StructuredTaskScope' src/main/java/

# 2. Preview flags in the build
grep -rn 'enable-preview' build.gradle* pom.xml

# 3. Preview flags at run time -- the one that is usually missing
grep -rn 'enable-preview' . --include='*.sh' --include='Dockerfile*' --include='*.yaml' --include='*.yml' \
  || echo "NOT SET at run time"

# 4. Which shape is this source written against? (the JDK 23-only members)
grep -rn 'ShutdownOnFailure\|ShutdownOnSuccess\|throwIfFailed\|joinUntil' src/main/java/

# 5. What the JDK 25 docs actually document
#    https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html
```

What this check cannot see: grep cannot tell you whether a member you call is *deprecated* or
*removed* — a removed member is simply absent, and a call through reflection or a method reference
will not appear in source. Nor can it tell you which JDK the next upgrade will bring, which is the
actual risk. The mechanical check that matters is step 3: a build-time flag without a run-time flag
is the single most common way this feature breaks in production only.