---
title: "Debug Kubernetes CrashLoopBackOff"
category: "debugging"
applies_to: "Kubernetes"
last_updated: "2026-10-01"
source: "https://kubernetes.io/docs/tasks/debug-application-cluster/debug-application/"
---

# Debug Kubernetes CrashLoopBackOff
CrashLoopBackOff is a common Kubernetes pod state where a container crashes, Kubernetes restarts it, it crashes again, and so on with increasing delays. This skill provides a systematic approach to diagnosing the root cause.

## Why
A pod in CrashLoopBackOff state indicates that its main container is failing to start successfully. The increasing back-off delay (starting at 10s, doubling each time up to 5 minutes) prevents tight restart loops but makes debugging frustrating. Common causes include:
- Application errors (missing config, database connection failures, etc.)
- Missing dependencies or sidecars
- Insufficient resources (OOMKilled due to low memory limits)
- Permission issues (cannot read config files or bind to ports)
- Entrypoint or command issues (wrong script, missing executable)
- Liveness/readiness probe misconfiguration causing premature restarts

## Do
- Check pod events: `kubectl describe pod <pod>` shows why containers are restarting.
- Get recent container logs: `kubectl logs <pod> --previous` shows the crash reason from the last termination.
- Check current container logs (if it starts briefly): `kubectl logs <pod> -f` streams logs from the current incarnation.
- Look at the pod spec: `kubectl get pod <pod> -o yaml` to see image, command, args, env, volume mounts, resources, and probes.
- Check if it's a resource issue: `kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}'` may show OOMKilled.
- Verify image and tag: ensure you're running the intended image; `kubectl describe pod` shows the image under Containers.
- Check probes: liveness/readiness probes that fail immediately will cause restarts; examine `initialDelaySeconds` and timeout values.
- Test locally: if possible, run the container image locally with the same environment to reproduce the issue.
- Check init containers: if any init container failed, the main container won't start; `kubectl describe pod` shows init container status.
- Increase restart deadline temporarily: `kubectl patch pod <pod> -p '{"spec":{"activeDeadlineSeconds":300}}'` to give yourself 5 minutes of crash cycles to debug.
- Consider adding a debug container or using `kubectl debug` for ephemeral debugging containers.

## Don't
- Don't just increase the restart policy or disable restarts; this hides the underlying problem.
- Don't assume it's always the application code; check config, secrets, and dependencies first.
- Don't ignore the `--previous` flag when getting logs — current logs may be empty if the container crashes immediately.
- Don't forget that CrashLoopBackOff can be caused by Kubernetes system issues (e.g., CNI plugin failure, insufficient node resources).
- Don't overlook sidecar containers — if a sidecar fails, it can cause the main pod to CrashLoopBackOff depending on restart policy.
- Don't assume the error is in the main container without checking init containers and sidecars first.
- Don't change the image or command without first understanding why the current one is failing.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Pod immediately crashes on start | Missing config file, failed database connection, or application error | Check logs from previous termination; verify config maps and secrets are mounted correctly |
| Pod runs for exactly 10 seconds then crashes | Liveness probe failing immediately after startup | Increase `initialDelaySeconds` or fix liveness probe logic |
| OOMKilled in container status | Memory limit too low for actual usage | Increase memory limit in pod spec or optimize application memory usage |
| Crash due to permission denied | Container cannot read config or bind to port | Check fsGroup, runAsUser, or port permissions; ensure volume mounts are readable |
| ImagePullBackOff instead of CrashLoopBackOff | Image not found or pull credentials missing | Check image name, tag, and imagePullSecrets; verify registry access |
| Restart loop with no useful logs | Entrypoint script failing silently or exec format error | Verify container entrypoint and command; check for architecture mismatches |
| CrashLoopBackOff after deployment change | New image has bug or config change broke something | Roll out previous version; use kubectl rollout undo |
| All pods in deployment CrashLoopBackOff | Shared config issue (broken ConfigMap used by all) | Check the ConfigMap; verify it's correctly formatted and mounted |