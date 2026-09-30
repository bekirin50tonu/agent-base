---
title: "Event Publishing Has a Dual-Write Problem"
rule_id: "RULE-ARCH-003"
category: "architecture"
scope: "all"
applies_to: "Any backend that writes to a database and publishes to a broker"
last_updated: "2026-09-30"
source: "https://debezium.io/, https://martinfowler.com/eaaDev/EventSourcing, https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing"
---

# Event Publishing Has a Dual-Write Problem

Writing to a database and publishing to a broker are two separate commits with no shared
transaction. One succeeds while the other fails, and the inconsistency is invisible until
someone reconciles it months later. There is no ordering of those two operations that is
always right.

## Why

Consider the ordinary outbox pattern: insert an order row, then insert an outbox row, commit,
then a relay publishes. The relay can crash after committing the outbox row and before
publishing — fine, the relay retries. But now consider the relay publishing successfully and
the consumer receiving the message *before* the consuming service has committed its own
database write, or the consumer receiving the message *twice* because the relay retried after
an ambiguous timeout.

Every one of these is a different failure with the same root cause: two writes, one logical
operation, no atomicity. The consequences show up as phantom state — an event says a thing
happened that the database does not reflect — and as duplicate processing.

The three approaches that actually close the gap:

**Transactional outbox.** Write the domain change and an outbox record in the *same*
transaction, then relay asynchronously. Atomic locally, at-least-once on the wire. The
duplicate-delivery burden moves to the consumer, which must be idempotent.

**Change Data Capture.** Read the change stream straight off the database's replication log
(Debezium is the standard implementation) rather than polling a side table. Nothing can forget
to write the outbox row, because there is no separate insert to forget — the change is the
event. The cost is infrastructure: connectors, and a broker behind them.

**Event sourcing.** The event log *is* the state; current state is a projection. This gives
full auditability and the ability to rebuild state from history. The costs are real: eventual
consistency everywhere, event schema evolution as a permanent concern, and duplicate storage
for the log plus the projection.

CDC and outbox compose: CDC is often how the outbox table gets published, which removes the
relay as a bespoke service while keeping the local atomicity.

## Do

- Pick one of the three deliberately, based on whether you need the *event* or only the
  *change*.
- Use a transactional outbox when you need both the domain change and a domain-meaningful
  event — the event is a business fact, not a row diff.
- Use CDC when the event is genuinely a change notification — cache invalidation, search index
  updates, replication to a read model. Debezium is the common implementation and is deployed
  at Fortune 500 scale.
- Make every consumer idempotent, keyed on the event id. Assume duplicates as the normal case.
- Version event schemas additively. Consumers are deployed independently of producers, so a
  producer cannot assume anyone upgraded with it.
- Reconsider event sourcing when auditability or historical reconstruction is a stated
  requirement — not as a general default.

## Don't

- Do not publish to a broker and then write the database, or write the database and then
  publish. Both orderings lose one side on failure.
- Do not rely on the broker for exactly-once. Assume at-least-once and make consumption safe.
- Do not break an event schema in place. Producers and consumers deploy on different
  schedules; a breaking change strands every consumer that has not upgraded.
- Do not adopt event sourcing for its own sake. The auditability case justifies it; "we want
  the log" does not.
- Do not build a bespoke CDC pipeline when a maintained connector exists — the interesting work
  is in what you do with the stream, not in reading the WAL.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Consumer sees an event for a row that does not exist | Non-atomic write, or event published before commit | Transactional outbox; publish only committed rows |
| Same event processed twice, double-charging a customer | At-least-once delivery treated as exactly-once | Idempotent consumer keyed on event id |
| New consumer fails on an old producer's event | Event schema changed in place | Additive versioning; producers never break published fields |
| A committed change never produced an event | Relay or polling job missed it, or no outbox row was written | CDC from the replication log, so there is no separate write to miss |
| Projection and database disagree after a rebuild | Event sourcing without a deterministic projection | Versioned projectors; rebuild is a replay from the log |
| Broker outage silently stops event flow | No lag monitoring on the outbox or stream | Alert on oldest-unpublished age, not on publish failures |

## Verifying

1. Kill the relay between commit and publish; confirm the event still arrives after restart.
2. Deliver the same event twice to a consumer; confirm one durable effect.
3. Deploy a consumer against an older producer's schema; confirm it parses.
4. Confirm no publisher writes to the broker and the database in separate, unordered operations.

## Caveats on confidence

Adoption is uneven by pattern: CDC is early majority, event sourcing is an early adopter
pattern concentrated in domains with an audit requirement, outbox is common practice. Debezium
adopter counts were not quantified in this research. *Researched 2026-09-30.*