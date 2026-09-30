---
title: "Kubernetes Priority Classes and Preemption"
rule_id: "RULE-K8S-006"
category: "correctness"
scope: "all"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/"
---

# Kubernetes Priority Classes and Preemption
Priority Classes allow you to assign importance values to Pods, enabling the scheduler to preempt (evict) lower priority Pods when resources are needed for higher priority Pods. Preemption ensures critical workloads can be scheduled even under resource pressure, but misconfiguration can lead to unintended evictions or starvation.

## Why
Pod priority influences scheduling order and preemption behavior. When the scheduler cannot find a node that fits a pending Pod, it attempts to preempt one or more lower priority Pods to free resources. This is essential for guaranteeing that critical system components (e.g., kube-apiserver, etcd) or high-priority user workloads (e.g., payment processing) are not delayed by lower priority workloads.

However, priority is cluster-wide and not namespaced. Assigning excessively high priorities to non-critical Pods can starve other workloads. Preemption does not consider QoS classes, pod disruption budgets (best-effort only), or node affinity beyond the victim Pods' priority. Misuse can cause cascading evictions, unnecessary terminations, or resource starvation for lower priority workloads.

## Do
- Create PriorityClass objects for critical system pods (e.g., `system-cluster-critical`, `system-node-critical` shipped by Kubernetes) and for your high-priority applications.
- Use integer values that reflect relative importance: higher numbers mean higher priority. Reserve values ≥ 1 billion for critical system pods (Kubernetes uses 2,000,000,000 and 2,000,001,000 for v1.37).
- To prevent a Pod from being preempted, set `preemptionPolicy: Never` in its PriorityClass (stable since v1.24). Use this for workloads where preemptive eviction is undesirable (e.g., batch jobs with intermediate state).
- Assign `priorityClassName` in Pod templates (e.g., Deployments, StatefulSets) to apply priority to all pods of a workload.
- Use `globalDefault: true` on exactly one PriorityClass to define the default priority for Pods without an explicit priorityClassName (defaults to zero otherwise).
- Add a `description` field to PriorityClass objects to document their intended use.
- Combine priority with PodDisruptionBudgets: PDBs limit voluntary disruptions, while priority protects against preemption due to resource shortages.
- Use ResourceQuotas to limit consumption of high priority classes by non-administrative users or namespaces.
- Verify priority admission: `kubectl get pod <pod> -o jsonpath='{.spec.priority}'` shows the resolved integer value.
- Consider topology spread constraints and affinity/anti-affinity alongside priority to balance scheduling goals.

## Don't
- Don't assign high priority values (e.g., >1000000) to Pods that are not critical; this can cause unnecessary preemption of lower priority workloads.
- Don't assume priority is namespaced; PriorityClass objects are cluster-wide and affect all namespaces.
- Don't forget that preemption evicts Pods regardless of their health or disruption budget; a healthy Pod can be preempted if it has lower priority.
- Don't rely on priority alone for scheduling guarantees; pair with node affinity, resource requests/limits, and pod anti-affinity for deterministic placement.
- Don't set `globalDefault: true` on multiple PriorityClass objects; only one can be true system-wide.
- Don't ignore the interaction with PodDisruptionBudgets: the scheduler tries to respect PDBs when preempting, but if no victims satisfy the PDB, preemption may still occur and violate the budget.
- Don't use priority to workaround insufficient resource requests; set appropriate requests/limits instead of inflating priority.
- Don't neglect to monitor preemption events; frequent preemption indicates chronic resource pressure or misconfigured priorities.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Critical system pods (e.g., kube-dns) being evicted | Non-critical workloads assigned higher priority than system pods | Reduce priority of application workloads or increase priority of system pods via admission control or node labels |
| Lower priority Pods never scheduling (starvation) | High priority Pods consistently consuming resources, leaving no room for lower priority | Implement resource quotas per namespace/user, or use `preemptionPolicy: Never` for lower priority workloads that should not be preempted |
| Pods being preempted despite PDB | Scheduler could not find victims that satisfy both priority and PDB constraints | Increase the PDB's `minAvailable` or `maxUnavailable` to allow more voluntary disruptions, or lower the priority of the pending Pod |
| Frequent preemption events in cluster events | Chronic under-provisioning or misconfigured priority classes | Audit PriorityClass assignments, adjust resource requests/limits, or scale up the cluster |
| Preemption not occurring when expected | Pending Pod priority not higher than any victim Pod on any node | Ensure the pending Pod has a priorityClassName with a sufficiently high value, and that lower priority Pods exist on nodes where it could schedule |
| Pods with `preemptionPolicy: Never` still being preempted | Using a PriorityClass that does not have `preemptionPolicy: Never` set | Verify the PriorityClass definition; the field defaults to `PreemptLowerPriority` |
| Priority value not taking effect | Typo in `priorityClassName` or PriorityClass not found | Check pod events for `FailedScheduling` with reason `PriorityClassNotFound` |

## Verifying
- List PriorityClasses: `kubectl get priorityclass`
- Describe a PriorityClass: `kubectl describe priorityclass <class-name>`
- Check a Pod's effective priority: `kubectl get pod <pod> -o jsonpath='{.spec.priority}'`
- Simulate preemption: create a Deployment with low priority replicas, then create a high priority Pod that requests resources exceeding node capacity; observe if low priority Pods are evicted.
- Watch for preemption events: `kubectl get events --field-selector=reason=Preempted`
- Validate that a Pod with `preemptionPolicy: Never` is not evicted when a higher priority Pod arrives (it should wait for resources to free naturally).
- Check that Pods without an explicit priorityClassName receive the globalDefault priority (or zero if none set).
- Review scheduler logs (if accessible) for preemption decisions.