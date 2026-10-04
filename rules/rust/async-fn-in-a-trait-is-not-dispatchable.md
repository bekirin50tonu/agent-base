---
title: "An async fn in a Trait Removes Its dyn Compatibility, and Nothing Warns You"
rule_id: "RULE-RUST-001"
category: "api-design"
scope: "backend"
applies_to: "Any trait definition containing an async fn; any trait intended to be used as a trait object (dyn Trait); any plugin registry, handler map, or dependency-injected collaborator keyed by trait"
last_updated: "2026-10-04"
source: "https://doc.rust-lang.org/reference/items/traits.html"
---

# An async fn in a Trait Removes Its dyn Compatibility, and Nothing Warns You

A trait with an `async fn` in it is a valid trait. It compiles, it works with generic code, and it
monomorphises into concrete implementations without complaint. What it cannot do is be used as a
`dyn Trait` — and that is the capability people most often add a trait for. The restriction is not
a bug and it is not going away: an `async fn` returns an unnamed future type, and a vtable has no
place to put it.

## Why

The Reference lists exhaustively what a function must be to be reachable through a trait object.

> Dispatchable functions must:
> ([The Rust Reference — Traits](https://doc.rust-lang.org/reference/items/traits.html))

and one entry in that list is the one that surprises people:

> Not be an async fn (which has a hidden Future type).
> ([The Rust Reference — Traits](https://doc.rust-lang.org/reference/items/traits.html))

The same page then closes the door on the three traits the language feature introduced:

> the asyncfn, asyncfnmut, and asyncfnonce traits are not dyn-compatible.
> ([The Rust Reference — Traits](https://doc.rust-lang.org/reference/items/traits.html))

`std::ops::AsyncFn` says the same of itself, and explains the older vocabulary:

> This trait is not dyn compatible
> ([std::ops::AsyncFn](https://doc.rust-lang.org/std/ops/trait.AsyncFn.html))

The parenthetical in the Reference is the whole mechanism, and the Reference's own function page
shows the desugaring:

> Async functions do no work when called: instead, they capture their arguments into a future.
> ([The Rust Reference — Functions](https://doc.rust-lang.org/reference/items/functions.html))

There is also a documented escape hatch, and it is the reason this is a rule rather than a compile
error:

> Sized must not be a supertrait
> ([The Rust Reference — Traits](https://doc.rust-lang.org/reference/items/traits.html))

A method with a `where Self: Sized` bound can never be called through a trait object, because there
is no trait object to call it on — so `async fn` becomes dispatchable by making the trait
unobject-safe *on purpose*. The trait then compiles, keeps working for every generic and
monomorphised caller, and quietly loses exactly the capability that would have let a caller supply a
heterogeneous set of implementations.

The failure surfaces at the use site, not the definition:

> This trait is not dyn compatible
> ([std::ops::AsyncFn](https://doc.rust-lang.org/std/ops/trait.AsyncFn.html))

## Do

- Return the future as a value when the trait needs to be object-safe. This is the default answer
  for a trait you own:
  ```rust
  use std::future::Future;

  trait Repository {
      fn load(&self, id: u64) -> impl Future<Output = User> + Send + '_;
  }

  fn registry() -> HashMap<&'static str, Box<dyn Repository>> {
      let mut r = HashMap::new();
      r.insert("primary", Box::new(PostgresRepo::new()));
      r
  }
  ```
- Add `#[trait_variant::make(...)]` when you need `Send`/`Sync` variants of a trait other people
  call, or when the base trait is `async fn` and you want to keep both shapes:
  ```rust
  #[trait_variant::make(HttpFactory: Send)]
  trait LocalFactory {
      async fn build(&self) -> HttpClient;
  }
  ```
- Write the lifetime capture explicitly (`+ '_`) on the returned future. The desugaring assumes it,
  but a hand-written `-> impl Future` is yours to state:
  ```rust
  // The return type in the desugaring is assumed to capture all lifetime
  // parameters from the async fn declaration.
  // ([The Rust Reference — Functions](https://doc.rust-lang.org/reference/items/functions.html))
  fn load<'a>(&'a self, id: u64) -> impl Future<Output = User> + Send + 'a;
  ```
- Add a compile-time assertion wherever the trait must stay object-safe, so a later `async fn`
  cannot reintroduce the loss quietly:
  ```rust
  fn assert_object_safe<T: ?Sized>() {}
  fn assert_registry<T: Repository + ?Sized>() { assert_object_safe::<T>(); }
  ```
- Reach for `#[async_trait]` when the trait is *not* yours — it is the only way to retrofit dyn
  compatibility onto an existing dependency's trait, and the cost below is what you are paying for.

## Don't

- Add `async fn` to a trait that a test double, mock, plugin registry, or handler map will ever
  implement. The generics keep compiling, so the breakage lands on whoever first wants
  `Box<dyn Trait>`.
- Treat a green test suite as evidence the trait is usable as a trait object. Every monomorphised
  caller passes. Only heterogeneity fails, and only at the use site.
- Reach for `#[async_trait]` first. It is the most-adopted answer in the ecosystem largely because
  it predates native `async fn` in traits, not because it is cheaper — it boxes a future on every
  call, and its `Send` decision is per-crate rather than per-method.
- Assume `#[async_trait(?Send)]` and `#[async_trait]` are interchangeable inside one crate. One
  `Send` requirement elsewhere in the program pushes the whole crate toward boxing futures that
  never cross a thread.
- Assume the error is a compile error at the trait. It is not, unless something in your build
  actually requires `dyn`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `the trait 'X' is not dyn compatible` at a `Box<dyn X>` | `async fn` in the trait, no `Self: Sized` escape | Return `impl Future`, or `#[trait_variant::make]` |
| The trait works everywhere except where heterogeneity is needed | Generics and monomorphisation cannot see the missing capability | Add the object-safety assertion at the registration site |
| A method stops being callable on `dyn Trait` after adding `Self: Sized` | The escape hatch removes it from the vtable by design | Move the method to an inherent impl or a free function |
| Every call allocates after adopting `async-trait` | The macro boxes each returned future | Prefer `-> impl Future` on traits you own |
| `Send` errors appear only after adding a dependency that spawns | `#[async_trait(?Send)]` makes the crate's futures non-`Send` | Use the `Send` form and mark the offending spawn |
| A trait stopped being object-safe after a refactor with no error at the definition | Someone added an `async fn` to a trait that had `Self: Sized` methods only | Re-run the object-safety assertion in CI |

## Verifying

```bash
# Traits that contain an async fn -- each line is a trait that cannot be a dyn
grep -rn --include='*.rs' -B20 'async fn' src/ \
  | grep -E '^\S+[-:]trait ' | sort -u

# Places that need a trait object; each one must name a trait from the list above
grep -rn --include='*.rs' 'Box<dyn \|&dyn \|Arc<dyn ' src/

# The escape hatch, which is the silent way to lose object safety
grep -rn --include='*.rs' 'where Self: Sized\|: Sized' src/

# The macro, and which Send form each call site uses
grep -rn --include='*.rs' 'async_trait' src/
```

The first and second commands are the audit: any trait that appears in both has lost the capability
it needs. Neither command can tell you whether a trait *should* be object-safe — that depends on
whether a test double or a plugin is planned, which is why the assertion in the Do section is worth
adding rather than inferring. What none of these commands show is which `async_trait` futures cross
a thread boundary at runtime; that is what a `Send`-bound assertion or a `tokio::spawn` call site
reveals.
