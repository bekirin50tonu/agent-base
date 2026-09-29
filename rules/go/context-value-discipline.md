---
title: "context.Value Is Request Metadata, Not a Parameter Channel"
rule_id: "RULE-GO-002"
category: "api-design"
scope: "all"
applies_to: "Any use of context.WithValue"
last_updated: "2026-09-30"
source: "https://pkg.go.dev/context"
---

# context.Value Is Request Metadata, Not a Parameter Channel

Typed unexported keys, type-safe accessors, and an explicit `ok`. Never a string key, never
a `map[string]any` smuggled through a context, never an optional argument.

## Why

`WithValue` looks like a way to avoid threading a parameter through five call layers. That
is exactly what it is, and the godoc forbids it:

> Use context Values only for request-scoped data that transits processes and APIs, **not for
> passing optional parameters to functions.**

The cost of the shortcut is that the value becomes invisible to the compiler. A function
using a required dependency through `ctx.Value` has no way to declare it; every caller must
know an unwritten convention, and a missing key is a `nil` type assertion that panics at
runtime, far from the call that forgot it.

Key collisions are the second half. The godoc requires keys to be comparable and warns they
**"should not be of type string or any other built-in type to avoid collisions between
packages using context."** Two packages both using `"userID"` silently overwrite each other.

## Do

Define the key as an **unexported type**, and expose a typed accessor pair:

```go
package user

// The key type is unexported to prevent collisions with context keys defined in
// other packages.
type key int

const userIPKey key = 0

func NewContext(ctx context.Context, ip net.IP) context.Context {
	return context.WithValue(ctx, userIPKey, ip)
}

func FromContext(ctx context.Context) (net.IP, bool) {
	// ctx.Value returns nil if ctx has no value for the key;
	// the net.IP type assertion returns ok=false for nil.
	ip, ok := ctx.Value(userIPKey).(net.IP)
	return ip, ok
}
```

- Return `(T, bool)`. The `bool` is what distinguishes "not set" from "set to the zero
  value" — a plain `T` return conflates them and callers invent sentinel errors.
- Use a concrete struct type for the key where possible: `struct{}` keys avoid allocating on
  the `interface{}` conversion. Otherwise an exported key variable's *static* type should be
  a pointer or interface.
- Use `context.TODO()` where the right context is not yet known, and `context.Background()`
  only at a true entry point (a `main`, a request handler). **Never pass `nil`.**

## Don't

- Use `string` or `int` as a key type. A plain `const userIDKey = "userID"` will eventually
  collide with another package's identically named key.
- Put a required dependency in the context. If the callee cannot work without it, it is a
  parameter.
- Return a bare `T` from the accessor. Use `(T, bool)`.
- Read `ctx.Value` on a hot path expecting it to be cheap. It walks the chain of derived
  contexts, and every `WithValue` adds a level.
- Assume a value placed in a parent context is mutable or safe to write. Context values are
  shared with every goroutine that holds the context; the data must be safe for simultaneous
  use.

## Related

Values must be safe for concurrent use — *"That data must be safe for simultaneous use by
multiple goroutines"* (go.dev/blog/context). A pointer to a mutable struct in a context is
shared mutable state with an extra hop.

## Verifying

There is no linter for this one. The check is in review: any new `WithValue` call should
arrive with an unexported key type and a `(T, bool)` accessor in the same package. If a
reviewer sees a bare `ctx.Value` read without a paired `ok`, that is the finding.
