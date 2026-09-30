---
title: "Namespaces Are Not a Tenancy Boundary"
rule_id: "RULE-K8S-003"
category: "correctness"
scope: "all"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/"
---

# Namespaces Are Not a Tenancy Boundary
Kubernetes namespaces provide scope for names and a mechanism to attach authorization and policy, but they do not isolate resources strongly enough to serve as a security boundary between untrusted tenants. Multiple workloads sharing a cluster should use additional isolation mechanisms (e.g., separate clusters, node pools, or runtime classes) for true tenancy separation.

## Why
Namespaces were designed to organize cluster resources into virtual sub-clusters for different teams, projects, or environments. They provide:
- Name scoping: Resources of the same type can have the same name in different namespaces.
- Authorization scope: Roles and RoleBindings can be namespace-scoped.
- Resource quota scope: Quotas and LimitRanges apply per namespace.

However, many cluster-scoped resources are not namespace-bound: nodes, persistent volumes, storage classes, CSRIs, and certain admission controllers operate cluster-wide. Furthermore, several attack vectors cross namespace boundaries:
- A compromised container can attempt to reach services in other namespaces via their fully qualified DNS names (`<service>.<namespace>.svc.cluster.local`).
- Pods can exhaust cluster-wide resources like IP addresses, port numbers, or node-level resources (CPU, memory, disk, network bandwidth).
- Side-channel attacks via shared hardware caches (e.g., Spectre, Meltdown) are not mitigated by namespace separation.
- Admission webhooks and policy engines (e.g., OPA/Gatekeeper) often evaluate cluster-wide context.

As a result, namespaces alone cannot prevent a malicious or misbehaving workload in one namespace from affecting workloads in another namespace or destabilizing the cluster itself.

## Do
- Use namespaces to organize resources for different teams, environments, or components within a trusted administrative domain.
- Combine namespaces with RBAC to limit what users or service accounts can do within a namespace.
- Apply ResourceQuota and LimitRange per namespace to prevent noisy-neighbor effects at the namespace level.
- Use NetworkPolicy to restrict traffic between namespaces when needed (default is allow all).
- For true multi-tenancy isolation (especially with untrusted workloads), consider:
  - Separate clusters per tenant or tenant group.
  - Node pools or node selectors to schedule workloads on dedicated hardware.
  - Runtime classes (e.g., gVisor, Kata Containers) for stronger container isolation.
  - Service meshes (e.g., Istio, Linkerd) for fine-grained traffic control and mutual TLS.
- Audit cluster-scoped resources regularly: check for unexpected CSRIs, MutatingWebhookConfigurations, or APIService objects.
- Monitor cross-namespace traffic patterns if you rely on NetworkPolicy for segmentation.
- Use tools like `kubectl ns` or `kubectx` to reduce context-switching errors, but remember that a namespace typo doesn't provide isolation.

## Don't
- Don't rely on namespaces alone to isolate untrusted or potentially hostile workloads.
- Don't assume that a namespace-scoped RoleBinding prevents access to cluster-scoped resources (e.g., a role cannot grant access to nodes, but a ClusterRole can).
- Don't create a namespace named after a public TLD (e.g., `com`, `org`, `io`) — services in that namespace can hijack trailing-dot-less DNS lookups from workloads in other namespaces, bypassing cluster DNS and reaching public resolvers.
- Don't use the `default` namespace for production workloads; it makes it harder to apply blanket policies and increases the chance of resource name collisions.
- Don't forget that many operators and controllers create cluster-scoped resources (CRDs, APIServices) that affect all namespaces regardless of namespace-scoped RBAC.
- Don't expect namespaces to protect against kernel-level side-channel attacks; hardware isolation or separate nodes are required for that.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Unauthorized access to services in other namespaces | Missing NetworkPolicy or reliance on namespace alone for isolation | Implement deny-by-default NetworkPolicy; move to separate clusters if needed |
| Resource starvation affecting multiple namespaces | Cluster-wide resource exhaustion (IPs, ports, node resources) | Use ResourceQuota at namespace level; consider dedicated node pools or separate clusters |
| DNS hijacking via trailing-dot-less lookups | Namespace named after a public TLD (e.g., `io`) | Rename namespace; enforce naming conventions that avoid TLDs |
| Cluster instability from noisy-neighbor effects | One namespace consuming excessive cluster-wide resources | Apply LimitRange and ResourceQuota; monitor node-level metrics |
| Unexpected cluster-wide policy changes | Admission webhook or Operators creating cluster-scoped resources | Audit CSRIs, APIServices, and cluster-scoped RBAC regularly |

## Verifying
- Check namespace annotations and labels: `kubectl get namespace <ns> -o yaml`
- Review NetworkPolicy rules: `kubectl get networkpolicy -n <ns> -o yaml`
- Test cross-namespace service access: from a pod in namespace A, try to resolve `<service>.namespace B.svc.cluster.local`
- Monitor resource usage per namespace: `kubectl top pod -n <ns>` and `kubectl describe namespace <ns>` for quotas
- List cluster-scoped resources that affect all namespaces: `kubectl get apiservices,csri,componentstatuses,nodes,persistentvolumes`
- Simulate a noisy neighbor: deploy a CPU/memory bomb in one namespace and observe impact on pods in another namespace (should see throttling/eviction only if quotas/limits are set)