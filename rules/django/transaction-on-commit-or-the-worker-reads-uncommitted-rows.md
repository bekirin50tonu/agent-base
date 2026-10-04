---
title: "transaction.on_commit(), or the Worker Reads Rows That Do Not Exist Yet"
rule_id: "RULE-DJANGO-001"
category: "correctness"
scope: "backend"
applies_to: "Any task-queue dispatch, cache invalidation, or email send made from inside a transaction.atomic() block or a request under ATOMIC_REQUESTS"
last_updated: "2026-10-04"
source: "https://docs.djangoproject.com/en/6.1/topics/db/transactions/,https://raw.githubusercontent.com/django/django/6.1/django/db/transaction.py"
---

# transaction.on_commit(), or the Worker Reads Rows That Do Not Exist Yet

A transaction hides uncommitted work from *other connections on the same database* — which is
exactly why dispatching a task from inside one looks correct. The worker is not on that connection
and is not inside that transaction. `transaction.on_commit()` is the primitive Django ships for
this, and nothing in the framework applies it on your behalf.

## Why

Three axes have to line up, and none of them reference each other:

1. Whether a transaction is open at the call site at all.
2. Whether the worker's own transaction boundary starts before or after the producer's commit.
3. Whether the broker re-reads state at execution time, or captured it at enqueue time.

Under `ATOMIC_REQUESTS = True` the whole request is one transaction, so a `.delay()` inside it
publishes immediately. A worker on the same database — or on a replica that has not yet received
the commit — reads the row and finds nothing. It then either raises `DoesNotExist`, which is
visible and retryable, or, if written defensively with `.filter().first()`, returns `None` and
quietly does nothing. The second is the silent one.

The rollback direction is worse than the race. Without `on_commit`, a `ROLLBACK` does not retract a
dispatched task — it stays on the queue and runs against rows that never existed. The framework
takes no compensating action, because it was never told the dispatch was transaction-dependent.

Django documents the primitive:

> Sometimes you need to perform an action related to the current database transaction, but only if
> the transaction successfully commits. Examples might include a background task, an email
> notification, or a cache invalidation.
> ([Django 6.1 Transactions](https://docs.djangoproject.com/en/6.1/topics/db/transactions/))

> on_commit() allows you to register callbacks that will be executed after the open transaction is
> successfully committed
> ([Django 6.1 Transactions](https://docs.djangoproject.com/en/6.1/topics/db/transactions/))

> Callbacks are called after the open transaction is successfully committed. If the transaction is
> instead rolled back (typically when an unhandled exception is raised in an atomic() block), the
> callback will be discarded, and never called.
> ([Django 6.1 Transactions](https://docs.djangoproject.com/en/6.1/topics/db/transactions/))

### The second silent failure: outside a transaction it fires immediately

> If you call ``on_commit()`` while there isn't an open transaction, the callback will be executed
> immediately.
> ([Django 6.1 Transactions](https://docs.djangoproject.com/en/6.1/topics/db/transactions/))

That last sentence is the one that matters. `on_commit()` outside a transaction is not an error and
not a no-op — it fires *now*. So the guard that wins the code review is the one that removes the
protection exactly when the code is most fragile: an `ATOMIC_REQUESTS = True` project, or a path
where a `TestCase` wraps the call in an atomic block that production does not have, flips
`on_commit` from deferred to immediate with no other observable difference.

## Do

- Wrap the dispatch so it runs on commit and is discarded entirely on rollback:
  ```python
  class CheckoutView(View):
      def post(self, request):
          with transaction.atomic():
              order = Order.objects.create(...)
              transaction.on_commit(lambda: send_invoice_task.delay(order.id))
          return JsonResponse({"id": order.id})
  ```
- Note the lambda. `on_commit` takes a callable with **no arguments**:

  > Callbacks will not be passed any arguments, but you can bind them with functools.partial()
  > ([Django 6.1 Transactions](https://docs.djangoproject.com/en/6.1/topics/db/transactions/))

  So `send_invoice_task.delay` passed directly is a bound call, not a deferred one. Use
  `functools.partial` when the callback needs data.
- Move the dispatch outside the `atomic()` block entirely when it does not depend on the
  transaction — after the block returns is the simplest correct placement.
- Distinguish the two boundaries explicitly. `on_commit` is a *transaction* boundary. FastAPI's
  `BackgroundTasks` and a post-response worker hook are *response* boundaries, and a response is
  only sent after the transaction has already resolved. A task that must not run on a rollback
  needs `on_commit`; a task that must not delay the response needs the other one.
- In tests, assert the ordering rather than trusting a passing suite. `TestCase` wraps each test in
  an atomic block and rolls it back, which is a different world from production.

## Don't

- Dispatch inside `transaction.atomic()` and consider it fine because "the transaction hides it."
  It hides it from the writer's connection only.
- Expect a rollback to retract a dispatched task. Nothing retracts it.
- Add a queue library that reimplements commit-awareness. Django's `on_commit` is the complete
  answer; a second mechanism means a second default, which is the failure class this rule is about.
- Treat a broker visibility timeout as a fix. It is a probabilistic backstop that converts a
  correctness bug into a latency problem that only appears under load.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `DoesNotExist` in a task, only under load | Worker ran before the transaction committed | `transaction.on_commit(...)`, or move the dispatch out of the block |
| Task returns `None` and no-ops, only under load | `.filter().first()` swallowed the race the same way | Same — and treat a `None` result as a failure, not an empty case |
| Task runs against rows that were rolled back | Dispatch is not transaction-dependent; nothing retracts it | Same; audit every dispatch inside `atomic()` |
| Correct in dev, immediate-fire in production | A `TestCase` atomic block made `on_commit` defer, masking a call site that has no transaction | Assert the ordering in a `TransactionTestCase`, which does not wrap |

## Verifying

```bash
# Which side-effecting calls run inside a transaction? (manual read — the check is structural)
grep -rn "transaction.atomic\|ATOMIC_REQUESTS" --include=*.py .
grep -rn "\.delay(\|\.apply_async(\|send_mail\|cache.delete" --include=*.py . | grep -v on_commit

# Is the escape hatch set anywhere? A single occurrence makes every dispatch above unsafe.
grep -rn "DJANGO_ALLOW_ASYNC_UNSAFE\|CELERY_TASK_ALWAYS_EAGER" --include=*.py --include=*.env --include=*.yml .
```

The second command is a review queue, not a verdict: a dispatch outside any transaction is fine,
and the grep cannot tell you whether an enclosing `atomic()` exists at the call site. What it
cannot see at all is the `TestCase` wrapper, which is why the ordering assertion belongs in a
`TransactionTestCase`.
