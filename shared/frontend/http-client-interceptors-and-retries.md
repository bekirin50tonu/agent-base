---
title: "HTTP Client Interceptors, Cancellation, and Retries"
category: "config"
applies_to: "Any browser or Node client using Axios, or a hand-rolled fetch wrapper"
last_updated: "2026-09-30"
source: "https://github.com/axios/axios/releases, https://developer.mozilla.org/en-US/docs/Web/API/AbortController"
---

# HTTP Client Interceptors, Cancellation, and Retries

One place to attach auth, one place to unwrap errors, one place to decide what is worth retrying — and an `AbortController` on every request whose result the user may no longer want. These are the four concerns a hand-rolled `fetch` wrapper ends up reimplementing, badly, if it is allowed to grow organically.

## When to Use

- The target project has more than one place that calls the same API, and the base URL or auth header is not centralised.
- A reviewer asks which failures are safe to retry, or how a component avoids a state update after unmount.
- Axios is a dependency and its interceptors are either unused or tangled.

## Usage Example

### Interceptor ordering is the whole game

Request interceptors run in **registration** order; response interceptors run in **reverse**. That asymmetry is why a response interceptor that rejects navigates every subsequent handler in the chain — a 401 handler registered first sees every response, a 401 handler registered last sees only what earlier handlers passed through.

```js
const api = axios.create({ baseURL: "/api", timeout: 15_000 });

// request: add the token, outermost first
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// response: unwrap once, at the end of the chain — the LAST handler registered
// runs FIRST, so register the 401 handler AFTER this one.
api.interceptors.response.use(
  (r) => r.data,
  (error) => Promise.reject(normalize(error)),  // always returns a rejected promise
);
api.interceptors.response.use(undefined, async (error) => {
  if (error.response?.status === 401 && !error.config._retried) {
    error.config._retried = true;
    accessToken = await refresh();
    return api(error.config);          // re-enters the request interceptor
  }
  return Promise.reject(error);
});
```

Two traps: a response interceptor that `throw`s a non-`Error` value, and one that returns a plain object instead of a promise — the chain assumes a promise and silently swallows the rejection otherwise.

### Retry only what is safe to retry

Retry a request when **all** of these hold: the method is idempotent or carries an `Idempotency-Key`; the failure is a network error, a `429`, or a `502`/`503`/`504`; and the request was not already at its deadline. Never retry a `400` or a `422` — the server parsed the request and rejected it; retrying sends the same rejection again.

```js
const RETRYABLE = new Set([429, 502, 503, 504]);
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason); }, { once: true });
});

async function withRetry(config, { attempts = 3, baseMs = 200 } = {}) {
  for (let i = 0; ; i++) {
    try { return await api.request(config); }
    catch (e) {
      const status = e.response?.status;
      const ok = RETRYABLE.has(status) || !e.response;   // no response = network/timeout
      if (i >= attempts - 1 || !ok || config.headers?.["Idempotency-Key"] === undefined && !config.idempotent) throw e;
      // full jitter: the point is to de-correlate clients, not to be polite in a fixed way
      await sleep(Math.random() * baseMs * 2 ** i, config.signal);
    }
  }
}
```

Backoff without jitter synchronises every client that failed at the same moment — which is how a retry storm turns a 30-second blip into a sustained outage. Honour `Retry-After` when the server sends it; it is the only number that reflects the actual capacity situation.

### Cancellation is not cleanup

```js
const ctrl = new AbortController();
const res = await fetch("/api/orders", { signal: ctrl.signal });

// in the effect that owns the request
useEffect(() => {
  const ctrl = new AbortController();
  load(ctrl.signal);
  return () => ctrl.abort();     // unmount, or a dependency changed
}, [orderId]);
```

`AbortError` is expected, not exceptional — swallow it specifically rather than `catch {}`-ing everything, or you will hide real failures behind an unmount. Axios 0.34.0 (September 2026) explicitly adds cancellation context to requests; check whether your version's abort semantics match what your components assume.

## Caveats

- **Axios has two live release lines and they are not interchangeable.** As of 2026-09-30 the latest tags are **v1.20.0** (August 19, 2026) and **v0.34.0** (September 13, 2026), and the 0.34.0 notes describe breaking changes in header types and proxy routing. Pin a major explicitly; do not let a range float across the 0.x/1.x boundary.
- **Recent axios releases are security releases; read the notes before upgrading.** v1.20.0 hardens runtime option handling against *"shared and foreign prototype pollution"* and normalizes interceptor replacement objects; v0.34.0 prevents *"inherited properties from influencing form serializer options, default request methods, headers on interceptor-returned configs, and HTTP redirect hooks."* Prototype pollution in interceptor-returned config is precisely the pattern the interceptor section above uses — that is a signal to review yours.
- **Node's `timeout` option and `AbortSignal.timeout()` interact poorly.** An axios `timeout` produces its own error path, separate from an abort; if you use both, the one that fires first determines the error the caller sees. Pick one deadline mechanism.
- The `idempotent` flag in the retry example is a placeholder for your own contract. For a real one, see the idempotency rule — the header, the fingerprint check, and the replay semantics all have to line up, or a retry is a duplicate write.
- **This asset does not argue Axios versus `fetch`.** The interceptor/cancellation shape ports directly to a middleware-style `fetch` wrapper; the trade-off is the dependency and the ~15 kB, not the patterns. If you drop Axios, keep the four concerns above or you will rebuild them.
- `Retry-After` handling and the jitter formula are standard practice, not quoted from a primary source. Tune the constants to your API's capacity, not to a blog post's example.