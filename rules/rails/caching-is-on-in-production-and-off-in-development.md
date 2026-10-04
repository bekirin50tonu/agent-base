---
title: "Caching is on in production and off in development"
rule_id: "RULE-RAILS-008"
category: "performance"
scope: "backend"
applies_to: "perform_caching, Rails.cache, fragment caching, cache_store, solid_cache, mem_cache_store, expires_in, cache_key, time_helpers"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/configuring.html"
---

# Caching is on in production and off in development

`config.action_controller.perform_caching` defaults to `false` in development and `true` in
production, and `perform_caching` governs only Action Controller caching — low-level `Rails.cache`
is unaffected. A bug that depends on a cached fragment therefore reproduces locally only if the
developer opts in.

Fragment caching adds a second boundary: expiring a fragment because a record changed does not
expire the outer fragment that contains it, so a page can keep serving stale content with no
signal at all.

The store default also shifted — a generated Rails 8.0+ application uses Solid Cache, while the
generic configuration entry still documents `:file_store`.

## Why

This is a distinct failure class from "the default is surprising". Here the code is identical in
both environments and the behaviour is not, so a test suite, a local run and production disagree
and the disagreement is invisible in the diff.

> Configures whether the application should perform the caching features provided by the Action
> Controller component. Set to false in the development environment, true in production. If it's not
> specified, the default will be true.
> ([Configuring Rails Applications](https://guides.rubyonrails.org/configuring.html))

Note the last clause: "if it's not specified, the default will be true" — the production value
applies to any environment where the key is absent, including test. The environment files supply
`false` for development, which is a decision in generated code, not a framework guarantee.

The scope split is the part that produces the most confusion, because both halves are called
caching:

> Changing the value of config.action_controller.perform_caching only affects caching provided by
> Action Controller. It will not impact low-level caching.
> ([Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html))

So `Rails.cache.fetch` works identically in development and production — including writing to the
same store — while `caches_action` and `caches_page` are inert locally. A developer testing a
`Rails.cache` path sees production behaviour without opting into anything, and a developer testing
a fragment cache sees nothing at all.

Which store is in play also depends on the version that generated the app:

> Solid Cache is a database-backed Active Support cache store. It is the default cache store for
> new Rails applications.
> ([Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html))

> New Rails applications generated with Rails 8.0 and later include Solid Cache by default.
> ([Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html))

And nested fragments expire independently, which is where staleness hides:

> However, that does not automatically expire any outer fragment that contains it.
> ([Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html))

Testing has its own related default — the implicit transaction — which makes tests agree with
neither environment:

> By default, Rails automatically wraps tests in a database transaction that is rolled back once
> completed. This makes tests independent of each other and means that changes to the database are
> only visible within a single test.
> ([Testing Rails Applications](https://guides.rubyonrails.org/testing.html))

## Do

Make the cache behaviour explicit in test and development so both environments exercise the same
path as production:

```ruby
# config/environments/test.rb
config.action_controller.perform_caching = true
config.action_controller.allow_forgery_protection = false
```

Assert against cache state directly, not against whether a fragment happened to be served:

```ruby
test "the summary is cached" do
  Rails.cache.clear
  get admin_dashboard_path
  assert Rails.cache.exist?("views/admin/dashboard")
end
```

Expire the outer fragment too when a record changes, because the inner one is not enough:

```ruby
# Correct — the page fragment that contains it must be expired by name
class Order < ApplicationRecord
  after_commit :expire_dashboard

  def expire_dashboard
    Rails.cache.delete_matched("views/admin/*")
  end
end
```

Prefer explicit keys with a version you control over `cache_key` on an implicit view path when a
fragment's freshness depends on a record — the version is the thing you bump:

```ruby
Rails.cache.fetch("orders/#{id}/summary/v3", expires_in: 5.minutes) { expensive_summary }
```

Use `race_condition_ttl` for anything computed rather than looked up, since several processes
missing the same key at once is the default behaviour:

> For more advanced use cases, Rails.cache.fetch also accepts options such as race_condition_ttl,
> which can help prevent a cache stampede by briefly reusing a recently expired entry while one
> process rebuilds it.
> ([Caching with Rails](https://guides.rubyonrails.org/caching_with_rails.html))

Assert on time-sensitive behaviour with the framework's helpers rather than a fixed timestamp:

> Rails provides built-in helper methods that enable you to assert that your time-sensitive code
> works as expected.
> ([Testing Rails Applications](https://guides.rubyonrails.org/testing.html))

## Don't

Don't develop a caching bug locally. With `perform_caching` off, `caches_action` is a no-op and
the code path you are debugging does not exist in development.

Don't assume `perform_caching` controls `Rails.cache`:

```ruby
# Incorrect — caches_action is inert when perform_caching is false, but Rails.cache still works
Rails.cache.fetch("key") { compute }
caches_action :index
```

Don't rely on the implicit test transaction to reproduce a cache interaction. A fragment that
should be expired on commit is never committed in a wrapped test, so the expiry never fires — the
test is green and the production behaviour is untested. Use the framework's time helpers and an
explicit transaction where the commit path is the thing under test.

Don't assume `expires_in` on an inner fragment propagates outward. It does not, and the outer page
keeps its stale copy until its own TTL.

Don't assume the store. `:memory_store` in development, Solid Cache in a new app, whatever is
configured elsewhere in older ones — code that depends on a store-specific API or a file on disk
behaves differently in each.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Fragment caching bug never reproduces locally | `perform_caching` false in development | Enable it in development and test |
| `caches_action` appears to do nothing | Same, and it is expected | Not a bug locally; it is active in production |
| `Rails.cache` behaves oddly in development | Unaffected by `perform_caching` | Check `cache_store`, not the flag |
| Page serves stale data after a record changes | Only the inner fragment expired | Expire the outer fragment too |
| Same key written by every process at once | Stampede on a computed value | `race_condition_ttl` |
| Cache works in dev, empty in production | Different `cache_store` per environment | Print the resolved store per environment |
| Test passes, production stale | Implicit test transaction never commits | Test the commit path explicitly |
| Everything expired at once | `delete_matched` with too broad a glob | Scope the glob and document it |

## Verifying

Find the cache call sites and, separately, the store configuration:

```bash
grep -rn 'caches_action\|caches_page\|cache ' app/controllers/ app/views/ --include='*.rb'
grep -rn 'Rails.cache\|cache_store\|solid_cache\|mem_cache_store' config/ app/ --include='*.rb'
```

Then print what each environment actually resolves to, rather than assuming from the config file:

```bash
RAILS_ENV=development bin/rails runner 'puts Rails.application.config.action_controller.perform_caching'
RAILS_ENV=production  bin/rails runner 'puts Rails.cache.class'
```

The check that actually catches the environment split is running the same cache-dependent test
twice, once per setting, and requiring both to pass:

```ruby
test "the fragment is served from cache after the first request" do
  Rails.cache.clear
  get admin_dashboard_path
  assert Rails.cache.exist?("views/admin/dashboard")
  get admin_dashboard_path
  assert_response :success
end
```

What this check cannot see: it cannot see the outer-fragment staleness case, because a single
controller renders one fragment. Nested caching is only visible in the browser's network tab or in
a view-level assertion on the containing template — and neither can tell you the TTL you meant to
set from the TTL you did. Read the `expires_in` values back out of the running app rather than from
the diff, and remember that `cache_key` changes when you add or reorder a collection in the
template, which invalidates every fragment that contains it at once.