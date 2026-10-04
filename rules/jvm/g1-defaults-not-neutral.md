---
title: "G1 is the default collector and its defaults are not neutral"
rule_id: "RULE-JVM-007"
category: "performance"
scope: "backend"
applies_to: "G1, MaxGCPauseMillis, Xmn, NewRatio, G1HeapRegionSize, humongous objects, ergonomics, Full GC"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html"
---

# G1 is the default collector and its defaults are not neutral

Every number G1 uses was picked by a heuristic table tuned for a mid-size server. None of them
describes your workload. The most consequential are a fraction of physical memory, a pause target
that is explicitly a hint, and a humongous threshold that moves when you change `-Xmx`.

## Why

Which collector you get is not a constant. It is a function of the machine:

> These are important garbage collector, heap size, and runtime compiler default selections:
>
> Garbage-First (G1) Collector on server-class machines, Serial Collector otherwise.
> ([2 Ergonomics](https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html))

> The VM considers machines as server-class if the VM detects two or more processors and physical
> memory larger than or equal to 1792 MB.
> ([2 Ergonomics](https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html))

Copy a start script from a CI box to a laptop, or run under a container memory limit, and you have
changed the collector without changing a flag.

The heap defaults are fractions of physical memory — on a 64 GB box that is 1 GB initial, 16 GB
maximum — independent of your live set.

The pause target is the sharpest trap, because the documentation calls it a hint and then says the
goal may be missed:

> The maximum pause-time goal is specified with the command-line option
> -XX:MaxGCPauseMillis=<nnn>. This is interpreted as a hint to the garbage collector that a
> pause-time of <nnn> milliseconds or fewer is desired. The garbage collector adjusts the Java heap
> size and other parameters related to garbage collection in an attempt to keep garbage collection
> pauses shorter than <nnn> milliseconds. [...] In some cases, though, the desired pause-time goal
> can't be met.
> ([2 Ergonomics](https://docs.oracle.com/en/java/javase/25/gctuning/ergonomics.html))

And the option people reach for to fix pauses is what removes them:

> Avoid limiting the young generation size to particular values by using options like -Xmn,
> -XX:NewRatio and others because the young generation size is the main means for G1 to allow it to
> meet the pause-time. Setting the young generation size to a single value overrides and practically
> disables pause-time control.
> ([8 Garbage-First Garbage Collector Tuning](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html))

Humongous allocation is the failure that OOMs with free memory left:

> Humongous objects are objects larger or equal the size of half a region. [...] every humongous
> object gets allocated as a sequence of contiguous regions in the old generation. The start of the
> object itself is always located at the start of the first region in that sequence. Any leftover
> space in the last region of the sequence will be lost for allocation until the entire object is
> reclaimed.
> ([7 Garbage-First (G1) Garbage Collector](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html))

> Humongous objects only move in a last-resort collection effort after a first Full GC failed to
> free enough contiguous memory for another humongous object allocation in a second Full GC in the
> same pause. This process is very slow. Due to space being unavailable for allocation in heap
> regions containing the end of humongous objects, it is still possible that G1 exits the VM with
> an out-of-memory condition.
> ([7 Garbage-First (G1) Garbage Collector](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html))

## Do

- Set `-Xms` and `-Xmx` explicitly from the container limit, and make them equal so the heap never
  has to grow during a traffic ramp.
- Confirm the collector from the log header rather than from memory:

  > G1 is the default collector.
  > ([7 Garbage-First (G1) Garbage Collector](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html))

- Treat `MaxGCPauseMillis` as a target, and verify it against `-Xlog:gc+phases=debug` output, not
  against the flag being present.
- On a Full GC or OOM, check humongous occupancy in `-Xlog:gc+heap=info` **before** growing the heap.
- Raise `-XX:G1HeapRegionSize` when the heap is mostly humongous regions, so fewer objects cross the
  half-region threshold.
- Watch for large buffers, byte arrays, and `Object[]` growth — those are what become humongous.

## Don't

- Don't assume G1. It is machine-dependent, and a container memory limit can flip it.
- Don't set `-Xmn`, `-XX:NewRatio`, or a single-sided `-XX:NewSize`/`MaxNewSize` and expect
  pause-time control to keep working. It does not.
- Don't read `MaxGCPauseMillis` as an SLO the JVM enforces. It adjusts, and it may miss.
- Don't raise `-Xmx` to fix a humongous OOM. It raises the region size, which raises the byte
  threshold, which changes which objects are humongous.
- Don't leave heap sizing at the ergonomics fraction on a machine whose live set is known.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| OOM with visible free heap | Humongous allocation could not get contiguous regions | Raise `G1HeapRegionSize`, or shrink the buffers |
| Pauses grew after a "performance" tuning change | `-Xmn`/`NewRatio` disabled pause-time control | Remove the flag; set `MaxGCPauseMillis` instead |
| `MaxGCPauseMillis=50`, actual pauses 400 ms | The target is a hint and was not met | Check `gc+phases=debug`; shrink the live set |
| Serial collector on a large container | Machine is not server-class (memory < 1792 MB, or 1 CPU) | Pass `-XX:+UseG1GC` explicitly |
| Heap grows slowly for ten minutes after start | Initial heap is 1/64 of physical memory | Set `-Xms` = `-Xmx` |
| Different collector on each host | Ergonomics is machine-dependent | Pin `-XX:+UseG1GC` explicitly |

## Verifying

```bash
# 1. Which collector is actually running?
java -Xlog:gc+heap+exit=info -version 2>&1 | head
java -XX:+PrintFlagsFinal -version | grep -iE 'UseG1GC|UseSerialGC|UseParallelGC'
java -XX:+PrintFlagsFinal -version | grep -iE 'InitialHeapSize|MaxHeapSize|G1HeapRegionSize'

# 2. Pause-time control still active? These flags disable it.
java -XX:+PrintFlagsFinal -version | grep -iE 'NewSize|NewRatio'

# 3. Humongous occupancy on the next Full GC
java -Xlog:gc+heap=info -Xlog:gc+phases=debug -jar app.jar

# 4. Are there large buffers that could cross the half-region threshold?
grep -rnE 'new (byte|int|long|char)\[|ByteBuffer\.allocate|toByteArray|readAllBytes' src/main/java/
```

What this check cannot see: none of these attributes a pause to a cause. `gc+phases=debug` shows
which phase took the time, but distinguishing "the hint was missed because the live set is too
large" from "the hint was missed because a full GC ran" requires reading the live set over time.
And the humongous grep is a list of *candidates* by allocation size in source — it cannot see the
runtime size of a serialized object, which is usually the actual culprit.