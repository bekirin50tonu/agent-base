---
title: "Loop-Variable Safety Is a go.mod Property, Not a Toolchain Property"
rule_id: "RULE-GO-004"
category: "correctness"
scope: "all"
applies_to: "Any for/range loop whose variable is captured by a closure, goroutine, or pointer"
last_updated: "2026-09-30"
source: "https://go.dev/blog/loopvar-preview"
---

# Loop-Variable Safety Is a go.mod Property, Not a Toolchain Property

Go 1.22 gave every iteration its own variable — but only in modules that declare `go 1.22` or
later. On an older directive you get the old semantics on a new toolchain, and `go vet` has
been taught to stay silent about it.

## Why

> In Go 1.22, each iteration of the loop creates new variables, to avoid accidental sharing
> bugs. ([go1.22 release notes](https://go.dev/doc/go1.22))

The gate is the module directive, and this is the part that surprises people:

> To ensure backwards compatibility with existing code, the new semantics will only apply in
> packages contained in modules that declare go 1.22 or later in their go.mod files. […] Old
> code will continue to mean exactly what it means today: the fix only applies to new or
> updated code.

And the safety net went with it:

> When analyzing a file that requires Go 1.22 or newer, **vet no longer reports references to
> loop variables from within a function literal that might outlive the iteration of the
> loop.** ([go1.22 release notes](https://go.dev/doc/go1.22))

So a clean `go vet` run means nothing about capture safety. The only assertable fact is the
`go` line in `go.mod`.

### The class of bug this finds

The Go team fixed a large set of **passing tests that were testing the wrong thing** before
flipping the switch:

```go
func TestAllEvenBuggy(t *testing.T) {
	testCases := []int{1, 2, 4, 6}
	for _, v := range testCases {
		t.Run("sub", func(t *testing.T) {
			t.Parallel()
			if v&1 != 0 { t.Fatal("odd v", v) }
		})
	}
}
```

> In Go 1.21, this test passes because t.Parallel blocks each subtest until the entire loop
> has finished and then runs all the subtests in parallel. When the loop has finished, v is
> always 6, so the subtests all check that 6 is even, so the test passes. […] Fixing for
> loops exposes this kind of buggy test.

That is not a style issue. It is a green CI signal asserting something false.

## Do

- **Check the directive before reasoning about capture.** `go 1.21` in `go.mod` means old
  semantics, whatever `go version` prints.
- On a `go < 1.22` module, keep `v := v`, or pass the value as a parameter:
  `go func(u string) { … }(v)`. Both remain correct after 1.22 — they are redundant, not
  wrong.
- Re-verify any table-driven test that combines `t.Run` + `t.Parallel()` with per-case
  assertions. Bump the directive, or run once under `GOEXPERIMENT=loopvar`, and watch for
  new failures. Those failures were always there.
- Know what the fix does **not** cover. From the Let's Encrypt incident: *"modelToAuthzPB
  used pointers to fields in v when constructing its result, so the loop also needed to make
  a copy of v."* Per-iteration variables protect the **variable**; data **pointed to** by it
  is still shared.

## Don't

- Treat a silent `go vet` as a capture-safety check. It was deliberately turned off for
  go1.22+ modules, and it never covered the pointer case.
- Remove `v := v` from a module that has not actually bumped to `go 1.22`. The idiom still
  appears throughout the standard documentation — the subtests post carries the comment
  `// capture range variable` — so "the docs show it" is not an argument either way. Read
  the directive.
- Take `&v` inside a loop and store the pointer in a slice, map, or goroutine. Under
  go1.22+ this is still an aliasing bug; the language change made the *variable* fresh, not
  its contents.
- Assume bumping `go.mod` to 1.22 is behaviour-neutral. It is a semantic change with a test
  suite as its detector — run the tests, do not just merge it.

## Verifying

```bash
grep '^go ' go.mod                    # the only real check; < 1.22 → old semantics

GOEXPERIMENT=loopvar go test ./...   # on a <1.22 module: surfaces the hidden failures
```

After a directive bump, read the test output for *new* failures rather than assuming there
are none. The point of the change is that it makes previously-silent bugs loud.
