---
title: "Removed collectors are silently ignored, not rejected"
rule_id: "RULE-JVM-008"
category: "correctness"
scope: "backend"
applies_to: "CMS, UseConcMarkSweepGC, JEP 363, JEP 410, Parallel GC, UseParallelGC, JVM flags, start scripts"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/363"
---

# Removed collectors are silently ignored, not rejected

A garbage collector flag for a removed collector does not fail the JVM. It prints a `warning:` to
stderr and starts on the default collector. Exit code zero, health check green, deployment
successful — on a different collector than the script's author chose.

## Why

The JEP specifies the warning text and the fallback:

> Trying to use CMS via the -XX:+UseConcMarkSweepGC option will result in the following warning
> message:
>
> Java HotSpot(TM) 64-Bit Server VM warning: Ignoring option UseConcMarkSweepGC; \
> support was removed in <version>
>
> and the VM will continue execution using the default collector.
> ([JEP 363: Remove the Concurrent Mark Sweep (CMS) Garbage Collector](https://openjdk.org/jeps/363))

"Continue execution using the default collector" is the failure. A start script written for JDK 8
and untouched since is now on G1 (on a server-class machine) with CMS's sizing flags, and the
tuning guide warns that combination explicitly:

> Many options that are useful for other collectors to respond in some particular way, have either
> no effect at all, or even decrease throughput and the likelihood to meet the pause-time target.
> An example could be setting young generation sizes that completely prevent G1 from adjusting the
> young generation size to meet pause-time goals.
> ([8 Garbage-First Garbage Collector Tuning](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html))

**Correction worth stating because it is commonly repeated wrong.** JEP 410 removes the
experimental AOT/JIT compiler (`jaotc`, Graal) — not a garbage collector. CMS went in JEP 363, JDK
14. Parallel GC was never removed:

> The parallel collector is intended for applications with medium-sized to large-sized data sets
> that are run on multiprocessor or multithreaded hardware. You can enable it by using the
> -XX:+UseParallelGC option.
> ([5 Available Collectors](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html))

> It is not a goal to remove any other garbage collector.
> ([JEP 363: Remove the Concurrent Mark Sweep (CMS) Garbage Collector](https://openjdk.org/jeps/363))

Deprecation ran in two steps, and knowing which one you are past tells you what to expect: JEP 291
deprecated CMS for removal in JDK 13 (still functional, warning), JEP 363 removed it in JDK 14
(ignored entirely). There is no third state where the JVM refuses to start.

## Do

- Read stderr in CI. It is the only place the warning appears.
- Strip collector-specific flags when you change collectors rather than carrying them across.
- Pin the collector explicitly (`-XX:+UseG1GC`) so the effective collector never depends on host
  ergonomics.
- Audit start scripts, Dockerfiles and CI configs on every JDK major upgrade, not just when
  something misbehaves.
- Capture startup stderr into your logs. It is usually discarded on a successful exit.

## Don't

- Don't trust exit code as evidence that a flag was accepted.
- Don't keep `-XX:+UseConcMarkSweepGC` "in case you roll back". It is inert, and it hides the fact
  that the rollback target is gone too.
- Don't carry CMS-era `-Xmn`/`NewRatio`/CMS flags across to G1. See `RULE-JVM-007`.
- Don't assume Parallel GC is gone. It is a supported collector.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Service on G1 though the script says CMS | CMS flag ignored with a stderr warning | Remove the flag; migrate the config |
| Pause goals not met after a JDK upgrade | Old collector flags inert or harmful on G1 | Strip and re-tune from the pause goal and heap size |
| Warning never seen in CI | stderr not captured on success | Capture stderr |
| `warning: ... support was removed` in production logs | Flag for a removed feature | Remove it |
| Rollback to JDK 11 fails after a JDK 17 upgrade | AOT/JIT compiler flags (JEP 410) removed | `jaotc`/Graal options are inert on 17+ |

## Verifying

```bash
# 1. Any flag for a removed feature still in the tree
grep -rn 'UseConcMarkSweepGC\|UseCMSInitiatingAtOccupancyThreshold\|UseParNewGC' . \
  --include='*.sh' --include='Dockerfile*' --include='*.service' --include='*.yaml' --include='*.yml' \
  --include='*.env' --include='*.json' --include='*.xml'

# 2. AOT/JIT compiler flags -- removed by JEP 410, a different JEP from CMS
grep -rn 'jaotc\|CompileCommand=.*jdk.internal.vm.compiler\|Graal' . --include='*.sh' --include='*.xml'

# 3. Is the JVM actually warning? stderr on a successful run is the whole signal.
java -XX:+UseConcMarkSweepGC -version 2>&1 | grep -i 'warning'

# 4. Every GC flag in use, for review
grep -rhoE '\-XX:[+-]?[A-Za-z]+(=[^ ]+)?|\-Xm[sx][0-9a-zA-Z]*' . \
  --include='*.sh' --include='Dockerfile*' | sort -u

# 5. Which collector actually starts?
java -Xlog:gc+heap+exit=info -version 2>&1 | head
```

What this check cannot see: the greps find flags in *your* files, not in a base image, a framework
default, or a container orchestrator's JVM args. The check that closes the gap is step 3 combined
with capturing stderr from the real production start command — a flag injected at runtime by a
platform you do not control is invisible to every grep in this list.