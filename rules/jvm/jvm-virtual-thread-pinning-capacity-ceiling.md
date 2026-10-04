---
title: "synchronized pins a virtual thread, and the scheduler does not grow to compensate"
rule_id: "RULE-JVM-001"
category: "concurrency"
scope: "backend"
applies_to: "virtual threads, Thread.ofVirtual, synchronized, ReentrantLock, jdk.VirtualThreadPinned, jdk.tracePinnedThreads, ForkJoinPool"
last_updated: "2026-10-04"
source: "https://openjdk.org/jeps/444"
---

# synchronized pins a virtual thread, and the scheduler does not grow to compensate

`synchronized` is the one thing under your control that can turn an unbounded virtual-thread
program back into a fixed-size pool. It converts a design that scales with concurrent tasks into
one that scales with `nproc`, silently, while every request still succeeds.

The mechanism is a mismatch between two different blocking situations. When a virtual thread blocks
on ordinary I/O it unmounts, returning its carrier to the pool. When it blocks while holding a
monitor it cannot unmount — the JVM will not split a critical section across two OS threads — so
the carrier is held too. The scheduler's response to the two cases is deliberately different.

## Why

The JEP states the two kinds of compensation explicitly, and the asymmetry is the whole hazard:

> The implementations of these blocking operations compensate for the capture of the OS thread by
> temporarily expanding the parallelism of the scheduler.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

> The scheduler does not compensate for pinning by expanding its parallelism. Instead, avoid
> frequent and long-lived pinning by revising synchronized blocks or methods that run frequently
> and guard potentially long I/O operations to use
> java.util.concurrent.locks.ReentrantLock instead.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

So a `synchronized` block around a JDBC call does not degrade into "slower but progressing". It
removes the growth mechanism entirely, and the application's throughput ceiling becomes the
scheduler's parallelism — which is the processor count, not the thread count.

The bound is easy to miss because the numbers look fine:

> The JDK's virtual thread scheduler is a work-stealing ForkJoinPool that operates in FIFO mode.
> The parallelism of the scheduler is the number of platform threads available for the purpose of
> scheduling virtual threads. By default it is equal to the number of available processors, but it
> can be tuned with the system property jdk.virtualThreadScheduler.parallelism.
> ([JEP 444: Virtual Threads](https://openjdk.org/jeps/444))

A service can hold a million idle virtual threads and still execute on eight cores. The unbounded
number is real; the concurrency is not.

Note also that the Oracle tutorial page defines pinning *narrower* than the JEP does — it names
only native methods and foreign functions, not `synchronized`:

> A virtual thread is pinned when it runs a native method or a foreign function (see Foreign
> Function and Memory API). Pinning does not make an application incorrect, but it might hinder
> its scalability.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

A developer who read only that page would not learn that `synchronized` pins at all.

## Do

- Convert the `synchronized` blocks and methods that run frequently **and** guard a long I/O
  operation to `ReentrantLock`. That is the documented remedy and it is narrow on purpose.
- Leave `synchronized` alone where it is infrequent (startup-only, cold paths) or guards an
  in-memory invariant. The JEP says so directly: "There is no need to replace synchronized blocks
  and methods that are used infrequently (e.g., only performed at startup) or that guard in-memory
  operations."
- Enable `jdk.VirtualThreadPinned` in JFR. It is on by default with a 20 ms threshold, so if you
  have disabled it, turn it back on for any virtual-thread rollout.
- Turn on `jdk.tracePinnedThreads=short` when diagnosing, and `full` when you need the monitor
  frames.

> jdk.VirtualThreadPinned indicates that a virtual thread was pinned (and its carrier thread wasn’t
> freed) for longer than the threshold duration. This event is enabled by default with a threshold
> of 20 ms.
> ([Virtual Threads](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html))

## Don't

- Don't wrap a blocking call — JDBC, HTTP client, a queue drain — in `synchronized` on a virtual
  thread. That is the one shape that reliably converts concurrency into a fixed pool.
- Don't assume `tryLock`, `Lock` and `synchronized` are interchangeable in cost. `ReentrantLock`
  unmounts because it is not a monitor.
- Don't reach for `-Djdk.virtualThreadScheduler.maxPoolSize` as the fix. It raises the ceiling for
  JDK-internal blocking that already expands the pool; it does nothing for pinning, which by
  design never expands.
- Don't diagnose a flat throughput curve from thread counts. A million virtual threads and eight
  carriers produce the same curve as eight platform threads.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Throughput flatlines at core count under virtual threads | `synchronized` held across a blocking call; scheduler does not expand for pinning | `ReentrantLock` around the I/O |
| Thread dump shows fewer carriers than expected | Carriers captured by pinned virtual threads | Find the pins with `jdk.tracePinnedThreads` |
| Latency rises with load while CPU sits idle | Work queued behind pinned carriers | Same |
| JFR shows `jdk.VirtualThreadPinned` spikes | Long monitor hold times | Shorten the critical section, or move the I/O out of it |
| `OutOfMemoryError: unable to create native thread` with virtual threads | Legacy pool of platform threads still in the path, or a carrier-count misconfiguration | Find the `newFixedThreadPool` that survived the conversion |

## Verifying

```bash
# 1. Is pinning happening at all? (JFR event, on by default at 20ms)
jcmd $PID JFR.start name=pin settings=profile filename=/tmp/pin.jfr
#   ... reproduce the slow path under load, then:
jcmd $PID JFR.dump name=pin filename=/tmp/pin-dump.jfr
jfr summary /tmp/pin-dump.jfr | grep -i pinned

# 2. Print a stack trace at the moment of the pin
java -Djdk.tracePinnedThreads=short -jar app.jar

# 3. What is the scheduler actually configured with?
java -Xlog:os+container=trace -jar app.jar 2>&1 | head

# 4. Static sweep: monitors held around likely-blocking calls
grep -rn -A12 'synchronized' src/main/java/ \
  | grep -iE 'jdbc|\.query\(|\.execute|restTemplate|httpClient|\.read\(|\.get\(\)|Future\.get|sleep'

# 5. The ceiling, on a production-shaped machine
java -XX:+PrintFlagsFinal -version | grep -i virtualThreadScheduler
```

What this check cannot see: `jdk.tracePinnedThreads` prints at the *first* blocking operation in a
pinned thread, so a thread that blocks a hundred times prints once and tells you nothing about
frequency. The JFR event is the frequency instrument — use the trace for the stack, the event for
the count. Neither can attribute a throughput plateau to pinning on its own; to make that
attribution, compare throughput against a run with the suspect `synchronized` blocks removed, since
the flag-level diagnostics show where pins occur, not what they cost.