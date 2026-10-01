---
title: "Pod Disruption Budgets Ensure High Availability During Voluntary Disruptions"
rule_id: "RULE-K8S-005"
category: "correctness"
scope: "all"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/workloads/pods/disruptions/, https://kubernetes.io/docs/tasks/run-application/configure-pdb/, https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/"
---

# Pod Disruption Budgets Ensure High Availability During Voluntary Disruptions
Pod Disruption Budgets (PDBs) limit the number of pods of a replicated application that can be down simultaneously from voluntary disruptions, ensuring high availability during cluster operations like node drains, upgrades, and autoscaling. PDBs work with the Eviction API to gracefully evict pods while respecting availability constraints.

## Why
Voluntary disruptions (e.g., node drains for upgrades, cluster autoscaling) are initiated by administrators or automation. Without a PDB, these disruptions can evict too many replicas simultaneously, causing service downtime or loss of quorum. A PDB defines the minimum number of replicas that must remain available during such events, protecting replicated workloads from involuntary downtime.

Pods deleted or unavailable due to involuntary disruptions (node failures, kernel panics, network partitions) also count against the PDB budget but cannot be prevented by it. PDBs do not protect against direct deletion of pods or deployments (which bypass the Eviction API) or against rolling upgrades of workload resources (which use their own `maxUnavailable` setting).

## Do
- Create a PDB for every replicated application requiring high availability (e.g., web frontends, databases, queues).
- Use a label selector that matches the application's controller (Deployment, StatefulSet, etc.) so the PDB covers the correct pod set.
- Set `minAvailable` or `maxUnavailable` to reflect the minimum replicas needed for correctness (e.g., a quorum-based system needs `minAvailable: (replicas/2)+1`).
- Enable the `AlwaysAllow` unhealthy pod eviction policy in the PDB to allow eviction of misbehaving pods during a node drain.
- Use `kubectl drain` (which calls the Eviction API) instead of directly deleting pods or deployments when performing node maintenance.
- Verify PDB behavior by simulating a drain and checking that only the allowed number of pods are evicted.
- Combine PDB with PodAntiAffinity or zone spreading to further increase availability across failure domains.
- Monitor PDB status via `kubectl get poddisruptionbudget` to see current disruptions allowed and observed.

## Don't
- Don't omit PDBs for replicated workloads; voluntary disruptions will evict pods without regard to availability needs.
- Don't set `minAvailable` higher than the replica count; this blocks all voluntary disruptions and can prevent necessary maintenance.
- Don't rely on PDBs to protect against involuntary disruptions (node failures, zone outages); they only limit voluntary evictions.
- Don't forget that deleting a Deployment or Pod directly bypasses the PDB and Eviction API.
- Don't assume PDBs apply to workload resources during rolling upgrades; Deployments and StatefulSets use `spec.strategy.rollingUpdate.maxUnavailable` instead.
- Don't ignore the `DisruptionTarget` condition on pods; it indicates a pod is marked for eviction due to disruption.
- Don't set PDBs on single-replica workloads unless you tolerate downtime; a PDB with `minAvailable: 1` on a replica count of 1 blocks all voluntary disruptions.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Application downtime during node drains | No PDB or PDB too restrictive (minAvailable > available replicas) | Create or adjust PDB to allow at least one voluntary disruption while maintaining minimum required replicas |
| PDB blocking all drains | `minAvailable` set to replica count (zero disruptions allowed) | Reduce `minAvailable` or use `maxUnavailable` to allow a controlled number of disruptions |
| Pods evicted despite PDB | Involuntary disruptions (node failure) also count against budget | Understand that involuntary disruptions reduce available replicas; PDB only limits voluntary evictions |
| PDB not preventing quorum loss | PDB selector mismatches application pods | Ensure label selector matches the controller's pod template labels |
| Eviction API returns "too many disruptions" | PDB allows fewer disruptions than requested | Increase `minAvailable` or decrease `maxUnavailable` in the PDB |
| kubectl drain hangs indefinitely | PDB blocks eviction and no timeout configured | Configure eviction timeout in `kubectl drain --timeout` or set `UnhealthyPodEvictionPolicy: AlwaysAllow` |
| Application incorrectly scaled down | Using PDB instead of Deployment's maxUnavailable during rollouts | Use Deployment rollingUpdate settings for upgrade-related availability; PDB only for voluntary disruptions initiated by cluster admins |

## Verifying
- Check PDB definition: `kubectl get poddisruptionbudget <pdb> -o yaml`
- View current status: `kubectl get poddisruptionbudget <pdb>` shows `DISRUPTIONS` (allowed) and `ALLOWED` (observed)
- Simulate a voluntary disruption: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=60s` and observe pod evictions respecting PDB
- Verify that pods receive a `DisruptionTarget` condition with reason `EvictionByEvictionAPI` when evicted via PDB
- Check events for eviction reasons: `kubectl get events --field-selector=reason=Evicted`
- Confirm that involuntary disruptions (e.g., node `NotReady`) also reduce available pods but do not trigger PDB-based eviction
- Test unhealthy pod eviction: label a pod with a taint that matches a NoExecute taint on the node and ensure it is evicted when `AlwaysAllow` policy is set