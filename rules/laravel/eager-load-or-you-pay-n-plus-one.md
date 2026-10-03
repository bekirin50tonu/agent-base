---
title: "A Relationship Accessed as a Property Is a Query — and Eager Loading Does Not Cover Reaching Upward"
rule_id: "RULE-LARAVEL-006"
category: "performance"
scope: "backend"
applies_to: "Any loop over Eloquent models, any Blade template rendering a collection, and any relation defined with hasMany/belongsToMany"
last_updated: "2026-10-03"
source: "https://laravel.com/framework/docs/12.x/eloquent-relationships,https://laravel.com/framework/docs/12.x/eloquent,https://github.com/alexeymezenin/laravel-best-practices"
---

# A Relationship Accessed as a Property Is a Query — and Eager Loading Does Not Cover Reaching Upward

`$post->comments` is not a field read. It is a query the first time it is touched on a given
instance, cached afterwards. Inside a loop, "the first time" is once per iteration — and nothing in
the source looks like a query.

## Why

The framework documents the textbook case under eager loading, but the case it emphasises is the
one eager loading does **not** fix:

> **Even when utilizing Eloquent eager loading**, "N + 1" query problems can arise if you try to
> access the parent model from a child model while looping through the child models:
>
> […] an "N + 1" query problem has been introduced because, even though comments were eager
> loaded for every `Post` model, **Eloquent does not automatically hydrate the parent `Post` on
> each child `Comment` model.**
> ([Laravel 12.x Eloquent Relationships](https://laravel.com/framework/docs/12.x/eloquent-relationships))

So `$comment->post->title` over a collection of comments costs one query per comment *even though*
you eager loaded `comments`. The fix is not another `with()` call; it is hydrating the inverse
relation onto the children:

```php
public function comments(): HasMany
{
    return $this->hasMany(Comment::class)->chaperone();
}
```

The third form is not an N+1 at all, and it is the easiest to introduce — a plain foreign key
exists, and the relation is loaded to read it anyway. The operator-supplied gist (trust 0.85 —
attributed opinion) names the cause rather than the symptom: *"Don't needlessly access relationships
from models"* — prefer `$user->account_id` over `$user->account->id`.

| Access | Cost | Fix |
|---|---|---|
| `$post->comments` in a loop | 1 query per post | `Post::with('comments')->get()` |
| `$comment->post->title` | 1 query per comment, *with* eager loading | `->chaperone()` on the `hasMany` |
| `$user->account->id` | 1 query per user | `$user->account_id` |

The framework ships a runtime switch, which is the strongest available signal about severity:

```php
public function boot(): void
{
    Model::preventLazyLoading(! $this->app->isProduction());
}
```
([Laravel 12.x Eloquent](https://laravel.com/framework/docs/12.x/eloquent))

Without it a production lazy load is silent — no query log entry, no exception, no metric. The
documented default leaves it off in production, so the defect ships as a slow endpoint rather than
an error.

## Do

- Eager load exactly the relations the loop body touches, on the query that feeds it — not on the
  model class, and not speculatively.
- Add `->chaperone()` to the `hasMany` when children are rendered with their parent:
  ```php
  $posts = Post::with('comments')->get();
  return view('posts.index', compact('posts')); // $comment->post->title is now free
  ```
- Read a foreign key as a key. `$user->account_id` is a column; `$user->account->id` is a query.
- Turn on `preventLazyLoading()` outside production so the class of error fails at the line.
- Stream when the loop body does per-row work — `eachById()` or `cursor()` instead of `get()`.
  `get()` hydrates the whole result set before the loop starts, which is a memory ceiling unrelated
  to the work being done.
- For very large sets, `chunkById()` over `offset` chunking: the latter skips rows as earlier pages
  mutate the result.

## Don't

- Read "we eager loaded" as "no N+1 is possible." The upward case is documented as surviving eager
  loading, and it survives a code review that was already given the eager-loading lesson.
- Use `offset`/`limit` pagination for a loop that writes to the rows it reads. Rows shift under the
  offset and some are skipped.
- Turn `preventLazyLoading()` on in production as a first move. The default is off there for a
  reason — the exception lands mid-request. Enable it where the fallout can be fixed.
- Optimise a query count that is not per-row. Two queries for a page is the target; the multiplier
  is what costs, and it scales with whatever the page limit happens to be.
- Assume holding a transaction makes the extra round trips cheap. It is the round-trip *count*
  that costs, and each one extends the window in which locks are held.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| N+1 survives a correct `with()` | Reached the parent from a child; inverse relation not hydrated | `->chaperone()` on the `hasMany` |
| Queries scale with row count, endpoint merely slow | Property access on a relation inside a loop | `with()` the relations the loop touches |
| One relation loaded where a key would do | `$user->account->id` in place of `$user->account_id` | Use the foreign key |
| Memory ceiling on a large per-row job | `get()` hydrated the whole result set first | `eachById()` / `chunkById()` / `cursor()` |
| Rows silently skipped while paginating with `offset` | Earlier chunk mutated the result set | `chunkById()` |

## Verifying

```bash
# Relations reached from inside a loop or a Blade view
grep -rn 'foreach' resources/views/ | head -50
grep -rn 'preventLazyLoading' app/Providers/
```

The first is a review queue, not a verdict — it lists the places a hidden query can live, and only
reading the loop body decides which property accesses are relation loads. The second tells you
whether the switch is armed outside production. Neither can see a `$user->account->id` reached
through a helper three frames away, which is why `preventLazyLoading()` is the only check that
finds every instance.
