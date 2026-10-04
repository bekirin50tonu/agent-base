---
title: "BackgroundTasks Runs In-Process After the Response, and Its Failure Is Not the Client's"
rule_id: "RULE-FASTAPI-006"
category: "architecture"
scope: "backend"
applies_to: "Any FastAPI path operation passing BackgroundTasks; any sync work deferred this way; any BackgroundTask whose exception is expected to reach the caller"
last_updated: "2026-10-04"
source: "https://fastapi.tiangolo.com/tutorial/background-tasks/"
---

# BackgroundTasks Runs In-Process After the Response, and Its Failure Is Not the Client's

`BackgroundTasks` is a list of callables on the same application object, executed sequentially in
the same process after the response has been sent. It is not a queue, it has no worker, and it has
no retry. The client has already received a `200` by the time any of it runs.

## Why

> You can define background tasks to be run after returning a response.
> ([FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/))

> This is useful for operations that need to happen after a request, but that the client doesn't
> really have to be waiting for the operation to complete before receiving the response.
> ([FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/))

The docs are precise about the size of the class of work this is for, and the sentence is a size
limit, not a convenience:

> But if you need to access variables and objects from the same **FastAPI** app, or you need to
> perform small background tasks (like sending an email notification), you can simply just use
> `BackgroundTasks`.
> ([FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/))

and about what waits when it is not the right tool:

> If you need to perform heavy background computation and you don't necessarily need it to be run by
> the same process (for example, you don't need to share memory, variables, etc), you might benefit
> from using other bigger tools like [Celery](https://docs.celeryq.dev).
> ([FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/))

> They tend to require more complex configurations, a message/job queue manager, like RabbitMQ or
> Redis, but they allow you to run background tasks in multiple processes, and especially, in
> multiple servers.
> ([FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/))

The tradeoff the docs are drawing is **same process** against **multiple processes**. Three
consequences follow, and none of them raise:

1. **The response is already sent.** Every status code, header, and body the client sees was decided
   before the task ran. A task that fails returns a perfectly good `201` to the client and a
   traceback to the log. The two are not connected, and nothing in the API surface says so.
2. **The work is sequential and unbounded in duration.** A `BackgroundTasks` that takes four
   minutes holds the worker for four minutes. Under `RULE-FASTAPI-001`'s threadpool accounting it
   consumes a token, and with an `async def` task it holds the event loop. `uvicorn --workers 4`
   runs one such task at a time per process.
3. **A restart drops it.** There is no persistence, so a deploy between the response and the task
   loses the work silently. `acks_late` semantics — the ones that make a queue *not* lose work —
   are precisely what a bare list does not have.

The second-order trap is that the docs name Celery as the alternative, and Celery's own default is
a silent failure in the same direction: `task_acks_late=False` means a worker that dies mid-task
**acknowledges** it, and the message is gone. Moving from `BackgroundTasks` to Celery without
changing that default does not fix the durability gap — it moves it and renames it. See
`shared/python/task-queue-choice.md`.

## Do

- Keep the task to what it names: a notification, a cache write, a short outbound call. It should
  finish in well under a second and never block on a database transaction you still need:
  ```python
  from fastapi import BackgroundTasks

  @app.post("/orders", status_code=201)
  def create_order(payload: CreateOrder, tasks: BackgroundTasks):
      order = OrderService.create(payload)
      tasks.add_task(notify_recipient, order.id)   # fire and forget, documented as such
      return order
  ```
- Use a `with`-statement task when it needs a resource, so the resource is released even if the
  body raises:
  ```python
  def write_audit_row(payload: dict) -> None:
      with SessionLocal() as session:          # closed on the exception path too
          session.add(AuditRow(**payload))
          session.commit()
  ```
- Make the task's own failure visible, since the response cannot report it. A log line with the
  task name, and a metric — the log is what an operator reads at 3am; the metric is what a
  dashboard catches before that.
- Move the work to a real queue once any of these is true: it needs to survive a restart, it needs
  to run on more than one server, it can exceed a second, or a human must be able to see and
  retry it.
- Pass the identifiers, not the objects. An in-memory ORM instance is valid in-process and
  meaningless to another process:
  ```python
  # Correct — a queue task takes ids
  @shared_task
  def send_order_email(order_id: int) -> None: ...
  ```

## Don't

- Add a 30-second report generation to `BackgroundTasks` and treat the `200` as acknowledgement. The
  client has its answer; the work is a race against the next deploy.
- Assume a `BackgroundTasks` exception surfaces anywhere the client can see. It cannot — the
  response left. Errors become log lines that nobody reads, which is how a nightly job silently
  stops running.
- Use it to escape a slow request without measuring anything. The slow part is on the same worker;
  deferring it does not make the system faster, it defers the cost to a moment with less
  visibility.
- Chain tasks to fake a pipeline. They run in order in one process, so a failure at step three
  loses steps one and two, and the client is gone.
- Reach for Celery and assume the durability gap closed. Check `task_acks_late`, `task_reject_on_worker_lost`,
  and the broker's own persistence settings before calling the move a fix.
- Use `BackgroundTasks` to escape a `SynchronousOnlyOperation` or a `MissingGreenlet`. It runs in
  the same event loop context; `RULE-DJANGO-007` applies inside it exactly as it did before.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Client got `201`, the work never happened | Task raised after the response was sent | Log and metric the task; move to a queue |
| Latency spikes with no slow endpoint | Long task holding a threadpool token or the event loop | Move the work to a queue |
| Work lost across a deploy | `BackgroundTasks` holds no persistence | Use a broker-backed queue |
| `AttributeError` on an ORM object inside a worker | In-memory instance passed across a process boundary | Pass identifiers |
| Steps one and two gone, three never ran | Sequential in-process list, no per-step durability | One idempotent task, retried as a whole |
| `CELERY_RESULT_BACKEND` is set but messages vanish | `task_acks_late=False` acknowledged on worker loss | Set `task_acks_late=True` and make the task idempotent |
| An async ORM call inside the task raises | Same async context, still | `sync_to_async`, or keep it in the request |

## Verifying

```bash
# Every use of the mechanism — the list is short enough to read in full
grep -rn "BackgroundTasks\|add_task" --include=*.py .

# What is actually deferred, so the durations are comparable against a threadpool token
grep -rn -A4 "add_task(" --include=*.py .

# The tasks themselves
grep -rn -A15 "^\(async \)\?def .*(" --include=tasks.py --include=background*.py .

# Celery configured without the durability flags
grep -rn "acks_late\|reject_on_worker_lost\|task_acks" --include=*.py --include=*.pyi .
grep -rn "^CELERY_\|task_acks_late" --include=*.py --include=*.toml --include=*.cfg .
```

The first command is the audit: every hit is work that runs after the client is gone and cannot
report back. The fourth matters if the answer to the first is "move it to a queue" — a queue
configured with the default `acks_late` has replaced a lost-on-restart list with a
lost-on-worker-death list, and the second grep tells you which one you have. Nothing here can tell
you how long any task actually takes.
