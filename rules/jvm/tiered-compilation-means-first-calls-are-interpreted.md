---
title: "Tiered compilation means your first calls are interpreted"
rule_id: "RULE-JVM-009"
category: "performance"
scope: "backend"
applies_to: "tiered compilation, code cache, JIT, C1, C2, escape analysis, -XX flags, warm-up"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html"
---

# Tiered compilation means your first calls are interpreted

A Java program does not tell you when it stopped being slow. There is no API for the warm-up, no
log line, no callback. The warm-up is measured in invocations, not seconds, and a method has three
distinct personalities before it settles: interpreted, client-compiled, then server-compiled.

The practical consequence is that a benchmark of the first thousand calls measures something the
JIT will never produce in production, and an allocation-heavy path that looks free in a profiler
may be free only once escape analysis has warmed up.

## Why

The server VM does not compile a method on its first call. It interprets it and collects profiling
data first:

> Without tired compilation, a server VM uses the interpreter to collect profiling information
> about methods that is sent to the compiler. With tiered compilation, the server VM also uses the
> client compiler to generate compiled versions of methods that collect profiling information about
> themselves.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

> Tiered compilation is enabled by default for the server VM. [...] You can disable tiered
> compilation by using the -XX:-TieredCompilation flag with the java command.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

(Note the documentation's own typo, "tired", preserved verbatim from the source — it is the
Oracle page, not this rule.)

Escape analysis is the mechanism people most often misread. It classifies every new object, and
the one clause that matters is in the same sentence as the elimination:

> After escape analysis, the server compiler eliminates the scalar replaceable object allocations
> and the associated locks from generated code. The server compiler also eliminates locks for
> objects that do not globally escape. It does not replace a heap allocation with a stack
> allocation for objects that do not globally escape.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

So allocation-heavy code does **not** become stack-allocated and free. It is either eliminated
outright (`NoEscape`) or still on the heap (`ArgEscape`), and which one you got depends on an
inlining decision the compiler makes silently.

> NoEscape: The object is a scalar replaceable object, which means that its allocation could be
> removed from generated code.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

> ArgEscape: The object is passed as an argument or referenced by an argument but does not globally
> escape during a call. This state is determined by analyzing the bytecode of the called method.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

The code cache is a fixed budget, and tiered compilation is why it is as large as it is:

> To accommodate the additional profiling code that is generated with tiered compilation, the
> default size of code cache is multiplied by 5x. To organize and manage the larger space
> effectively, segmented code cache is used.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

> The code heap has a fixed size of 3 MB and remaining code cache is distributed evenly among the
> profiled and non-profiled code heaps.
> ([Java HotSpot Virtual Machine Performance Enhancements](https://docs.oracle.com/en/java/javase/25/vm/java-hotspot-virtual-machine-performance-enhancements.html))

A code cache that is merely *full* is a budget outcome, not an error: the JVM stops compiling and
the program silently stays slow. No exception, no log line.

And none of this is API:

> The -XX options are not part of the Java API and can vary from one release to the next.
> ([Troubleshooting Guide and Diagnostic Tools](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html))

## Do

- Warm up before measuring, and record the warm-up iteration count in the benchmark itself.
- Measure a long-running path, not first-call latency, when you are deciding on an optimization.
- Check code cache headroom in a long-running or dynamically-generated-heavy service:

  ```java
  CodeCache cc = ManagementFactory.getCodeCache();
  System.out.println(cc.getUsage());       // used / max
  System.out.println(cc.isCompilationQueueTimeout());
  ```

- Treat `-XX` tuning as version-scoped. Re-check every flag on each JDK major upgrade.
- Prefer reducing allocation and megamorphic call sites in source over reaching for a compiler flag.
  Escape analysis improves when the call site is monomorphic.

## Don't

- Don't benchmark a method's first N calls and report the number as its cost.
- Don't assume escape analysis makes short-lived objects stack-allocated. It does not.
- Don't disable tiered compilation (`-XX:-TieredCompilation`) for a latency-sensitive service. The
  start-up win is real; so is a permanently slower steady state.
- Don't treat a full code cache as an error condition — there is no exception to catch.
- Don't carry `-XX` flags across a JDK major upgrade without re-reading the release's
  documentation.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Benchmark says 10x slower than production | Warm-up measured; first calls are interpreted | Warm up, then measure |
| Throughput drops after several hours | Code cache full; compilation stopped | Raise code cache, or reduce generated code |
| GC pressure unchanged after an "allocation-free" refactor | Objects were `ArgEscape`, not `NoEscape` | Remove the reference so it does not escape; check with `-XX:+PrintEscapeAnalysis` (debug JVM) |
| Latency regressed after a JDK upgrade | An `-XX` flag changed meaning | Re-read the release documentation for every flag |
| Slow steady state after a `-XX:-TieredCompilation` "fix" | Tiering disabled | Re-enable it |

## Verifying

```bash
# 1. Code cache headroom at runtime
java -Xlog:codecache=info -jar app.jar 2>&1 | grep -i 'full\|flushed'
jcmd $PID Compiler.codecache

# 2. Is compilation still happening, or has it given up?
java -Xlog:jit+compilation=debug -jar app.jar 2>&1 | tail -20

# 3. Compiler control, including what tiered compilation is doing
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintFlagsFinal -version \
  | grep -iE 'TieredCompilation|ReservedCodeCacheSize|TieredStopAtLevel|CompileThreshold'

# 4. Escape analysis, on a debug-capable JVM only
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis -jar app.jar 2>&1 | head -40

# 5. Every -XX flag in the tree, for a per-upgrade review
grep -rhoE '\-XX:[+-]?[A-Za-z0-9]+(=[^ ]+)?' . --include='*.sh' --include='Dockerfile*' | sort -u
```

What this check cannot see: nothing here reports the warm-up point, because no API exposes it.
`PrintEscapeAnalysis` shows classifications at the moment of compilation, not which methods were
compiled — a method that never got hot simply does not appear. Step 4 also requires a JVM with
diagnostic flags unlocked, which is not a production build, so the escape classification has to be
confirmed with a profiling run on a separate machine.