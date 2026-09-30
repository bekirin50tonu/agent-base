---
title: "Reactive and Blocking Work Run on One Executor — Virtual Threads Change Its Shape"
rule_id: "RULE-SPRING-004"
category: "performance"
scope: "all"
applies_to: "Spring Boot applications on the reactive stack (WebFlux) or mixing WebClient with MVC"
last_updated: "2026-09-30"
source: "https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html"
---

# Reactive and Blocking Work Run on One Executor — Virtual Threads Change Its Shape

Spring Boot models blocking and reactive work as consumers of a *single* auto-configured
executor. "Should I use virtual threads or WebFlux?" is therefore the wrong question — the
question is what that shared executor is made of this week.

## Why

Boot's integration list is the whole architecture in one block:

> "The auto-configured `AsyncTaskExecutor` is used for the following integrations unless a custom
> `Executor` bean is defined:
> - Execution of asynchronous tasks using `@EnableAsync` …
> - **Asynchronous request handling in Spring MVC.**
> - **Support for blocking execution in Spring WebFlux.**
> - Utilized for inbound and outbound message channels in Spring WebSocket.
> - …"

Item three is the one that gets misremembered. WebFlux is the primary model — *"it does not
require the servlet API, is fully asynchronous and non-blocking, and implements the Reactive
Streams specification through the Reactor project"* — and blocking is a **bridged** concern
served by that shared executor. Enabling `spring.threads.virtual.enabled` changes what the
bridge is made of:

> "When virtual threads are enabled … this will be a `SimpleAsyncTaskExecutor` that uses virtual
> threads."

…replacing the default, which is *"a `ThreadPoolTaskExecutor`" using *"8 core threads that can
grow and shrink according to the load."*

The consequence for a reactive codebase is concrete: an accidental blocking call in a WebFlux
handler — a JDBC query, a `Thread.sleep`, a synchronous SDK call — stops being bounded by an
8-thread pool and becomes thread-per-invocation. That is the *documented purpose* of the
integration, working correctly. It is also an unbounded thread creation path in a stack whose
entire design assumption is that blocking does not happen.

**On the folklore.** The widely repeated claim "virtual threads don't apply to WebFlux" is not
in Boot 4.1.1's reference documentation. Full-text search of `web/reactive.html` (24 280 chars)
and `web/servlet.html` (48 641 chars) for "virtual thread", `spring.threads.virtual`, and
"keep-alive" returned zero hits. Anyone citing those pages for it is citing a blog. The
documented architecture is the *opposite shape* of the folklore: one executor serves both
stacks, and the property changes what WebFlux's blocking escape hatch is made of.

## Do

- **Read the executor list before enabling virtual threads on a reactive service.** If the
  application is WebFlux, item four is the one that applies, and it is the reason to check what
  the property does to your thread count.
- **Fix the blocking call rather than the pool.** With virtual threads on, an accidental block is
  no longer bounded. That is a loud failure in production instead of a slow one, which is an
  improvement — but it is a defect that was always there.
- **Select the stack deliberately.** Boot's default surprises people:
  *"Adding both `spring-boot-starter-web` and `spring-boot-starter-webflux` modules in your
  application results in Spring Boot auto-configuring Spring MVC, not WebFlux. This behavior has
  been chosen because many Spring developers add `spring-boot-starter-webflux` to their Spring
  MVC application to use the reactive `WebClient`."* If you meant reactive, set
  `spring.main.web-application-type=reactive`.
- **Judge virtual threads on throughput, and only for blocked work.** Oracle: *"Virtual threads
  are not faster threads; they do not run code any faster than platform threads. They exist to
  provide scale (higher throughput), not speed (lower latency)"* and *"they aren't intended for
  long-running CPU-intensive operations."*
- **Scope negative claims to what was actually searched.** "Not in Boot's reactive and servlet
  reference pages" is a statement you can defend; "no Spring document says this" is not, and the
  difference matters when someone repeats it back to you as vendor policy.

## Don't

- **Cite the reactive docs for "virtual threads are incompatible with WebFlux."** Not there. The
  quotable primary fact is the shared-executor list.
- **Add `spring-boot-starter-webflux` to an MVC app expecting reactive.** You get MVC plus a
  `WebClient`, which is the documented outcome and usually what the person wanted — but it is not
  a reactive application, and no async rule about it applies.
- **Assume a `keep-alive` interaction with virtual threads.** `spring.main.keep-alive` is defined
  in the appendix — "Whether to keep the application alive even if there are no more non-daemon
  threads", default `false` — and its interaction with `spring.threads.virtual.enabled` is **not**
  documented in the pages that cover task execution or the reactive stack. Do not assert one.
- **Treat CPU-bound services as virtual-thread candidates.** The property buys throughput on
  blocked work only. On compute-bound work it adds thread-creation cost and no benefit.
- **Generalize from a two-page search to a policy statement.** The verified claim is narrow. Keep
  it that way in anything you write down.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Thread count climbs without bound in a WebFlux app | blocking call, now on a thread-per-invocation executor | remove the blocking call; the pool is no longer bounding it |
| "Blocking execution support" missing from logs | a custom `Executor` bean made auto-config back off | confirm which executor is in play before blaming the property |
| Expected a reactive app, got MVC | both starters on the classpath; MVC wins by default | set `spring.main.web-application-type=reactive` if reactive was intended |
| Latency unchanged after enabling the property | work is CPU-bound, not blocked | virtual threads buy throughput, not speed |
| MVC app now spawns unbounded threads | the property applies app-wide, not per stack | bound the executor or revert |

## Verifying

```bash
# 1. Which stack is actually active?
grep -rn 'spring-boot-starter-web\b\|spring-boot-starter-webflux' pom.xml build.gradle* 2>/dev/null
grep -rn 'web-application-type' --include=*.yml --include=*.properties src/ config/ 2>/dev/null

# 2. Is the executor property set?
grep -rn 'spring.threads.virtual.enabled' --include=*.yml --include=*.properties src/ config/ 2>/dev/null

# 3. Is a custom Executor overriding it?
grep -rn 'Executor\b' --include=*.java src/ | grep -iE '@Bean|Executor\s+\w+\s*\('
```

Finding 1 with both starters means MVC — check the second line of that grep before reading
anything into the rest. Findings 2 and 3 together decide whether the shared executor is the
virtual-thread one or your own.
