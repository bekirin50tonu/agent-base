---
title: "Nothing Crosses the `@Async` Thread Boundary Unless You Attach a TaskDecorator"
rule_id: "RULE-SPRING-003"
category: "correctness"
scope: "all"
applies_to: "Any @Async method that reads MDC, a correlation ID, a tracing span, or request state"
last_updated: "2026-09-30"
source: "https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/TaskDecorator.html"
---

# Nothing Crosses the `@Async` Thread Boundary Unless You Attach a TaskDecorator

An `@Async` method runs on a different thread, and a different thread has an empty thread-local
set. No exception, no log — just a null correlation ID, or a security check that sees no
principal.

## Why

`TaskDecorator` exists for exactly this, and its javadoc says so in the first line of the
contract:

> "**The primary use case is to set some execution context around the task's invocation**, or to
> provide some monitoring/statistics for task execution."

The mechanism is available on the executor, but attaching it is configuration you write:

> "Most `TaskExecutor` implementations provide a way to automatically wrap tasks submitted with a
> `TaskDecorator`. Decorators should delegate to the task it is wrapping, possibly implementing
> custom behavior before/after the execution of the task."

Read that carefully: the executor *can* wrap. Nothing wraps until you say so. The default is an
empty thread-local set on the worker, and security context, MDC (request/correlation IDs),
tracing spans, and Micrometer observation context all live in thread-locals.

Since 6.1 there is a built-in implementation, `ContextPropagatingTaskDecorator`, and it makes the
opt-in explicit twice — once about applicability, once about cost:

> "**This operation is only useful when the task execution is scheduled on a different thread than
> the original call stack; this depends on the choice of `TaskExecutor`.** This is particularly
> useful for **restoring a logging context or an observation context**. **Note that this decorator
> will cause some overhead for task execution and is not recommended for applications that run
> lots of very small tasks.**"

Two constraints fall out of that, and they are load-bearing. First, the decorator's usefulness
depends on *which* executor runs the task — the same choice
`rules/spring/virtual-threads-replace-the-executor-silently.md` describes. Second, it carries a
per-task cost, so it is the wrong tool for a high-frequency small-task workload.

The JDK's own guidance explains why the pairing deserves care. Oracle's virtual-threads guide
warns about the async-framework combination by naming the mechanism:

> "**Note that using thread-local variables to cache shared expensive objects is sometimes done
> behind the scenes by asynchronous frameworks, under their implicit assumption that they are used
> by a very small number of pooled threads. This is one reason why mixing virtual threads and
> asynchronous frameworks is not a good idea: a call to a method may result in instantiating
> costly objects in thread-local variables that were intended to be cached and shared.**"

That is scoped to a thread-local *caching* antipattern, not a blanket ban on `@Async` — but it is
the JDK naming the async-plus-virtual-thread pairing as where the assumption breaks. The
underneath caveat applies regardless of thread flavor:

> "Although virtual threads support thread-local variables and inheritable thread-local variables,
> you should carefully consider using them because a single JVM might support millions of
> virtual threads."

## Do

- **Attach a `TaskDecorator` to the executor that actually runs the task.** If you declare a
  `TaskDecorator` bean, Spring Boot's auto-configured `TaskExecutorBuilder` applies it — but only
  to the auto-configured executor. A hand-rolled `ThreadPoolTaskExecutor` needs the decorator set
  on it explicitly.
- **Use `ContextPropagatingTaskDecorator` for logging and observation context.** That is its
  documented scope and it is the 6.1+ answer; hand-rolling an MDC copy is what it replaced.
- **Size the decision against task frequency.** The javadoc's own caveat is the test: lots of
  very small tasks → skip the decorator, or set a correlation ID explicitly at the call site
  rather than copying a whole context per task.
- **Remember it is a decorator on *an* executor**, so pair it with the executor rule. Enabling
  `spring.threads.virtual.enabled` moves `@Async` onto a different executor, and this decorator
  becomes the only thing carrying your MDC across.
- **Use `CompositeTaskDecorator` when you need more than one.**
  "the `org.springframework.core.task.support.CompositeTaskDecorator` can be used to execute
  sequentially multiple decorators."

## Don't

- **Assume Spring Security context crosses.** The decorator's javadoc scopes itself to "a logging
  context or an observation context" — it does not claim to restore `SecurityContext` or
  request-scoped beans, and the framework docs retrieved do not address either. Treat the security
  case as unverified and pass what you need explicitly.
- **Wrap the user-supplied `Runnable` and expect its exceptions to propagate.** The javadoc warns:
  "Note that such a decorator is not necessarily being applied to the user-supplied
  `Runnable`/`Callable` but rather to the actual execution callback (which may be a wrapper around
  the user-supplied task)" and, for Future-based operations, "the exposed `Runnable` will be a
  wrapper which does not propagate any exceptions from its `run` method." A decorator that
  swallows or rethrows changes behaviour the caller depends on.
- **Attach the decorator to the wrong executor.** "this depends on the choice of `TaskExecutor`" —
  a decorator on a bean nothing uses is dead code that reads as protection.
- **Treat the Oracle sentence as a prohibition on `@Async` + virtual threads.** It is a warning
  about thread-local caching of expensive objects. The accurate reading is a constraint: when you
  combine them, your thread-local caching assumptions are wrong, and that is the diagnostic.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| MDC null inside `@Async`, no error | no `TaskDecorator` attached | attach one to the running executor |
| Correlation ID present in HTTP logs, absent in async logs | same | `ContextPropagatingTaskDecorator` (6.1+) |
| Decorator installed, still no context | attached to an executor nothing uses | confirm which executor runs the task |
| Throughput drops after adding the decorator | per-task overhead on very small tasks | javadoc's own caveat — skip it for small tasks |
| Task never completes / result lost | decorator swallowed an exception from the execution callback | delegate to the wrapped task; see the Future caveat |

## Verifying

```bash
# 1. Is any TaskDecorator present?
grep -rn 'TaskDecorator\|ContextPropagatingTaskDecorator' --include=*.java src/

# 2. Which executor runs @Async? (a declared Executor bean backs off auto-config)
grep -rn 'Executor\b' --include=*.java src/ | grep -iE '@Bean|Executor\s+\w+\s*\('

# 3. Which async methods actually read thread-local state?
grep -rln '@Async' --include=*.java src/ | xargs grep -ln 'MDC\|SecurityContext\|Tracer\|TracerService\|Span'
```

A hit on 1 and 3 with nothing in between is the defect. A hit on 2 means the auto-configured
executor is not in play and the decorator must be set on your bean by hand.
