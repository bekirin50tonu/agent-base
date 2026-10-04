---
language: "JVM"
tag: "java"
ecosystem: "backend"
last_updated: "2026-10-04"
summary: "Routing hub for the JVM runtime itself: virtual threads, structured concurrency, scoped values, records and sealed types, and the GC and JIT defaults that are correct and not what the author assumed."
---

# Documentation Hub: JVM

> **Agent Directive (Phase 4)**: Inspect the target project for `module-info.java`, `pom.xml` /
> `build.gradle[.kts]` (`<maven.compiler.release>`, `sourceCompatibility`, `toolchain`), a
> `.java-version` file, a `Dockerfile` base image tag, or any `--enable-preview` flag. Then grep
> for `synchronized`, `ThreadLocal`, `InheritableThreadLocal`, `Executors.newVirtualThread`,
> `Thread.ofVirtual`, `StructuredTaskScope`, `ScopedValue`, `record `, `sealed `, `non-sealed`,
> `permits`, `MatchException`, `UseConcMarkSweepGC`, `UseParallelGC`, `UseG1GC`, `TieredCompilation`,
> `ReservedCodeCacheSize`, `-Xmn`, `NewRatio`, and `MaxGCPauseMillis`. Match the conditions below to
> determine which `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Scope**: this hub is the JVM runtime and the Java language features that change how a program
> behaves under concurrency or across a deployment. It does **not** cover frameworks —
> `ExecutorService` semantics as Spring configures them, `@Async`, JPA or Spring Security live in
> the `Java` topic (`docs/java.md`), and there is a separate `docs/laravel.md`, `docs/ruby.md` and
> `docs/python.md`. A project can match both hubs; judge each entry separately. If the defect is
> "the framework did not do what its documentation says", it is not this hub.
>
> **Status**: twelve rules, covering the places where the platform's documented behaviour is
> correct and silently not what the author assumed — virtual threads that pin and do not grow,
> thread-locals whose caching rationale inverts under them, preview APIs whose shape drifts,
> sealed hierarchies whose compile-time proof expires, and GC/JIT defaults that are tuned for
> neither. No `skills` and no `shared` assets yet.
>
> **Version note**: written against **JDK 25**, the current LTS. Three boundaries are
> load-bearing. JDK 25 is the newest LTS; **JDK 27 exists but is not LTS**, and every URL here is
> pinned to `/en/java/javase/25/` rather than to a floating `/javase/latest/`. `StructuredTaskScope`
> and `ScopedValue` are **preview** APIs: `StructuredTaskScope` has changed shape across JEP 446,
> 499 and 505, and `ScopedValue` was finalized in JEP 506 only after shipping as preview under a
> different signature. A project on `--enable-preview` is on a versioned API and must be checked
> against its own JDK's release notes, not against this page. **CMS was removed in JDK 14 by JEP
> 363**; AOT/JIT compiler removal is JEP 410, a different JEP, and Parallel GC was never removed.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/jvm/jvm-virtual-thread-pinning-capacity-ceiling.md`
  - **Why**: `synchronized` pins a virtual thread, and the scheduler does not grow to compensate.
    The pool that was sized to be a bottleneck on platform threads is gone, so the pinning becomes
    the ceiling instead of the pool — and the failure is throughput-shaped, not an exception. A
    lock held across a blocking call caps concurrency at the number of locks, which is a number
    nobody chose deliberately.
  - **When**: Target project uses `Executors.newVirtualThreadPerTaskExecutor` or
    `Thread.ofVirtual` **and** contains `synchronized` blocks or methods on any path those tasks
    run.
  - **Target Location**: `docs/rules/jvm/jvm-virtual-thread-pinning-capacity-ceiling.md`

- **Path**: `rules/jvm/jvm-virtual-thread-scoped-value-over-thread-local.md`
  - **Why**: A virtual thread's thread-local is its own — so a cached-object thread-local inverts
    under it. The cache existed because platform threads are pooled and reused; a virtual thread is
    never pooled, so the reuse that would amortise the object never happens, and the cost paid per
    task is higher, not lower. This is the one rule in the set where the migration is a silent
    regression rather than an error.
  - **When**: Target project uses virtual threads and also uses `ThreadLocal` or
    `InheritableThreadLocal` to carry context, a request id, a security principal, or a cached
    per-thread object.
  - **Target Location**: `docs/rules/jvm/jvm-virtual-thread-scoped-value-over-thread-local.md`

- **Path**: `rules/jvm/jvm-virtual-threads-throughput-not-latency.md`
  - **Why**: Virtual threads buy throughput, not speed. Where the task unmounts, more tasks run at
    once and per-task latency is unchanged or better; where the task is CPU-bound or pinned, the
    work was already saturated and the switch adds overhead. The claim "virtual threads make it
    faster" is the load-bearing mistake, because it justifies the migration without a
    measurement.
  - **When**: Target project is adopting, has adopted, or is benchmarking virtual threads, and the
    stated goal is latency rather than concurrency.
  - **Target Location**: `docs/rules/jvm/jvm-virtual-threads-throughput-not-latency.md`

- **Path**: `rules/jvm/structured-task-scope-preview-api-shape-drift.md`
  - **Why**: `StructuredTaskScope` is preview and its shape has drifted with every JEP — the
    factory methods, the result type, and the failure behaviour have each changed across JEP 446,
    499 and 505. Code written against one JDK does not compile against the next, and blog posts
    and model answers describing the older shape are confidently wrong rather than obviously
    broken.
  - **When**: Target project compiles with `--enable-preview`, or contains
    `StructuredTaskScope`, `StructuredTaskScope.open`, `ShutdownOnFailure`, or
    `StructuredTaskScope.Subtask`.
  - **Target Location**: `docs/rules/jvm/structured-task-scope-preview-api-shape-drift.md`

- **Path**: `rules/jvm/structured-scope-failure-propagation-joiner-policy.md`
  - **Why**: A scope's children do not propagate failure — the joiner decides. What happens when
    one child throws is a policy you choose in the join call, not a property of the scope, so the
    default is not "fail the scope". A child that fails silently while siblings continue is a
    correct configuration for independent fan-out and a data-loss bug for a request/response shape,
    and the code looks identical.
  - **When**: Target project contains `StructuredTaskScope`, `join()`, `joinAll()`, or
    `invokeAll()` where more than one task runs and the failure policy matters to the result.
  - **Target Location**: `docs/rules/jvm/structured-scope-failure-propagation-joiner-policy.md`

- **Path**: `rules/jvm/scoped-values-bounded-scope-not-thread-local.md`
  - **Why**: `ScopedValue` replaces `ThreadLocal` where scope is the point. It is immutable,
    write-once, and bound at a structure that can be statically checked — so it cannot be set in
    a child and silently diverge, which is the defect that makes `ThreadLocal` hard to reason
    about in a virtual-thread or `CompletableFuture` codebase. It is also preview, which is why the
    rule exists.
  - **When**: Target project uses `ThreadLocal` to propagate request-scoped or
    task-scoped context across an async boundary, or already references `ScopedValue`.
  - **Target Location**: `docs/rules/jvm/scoped-values-bounded-scope-not-thread-local.md`

- **Path**: `rules/jvm/g1-defaults-not-neutral.md`
  - **Why**: G1 is the default collector on a server-class machine and its defaults are not
    neutral. `MaxGCPauseMillis`, the young-generation sizing flags, and the collector's own
    ergonomics interact, so a flag carried over from a CMS-era start script is either inert or
    actively harmful — Oracle's tuning guide says a flag that looks like tuning can prevent G1
    from meeting the pause goal. The default collector is doing something specific, not nothing.
  - **When**: Target project sets any GC flag (`-XX:+UseG1GC`, `-Xmn`, `NewRatio`,
    `MaxGCPauseMillis`, `InitiatingHeapOccupancyPercent`) or relies on the default collector
    without having chosen one.
  - **Target Location**: `docs/rules/jvm/g1-defaults-not-neutral.md`

- **Path**: `rules/jvm/removed-collectors-flags-warn-not-fail.md`
  - **Why**: Removed collectors are silently ignored, not rejected. A flag for a removed feature
    prints a `warning:` to stderr and the VM continues on the default collector — exit code zero,
    health check green, deployment successful, on a different collector than the script's author
    chose. Note the common misattribution: JEP 410 removed the AOT/JIT compiler, not a
    collector; CMS went in JDK 14 by JEP 363, and Parallel GC was never removed at all.
  - **When**: Target project pins an older JDK in a Dockerfile or start script, or any JVM flag
    for `CMS`, `UseConcMarkSweepGC`, `UseParNewGC`, `jaotc` or `Graal` appears in its config.
  - **Target Location**: `docs/rules/jvm/removed-collectors-flags-warn-not-fail.md`

- **Path**: `rules/jvm/tiered-compilation-means-first-calls-are-interpreted.md`
  - **Why**: Tiered compilation means the first calls are interpreted, and the warm-up is measured
    in invocations with no API that reports when it ended. A benchmark of the first thousand calls
    measures something the JIT will never produce in production, and escape analysis does **not**
    stack-allocate — it either eliminates the allocation or leaves it on the heap, and which one
    you got depends on an inlining decision the compiler makes silently. The `-XX` surface is
    also explicitly outside the Java API and changes between releases.
  - **When**: Target project benchmarks JVM code, passes `-XX` flags, generates code at runtime,
    or is a long-running service whose throughput degrades hours after start.
  - **Target Location**: `docs/rules/jvm/tiered-compilation-means-first-calls-are-interpreted.md`

- **Path**: `rules/jvm/jvm-record-accessor-is-a-method-not-a-field.md`
  - **Why**: A record's component is accessed by a method, and `equals`/`hashCode` freeze what it
    returns. `r.length` does not compile when `r` is a record — `r.length()` does — which is why
    records do not interoperate with reflection, ORMs and serializers written for field access.
    The second half is quieter: immutability is shallow, so a mutable component silently changes
    the record's generated `hashCode` and a `HashMap` that holds it can no longer find it.
  - **When**: Target project declares records, or serialises, reflects over, or ORM-maps types that
    might be records.
  - **Target Location**: `docs/rules/jvm/jvm-record-accessor-is-a-method-not-a-field.md`

- **Path**: `rules/jvm/jvm-sealed-switch-exhaustiveness.md`
  - **Why**: A sealed type's `permits` list is a compile-time contract, and a `switch` over it
    stops being exhaustive the moment a subclass is added. The `permits` list bounds one level
    only — one `non-sealed` link reopens the hierarchy below it — and a `default` branch makes the
    new case compile and be silently absorbed. Removing `default` is the only mechanism the
    language offers for making the obligation enforced rather than merely available.
  - **When**: Target project declares `sealed` types and switches over them, especially anywhere a
    `default` branch is present.
  - **Target Location**: `docs/rules/jvm/jvm-sealed-switch-exhaustiveness.md`

- **Path**: `rules/jvm/jvm-exhaustive-switch-throws-matexception-on-unrecompiled-hierarchy.md`
  - **Why**: An exhaustive `switch` throws `MatchException` when the sealed hierarchy changed but
    the switch was not recompiled. The proof is a compile-time fact about the bytecode it was
    compiled from, it is "migration incompatible" by Oracle's own wording, and nothing in the
    build fails. An enum switch degrades in the opposite direction — the compiler inserts an
    implicit default — so the same change shape produces opposite failure modes depending on which
    kind of switch you wrote.
  - **When**: Target project switches over sealed types or enums **and** uses incremental
    compilation, splits across modules or jars, or consumes a dependency that may change a sealed
    hierarchy.
  - **Target Location**: `docs/rules/jvm/jvm-exhaustive-switch-throws-matexception-on-unrecompiled-hierarchy.md`

## 2. Skills (`skills/`)

_None yet._

## 3. Agents (`agents/`)

- **Path**: `agents/jvm/agent.json`
  - **Why**: Helps with plain-JVM tasks where the platform's documented behaviour is correct and
    the author's model of it is wrong — deciding whether a `synchronized` block will pin a
    virtual thread and cap concurrency at the number of locks, moving request context from
    `ThreadLocal` to `ScopedValue` instead of caching per-thread objects that a virtual thread
    never reuses, choosing a structured-concurrency joiner policy that fails the scope when a
    child fails, stripping GC flags for collectors that were removed rather than trusting the exit
    code, warming up before benchmarking instead of measuring interpreted first calls, and
    recompiling a sealed hierarchy's switch consumers rather than shipping an artifact whose
    exhaustiveness proof has expired.
  - **When**: Target project builds Java and contains any of `synchronized`,
    `ThreadLocal`, `Executors.newVirtualThread`, `StructuredTaskScope`, `ScopedValue`, `record`,
    `sealed`, `--enable-preview`, or JVM GC/JIT flags. Framework-level Java (Spring Boot,
    `@Async`, JPA) is a different hub — `docs/java.md` — and a project can match both.
  - **Target Location**: `docs/agents/jvm/agent.json`

## 4. Shared Assets (`shared/`)

_None yet._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.