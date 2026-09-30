---
title: "Vertical Slice Organizes by Feature"
rule_id: "RULE-ARCH-004"
category: "architecture"
scope: "all"
applies_to: "Any backend with a controllers / services / repositories layer structure"
last_updated: "2026-09-30"
source: "https://jimmybogard.com/vertical-slice-architecture/, https://fsd.how, https://www.thoughtworks.com/radar"
---

# Vertical Slice Organizes by Feature

A layered backend splits code by *technical role* — every controller together, every service
together, every repository together. A vertical slice splits it by *feature* — one use case's
handler, logic, and data access together, end to end. The unit of change moves from "the
service layer" to "the feature."

## Why

The failure mode of technical layering is predictable: a change that touches one feature now
touches N directories, because the handler goes in `controllers/`, the logic in `services/`,
the query in `repositories/`, and the DTO in `models/`. Six features being edited at once put
one developer's `services/` diff in the middle of six other people's work. Merge conflicts
concentrate in the shared layers, and nobody can see a feature's behavior without reading
across four directories.

The vertical-slice answer is to make the feature the unit. Adding or changing a use case
ideally touches only files inside its own slice, which also aligns with a stream-aligned team
owning one feature end to end.

The costs are equally predictable, and both are real:

- **Infrastructure duplication.** Logging, auth, validation, and error mapping get written per
  slice. Jimmy Bogard's own framing treats the shared kernel as a deliberate part of the
  design, not an accident.
- **Genuinely cross-cutting features still cross slices.** A change to authentication touches
  every slice, and no amount of slicing avoids that. This is the honest limit.

Where it stands: strong advocacy and real adoption in .NET (Bogard's webinars and training) and
in frontend work as Feature-Sliced Design (`fsd.how`), which is gaining traction on large React
and Vue apps. On the backend it is less commonly named explicitly, and Thoughtworks' radar
carries no entry for it — which is itself a signal about how settled it is.

## Do

- Organize new features as self-contained slices: the use case's handler, its logic, and its
  data access in one directory.
- Extract a shared kernel deliberately and name it as such — logging, auth, error mapping,
  connection handling. Treat it as a designed boundary, not as "whatever got duplicated".
- Judge the structure by where conflicts land. If PRs routinely conflict in one shared
  directory, that is the argument for slicing.
- Align slice ownership with team ownership when teams are stream-aligned.
- Keep slices independent in the *build*: a slice should not import from a sibling slice's
  internals.

## Don't

- Do not convert an existing layered codebase in one pass. Slicing is cheaper when applied to
  the feature you are already touching.
- Do not duplicate infrastructure across slices without deciding it is the shared kernel —
  unexamined duplication becomes the inner-platform effect once someone builds a framework on
  top of it.
- Do not slice vertically and then let slices reach across into each other's data access; that
  recreates the layering you replaced with one more layer of indirection.
- Do not expect slicing to eliminate merge conflicts. It relocates them away from shared
  layers; cross-cutting changes still collide, and always did.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Merge conflicts concentrate in `services/` | Technical layering across parallel features | Slice by feature; move the shared concerns into a named kernel |
| One behavior change requires edits in five directories | Layered structure with no feature ownership | Complete the change inside one slice, exposing what others need |
| Every slice has its own slightly different auth check | Duplicated infrastructure | Promote it to the shared kernel once, deliberately |
| A framework of base classes accumulates over time | Unexamined duplication, then inner-platform effect | Delete the base class; a function is usually enough |
| Slices import each other's internals | No enforced boundary | Restrict imports to the slice's public surface |

## Verifying

1. Pick a single feature; confirm its handler, logic, and data access live under one directory.
2. Confirm no slice imports another slice's internals.
3. Look at where the last 20 merge conflicts landed; one dominant directory is the signal.
4. Confirm shared infrastructure has a name and an owner rather than being implicit.

## Caveats on confidence

Confidence is **medium**, lower than the rules with authoritative backing. The concept is
strongly advocated and demonstrably used, but independent production case studies are thin,
mainstream architecture literature discusses it mostly through modular-monolith and DDD
framing, and the Thoughtworks radar carries no entry. The tradeoffs above are from the
advocates' own writing, which is a place to be careful. *Researched 2026-09-30.*