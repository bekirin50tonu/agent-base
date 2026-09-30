---
title: "Redis as a Cache: Eviction, Sizing, and the Two Misuses"
category: "caching"
applies_to: "Redis 6 and later, standalone or clustered; the eviction model also applies to Redis Cloud and Redis Software"
last_updated: "2026-09-30"
source: "https://redis.io/docs/latest/develop/reference/eviction/, https://redis.io/docs/latest/commands/scan/, https://redis.io/docs/latest/develop/use/client-side-caching/, https://redis.io/docs/latest/develop/use/patterns/"
---

# Redis as a Cache: Eviction, Sizing, and the Two Misuses

A cache that silently misbehaves does not throw — it gets slow, or it starts serving stale data,
and both present as "Redis is fine". Almost every cache incident traces to one of three places:
`maxmemory` was never set, the eviction policy does not match the access pattern, or iteration
was done with a blocking command.

## When to Use

- Target project uses Redis for read-through or cache-aside caching and has never had a
  conversation about `maxmemory` or `maxmemory-policy`.
- A cache is evicting aggressively, or `OOM command not allowed` appears on writes.
- Someone reaches for `KEYS` in application code, or a cache is shared with queues, locks, or
  session keys.

## `maxmemory` unset is the default failure

The default is the finding worth stating plainly: *"Set maxmemory to zero to specify that you
don't want to limit the memory for the dataset. This is the default behavior for 64-bit
systems, while 32-bit systems use an implicit memory limit of 3GB."* A 64-bit Redis with no
`maxmemory` configured never evicts — it grows until the host OOM-killer takes it, and because
it is a cache the process coming back is also the moment every entry disappears at once.

Two non-obvious details from the same reference:

- **A single command can overshoot the limit badly.** *"when a command adds a lot of data to the
  cache (for example, a big set intersection stored into a new key), this might temporarily
  exceed the limit by a large amount."* `maxmemory` is checked between commands, not during one.
- **Replication and AOF buffers are excluded from the limit, and that is deliberate.** Buffer
  memory is not counted toward `maxmemory` *"because the key evictions themselves generate
  updates that must be added to the buffer"* — counting it would create a feedback loop where
  evicting a key allocates the memory the eviction just freed, triggering more evictions. The
  consequence for sizing: you must leave headroom for the buffers, and
  `INFO memory` → `mem_not_counted_for_evict` tells you how much is in them.

## Choosing the eviction policy

The default recommendation from Redis itself is `allkeys-lru`, on Pareto grounds: *"Use allkeys-lru
when you expect that a subset of elements will be accessed far more often than the rest. This is
a very common case according to the Pareto principle, so allkeys-lru is a good default option if
you have no reason to prefer any others."*

| Policy | Use when |
|---|---|
| `allkeys-lru` | default; a hot subset dominates access |
| `allkeys-lfm` | read-heavy, and you want to protect data that is actively being written from data that is only read |
| `allkeys-lru` vs `allkeys-random` | `allkeys-random` *"when you expect all keys to be accessed with roughly equal frequency"* — a repeating read cycle over the whole keyspace |
| `volatile-ttl` | *"if your code can estimate which keys are good candidates for eviction and assign short TTLs to them"* |
| `noeviction` | the keyspace is **not** a cache — writes must fail loudly rather than lose data |

Two traps in this table:

- **`volatile-*` degrades to `noeviction` when nothing has a TTL**: *"The volatile-xxx policies
  behave like noeviction if no keys have an associated expiration."* A `volatile-lru` cache where
  someone forgot the TTL on a code path becomes a hard write error at the memory ceiling, not a
  silent cache miss.
- **Mixing cache and persistent keys in one instance is a documented anti-pattern.** `volatile-*`
  exists for that case, and Redis's own advice is to consider running two instances instead.
  TTLs also cost memory, so `allkeys-lru` is *"more memory efficient since it doesn't need an
  expire value to operate."* This matters for the shared-Redis case — a queue and a cache on the
  same instance means an LRU cache can evict a pending job.

## Diagnosing with `INFO` instead of guessing

The hit-ratio formula is the whole diagnostic:

```
keyspace_hits / (keyspace_hits + keyspace_misses) * 100
```

Read it with two companion counters, because hit rate alone does not say *why*:

- **`evicted_keys` high** → *"the wrong keys are being evicted too often by your chosen policy."*
  If a small hot subset should account for ~75% of accesses and the ratio is materially below
  that, the policy is wrong; Redis names `allkeys-lru` as the likely fix.
- **`evicted_keys` low but `expired_keys` high** → *"you might be using a TTL that is too low or
  you are choosing the wrong keys to expire and this is causing keys to disappear from the cache
  before they should."* A short TTL looks identical to a good cache until you check this.
- One subtlety in the ratio itself: *"When the EXISTS command reports that a key is absent then
  this is counted as a keyspace miss."*

## Misuse 1: `KEYS` in application code

`SCAN`'s complexity contract is the argument: *"Time complexity: O(1) for every call. O(N) for a
complete iteration."* Each call is cheap regardless of dataset size.

`KEYS` has no such property, and the reference states the consequence plainly: the scan family
exists because those commands *"can be used in production without the downside of commands like
KEYS or SMEMBERS that may block the server for a long time (even several seconds) when called
against big collections of keys."* On a single-threaded server, that is a full stall for every
other client — a read-only cache pattern makes it worse, because the whole point of the instance
is that reads are the hot path.

The correctness cost is equal to the performance cost. `SCAN` is a cursor over a collection that
can change mid-iteration, so *"the SCAN family of commands only offer limited guarantees about
the returned elements."* A `KEYS`-shaped loop written against `SCAN` — one that assumes the
first pass sees every key — is wrong in a way that only shows up under concurrent writes.

The migration is mechanical, and `COUNT` is a tuning knob rather than a page size:

```ts
// Don't: blocks the server for seconds on a large keyspace
const all = await redis.keys('session:*')

// Do: cursor until it returns to 0; COUNT is a hint, default 10
let cursor = '0'
do {
  const [next, keys] = await redis.scan(cursor, { MATCH: 'session:*', COUNT: 100 })
  cursor = next
  await doSomething(keys)
} while (cursor !== '0')
```

The loop condition is the part people get wrong: the iteration ends when the cursor returns to
`0`, **not** when a batch comes back empty. A batch can legitimately be empty while more keys
remain.

If iteration is frequent rather than occasional, the right answer is not a better `SCAN` loop —
it is a different data structure. A key prefix is a pattern match over every key in the
database; an index (a set, or a Redis sorted set scored by timestamp) turns the question into an
`SMEMBERS` on a known key.

## Misuse 2: cache invalidation by TTL alone, then layering Pub/Sub

The stale-read problem is named in Redis's own client-caching reference: *"after the application
above locally cached the information for user:1234, Alice may update her username to Flora. Yet
the application may continue to serve the old username."*

The naive fix is Pub/Sub invalidation, and the reference explains why it underperforms:
messages go *"to every client in the application, even if certain clients may not have any copy
of the invalidated data"*, it is *"costly from the point of view of the bandwidth used"*, and
*"every application query altering the data requires to use the PUBLISH command, costing the
database more CPU time."* Pub/Sub is also fire-and-forget — a client disconnected at publish time
misses the invalidation permanently, and there is no replay.

Redis 6 added **tracking** as the supported answer, with two modes:

- **Default (opt-in) mode** — *"the server remembers what keys a given client accessed, and sends
  invalidation messages when the same keys are modified. This costs memory in the server side,
  but sends invalidation messages only for the set of keys that the client might have in
  memory."*
- **Broadcasting mode** — *"the server does not attempt to remember what keys a given client
  accessed, so this mode costs no memory at all in the server side. Instead clients subscribe to
  key prefixes such as object: or user:, and receive a notification message every time a key
  matching a subscribed prefix is touched."*

The trade is memory on the server against messages on the wire, and the first mode's cost is
bounded by what a client actually read — which is the part hand-rolled Pub/Sub gets wrong.

## Usage Example

Cache-aside with a TTL, which is the correct default shape:

```ts
async function getUser(id: string): Promise<User> {
  const key = `user:${id}`
  const hit = await redis.get(key)
  if (hit) return JSON.parse(hit)

  const user = await db.users.find(id)
  if (user) await redis.set(key, JSON.stringify(user), { EX: 300 })  // TTL: the safety net
  return user
}
```

The TTL is not the invalidation strategy — it is the bound on how wrong a missing invalidation
can be. For data that must be exact on read, the write path deletes the key, and the TTL is
what covers the case where the delete was lost. Without a TTL, a lost delete is permanent
staleness; with one, it is bounded.

## Caveats

- **`volatile-ttl` and friends silently become `noeviction`** when no keys carry a TTL, which
  converts a cache into a write-failing service. This is the single most likely way a
  `volatile-*` policy causes an outage.
- **Eviction is not free even when it is correct.** A miss that re-reads the database is a
  database load, so a policy that evicts too aggressively shows up as origin load, not as Redis
  load. Watch both `evicted_keys` and the origin's query rate together.
- **`maxmemory` is checked between commands, not during one.** A single large write can overshoot
  the configured limit substantially, so a `maxmemory` set exactly at available RAM is not a
  safe setting.
- **A shared instance inherits every policy decision.** Queues, locks, rate limiters, and
  sessions on the same keyspace as a cache mean the eviction policy is choosing what to lose
  across all of them. Redis's own guidance — run two instances — is the correct answer and is
  the one most often skipped.
- **This asset does not cover:** Redis as a primary datastore rather than a cache (persistence
  and durability tradeoffs), `volatile-*` at scale with many key TTL classes, the
  `OBJECT FREQ` / LFU counter decay, client-side caching in a specific language client, and
  cache stampedes — the thundering-herd problem when one popular key expires under load. Stampede
  protection is the most notable omission here and is not covered by the `EX 300` above.
