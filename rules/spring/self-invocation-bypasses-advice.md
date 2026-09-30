---
title: "Self-Invocation Bypasses Spring Advice — `this.method()` Is Not Proxied"
rule_id: "RULE-SPRING-001"
category: "correctness"
scope: "all"
applies_to: "Any class carrying @Transactional, @Async, @Cacheable, @Retryable, or a custom @Aspect"
last_updated: "2026-09-30"
source: "https://docs.spring.io/spring-framework/reference/core/aop/proxying.html"
---

# Self-Invocation Bypasses Spring Advice — `this.method()` Is Not Proxied

A call from a method to another method **on the same object** never reaches the proxy, so no
advice runs. No exception, no warning — the annotated method simply executes inline, on the
caller's thread, in the caller's transaction (or none).

## Why

Spring AOP is proxy-based, and the framework docs call the semantics of that one word
"vitally important" before explaining what follows from it:

> "Spring AOP is proxy-based. It is vitally important that you grasp the semantics of what that
> last statement actually means before you write your own aspects or use any of the Spring
> AOP-based aspects supplied with the Spring Framework."

> "However, once the call has finally reached the target object … any method calls that it may
> make on itself, such as `this.bar()` or `this.foo()`, are going to be invoked against the
> `this` reference, and not the proxy. This has important implications. It means that self
> invocation is not going to result in the advice associated with a method invocation getting a
> chance to run. In other words, **self invocation via an explicit or implicit `this` reference
> will bypass the advice**."

The reason is structural, not a defect in the advice. The interception point is the proxy
object. When a method body executes, `this` is the *target* — the real object sitting behind the
proxy. Calling `this.other()` therefore never re-enters the proxy, and there is nothing there to
fire the interceptor.

`@Async` is not exempt. Its default advice mode is named in the scheduling reference:

> "The default advice mode for processing `@Async` annotations is proxy which allows for
> interception of calls through the proxy only. **Local calls within the same class cannot get
> intercepted that way.**"

So the three classic symptoms are one bug with one cause:

| You wrote | You get |
|---|---|
| `@Cacheable public Cat find() { return load(); }`, `load()` is private or `this.`-called | cache miss every time; method runs inline |
| `@Transactional public void place() { this.save(); }` | `save()` joins the caller's transaction, or runs with none |
| `@Async public void handle() { this.work(); }` | runs **synchronously**, blocking the caller |

The symptom is *absence*, not an error. That is why it survives review: the code reads correctly,
the test passes, and the failure surfaces in production as a missing transaction, an endpoint
that quietly got slow, or a cache that is always cold.

## Do

- **Move the advised method to another bean.** The docs' own first remedy is to "refactor your
  code such that the self invocation does not happen … it is the best, least-invasive approach."
  Injecting the collaborator is the structural fix — the call now arrives through a proxy.
- **Check eligibility separately from interception.** Even a call that *does* arrive through the
  proxy is not advised if the method cannot be overridden. The CGLIB rules, verbatim:

  > "final classes cannot be proxied, because they cannot be extended.
  > - final methods cannot be advised, because they cannot be overridden.
  > - private methods cannot be advised, because they cannot be overridden.
  > - Methods that are not visible – for example, package-private methods in a parent class from
  >   a different package – cannot be advised because they are effectively private."

  `private` and `final` methods on a `@Service` are therefore doubly inert: a self-call bypasses
  the proxy, and an external call cannot be advised either.
- **Know which proxy type you have.** JDK dynamic proxies advise only "all of the interfaces
  implemented by the target type"; CGLIB proxies the class but hits the `final`/`private` wall
  above. As of Spring Framework 7.0 the default is global and overridable per bean with
  `@Proxyable(INTERFACES|TARGET_CLASS)`, and `@EnableAsync` "consistently participat[es] in
  unified global default settings" — so proxy-type choice is a one-time decision for the
  application, not a per-annotation one.
- **Set `proxyBeanMethods = false` unless you call `@Bean` methods directly.** `@Configuration`
  is subject to the identical proxy mechanism. The javadoc explains the flag exists to "return
  shared singleton bean instances even in case of direct `@Bean` method calls in user code,"
  implemented "through a runtime-generated CGLIB subclass which comes with limitations such as
  the configuration class and its methods not being allowed to declare final." With the flag
  false, the class is in "@Bean Lite Mode," described as "behaviorally equivalent to removing the
  `@Configuration` stereotype." This is why Boot's own samples write
  `@Configuration(proxyBeanMethods = false)`.

## Don't

- **Reach for `AopContext.currentProxy()`.** The docs offer it and then discourage it twice:
  "This last approach is highly discouraged, and we hesitate to point it out" and "totally
  couples your code to Spring AOP, and it makes the class itself aware of the fact that it is
  being used in an AOP context, which reduces some of the benefits of AOP. It also requires that
  the `ProxyFactory` is configured to expose the proxy." Three conditions to remember and a
  structural coupling to buy one call site — refactor instead.
- **Add `@Async` to a private or `final` method** and expect it to run off-thread. It cannot be
  advised. The method runs inline, and the return looks successful.
- **Put `@Async` on a method inside a `@Configuration` class.** Hard limitation from the javadoc:
  "Note, however, that `@Async` is not supported on methods declared within a `@Configuration`
  class."
- **Read "AspectJ auto proxy" as "AspectJ weaving."** Boot auto-configures
  `@EnableAspectJAutoProxy` — that installs the *Spring AOP proxy* infrastructure, not the advice
  mode that fixes self-invocation. Only `AdviceMode.ASPECTJ` with compile-time or load-time
  weaving removes the limitation, and that is a build-pipeline or JVM-agent change, not an
  annotation change.
- **Assume a passing test suite covers this.** A unit test that constructs the class directly
  (`new OrderService(...)`) has no proxy in the path at all, so the advice was never eligible
  to fire. The test proves nothing either way.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `@Cacheable` method never hits the cache | self-invocation, or method is `private`/`final` | move the method to another bean; drop `final`/`private` |
| `@Transactional` inner method does not roll back | self-invocation joined the caller's transaction | move to another bean; check the call arrives via an injected reference |
| `@Async` method blocks the caller | local call not intercepted (docs: "Local calls … cannot get intercepted that way") | move to another bean; verify the caller holds an injected reference |
| Aspect never fires, no error anywhere | self-invocation, or non-overridable method | `grep` for `this.<advisedMethod>(` inside the same class |
| `@Configuration` class cannot be proxied | `final` class or `final` `@Bean` methods | drop `final`, or set `proxyBeanMethods = false` |

## Verifying

The check is structural, and the two conditions are independent — a class can pass one and fail
the other:

```bash
# 1. Self-invocation: an advised method called via this. inside its own class
grep -rn 'this\.[a-zA-Z]*(' --include=*.java src/ | \
  grep -iE 'this\.(save|update|delete|find|get|handle|process|send|load)[a-zA-Z]*\('

# 2. Eligibility: advised methods that cannot be overridden
grep -rn 'private .*@\|final .*@\|@Transactional\|@Async\|@Cacheable' --include=*.java src/
```

Then read the hits: a `this.foo()` where `foo` carries advice is the bug. Cross-check each
against the CGLIB list — `private` and `final` are already dead on arrival.

AspectJ compile-time or load-time weaving is the documented alternative that removes the
self-invocation limit specifically ("AspectJ compile-time weaving and load-time weaving do not
have this self-invocation issue because they apply advice within the bytecode instead of via a
proxy"). It is a real option, not a free one — it does not change eligibility, executor
selection, or context propagation.
