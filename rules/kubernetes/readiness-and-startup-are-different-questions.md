---
title: "Readiness and Startup Probes Solve Different Problems"
rule_id: "RULE-K8S-002"
category: "correctness"
scope: "all"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/workloads/pods/probes/"
---

# Readiness and Startup Probes Solve Different Problems
Startup probes gate liveness and readiness checks during container initialization. Readiness probes control whether a Pod receives traffic via Services. Using the wrong probe type for the wrong problem leads to premature traffic routing or delayed failure detection.

## Why
Kubernetes provides three probe types with distinct semantics:
- **Startup probe**: Knows when the container application has started. While it's failing, liveness and readiness probes are disabled — useful for slow-starting containers.
- **Liveness probe**: Knows when the container is unhealthy and should be restarted.
- **Readiness probe**: Knows when the container is ready to serve traffic. When it fails, the Pod's IP is removed from Service endpoints.

Using a liveness probe where you need a readiness probe sends traffic to containers that aren't ready yet (causing 5xx errors). Using a readiness probe where you need liveness means unhealthy containers keep receiving traffic until the readiness probe fails and the Pod is removed — but the container isn't restarted, so the failure persists.

## Do
- Use a **startup probe** for containers that need more than `initialDelaySeconds` to start (e.g., Java apps with large Spring contexts, or containers waiting on sidecars).
- Use a **readiness probe** to gate traffic: check that your application can actually serve requests (e.g., can bind to port, can connect to database, can initialize caches).
- Use a **liveness probe** only to detect uncontainable states like deadlocks, where restarting the container is the only remedy.
- Set `initialDelaySeconds + failureThreshold × periodSeconds` appropriately for each probe type:
  - Startup: long enough for worst-case cold start.
  - Readiness: short enough to detect dependency loss quickly, but long enough to avoid flapping on brief GC pauses.
  - Liveness: long enough to survive normal request latency spikes.
- Match the probe depth to the decision: startup probes can be very light (e.g., check a lock file), readiness probes should check actual service readiness, liveness probes should check for unrecoverable states.
- When in doubt, prefer readiness over liveness for traffic gating — better to delay traffic than to restart healthy containers.

## Don't
- Don't use liveness probes to check if a database is reachable; a transient blip will restart healthy containers. Use readiness or application-level retry instead.
- Don't use readiness probes to decide when to restart a container; they only affect traffic routing, not container lifecycle.
- Don't omit startup probes for containers that need >10 seconds to start; liveness probes will fire during startup and restart healthy containers.
- Don't set all three probes to the same endpoint unless that endpoint correctly answers "started?", "healthy?", and "ready to serve?" with different semantics.
- Don't ignore probe failure reasons; check events with `kubectl describe pod <pod>` to see why a probe is failing.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| 5xx errors during deployments or scaling events | Readiness probe failing because app isn't ready to serve traffic (e.g., DB connection pool not warmed) | Use readiness probe to check actual service readiness; increase `initialDelaySeconds` or use startup probe for lengthy init |
| Containers restarting frequently despite serving traffic normally | Misconfigured liveness probe (e.g., checking a flaky dependency) | Replace liveness probe with readiness probe for dependency checks; use liveness only for unrecoverable states |
| Pods not receiving traffic despite healthy containers | Readiness probe failing; Pod IP removed from EndpointSlices | Fix readiness probe to reflect actual service readiness; check dependency timeouts and connection pools |
| Slow pod startup times causing scaling delays | Startup probe too aggressive or missing | Tune startup probe to allow sufficient initialization time; consider sidecar pattern for complex startup logic |

## Verifying
- Check probe status: `kubectl describe pod <pod>` shows events for probe successes/failures.
- Test readiness: `kubectl exec <pod> -c <container> -- curl -s http://localhost:<port>/healthz` should return 200 when ready.
- Simulate readiness failure: `kubectl exec <pod> -c <container> -- rm /tmp/healthy` (if your probe checks for a file) and watch EndpointSlices update: `kubectl get endpointslices`.
- Review probe configuration: `kubectl get pod <pod> -o yaml | grep -A 10 "readinessProbe\|startupProbe\|livenessProbe"`
- Monitor probe metrics via kubelet: `probe_success{condition="Ready", pod="<pod>"}` and `probe_failure{condition="Ready", pod="<pod>"}`.