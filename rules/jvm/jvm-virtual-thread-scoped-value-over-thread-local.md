---
title: "A virtual thread's thread-local is its own — so cache nothing in it"
rule_id: "RULE-JVM-002"
category: "performance"
scope: "backend"
applies_to: "virtual threads, ThreadLocal, InheritableThreadLocal, ScopedValue, newVirtualThreadPerTaskExecutor"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html"
---

# A virtual thread's thread-local is its own — so cache nothing in it

The cached-object thread-local is not a bad pattern under virtual threads; it is an inverted one.
It exists to build an expensive object once and reuse it across many tasks. Virtual threads are
never pooled and never reused by unrelated tasks, so the reuse never happens — every task pays the
construction cost, and every concurrent virtual thread holds its own copy.

The context-carrying thread-local is a different case and still works. That distinction is the
rule.

## Why

The pattern the JDK warns about by name is the formatter cache:

> There is another use of thread-local variables which is fundamentally at odds with virtual
> threads: caching reusable objects.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

> However, virtual threads are never pooled and never reused by unrelated tasks. Because every
> task has its own virtual threads, every call to foo from a different task would trigger the
> instantiation of a new SimpleDateFormat.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

> Moreover, because there may be a great many virtual threads running concurrently, the expensive
> object may consume quite a lot of memory. These outcomes are the very opposite of what caching in
> thread locals intends to achieve.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

The arithmetic behind it: a thread-local is keyed by thread identity, and the cost model assumed
few threads. Under virtual threads the population is not few.

> Although virtual threads support thread-local variables and inheritable thread-local variables,
> you should carefully consider using them because a single JVM might support millions of virtual
> threads.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

Context carriers are explicitly fine, and the destination is named:

> Usually, thread-local variables are used to associate some context-specific information with the
> currently running code, such as the current transaction and user ID. This use of thread-local
> variables is perfectly reasonable with virtual threads. However, consider using the safer and
> more efficient scoped values.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

`InheritableThreadLocal` is the third case, and it is the most expensive because the copy is per
child:

> When a developer chooses to create a child thread that inherits thread-local variables, the child
> thread has to allocate storage for every thread-local variable previously written in the parent
> thread.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

> This is unfortunate, because in practice child threads rarely call the set method on their
> inherited thread-local variables.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

Under a platform pool that copy is bounded by pool size. Under virtual threads it scales with
concurrent tasks.

## Do

- Classify every `ThreadLocal` static field into **cache** or **carrier** before converting anything.
  Caches get deleted, carriers get migrated.
- Delete cached non-thread-safe objects (`SimpleDateFormat`, `DecimalFormat`, per-thread Jackson
  mappers, compiled `Pattern`). Under virtual threads the correct replacement is a method-local
  allocation or a thread-safe alternative, because there is no shared thread to cache on.
- Migrate context carriers to `ScopedValue` when the data flows one way — which is most of them:

  > In general, we advise migration to scoped values when the purpose of a thread-local variable
  > aligns with the goal of a scoped value: one-way transmission of unchanging data.
  > ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

- Replace `InheritableThreadLocal` with a `ScopedValue` bound by `StructuredTaskScope`, which
  inherits without copying.
- If code must keep working on both thread models, convert it as two separate changes and keep the
  pool-based path on its own executor until the virtual-thread path is proven.

## Don't

- Don't port a thread-local cache to virtual threads "to preserve the optimization". You are
  keeping the cost and removing the benefit.
- Don't use `newVirtualThreadPerTaskExecutor()` and then assume a thread-local is shared across
  tasks. It is not, by design.
- Don't delete an `InheritableThreadLocal` without checking what depended on the implicit copy —
  request context, tenant id, trace id. Those need a real replacement, not removal.
- Don't assume a cached thread-local is a memory leak on platform threads. It is bounded by pool
  size; under virtual threads the same code is unbounded.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Memory climbs with concurrent task count | Cached object in a thread-local, one per virtual thread | Delete the cache; allocate per call |
| `SimpleDateFormat` constructed once per request under load | Same | Same |
| Latency worsens with concurrency while memory is fine | `InheritableThreadLocal` copying on every fork | Move to `ScopedValue` |
| Request context missing in a spawned task | Thread-local not inherited by that executor | Bind a `ScopedValue` and fork via `StructuredTaskScope` |
| Value leaks between tasks on a platform pool | `remove()` never called in a finally | Wrap in try/finally, or migrate to `ScopedValue` |

## Verifying

```bash
# 1. Every thread-local in the tree, with its declaring type — this is the audit list
grep -rn 'ThreadLocal' src/main/java/ \
  | grep -E 'static|final' \
  | sed 's/:.*ThreadLocal/ -> ThreadLocal/' | sort -u

# 2. Caches specifically: the anti-pattern. withInitial + a non-thread-safe type
grep -rnE 'ThreadLocal(\.with)?Initial' src/main/java/ \
  | grep -iE 'format|mapper|pattern|builder|buffer|calendar'

# 3. Inheritable — the per-child copy cost
grep -rn 'InheritableThreadLocal' src/main/java/

# 4. Virtual threads actually in use, so the audit above has teeth
grep -rn 'ofVirtual\|newVirtualThreadPerTaskExecutor' src/main/java/

# 5. Nothing left after conversion
grep -rn 'ThreadLocal' src/main/java/ | grep -v '//' || echo "clean"
```

What this check cannot see: the grep finds the declaration, not whether the value is still read —
a `ThreadLocal` in a legacy package that is never reached costs nothing. And it cannot tell a
cache from a carrier: both are a `ThreadLocal` with a `get()`. Only the declaring type and the
call sites distinguish them, so the audit is a reading task and step 2 is a hint, not a verdict.