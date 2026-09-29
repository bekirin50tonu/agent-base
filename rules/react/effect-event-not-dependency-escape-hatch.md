---
title: "useEffectEvent Reads Latest Values Without Re-running the Effect — Not a Dependency Escape Hatch"
rule_id: "RULE-REACT-008"
category: "correctness"
scope: "all"
applies_to: "React 19.3+ components that must read fresh values from inside a long-lived Effect"
last_updated: "2026-09-30"
source: "https://react.dev/reference/react/useEffectEvent"
---

# useEffectEvent Reads Latest Values Without Re-running the Effect — Not a Dependency Escape Hatch

The dependency trap in RULE-REACT-004 has a real answer, and it is narrower than it looks.
`useEffectEvent` gives a callback the latest committed values without adding them to the
dependency list. That is the whole feature, and also its limit.

## Why

> Effect Events are a part of your Effect logic, but they behave more like an event handler.
> They always "see" the latest values from render (like props and state) **without
> re-synchronizing your Effect**, so they're excluded from Effect dependencies.

The canonical case is the reconnect bug. Re-declaring `muted` as a dependency means changing a
notification setting tears down and rebuilds the socket:

```js
function ChatRoom({ roomId, muted }) {
  const onConnected = useEffectEvent(() => {
    if (!muted) showNotification('Connected!');
  });

  useEffect(() => {
    const connection = createConnection(roomId);
    connection.on('connected', onConnected);
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]);   // muted is NOT here — and must not be
}
```

> Since onConnected is an Effect Event, muted and onConnect are not in the Effect dependencies.

The same shape covers timers and global listeners. A `setInterval` reading `count` and
`increment` does not restart every time either changes; a `pointermove` listener reads the
current `canMove` without being removed and re-added. And it composes into custom Hooks —
`useInterval(callback, delay)` where the caller's callback is a fresh closure each render, with
the interval still stable because only `delay` is a dependency.

## Do

- Use it when the value should be *read* at fire time but must not *re-trigger* the Effect.
  The docs' test: *"Only use it for logic that is genuinely an event fired from Effects."*
- Wrap callbacks passed into your own custom Hooks so consumers can pass inline closures. This
  is the pattern that makes a Hook's identity argument stop mattering.
- Call it only from `useEffect`, `useLayoutEffect`, `useInsertionEffect`, or another Effect
  Event in the same component.

## Don't

- Use it to shrink a dependency array. The docs name this pitfall and show the failure:

```js
// 🔴 Wrong: Using Effect Events to hide dependencies
const logVisit = useEffectEvent(() => { log(pageUrl); });
useEffect(() => { logVisit(); }, []);  // Missing pageUrl means you miss logs
```

  The guidance is unambiguous: *"Do not use useEffectEvent to avoid specifying dependencies in
  your Effect's dependency array. This hides bugs and makes your code harder to understand."*
- Put it in the dependency array. The linter forbids it — *"Functions returned from
  useEffectEvent must not be included in the dependency array"* — and the reason is the
  identity rule below. Including it *"would cause your Effect to re-run on every render."*
- Call it during render, from an event handler, or pass it to a child. Each is a distinct
  error. For a callback a child or a click handler needs, *"use a regular function or
  `useCallback` instead."*
- Treat its identity as stable. It isn't, by design: *"Effect Event functions do not have a
  stable identity. Their identity intentionally changes on every render."* Anything comparing
  the function by reference will misbehave — `useEffect`'s dependency comparison is exactly
  why the linter blocks it.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Effect Event in deps, re-runs every commit | Unstable identity, linter suppressed | Remove it from the array |
| *"can only be called from Effects"* | Called from render, a handler, or a child | Use a plain function there |
| Missed logs / missed analytics | Used to hide a real dependency | Restore the dependency |
| Timer restarts on every tick | `increment` added as a dependency | Wrap the tick in an Effect Event |

## Verifying

```bash
npx eslint --rule '{"react-hooks/exhaustive-deps":"error"}' 'src/**/*.{ts,tsx}'
grep -rn 'useEffectEvent' --include=*.tsx src/ -A6 | grep -B3 'useEffect'
```

Read each hit for whether the value should have re-triggered the Effect. That is the only
question the hook raises, and the linter cannot answer it.

## Version note

Verified against **react@19.3**, where `useEffectEvent` appears in the hooks reference with a
full page including three troubleshooting entries. Its earlier availability across 19.x minors
was not verified by this research — if the project is on an older 19.x, confirm the export
exists before writing against it. It is a Hook, so the standard rules-of-hooks constraint
applies: top level of a component or your own Hook, never in a loop or a condition.
