---
title: "ScopedValue replaces ThreadLocal where scope is the point"
rule_id: "RULE-JVM-006"
category: "architecture"
scope: "backend"
applies_to: "ScopedValue, ThreadLocal, InheritableThreadLocal, StructuredTaskScope, ForkJoinPool, virtual threads"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/506"
---

# ScopedValue replaces ThreadLocal where scope is the point

`ScopedValue` is finalized in JDK 25 (JEP 506) — not preview, which is the point that makes it a
safe migration target. It has no `set` method at all. The value is bound by the caller and dies
when the call returns, and a child thread inherits it **only** if it was forked through
`StructuredTaskScope`.

That last clause is the whole safety argument, and it is also the trap.

## Why

The design is immutable data with a lexical lifetime, and the JEP describes the resulting reasoning
win:

> The structure of the code delineates the period of time when a thread can read its copy of a
> scoped value. This bounded lifetime greatly simplifies reasoning about thread behavior. The
> one-way transmission of data from caller to callees — both direct and indirect — is obvious at a
> glance. There is no set method that lets faraway code change the scoped value at any time.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

Two properties the JEP names explicitly: scoped values are finalized, while thread-local variables
are not:

> We here propose to finalize the scoped values API in JDK 25, with one small change: The
> ScopedValue.orElse method no longer accepts null as its argument.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

> Unbounded lifetime — Once a thread's copy of a thread-local variable is set via the set method,
> the value to which it was set is retained for the lifetime of the thread, or until code in the
> thread calls the remove method.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

**Inheritance is the point most often got backwards.** Scoped values *are* inherited by structured
children — and the inheritance is by reference, not by copy:

> The preferred mechanism for user code to create virtual threads is the Structured Concurrency API
> (JEP 505), specifically the class StructuredTaskScope. Scoped values in the parent thread are
> automatically inherited by child threads created with StructuredTaskScope. Code in a child thread
> can use bindings established for a scoped value in the parent thread with minimal overhead. Unlike
> with thread-local variables, there is no copying of a parent thread's scoped value bindings to the
> child thread.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

What is *not* inherited is the legacy unstructured pools, and the reason is exactly the safety
property:

> The fork/join model offered by StructuredTaskScope means that the dynamic scope of the binding is
> still bounded by the lifetime of the call to ScopedValue.run. The Principal will remain in scope
> while the child thread is running, and scope.join ensures that child threads terminate before run
> can return, destroying the binding. This avoids the problem of unbounded lifetimes seen when using
> thread-local variables. Legacy thread management classes such as ForkJoinPool do not support
> inheritance of scoped values because they cannot guarantee that a child thread forked from some
> parent thread scope will exit before the parent leaves that scope.
> ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

So the binding is safe *because* structured concurrency forbids the child outliving the scope. Swap
`StructuredTaskScope` for `ForkJoinPool` or a raw `Thread` and the guarantee is gone — that is the
case the design forbids rather than handles.

The API names, because they are commonly misremembered: `ScopedValue.where(KEY, value).run(op)`,
`.call(op)` for a return value, and `.where(A, x).where(B, y)` to nest. There is no `runWhere` or
`callWhere` in the finalized API. *(paraphrase — the JEP's own examples below carry the spelling;
no sentence states the absence of the other names.)*

## Do

- Migrate a thread-local when its purpose is one-way transmission of unchanging data, which is what
  the JEP's own test is:

  > In general, we advise migration to scoped values when the purpose of a thread-local variable
  > aligns with the goal of a scoped value: one-way transmission of unchanging data.
  > ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

- Bind with `ScopedValue.where(...).run(...)` at the request or task boundary, and read with `get()`
  anywhere below.
- Fork children through `StructuredTaskScope` when a child needs the binding. That is the only
  executor that carries it.
- Leave two-way thread-locals alone. The JEP rules migration out explicitly:

  > If a codebase uses thread-local variables in a two-way fashion — where a callee deep in the
  > call stack transmits data to a faraway caller via ThreadLocal.set — or in a completely
  > unstructured fashion, then migration is not an option.
  > ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

## Don't

- Don't read a scoped value after the binding returns. It throws rather than returning a stale
  value:

  > The binding established by run is usable only in code called from run. If CONTEXT.get() appeared
  > in Framework.serve after the call to run, an exception would be thrown because CONTEXT is no
  > longer bound in the thread.
  > ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

- Don't expect a `ForkJoinPool` child, a raw `Thread`, or
  `newVirtualThreadPerTaskExecutor()` to see the binding. It will not be there.
- Don't try to mutate one. There is no `set`, and that is the guarantee, not a missing feature.
- Don't pass `null` to `orElse`. The finalized API rejects it.
- Don't assume migration is required. The JDK is not deprecating `ThreadLocal`:

  > It is not a goal to require migration away from thread-local variables, or to deprecate the
  > existing ThreadLocal API.
  > ([JEP 506: Scoped Values](https://openjdk.org/jeps/506))

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `NoSuchElementException` reading a scoped value deep in a call | Read after the binding returned | Move the read inside `run`/`call` |
| Child task cannot see the binding | Forked via `ForkJoinPool`, `Thread`, or a plain executor | Fork via `StructuredTaskScope` |
| Binding appears stale in a cached task | Task outlived the scope, so the thread outlived the binding | Enforce the boundary with join |
| Cannot migrate a thread-local | Two-way use, deep callee writing back | Keep the thread-local; this is not a scoped-value case |
| `IllegalArgumentException` from `orElse(null)` | Finalized API tightened | Pass a non-null default |

## Verifying

```bash
# 1. Every scoped value declaration and its key
grep -rn 'ScopedValue\.' src/main/java/

# 2. Thread-locals still present -- each needs a one-way/two-way verdict
grep -rn 'ThreadLocal' src/main/java/ | grep -E 'static|final'

# 3. Forking outside StructuredTaskScope, where a binding would not be visible
grep -rn 'ForkJoinPool\|new Thread(\|newVirtualThreadPerTaskExecutor\|CompletableFuture.supplyAsync' \
  src/main/java/

# 4. Reads that may escape their binding -- returned values or async submission
grep -rn -B3 -A6 'ScopedValue\.where' src/main/java/ \
  | grep -iE 'return|supplyAsync|runAsync|submit'

# 5. Confirm the release actually has it finalized
javap -version java.lang.ScopedValue
```

What this check cannot see: the failure in this rule is *where the read happens relative to the
binding*, which is a control-flow property no grep can establish. A `get()` inside the lambda is
correct; the same `get()` three frames up is a runtime exception. The instrument for it is a test
that unbinds and asserts the throw — see `RULE-JVM-005`'s Verifying block for the same shape of
argument.