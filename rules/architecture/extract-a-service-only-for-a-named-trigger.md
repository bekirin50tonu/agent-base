---
title: "Extract a Service Only for a Named Trigger"
rule_id: "RULE-ARCH-001"
category: "architecture"
scope: "backend"
applies_to: "Any backend service decomposition discussion"
last_updated: "2026-09-30"
source: "https://martinfowler.com/articles/microservice-premium.html, https://www.nginx.com/blog/microservices-vs-monoliths/"
---

# Extract a Service Only for a Named Trigger

Service decomposition introduces operational overhead that is paid continuously: network latency and failure handling, distributed transactions, deployment and versioning coupling, and cross-process debugging complexity. Most extractions do not recoup this cost unless they are driven by a clear, independent trigger that justifies the separation.

## Do

Identify a named trigger before extracting a module into a network service. Acceptable triggers include:
- An independent scaling profile (the module faces load patterns unrelated to the rest of the system)
- An independent release cadence (the module must be versioned and deployed on a different schedule)
- A data-ownership boundary (the module owns a distinct schema or bounded context that other modules should not mutate directly)
- A different runtime requirement (the module needs a language, framework, or library that would impose unnecessary overhead on the rest of the system)
- A team topology constraint (the module is owned by a team that must ship without coordinating with other teams due to organizational structure)

When such a trigger is present, evaluate whether the expected benefit outweighs the measurable operational cost.

## Don't

Extract a module solely for architectural purity, to follow microservices fashion, or to isolate code that "feels like it should be separate" without a measurable trigger. Do not split to reduce perceived complexity in a monolith when the module shares the same scaling, release, data, runtime, and team constraints as the rest of the system.

## Failure modes
| Symptom | Cause | Fix |
|---|---|---|
| Increased latency and frequent timeouts after extraction | Network calls added where in-process calls were sufficient | Revert to a module unless a scaling trigger justifies the latency |
| Distributed transaction failures or complex saga implementations | ACID boundaries crossed without a data-ownership trigger | Keep the module as a library or introduce a trigger via clear context mapping |
| Deployment coupling remains; services must be version-locked | No independent release cadence trigger | Re-evaluate the release trigger; if absent, maintain a single deployable unit |
| Debugging sessions require attaching to multiple processes | No team or runtime trigger justifying process boundary | Return to in-process module unless a trigger exists |
| Teams experience merge conflicts due to shared library changes | Extracted module still shares runtime and release triggers with others | Verify the trigger; if missing, reconsider extraction |

## Verifying
- Check that the proposed service has at least one of the named triggers: independent scaling, independent release cadence, data-ownership boundary, different runtime, or team topology constraint.
- Ensure that the trigger is documented and measurable (e.g., scaling metrics, release schedule, context map, runtime requirement, or team charter).
- Confirm that the architectural decision record explicitly links the extraction to the trigger and estimates the ongoing operational cost.