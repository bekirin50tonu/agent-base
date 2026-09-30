---
title: "Schema Evolution Safety in Messaging Systems"
rule_id: "RULE-MESSAGING-009"
category: "correctness"
scope: "all"
applies_to: "Messaging"
last_updated: "2026-10-01"
source: "https://kafka.apache.org/documentation/#design, https://www.rabbitmq.com/tutorials/tutorial-six-java.html, https://redis.io/docs/latest/develop/data-types/streams/"
---

# Schema Evolution Safety in Messaging Systems
Schema evolution—changing the structure of messages over time—is inevitable in production systems, but unsafe evolution can break consumers, cause data loss, or require costly downtime. Safe schema evolution requires backward and forward compatibility strategies, versioning approaches, and contract testing.

## Why
Messages are contracts between producers and consumers. When schemas change:
- **Backward incompatible changes**: New producers writing old consumers cannot parse messages (e.g., removing a required field)
- **Forward incompatible changes**: Old producers writing new consumers cannot parse messages (e.g., adding a required field without default)
- Silent data corruption: Consumers misinterpret fields due to type changes or name reuse
- Consumer crashes: Unexpected fields or missing fields cause deserialization exceptions
- Downstream impact: Schema changes propagate to databases, APIs, and UIs

Different serialization formats have different evolution safety:
- **JSON**: Flexible but lacks explicit schema; consumers must tolerate missing/extra fields
- **Avro/Protobuf**: Schema registries enable compatibility checking (BACKWARD, FORWARD, FULL)
- **Protocol Buffers**: Field numbers provide evolution safety; never reuse numbers
- **MessagePack/CBOR**: Similar to JSON—requires tolerant consumers

Without safe evolution practices:
- Rolling upgrades fail due to incompatible schemas
- Silent data corruption goes undetected until downstream processes fail
- Consumer arrays break unexpectedly during deployment
- Schema registry becomes a bottleneck or single point of failure

## Do
- **Use schema registries for Avro/Protobuf**:
  - Configure compatibility modes (BACKWARD, FORWARD, FULL, NONE)
  - BACKWARD allows new consumers to read old producer data
  - FORWARD allows old consumers to read new producer data
  - FULL requires both backward and forward compatibility
  - Test compatibility before deploying new schemas

- **For JSON/messagepack consumers**:
  - Make consumers tolerant of missing fields (use default values)
  - Ignore unknown fields rather than failing
  - Never remove fields; deprecate them instead (leave in schema but document as unused)
  - Never change field types; add new fields with new names instead
  - Use explicit version numbers in messages if tolerance isn't sufficient

- **Implement contract testing**:
  - Test producer schemas against consumer expectations in CI/CD
  - Use tools like Pact or Spring Cloud Contract for messaging contracts
  - Verify both directions: can new consumers read old producers? Can old consumers read new producers?

- **Version topics/queues when necessary**:
  - For incompatible changes, create a new topic/queue (e.g., `orders-v2`)
  - Use consumer gravity or dual-write during migration period
  - Deprecate old topics after all consumers migrate

- **Monitor schema usage**:
  - Track which schemas are in use by producers and consumers
  - Set up alerts for schema registry compatibility check failures
  - Monitor consumer deserialization errors and dead lettering due to schema issues

- **Evolve gradually**:
  - Add new fields as optional with sensible defaults
  - Deprecate old fields before removing them (after a grace period)
  - Use union types in Avro for gradual migration (e.g., `["null", "string", "int"]`)

## Don't
- Don't remove fields or change field types in existing schemas without deprecation
- Don't assume consumers will tolerate schema changes—test explicitly
- Don't reuse field numbers in Protocol Buffers (ever)
- Don't forget that schema compatibility is directional; check both producer→consumer and consumer→producer
- Don't deploy schema changes without verifying compatibility in a staging environment
- Don't ignore that consumers may be offline during schema changes (handle gracefully)
- Don't use schema evolution as an excuse for poor upfront design—invest in stable contracts
- Don't let schema registry become a performance bottleneck; cache schemas locally where safe

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Consumer deserialization errors | Producer deployed incompatible schema change | Revert producer or fix schema to be compatible; use schema registry to prevent |
| Silent data corruption (e.g., null values) | Field renamed or reused without consumer update | Add new field with new name; deprecate old field gradually |
| Consumer crashes on startup | Missing required field in new schema | Make field optional or provide default value; ensure backward compatibility |
| Schema registry compatibility check fails | New schema violates configured compatibility mode | Adjust schema or compatibility mode (BACKWARD/FORWARD/FULL) |
| Mixed schema versions causing issues | Some producers/consumers upgraded, others not | Use consumer version detection or separate topics during transition |
| Increased message size due to schema evolution | All versions of fields kept indefinitely | Compact topics or clean up old schemas after migration period |
| Downtime during schema rollout | All consumers must be updated simultaneously | Use backward/forward compatibility to allow rolling upgrades |

## Verifying
- Check serializer configuration: confirm use of Avro/Protobuf with schema registry or tolerant JSON parsing
- Test schema compatibility: use schema registry API to check backward/forward compatibility
- Verify consumer behavior: send messages with old and new schemas; ensure no errors or silent corruption
- Monitor for deserialization errors in consumer logs and dead letter queues
- Test rolling upgrade scenario: upgrade subset of consumers/producers and verify continued operation
- Check that unknown fields are ignored and missing fields use defaults in JSON consumers
- Review schema registry logs for compatibility check results and errors