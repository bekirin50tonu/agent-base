---
language: "Java-Spring"
tag: "spring-boot"
ecosystem: "backend"
last_updated: "2026-09-30"
summary: "Routing hub and decision matrix for Java / Spring Boot assets."
---

# Documentation Hub: Java-Spring

> **Agent Directive (Phase 4)**: Inspect the target project's build file — `pom.xml` or
> `build.gradle` / `build.gradle.kts` — for `spring-boot-starter-*`, `spring-boot-dependencies`,
> or the `org.springframework.boot` plugin. Match the conditions below to determine which
> `rules`, `skills`, `agents`, or `shared` assets to inject.
>
> **Status**: four rules, all from the `@Async` / proxy-mechanism cluster. Phase 2 research is
> complete for that cluster; `@Transactional`, JPA, and Spring Security are not yet covered.
> Report the gap rather than substituting something from another ecosystem.
>
> **Scope**: this hub is Spring Boot. Plain-JDK concerns that are not framework-specific —
> `ExecutorService`, structured concurrency, the JVM itself — belong to the `JVM` topic
> (`docs/jvm.md`), not here. Virtual threads *as Spring configures them* are in scope; virtual
> threads as a JDK feature are not. A project can match both; judge each entry separately.
>
> **Version note**: these rules were synthesized against Spring Boot 4.1.1 and Spring Framework
> 7.0.9. Framework 7.0 unified the global proxy default and added `@Proxyable`; advice is older
> and still applies, but the per-annotation mental model for proxy-type choice is obsolete.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)
- **Path**: `rules/spring/self-invocation-bypasses-advice.md`
  - **Why**: A `this.method()` call never reaches the Spring proxy, so `@Transactional`,
    `@Async`, and `@Cacheable` silently do nothing — no exception, no warning, just a missing
    transaction or a cache that is always cold. The docs state this as the semantics of
    "proxy-based", and name `@Async`'s local-call limitation explicitly.
  - **When**: Target project has any Spring bean carrying `@Transactional`, `@Async`,
    `@Cacheable`, `@Retryable`, or a custom `@Aspect` — which is nearly every Spring Boot service.
    Applies even if no self-invocation is present today; this is the rule that explains one later.
  - **Target Location**: `docs/rules/spring/self-invocation-bypasses-advice.md`

- **Path**: `rules/spring/virtual-threads-replace-the-executor-silently.md`
  - **Why**: `spring.threads.virtual.enabled` (default `false`) replaces the auto-configured
    `ThreadPoolTaskExecutor` with a thread-per-invocation `SimpleAsyncTaskExecutor`, and the
    scheduler it swaps "will ignore any pooling related properties". One line of config moves
    seven integrations and silently invalidates the `spring.task.*` tuning you had.
  - **When**: Target project uses `@Async` / `@EnableAsync`, or sets any `spring.task.*`
    property, or the `spring.threads.virtual.enabled` property anywhere. The rule is what to read
    before enabling that property, so it applies even to a project that has not enabled it.
  - **Target Location**: `docs/rules/spring/virtual-threads-replace-the-executor-silently.md`

- **Path**: `rules/spring/async-context-propagation-is-opt-in.md`
  - **Why**: An `@Async` method runs on a thread whose thread-locals are empty, so MDC, tracing
    spans, and correlation IDs vanish with no error. `TaskDecorator` is the documented crossing
    point, but attaching it is opt-in configuration — the default is an empty context.
  - **When**: Target project has an `@Async` method that reads MDC, a correlation or trace ID, or
    any request-derived state. Also apply when a `TaskDecorator` already exists but context is
    still missing — the likely cause is that it is attached to an executor nothing uses.
  - **Target Location**: `docs/rules/spring/async-context-propagation-is-opt-in.md`

- **Path**: `rules/spring/virtual-threads-and-webflux-share-one-executor.md`
  - **Why**: "Support for blocking execution in Spring WebFlux" is item four on a list of seven
    integrations sharing one auto-configured executor. Enabling virtual threads turns WebFlux's
    blocking escape hatch from a bounded 8-thread pool into thread-per-invocation — and the
    folklore that virtual threads are incompatible with WebFlux is not in the docs at all.
  - **When**: Target project is on the reactive stack, or has `spring-boot-starter-webflux` on
    the classpath, or mixes `WebClient` with an MVC service. Skip for a pure servlet application
    with no reactive dependency — the shared-executor framing does not apply.
  - **Target Location**: `docs/rules/spring/virtual-threads-and-webflux-share-one-executor.md`

## 2. Skills (`skills/`)
_Empty — no Java/Spring skills have been synthesized._

## 3. Agents (`agents/`)

- **Path**: `agents/java/agent.json`
  - **Why**: Helps with Java-related tasks, such as Spring Boot migration, virtual threads, and other Java best practices.
  - **When**: Target project has a Spring Boot dependency (`spring-boot-starter-*` or `spring-boot-dependencies`) or uses the `org.springframework.boot` plugin in Gradle.
  - **Target Location**: `docs/agents/java/agent.json`

## 4. Shared Assets (`shared/`)
_Empty — no Java/Spring-specific shared assets have been synthesized._

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset` and
commit the file in the same push that updates this hub — otherwise consumers get a 404.
