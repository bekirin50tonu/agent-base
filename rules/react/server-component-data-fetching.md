---
title: "Fetch Data in Server Components — the Waterfall Is Caused by the Client Boundary"
rule_id: "RULE-REACT-001"
category: "performance"
scope: "all"
applies_to: "Any component that loads data it did not receive as a prop, in a React Server Components app"
last_updated: "2026-09-30"
source: "https://react.dev/reference/rsc/server-components"
---

# Fetch Data in Server Components — the Waterfall Is Caused by the Client Boundary

The client/server boundary is not a rendering optimisation. It is the thing that *creates* the
waterfall. A `useEffect` fetch does not start until after the component has rendered, and
each render can only start the next fetch.

## Why

The React docs diagnose the exact shape, with a two-comment example. Fetch in an effect on
the client and the second component cannot even begin until the first has rendered:

```js
function Note({id}) {
  const [note, setNote] = useState('');
  // NOTE: loads *after* first render.
  useEffect(() => { fetch(`/api/notes/${id}`).then(/* … */) }, [id]);
  return <div><Author id={note.authorId} /><p>{note}</p></div>;
}

function Author({id}) {
  const [author, setAuthor] = useState('');
  // NOTE: loads *after* Note renders.
  // Causing an expensive client-server waterfall.
  useEffect(() => { fetch(`/api/authors/${id}`).then(/* … */) }, [id]);
  return <span>By: {author.name}</span>;
}
```

Move the same two reads into Server Components and the second no longer waits on a
round trip. The docs annotate the change: *"loads **during** render"*, and then — for the
nested one — *"loads after Note, **but is fast if data is co-located**."* Server Components
call your data layer directly. **There is no API to build and no HTTP round trip**, so the
"wait for the parent's fetch to finish, then start mine" dependency disappears.

The static case is the same argument with the bundle attached. Fetching a markdown file in
an effect means users *"need to download and parse an additional 75K (gzipped) of libraries,
and wait for a second request to fetch the data after the page loads, just to render static
content that will not change for the lifetime of the page."* Rendered at build time, the
client never sees the component or its dependencies at all.

## Do

- `async function` a Server Component and `await` the data in its body. Pass the resolved
  value down as a prop; push `'use client'` as far toward the leaves as possible.
- Read a *parent's* data before rendering children that need it, and co-locate the reads.
  The docs' own qualifier — *"fast if data is co-located"* — is the real target: keep
  related fetches in one server component so they issue together.
- Reserve a Client Component for the interactive leaf. It is a boundary in the bundle, not
  just in the type system.
- Know what crossing the boundary actually costs. A Server Component may render a context
  provider imported from a `'use client'` module — *"Server Components cannot create
  context, but they can render a context provider"* — but every function you pass across is
  code the client must ship.

## Don't

- Fetch in a `useEffect` in a Server Components app. The comment in the official example is
  the finding: `loads *after* first render`. That is the waterfall.
- Build an API route solely so a component can `fetch` it. In a Server Component you can
  read the data layer directly; the route exists only to recreate the round trip.
- Assume the whole component tree is server-rendered. A single `'use client'` at the top of
  the tree puts everything below it back on the client, and the waterfall returns for all of
  it.
- Read a client-fetched value to compute what a child needs. That is the cascading case from
  the example above — the one the docs labelled "expensive".

## Related

If a fetch must happen on the client, the React 19 answer is `use` + Suspense, not
`useEffect` + `useState` — see RULE-REACT-002. Server Components remove the round trip;
`use` removes the effect from the critical path. They are not alternatives for the same
problem.

One correction to the framing above, because it is the common misdiagnosis: moving reads into
a Server Component is not, by itself, the fix for a *sequential* waterfall. Route segments
already render in parallel. If two reads still wait on each other, it is their `await` order
inside one component body — see RULE-REACT-006. This rule removes the client boundary's
contribution; that one removes the ordering.

## Verifying

There is no linter. The check is structural:

```bash
grep -rn "useEffect" --include=*.tsx src/ -A5 | grep -B2 'fetch('   # fetch in an effect?
grep -rln "'use client'" --include=*.tsx src/                       # how high is the boundary?
```

The second one is the higher-value question. A `'use client'` on a file that renders
`<html>` or `<body>` has put the entire app back on the client.

## Version note

Verified against **react@19.3** docs. React Server Components are stable across 19.x
minors, but the *implementation* APIs are not: *"the underlying APIs used to implement a
React Server Components bundler or framework do not follow semver and may break between
minors in React 19.x."* If you are writing a framework rather than an app, pin the version.
