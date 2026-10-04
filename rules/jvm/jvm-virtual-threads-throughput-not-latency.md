---
title: "Virtual threads buy throughput, not speed — and only where the thread unmounts"
rule_id: "RULE-JVM-003"
category: "performance"
scope: "backend"
applies_to: "virtual threads, Thread.ofVirtual, Executors, Semaphore, ForkJoinPool, throughput, latency"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/444"
---

# Virtual threads buy throughput, not speed — and only where the thread unmounts

A virtual thread does not make any request faster. It makes more requests run *concurrently* at
the same latency. A CPU-bound endpoint sees the same throughput it saw before, because the same
work runs on the same cores.

The corollary is a number, and it is the number people skip: if you never have ten thousand virtual
threads in flight, the change bought you nothing.

## Why

The JEP draws the line in terms you cannot argue with:

> If the tasks in this program performed a calculation for one second (e.g., sorting a huge array),
> rather than merely sleeping, then increasing the number of threads beyond the number of processor
> cores would not help, whether they are virtual threads or platform threads. Virtual threads are
> not faster threads — they do not run code any faster than platform threads. They exist to provide
> scale (higher throughput), not speed (lower latency).
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

Throughput here is a Little's-Law quantity. Latency per request is unchanged; concurrency is what
moves. A reviewer who expects a p99 improvement from the migration will measure one and conclude
the feature failed.

The threshold is documented rather than folklore:

> As a rule of thumb, if your application never has 10,000 virtual threads or more, it is unlikely
> to benefit from virtual threads. Either it experiences too light a load to need better
> throughput, or you have not represented sufficiently many tasks to virtual threads.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

Which is why the obvious conversion is the wrong one:

> Converting n platform threads to n virtual threads would yield little benefit; rather, it's tasks
> that need to be converted.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

A pool's size was a proxy for a concurrency limit. Virtual threads need a different limit, and the
docs are blunt about pools now:

> But restricting concurrency is only a side-effect of thread pools' operation. Pools are designed
> to share scarce resources, and virtual threads aren’t scarce and therefore should never be
> pooled!
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

The ceiling is also not where people expect. Scheduling is non-preemptive, so a CPU-bound virtual
thread never yields and cannot be forced off:

> To take advantage of virtual threads, it is not necessary to rewrite your program. Virtual
> threads do not require or expect application code to explicitly hand control back to the
> scheduler; in other words, virtual threads are not cooperative.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

> The scheduler does not currently implement time sharing for virtual threads. Time sharing is the
> forceful preemption of a thread that has consumed an allotted quantity of CPU time.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

## Do

- Measure concurrent in-flight tasks, not thread count, to decide whether the migration is worth
  anything. If the peak is under ten thousand, it is not.
- Convert **tasks**, not threads: one virtual thread per request or per unit of work.
- Bound concurrency with a `Semaphore` — around the database is the usual place — because that is
  the scarce resource virtual threads are not.
- Verify the win on *throughput at fixed latency*, not on p99.

## Don't

- Don't expect a latency improvement. There is none to find.
- Don't convert `Executors.newFixedThreadPool(16)` to
  `newVirtualThreadPerTaskExecutor()` and call it done. The pool size was the limit; removing it
  without adding a `Semaphore` moves the bottleneck to the database.
- Don't port CPU-bound work. It was already correctly sized by the pool.
- Don't reason about virtual-thread behaviour by analogy to `ForkJoinPool.commonPool()`. The
  scheduler is a *different* pool:

> The JDK's virtual thread scheduler is a work-stealing ForkJoinPool that operates in FIFO mode.
> The parallelism of the scheduler is the number of platform threads available for the purpose of
> scheduling virtual threads. By default it is equal to the number of available processors, but it
> can be tuned with the system property jdk.virtualThreadScheduler.parallelism. This ForkJoinPool
> is distinct from the common pool which is used, for example, in the implementation of parallel
> streams, and which operates in LIFO mode.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| No p99 improvement after migration | Virtual threads buy throughput, not latency | Measure requests/second at fixed latency instead |
| No throughput improvement either | Tasks not converted, or peak concurrency under 10,000 | Convert tasks; measure concurrency first |
| Connection-pool exhaustion under load | Pool size removed with no replacement limit | Bound with a `Semaphore` at the resource |
| One CPU-bound task starves others | Non-preemptive scheduling, no time sharing | Keep CPU work on a bounded platform pool |
| Behaviour differs from parallel streams | Scheduler pool is FIFO and separate from the LIFO common pool | Don't reason by analogy |

## Verifying

```bash
# 1. What is the actual in-flight concurrency? (pool utilisation over a load test)
#    < 10000 sustained => virtual threads will not help
# 2. What is the throughput at fixed latency? Not p99.
# 3. Where is concurrency still being limited by a pool?
grep -rn 'newFixedThreadPool\|newCachedThreadPool\|Executors\.' src/main/java/

# 4. Is there a limit at all after conversion?
grep -rn 'Semaphore\|newVirtualThreadPerTaskExecutor' src/main/java/

# 5. Scheduler parallelism actually in force
java -Xlog:os+container=trace -jar app.jar 2>&1 | head
java -XX:+PrintFlagsFinal -version | grep -i virtualThreadScheduler
```

What this check cannot see: none of these tell you the in-flight task count, which is the only
number that decides the question. That has to come from a load test that reports concurrency over
time, or from the framework's own metrics — and the "ten thousand" threshold is a documented rule of
thumb, not a measured constant, so treat the measurement as decisive and the number as a
screening filter.