---
title: "localStorage is synchronous and per-origin, so a large setItem blocks the main thread"
rule_id: "RULE-HTML-CSS-007"
category: "performance"
scope: "frontend"
applies_to: "localStorage, sessionStorage, IndexedDB, caching, quotas, private mode, cross-subdomain state"
last_updated: "2026-10-04"
source: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API"
---

# localStorage is synchronous and per-origin, so a large setItem blocks the main thread

`localStorage` is a synchronous, same-origin dictionary. Every read and every write is a blocking
call on the main thread, and "same-origin" is a boundary the page cannot see across — a bundle
served from a different subdomain starts from an empty store with no error.

## Why

The blocking behaviour is not a caveat, it is the definition:

> Both `sessionStorage` and `localStorage` in Web Storage are synchronous in nature. This means
> that when data is set, retrieved, or removed from these storage mechanisms, the operations are
> performed synchronously, blocking the execution of other JavaScript code until the operation is
> completed.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

> This synchronous behavior can potentially affect the performance of the web application,
> especially if there is a large amount of data being stored or retrieved.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

MDN names the alternative explicitly, and it is the answer for anything large:

> Asynchronous alternatives, such as IndexedDB, may be more suitable for scenarios where
> performance is a concern or when dealing with larger datasets.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

The per-origin boundary is where the silent failures live:

> A different storage object is used for the `sessionStorage` and `localStorage` for each origin
> — they function and are controlled separately.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

And in a private window the durability assumption changes without any API call reporting it:

> In private mode, `localStorage` is treated like `sessionStorage`.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

> The storage APIs are still available and fully functional, but all data stored in the private
> window is deleted when the browser or browser tab is closed.
> ([Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API))

That is the trap: an app that treats `localStorage` as durable persistence writes successfully
and loses the data on close, with no exception to catch.

## Do

- Use `localStorage` for small, synchronous, cheap reads — a feature flag, a theme choice, a
  token — and keep the whole payload well under a few tens of kilobytes.
- Use IndexedDB for anything structured or large: blobs, lists, caches, anything you would not
  read on every frame.
- Read from storage **once** at startup into memory, and treat storage as the persistence
  boundary, not the read path.
- Namespace keys by origin *and* by app version, and handle a missing key as a normal first-run
  state rather than an error.
- Wrap `setItem` in a try/catch: quota exhaustion and private-mode differences both surface as
  thrown or no-op behaviour depending on the browser.

## Don't

- Don't `JSON.parse` a large blob on every render or every `visibilitychange`. The read and the
  parse are both on the main thread.
- Don't assume `localStorage` survives closing the tab. In private mode it does not.
- Don't assume a different subdomain shares the store. It does not, and there is no error when it
  doesn't.
- Don't store session tokens or anything sensitive in `localStorage` — it is readable by any
  script on the origin, which is a different problem from this one but arrives together.
- Don't use `localStorage` as a cache for data you would re-fetch anyway without a plan for what
  a stale entry means.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Input lags on a specific action | Synchronous `setItem` of a large value | Move to IndexedDB, or debounce the write |
| Data gone after closing the tab | Private/incognito window behaviour | Treat as session state in that mode |
| Second subdomain sees an empty store | Per-origin storage object | Same origin, or share via the server |
| `QuotaExceededError` on write | Payload over quota | Store less, or move to IndexedDB |
| Write silently does nothing | Browser-dependent private-mode behaviour | Verify by reading back |
| Jank on every tab switch | Read + parse on `visibilitychange` | Cache in memory, read once |

## Verifying

```bash
# 1. Every storage touch -- the synchronous read/write surface
grep -rnE 'localStorage|sessionStorage' --include=*.js --include=*.ts --include=*.jsx --include=*.tsx \
  --include=*.vue --include=*.svelte . | grep -v node_modules | head -40

# 2. Writes that are not guarded -- quota and private mode both throw or no-op
grep -rnE '(localStorage|sessionStorage)\.setItem' --include=*.js --include=*.ts --include=*.jsx --include=*.tsx . \
  | grep -v node_modules

# 3. Reads on a hot path -- per-render or per-event reads block
grep -rnE 'getItem\(' --include=*.jsx --include=*.tsx --include=*.vue . | grep -v node_modules

# 4. Large payloads -- stringified objects rather than flags
grep -rnE 'setItem\([^,]+,\s*JSON\.stringify' --include=*.js --include=*.ts --include=*.jsx --include=*.tsx .

# 5. Cross-subdomain assumptions -- an API on one origin, the app on another
grep -rn 'localhost\|127\.0\.0\.1' --include=*.json --include=*.env* . 2>/dev/null | grep -iE 'url|origin|api' | head -10

# 6. Confirm the real cost in the browser, per call site:
#    performance.now() around the setItem, and Storage.getItem in devtools for the origin
```

What this check cannot see: steps 1–4 find storage calls but not their size or frequency — a
`setItem` of a 30-byte flag and a `setItem` of a 4 MB string are the same line of code, and only
one of them is a jank source. Step 5 cannot tell whether two origins were *meant* to share
storage. And none of it can observe private mode, which changes the durability contract with no
code change. The instrument that settles it is step 6: timing the call and reading the origin
panel in devtools, per origin the app is actually served from.
