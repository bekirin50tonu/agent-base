---
title: "Declare Every Reactive Value Your Effect Reads — Move Functions Inside to Prove It"
rule_id: "RULE-REACT-004"
category: "correctness"
scope: "all"
applies_to: "Any useEffect with a dependency array"
last_updated: "2026-09-30"
source: "https://react.dev/reference/react/useEffect"
---

# Declare Every Reactive Value Your Effect Reads — Move Functions Inside to Prove It

You cannot choose an Effect's dependencies. They are determined by the code, and suppressing
the linter is a lie React will act on.

## Why

The rule is stated as a fact rather than a guideline:

> Notice that you can't "choose" the dependencies of your Effect. **Every reactive value used
> by your Effect's code must be declared as a dependency. Your Effect's dependency list is
> determined by the surrounding code.**

Reactive values are *"props and all variables and functions declared directly inside of your
component."* There is no opt-out, and the linter enforces it:

```js
useEffect(() => {
  const connection = createConnection(serverUrl, roomId);
  connection.connect();
  return () => connection.disconnect();
}, []); // 🔴 React Hook useEffect has missing dependencies: 'roomId' and 'serverUrl'
```

The corollary is the useful part: **to remove a dependency, prove it is not one.** Moving a
constant out of the component does exactly that — it is no longer a value that can change on a
re-render, so the linter has nothing left to ask about.

## The function trap

This is the failure that survives review, because creating a function per render is normal
and harmless on its own. It becomes a bug the moment it is a dependency:

```js
function ChatRoom({ roomId }) {
  function createOptions() { // 🚩 This function is created from scratch on every re-render
    return { serverUrl, roomId };
  }
  useEffect(() => {
    const connection = createConnection(createOptions());
    connection.connect();
    return () => connection.disconnect();
  }, [createOptions]); // 🚩 As a result, these dependencies are always different on a commit
}
```

That Effect re-runs after **every commit**. The docs draw the line precisely:

> By itself, creating a function from scratch on every re-render is not a problem. You don't
> need to optimize that. However, **if you use it as a dependency of your Effect, it will
> cause your Effect to re-run after every commit.**

The fix is to move the function *inside* the Effect. Then the dependency list is `[roomId]` —
a string that only changes when you set it — and typing in an input no longer reconnects the
chat.

## Do

- Move the function or object construction inside the Effect body. The dependency becomes the
  primitive it closes over.
- Move genuinely constant values to module scope. `const serverUrl = 'https://localhost:1234'`
  at the top of the file is not a reactive value, so it drops out of the list honestly.
- Use an empty array `[]` only when the Effect reads no reactive values — the docs' condition
  is exactly that: *"If your Effect's code doesn't use any reactive values, its dependency
  list should be empty."* Such an Effect runs once on mount and never again.
- Add a value to the list rather than working around a missing one. Every declared dependency
  has to earn its place: `message` above is deliberately absent because the Effect does not
  read it, and that is why editing the message does not reconnect.

## Don't

- Add `// eslint-disable-next-line react-hooks/exhaustive-deps`. The docs call this out as a
  named anti-pattern with the reason: *"By suppressing the linter, you 'lie' to React about
  the values your Effect depends on."* And: *"When dependencies don't match the code, there is
  a high risk of introducing bugs."*
- Wrap a render-created function in `useCallback` just to satisfy the linter. That is the same
  problem with more code — and the docs' stated position is that re-creating a function per
  render is not itself a problem.
- Expect the dependency array to be a performance knob. It is a correctness declaration. An
  over-broad list reconnects on every keystroke; an under-broad one reads a stale closure.
- Put an object literal in the array. A new object is a new reference every render, so it
  re-triggers on every commit — the same trap as the function, one syntax level over.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Effect re-runs on every keystroke | Render-created function or object in deps | Move it inside the Effect |
| Stale value read after a prop changes | Missing dependency | Declare it, do not suppress |
| Connection re-established on every message | Object literal in deps | Declare inside, depend on primitives |
| Lint warning silenced repo-wide | `eslint-disable` on exhaustive-deps | Move the value out of scope instead |

## Verifying

```bash
npx eslint --rule '{"react-hooks/exhaustive-deps":"error"}' 'src/**/*.{ts,tsx}'
grep -rn 'eslint-disable.*exhaustive-deps' --include=*.tsx src/
```

The second grep is the one that matters. A codebase that has silenced this rule has opted out
of the only automatic check React gives you here, and the first grep will then pass
vacuously. Each suppression is a place where a reviewer must manually verify the closure is
actually correct — which is exactly the work the linter was doing.

## Version note

Verified against **react@19.3**. Where a value must be *read* without *re-triggering* the
Effect, react@19.3 has a real answer — `useEffectEvent` — and a real misuse of it. Both are
covered in RULE-REACT-008. Its availability across earlier 19.x minors was not verified by
this research.
