---
title: "Liveness Probe Failure Can Cause Cascading Failures"
rule_id: "RULE-K8S-001"
category: "correctness"
scope: "all"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/workloads/pods/probes/"
---

# Liveness Probe Failure Can Cause Cascading Failures
A liveness probe failure triggers a container restart. Under load, restarting containers shifts their work to surviving instances, which can overload those instances and cause them to fail their own liveness probes — leading to a cascading failure across the service.

## Why
Liveness probes are meant to catch unresponsive containers and restart them. However, when a node is under resource pressure and multiple containers fail liveness probes simultaneously, the restart storm can overwhelm the remaining healthy instances. If those instances cannot handle the sudden load increase, they too may start failing liveness probes, creating a feedback loop that can bring down the entire service.

## Do
- Set `initialDelaySeconds` long enough for your container to start up and serve traffic under expected load.
- Tune `failureThreshold` and `periodSeconds` so the probe doesn't flap during brief latency spikes.
- Ensure your liveness check is lightweight and fast — ideally a simple in-process health check that doesn't depend on external systems.
- Consider using a startup probe for applications that need extra time to initialize, so the liveness probe doesn't fire during legitimate startup.
- Monitor restart rates via `kubectl get pods` or metrics alerts on `kube_pod_container_status_restarts_total`.
- If using liveness probes to check downstream dependencies (e.g., database connectivity), implement circuit-breaker logic so temporary dependency issues don't trigger unnecessary restarts.

## Don't
- Don't set `initialDelaySeconds` too low; containers need time to bind ports and initialize caches.
- Don't make liveness probes depend on slow external calls (e.g., querying a remote database or API); a transient network blip will restart healthy containers.
- Don't use the same probe for both liveness and readiness unless you understand the semantic difference — liveness decides life or death, readiness decides traffic routing.
- Don't ignore high restart counts; they often indicate resource starvation or dependency issues that need investigation.
- Don't configure liveness probes to exec into a container and run a heavy script every few seconds; this adds load to the very container you're trying to monitor.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Sudden increase in pod restarts followed by service degradation | Liveness probe failures triggering restart storm under load | Increase `initialDelaySeconds`, make probe lighter, or use startup probe for lengthy init |
| Service becomes completely unavailable despite adequate node resources | Cascading failures from liveness-driven restarts | Review probe thresholds and application startup time; consider removing liveness probe if readiness + startup probes suffice |
| High CPU usage on nodes during periods of apparent health | Frequent liveness probe exec calls adding overhead | Move health checks to a sidecar or reduce probe frequency |
| Pods restarting constantly during deployments | New pods failing liveness probe before traffic starts | Increase `initialDelaySeconds` or use startup probe to gate liveness checks |

## Verifying
- Check pod restart counts: `kubectl get pods --field-selector=status.phase=Running` and look at the RESTARTS column.
- Simulate load and probe failure: `kubectl exec <pod> -c <container> -- pkill -f <your-healthcheck-command>` and observe restart behavior.
- Review probe configuration: `kubectl get pod <pod> -o yaml | grep -A 10 livenessProbe`
- Monitor restart metrics: `kube_pod_container_status_restarts_total{pod="<pod-name>"}` in Prometheus.