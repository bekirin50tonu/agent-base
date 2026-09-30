---
title: "`spring.threads.virtual.enabled` Silently Replaces the Executor — Pool Tuning Stops Applying"
rule_id: "RULE-SPRING-002"
category: "correctness"
scope: "all"
applies_to: "Any Spring Boot application using @Async, @EnableAsync, or spring.task.* pool properties"
last_updated: "2026-09-30"
source: "https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html"
---

# `spring.threads.virtual.enabled` Silently Replaces the Executor — Pool Tuning Stops Applying

One property, default `false`, decides what thread your `@Async` methods run on. Turning it on
does not add virtual threads alongside your pool — it replaces the pool, and the properties you
were tuning stop describing what happens.

## Why

`@Async` never names a thread. Its entire contract is "submit to a `TaskExecutor` and return
early" — *"the actual execution of the method occurs in a task that has been submitted to a
Spring TaskExecutor."* Which executor that is, is an auto-configuration decision:

> "In the absence of an `Executor` bean in the context, Spring Boot auto-configures an
> `AsyncTaskExecutor`. When virtual threads are enabled (using Java 21+ and
> `spring.threads.virtual.enabled` set to `true`) this will be a `SimpleAsyncTaskExecutor` that
> uses virtual threads. Otherwise, it will be a `ThreadPoolTaskExecutor` with sensible defaults."

So the same `@Async` method runs on a bounded pool of 8 core threads by default, and on
thread-per-invocation when the property is on. `SimpleAsyncTaskExecutor` is documented as
choosing the second shape outright: *"This implementation does not reuse any threads. Rather, it
starts up a new thread for each invocation."*

The blast radius is wider than `@Async`. Boot lists seven integrations that silently adopt the
same executor:

> "The auto-configured `AsyncTaskExecutor` is used for the following integrations unless a custom
> `Executor` bean is defined:
> - Execution of asynchronous tasks using `@EnableAsync`, unless a bean of type `AsyncConfigurer`
>   is defined.
> - Asynchronous handling of `Callable` return values from controller methods in Spring for
>   GraphQL.
> - Asynchronous request handling in Spring MVC.
> - **Support for blocking execution in Spring WebFlux.**
> - Utilized for inbound and outbound message channels in Spring WebSocket.
> - Bootstrap executor for JPA, based on the bootstrap mode of JPA repositories.
> - Bootstrap executor for background initialization of beans in the `ApplicationContext`."

Read that list before enabling the property in a WebFlux application: *"Support for blocking
execution in Spring WebFlux"* is item four. An accidental blocking call in a reactive handler
moves from a bounded 8-thread pool to a thread per call.

The scheduler side loses its configuration in the same breath:

> "If virtual threads are enabled … this will be a `SimpleAsyncTaskScheduler` that uses virtual
> threads. **This `SimpleAsyncTaskScheduler` will ignore any pooling related properties.**"

And the pool it replaced was: *"the thread pool uses 8 core threads that can grow and shrink
according to the load."*

The failure is configuration drift, not a code defect. A team flips the property in one
environment, or inherits it from a shared `application.yml`, and every concurrency limit that
was enforced by the pool is now enforced by nothing.

## Do

- **Treat the property as an application-wide decision, not a per-method one.** It is one line of
  config whose scope is the whole application, and it moves seven integrations plus the
  scheduler.
- **Check for a declared `Executor` bean first — it wins, silently.** *"By default, when a custom
  `Executor` bean is registered, the auto-configured `AsyncTaskExecutor` backs off, and the custom
  `Executor` is used for regular task execution (via `@EnableAsync`)."* If your app declares any
  `Executor`, the property may have no effect on `@Async` at all — verify rather than assume.
- **To keep both, register an `AsyncConfigurer` bean.** *"The only way to override the Executor for
  regular tasks is by registering an `AsyncConfigurer` bean."* That is the documented escape
  hatch; declaring a plain `Executor` bean is not.
- **Attach a `TaskDecorator` when you enable it** — see
  `rules/spring/async-context-propagation-is-opt-in.md`. A thread boundary is a context boundary,
  and the decorator is the only thing that carries MDC or the security principal across.
- **Evaluate on throughput, not latency.** Oracle's framing is explicit: *"Virtual threads are not
  faster threads; they do not run code any faster than platform threads. They exist to provide
  scale (higher throughput), not speed (lower latency)"* and *"they aren't intended for
  long-running CPU-intensive operations."* A CPU-bound service gets nothing from this property
  and pays for unbounded thread creation.
- **Re-derive any runbook that cites `spring.task.execution.pool.*`.** With virtual threads on,
  those properties no longer describe the executor. Note that `VirtualThreadTaskExecutor` exists
  in the framework but is **not** what Boot selects — auto-configuration picks
  `SimpleAsyncTaskExecutor`, which carries its own optional concurrency limit that is not
  `pool.max-size`.

## Don't

- **Cite "virtual threads don't work with WebFlux" as a vendor constraint.** It is not in Boot's
  reactive or servlet reference pages (verified by full-text search of both, zero hits). What the
  docs actually say is the opposite shape: one executor serves both stacks, and enabling the
  property changes what WebFlux's blocking escape hatch is made of. Cite the executor list, not
  the folklore.
- **Assume a custom `Executor` bean you registered still governs `@Async` after a
  `spring.task.execution.mode=force` change.** The back-off is the default, and `force` reverses
  it; that switch is a third mechanism interacting with the other two.
- **Enable the property in a shared base config and tune per environment.** The failure surfaces in
  the environment nobody benchmarked, because the property is a profile-level edit.
- **Assert request-lifetime semantics from this rule.** What happens to a virtual thread when the
  originating request returns is not documented in the Boot or Framework task-execution pages, and
  is asserted constantly in blog posts without a primary source.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `@Async` methods now unbounded; pool metrics flat | property on → `SimpleAsyncTaskExecutor`, thread per invocation | set a concurrency limit on the executor, or revert |
| `spring.task.execution.pool.max-size` has no effect | same property replaced the pool | tuning knob moved; find the real limit |
| Scheduled jobs ignore `spring.task.scheduling.pool.*` | `SimpleAsyncTaskScheduler` "will ignore any pooling related properties" | expect no pooling; re-size the workload |
| Property set, `@Async` behaviour unchanged | a custom `Executor` bean made auto-config back off | register an `AsyncConfigurer` to override deliberately |
| WebFlux handler exhausts threads on a blocking call | blocking support now draws on a thread-per-invocation executor | fix the blocking call; the pool is no longer bounding it |

## Verifying

```bash
# 1. Is the property set anywhere?
grep -rn 'spring.threads.virtual.enabled\|spring:\s*$' --include=*.yml --include=*.yaml \
  --include=*.properties src/ config/ 2>/dev/null

# 2. Does a declared Executor bean win over it?
grep -rn 'Executor\b' --include=*.java src/ | grep -iE '@Bean|Executor\s+\w+\s*\('

# 3. Java 21+ is the floor for the feature
grep -rn '<java.version>\|<maven.compiler' pom.xml build.gradle* 2>/dev/null
```

Findings 1 and 2 together decide which executor actually runs your `@Async` work. If 1 is
absent and 2 is present, the executor is yours and this rule does not apply to the method's
thread — the `Executor` bean decides.
