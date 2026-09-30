---
title: "Kubernetes Resource Requests, Limits, and QoS Classes"
category: "configuration"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/, https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/"
---

# Kubernetes Resource Requests, Limits, and QoS Classes
Kubernetes uses container resource requests and limits to determine Quality of Service (QoS) classes, which influence scheduling and eviction decisions. Requests guarantee minimum resources; limits set the ceiling; QoS class is derived from the relationship between requests and limits across all containers in a pod.

## Why
Resource requests (`requests`) are used by the scheduler to place pods on nodes with sufficient available resources — they represent the minimum resources guaranteed to a container. Resource limits (`limits`) set the upper bound on resource consumption; the container runtime will not allow the container to exceed these limits.

The kubelet derives a pod's QoS class from the pattern of requests and limits:
- **Guaranteed**: Every container has both memory and CPU requests and limits, and request equals limit for each resource.
- **Burstable**: At least one container has a memory or CPU request or limit (or pod-level equivalent), but not all containers have matching requests and limits.
- **BestEffort**: No container has any memory or CPU request or limit, and no pod-level requests or limits are set.

This QoS class directly influences eviction priority under node pressure: BestEffort pods are evicted first, followed by Burstable, then Guaranteed. Only pods exceeding their requests are candidates for eviction when reclaiming resources.

Understanding this relationship is critical for capacity planning, setting appropriate resource profiles, and predicting cluster behavior during resource shortages.

## Do
- Set `requests` to the minimum resources your container needs to function correctly — this is what the scheduler guarantees.
- Set `limits` to the maximum resources your container should ever consume — use limits to prevent noisy-neighbor effects.
- For Guaranteed QoS (useful for latency-sensitive or critical workloads): set `requests` == `limits` for both CPU and memory on every container in the pod.
- If you cannot determine a tight limit, omit `limits` (or set it high) to get Burstable QoS — but remember that Burstable pods exceeding requests are evictable before Guaranteed pods.
- To get BestEffort QoS (not recommended for production workloads): omit all `requests` and `limits` for CPU and memory.
- Consider pod-level resource specifications (alpha feature) for simpler Guaranteed/Burstable specification at the pod level.
- Monitor actual usage via `kubectl top pod` or metrics server to validate your requests and limits are realistic.
- Use LimitRange objects to enforce default requests and limits at the namespace level when appropriate.
- Remember that eviction only targets pods exceeding their requests — a pod at or below its requests will not be evicted due to resource pressure unless the node is completely out of resources.

## Don't
- Don't set `requests` higher than what your container actually needs; this wastes cluster resources and can cause unnecessary pod scheduling delays or failures.
- Don't set `limits` lower than your container's peak usage; this will cause frequent container restarts due to OOMKilled or CPU throttling.
- Don't assume that setting `limits` alone provides resource guarantees — the scheduler ignores limits and only considers `requests` for placement.
- Don't forget that memory limits include both application memory and page cache; workloads with high page cache usage may need higher limits to avoid OOM kills.
- Don't rely on QoS class alone for isolation — Guaranteed pods can still be evicted if the node is under extreme pressure and no lower-QoS pods exist.
- Don't set `requests` to zero to avoid scheduling; zero-request pods get BestEffort QoS and are the first to be evicted under pressure.
- Don't ignore ephemeral-storage requests and limits if your workload uses local disk (e.g., for caching or temporary files).
- Don't assume that resource quotas apply to limits; quotas by default apply to requests, not limits (check quota scope).

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Pods failing to schedule despite available node resources | Requests exceed node allocatable resources | Check `kubectl describe nodes` for allocatable CPU/memory; reduce requests or add nodes |
| Container restarting with OOMKilled | Memory usage exceeds limit | Increase memory limit or optimize memory usage; consider application-level caching limits |
| Container throttled (high latency) | CPU usage exceeds limit | Increase CPU limit or optimize CPU usage; check for CPU-bound loops |
| Eviction of pods that appear to be within limits | Pod exceeded requests but not limits (Burstable/Guaranteed) | Remember eviction candidates are pods exceeding requests; tighten requests or increase node capacity |
| All pods getting BestEffort QoS despite limits set | Limits set but requests omitted or zero | Set requests to meaningful values; requests == limits for Guaranteed |
| Node becoming unstable despite low pod density | Many BestEffort pods consuming excess resources | Apply LimitRange to set default requests; move critical workloads to Guaranteed QoS |
| Inconsistent QoS class after pod update | Container spec change altered request/limit equality | Use pod-level resources (if available) or ensure all containers match request/limit pattern |

## Verifying
- Check pod QoS class: `kubectl get pod <pod> -o jsonpath='{.status.qosClass}'`
- Review resource specification: `kubectl get pod <pod> -o yaml | grep -A 5 -B 5 "requests\|limits"`
- Validate scheduler decisions: `kubectl describe pod <pod> | grep -A 10 -B 10 "Requested\|Limits"`
- Monitor actual usage vs. requests/limits: `kubectl top pod <pod>` or metrics server queries
- Simulate node pressure: deploy a memory/CPU consumer and observe eviction order (BestEffort first)
- Check LimitRange impact: `kubectl get limitrange -n <namespace> -o yaml`
- Review events for eviction reasons: `kubectl get events --field-selector=reason=Evicted`