---
title: "Buffer.allocUnsafe() returns pooled memory holding previous data"
rule_id: "RULE-NODEJS-006"
category: "security"
scope: "backend"
applies_to: "Node.js, Buffer, allocUnsafe, memory pooling, information disclosure"
last_updated: "2026-10-04"
source: "https://nodejs.org/api/buffer.html"
---

# Buffer.allocUnsafe() returns pooled memory holding previous data

`Buffer.allocUnsafe()` does not return zeroes. It skips the zeroing step, which is the whole
reason it exists, and the memory it hands back may contain anything left there before:

> While this design makes the allocation of memory quite fast, the allocated segment of memory
> might contain old data that is potentially sensitive.
> ([Buffer](https://nodejs.org/api/buffer.html))

For small buffers it does not return the memory at all — it returns a slice of a shared pool:

> The Buffer module pre-allocates an internal Buffer instance of size Buffer.poolSize that is
> used as a pool for the fast allocation of new Buffer instances
> ([Buffer](https://nodejs.org/api/buffer.html))

The escape from sharing is a different function:

> Instances returned by Buffer.allocUnsafeSlow() never use the shared internal memory pool.
> ([Buffer](https://nodejs.org/api/buffer.html))

## Why

The disclosure is a cross-request leak, not a local one. A buffer allocated from the pool
overlaps memory another live `Buffer` in the same process still holds — a request's data, a
token, a password, a decrypted payload. The unsafe buffer's tail is that data.

The size condition is what makes it intermittent. Pooling applies only below half
`poolSize` (8 KiB by default), so small parses expose the tail and large ones do not. In tests
the pool often holds zeros, so the leak produces no visible output at all.

Two things make it look safe. The buffer type looks correct — it is a `Buffer`, it has the
right length, and no type error occurs. And the code is written to fully overwrite it, which is
the documented safe use. The defect is precisely the case where it does not fully overwrite: a
read length exceeding the bytes received, a parse that stops early, or a length field taken from
the input rather than from what was actually parsed.

## Do

- Use `Buffer.alloc()` for anything derived from untrusted input, and `Buffer.alloc(size, fill)`
  when a known fill value works.
- Use `Buffer.from(string)` and `Buffer.from(array)`, which size to the input.
- Start sensitive services with `--zero-fill-buffers`, which makes every new allocation zeroed
  regardless of which function allocated it.
- When a buffer is fully overwritten before any read, `allocUnsafe` is safe and faster — write
  a comment saying so, so the next reader knows the invariant.
- Use `allocUnsafeSlow` when you need the speed but not the sharing.

```javascript
// Correct — sized to the input, zero-filled
const body = Buffer.alloc(Number(req.contentLength));

// Correct — a fixed header buffer, fully overwritten before use
// (safe: every byte is written below before any read)
const header = Buffer.allocUnsafe(12);
header.writeUInt32BE(0, 0);
header.writeUInt32BE(payload.length, 4);
```

## Don't

- Don't use `allocUnsafe` for a length that comes from the network. That is the exact
  over-read case.
- Don't read past the bytes actually written, on the assumption that `allocUnsafe` zeroed them.
- Don't assume a buffer's contents are private because it is new. It is a slice of shared
  memory.
- Don't use `allocUnsafe` because `alloc` "showed up" in a profile. The cost it removes is real,
  and the exposure it creates is worse than the cost.
- Don't pass a pooled buffer across a worker boundary without knowing whether it was
  transferred or cloned.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Response contains another user's data | Pooled buffer tail not overwritten | `Buffer.alloc` |
| Bytes appear that were never written | `allocUnsafe` returns old memory | Same |
| Leak reproduces only for small payloads | Pooling threshold is `poolSize / 2` | Same, or `allocUnsafeSlow` |
| Fine in tests, leaks in production | Test pool happens to hold zeros | Same |
| Only JSON/parse paths affected | Those size from the input | Size from actual bytes read |
| Cross-thread value changes unexpectedly | Shared `ArrayBuffer` | Allocate per-thread, or transfer |

## Verifying

```bash
# Every unsafe allocation -- each hit needs the overwrite invariant checked
grep -rn --include='*.{js,mjs,cjs,ts}' 'allocUnsafe' src/

# Lengths derived from input, the over-read case
grep -rn --include='*.{js,mjs,cjs,ts}' -E 'allocUnsafe\([^)]*(length|size|len|content)' src/

# Zero-fill, the process-wide mitigation
grep -rn --include='*.{js,mjs,cjs,ts,sh,json,yaml,yml}' 'zero-fill-buffers' .

# Reads past written bytes -- slice/subarray without a checked length
grep -rn --include='*.{js,mjs,cjs,ts}' -E '\.subarray\(|\.slice\(' src/ | grep -vE '\.length'
```

The first list is the whole surface and the second is where the danger concentrates: a length
that came from the wire rather than from a count of received bytes. Each first-list hit needs
its lines after it read to confirm every byte is written.

These greps cannot tell whether a pooled region currently holds sensitive data — that depends
on allocation history at runtime. Confirm by running with `--zero-fill-buffers` in a test
environment; if output changes, a buffer was not fully written.