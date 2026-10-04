---
title: "KRaft Replaces ZooKeeper in Kafka"
rule_id: "RULE-KAFKA-001"
category: "architecture"
scope: "all"
applies_to: "Kafka"
last_updated: "2026-10-01"
source: "https://kafka.apache.org/documentation/#kraft"
---

# KRaft Replaces ZooKeeper in Kafka
Apache Kafka version 2.8.0 introduced KRaft (Kafka Raft Metadata) mode as an alternative to ZooKeeper for metadata management. Starting with Kafka 3.3.0, KRaft became production ready, and in Kafka 3.4.0 it became the default for new clusters. Kafka 4.3 continues this trend, with ZooKeeper mode deprecated and scheduled for removal. KRaft embeds a Raft-based consensus cluster directly into Kafka brokers (or controller nodes in combined mode), eliminating the external ZooKeeper dependency and simplifying deployment topology.

## Why
Kafka's reliance on ZooKeeper for controller election, broker registration, and topic metadata introduced operational complexity:
- **Separate system to manage**: ZooKeeper requires its own cluster, monitoring, backup, and upgrade procedures.
- **Additional failure modes**: ZooKeeper session losses, network partitions, and leader elections could affect Kafka availability.
- **Scaling limitations**: ZooKeeper performance degrades with large numbers of znodes (topics/partitions), limiting cluster size.
- **Operational overhead**: Coordinating Kafka and ZooKeeper version upgrades added complexity.
- **Security complexity**: Separate authentication and authorization systems for Kafka and ZooKeeper.

KRaft addresses these by integrating the metadata store into Kafka itself using a Raft consensus protocol. In KRaft mode:
- **Controller nodes** (or brokers in combined mode) form a Raft quorum that manages cluster metadata.
- **No external dependency**: All metadata is stored in the Kafka Raft log, managed by the controller quorum.
- **Simplified deployment**: Fewer moving parts, unified versioning, and unified security.
- **Better scalability**: Raft performance characteristics scale better for metadata workloads than ZooKeeper.
- **Unified failure domain**: Metadata management shares the same failure detection and recovery mechanisms as the data plane.

## Do
- Use **KRaft mode** for all new Kafka clusters starting with Kafka 3.3.0+; it is the default in 3.4.0+.
- For Kafka 4.3, plan migration from ZooKeeper to KRaft — ZooKeeper mode is deprecated and will be removed.
- Choose between **combined mode** (`process.roles=broker,controller`) and **separated mode** (`process.roles=broker` or `controller`) based on your needs:
  - Combined mode simplifies deployment but shares resources between broker and controller workloads.
  - Separated mode allows independent scaling and resource isolation for controller and broker functions.
- Configure an **odd number of controller nodes** (3 or 5) to tolerate 1 or 2 failures, respectively. Dynamic quorum changes (adding/removing controllers) are supported since KRaft version 1 (Kafka 4.1).
- Set `controller.quorum.voters` (pre-4.1) or `controller.quorum.bootstrap.servers` (4.1+) to initialize the controller quorum.
- Monitor the **KRaft controller status** via metrics: `kafka.controller:type=ControllerState, name=ActiveController` and `kafka.controller:type=ControllerMetadataManager,name=LeaderAndIsrCacheSize`.
- Plan for **metadata quota** — the controller has a limited metadata log size; monitor `kafka.controller:type=ControllerMetadataManager,name=RemoteLeadershipElectionRate` and related metrics.
- Use **existing Kafka tooling** — `kafka-cluster.sh` script for metadata topic formatting and cluster ID generation.

## Don't
- Don't start new clusters in ZooKeeper mode — it is deprecated and lacks future feature support.
- Don't assume combined mode is always appropriate — it is *"not recommended in critical deployment environments"* due to resource contention between broker and controller roles.
- Don't use an even number of controller nodes — Raft requires a majority for quorum; 2 nodes cannot tolerate any failures, 4 nodes tolerate only 1 failure (same as 3).
- Don't forget that controller nodes store the full metadata log — ensure sufficient disk space for the Raft log.
- Don't mix ZooKeeper and KRaft nodes in the same cluster — migration requires a clean cutover.
- Don't expect ZooKeeper-style znodes — KRaft uses a different internal metadata representation; direct ZooKeeper monitoring tools won't work.
- Don't ignore the metadata version — ensure compatibility when upgrading KRaft versions; check `kraft.version` in broker logs.
- Don't assume that combined mode controllers can be scaled independently — adding broker capacity also adds controller capacity in combined mode.

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| Controller election failures | Insufficient controller nodes or network partitions | Ensure odd number of controllers (3/5); check network connectivity between controller nodes |
| Metadata log too large | Controller disk space exhausted | Monitor metadata log size; increase disk retention or prune old metadata if possible |
| Broker unable to join cluster | Incorrect `controller.quorum.bootstrap.servers` or mismatched cluster ID | Verify controller connection settings; ensure all brokers share the same cluster ID |
| Performance degradation in combined mode | Resource contention between broker and controller workloads | Consider separated mode for high-throughput clusters; monitor CPU/memory usage on controller nodes |
| Unable to tolerate expected node failures | Even number of controllers or insufficient quorum size | Use 3 controllers to tolerate 1 failure, 5 for 2 failures; enable dynamic quorum if needed |
| Migration complications | ZooKeeper metadata not compatible with KRaft | Follow official migration guide; use `kafka-storage.sh` for metadata format conversion |