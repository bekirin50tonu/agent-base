---
title: "Choosing a Task Queue by Its Delivery Guarantee, and Reading the Default You Did Not Choose"
category: "architecture"
applies_to: "Any Python service moving work out of the request path; Celery, Dramatiq, arq, taskiq, RQ, Huey or Django-Q; any service claiming at-least-once delivery"
last_updated: "2026-10-04"
source: "https://raw.githubusercontent.com/celery/celery/main/celery/app/defaults.py,https://raw.githubusercontent.com/celery/celery/main/docs/userguide/configuration.rst,https://raw.githubusercontent.com/celery/celery/main/docs/faq.rst,https://raw.githubusercontent.com/Bogdanp/dramatiq/master/dramatiq/middleware/retries.py,https://raw.githubusercontent.com/python-arq/arq/master/arq/worker.py,https://raw.githubusercontent.com/python-arq/arq/master/arq/constants.py,https://raw.githubusercontent.com/rq/rq/master/rq/defaults.py,https://raw.githubusercontent.com/rq/rq/master/rq/worker/worker_classes.py,https://fastapi.tiangolo.com/tutorial/background-tasks/"
---

# Choosing a Task Queue by Its Delivery Guarantee, and Reading the Default You Did Not Choose

Every Python task queue will happily run your job after the response. That is not the decision.
The decision is **what happens when the worker dies mid-job**, and each queue answers it with a
default you did not choose. Then the second-order trap: the option you enable to fix the guarantee
usually introduces the duplication that guarantee implies, and that is the part nobody reads.

## When to Use

- Moving work out of a request path — email, PDF rendering, third-party calls, image processing.
- A job must survive a deploy, a crash, or a broker restart, and you cannot say what happens today.
- Choosing between Celery, Dramatiq, arq, taskiq, RQ, or Huey, or deciding whether you need a queue
  at all.
- A bug report of "the same email arrived twice" or "the job disappeared and nobody knows".
- Any claim of "at-least-once delivery" in a design document — verify it against the defaults.

## The axis: what does the broker do when a worker dies

| Queue | Default on worker death | Retry is | Duplicate possible | Notes |
|---|---|---|---|---|
| **Celery** | message acked **before** execution → **lost** | yours (`Task.retry`), opt-in | only with `acks_late` | the default loses work |
| **Dramatiq** | message redelivered; retried by middleware | automatic, with backoff | yes, by design | retries are the default |
| **arq** | job key **deleted** on failure → **lost** | opt-in (`retry=True`) | no | explicit, one line |
| **RQ** | work-horse monitored; job moves to Failed registry | `Retry(max=...)`, opt-in | no, unless you retry | needs `job.timeout` |
| **Huey** | at-least-once by default | automatic | yes | results in Redis |
| **Django-Q** | at-least-once, `sync` is synchronous | automatic | yes | ORM-backed, clusters |

The first column is the only one that matters for a first decision. Celery and arq default to
**at-most-once** — the work vanishes — while Dramatiq, Huey and Django-Q default to
**at-least-once** — the work may run twice. Those are opposite failure modes and neither is free:
at-most-once loses work silently, at-least-once duplicates it silently.

## Celery: the default loses the task

Celery's shipped default is the reason this file exists:

```python
        acks_late=Option(False, type='bool'),
```
([Celery `defaults.py`](https://raw.githubusercontent.com/celery/celery/main/celery/app/defaults.py))

and the documentation states the consequence of the default in the same words twice:

> Default: Disabled.
>
> Late ack means the task messages will be acknowledged **after** the task has been executed, not
> *right before* (the default behavior).
> ([Celery `configuration.rst`](https://raw.githubusercontent.com/celery/celery/main/docs/userguide/configuration.rst))

Acknowledged *before* execution means a worker killed mid-task has already told the broker the job
is done. The job is gone. No error, no failed-queue entry, no log line in your application — just a
task that never ran, discovered days later by a customer.

The FAQ is more precise than the setting reference, and it separates two things people conflate:

> `Task.retry` is used to retry tasks, notably for expected errors that is catch-able with the
> :keyword:`try` block. The AMQP transaction isn't used for these errors: **if the task raises an
> exception it's still acknowledged!**
>
> The `acks_late` setting controls when the message is acknowledged; it does not call `Task.retry`
> and is not an automatic retry policy. A task exception still results in an acknowledgment, and
> the worker also acknowledges the message when the child process is terminated by `sys.exit()` or
> a signal. Redelivery can instead occur when the worker loses the message before acknowledging it,
> for example after a worker or broker-connection failure. The exact behavior depends on the worker
> pool and message transport.
> ([Celery `faq.rst`](https://raw.githubusercontent.com/celery/celery/main/docs/faq.rst))

Read that twice. **`acks_late` is not `retry`.** Setting it does not make a failing task run again;
it only changes *when the broker stops owning the message*. A task that raises is still
acknowledged, redelivery only happens if the worker dies first, and the exact behaviour varies by
pool and transport. So a service that sets `acks_late=True` believing it now has retries has neither
retries nor durability — it has a different failure mode.

The FAQ also gives the reason Celery is not wrong here:

> If this crashed in the middle of copying the file to its destination the world would contain
> incomplete state. ... So for ease of programming we have less reliability; It's a good default,
> users who require it and know what they are doing can still enable acks_late
> ([Celery `faq.rst`](https://raw.githubusercontent.com/celery/celery/main/docs/faq.rst))

Because at-least-once means *at least* once, not exactly once. Celery trades a lost job for a
possible duplicate one, and documents the trade rather than hiding it.

### The other Celery defaults that change the picture

```python
        prefetch_multiplier=Option(4, type='int'),
```
([Celery `defaults.py`](https://raw.githubusercontent.com/celery/celery/main/celery/app/defaults.py))

Each worker holds up to 4 messages in memory before executing any. With one slow task at the head of
a queue and 8 workers, 36 messages sit in RAM — fetched, unexecuted, invisible. Raise it for
throughput, lower it to one (`--prefetch-multiplier=1`) for fair dispatch of long jobs.

```python
        reject_on_worker_lost=Option(type='bool'),
```
([Celery `defaults.py`](https://raw.githubusercontent.com/celery/celery/main/celery/app/defaults.py))

Unset, so `False`: when a worker process is killed, the message is **not** rejected for redelivery.
Even with `acks_late=True`, an `SIGKILL`ed worker loses its message unless you also set this — the
two settings are independent and only together do they give redelivery on worker loss.

```python
        always_eager=Option(False, type='bool'),
```
([Celery `defaults.py`](https://raw.githubusercontent.com/celery/celery/main/celery/app/defaults.py))

False in production, which is right. But set `task_always_eager=True` in tests and you are no longer
testing the queue: tasks run inline, no serialization, no broker, and a bug that only appears when
arguments fail to serialize will pass every test.

## Dramatiq: retries are the default, so duplicates are too

```python
class Retries(Middleware):
    """Middleware that automatically retries failed tasks with
    exponential backoff.

    Disabling this middleware will cause messages that fail due to
    exceptions to be marked 'done' rather than 'failed'.  If you don't
    want actors to retry automatically, it's better to set their
    ``max_retries`` options to ``0`` than to remove this middleware.
```
([Dramatiq `retries.py`](https://raw.githubusercontent.com/Bogdanp/dramatiq/master/dramatiq/middleware/retries.py))

Retries on by default, so a task that raises twice runs twice — and if it half-wrote before raising,
it half-wrote twice. Setting `max_retries=0` is the correct way to opt out; removing the middleware
turns failures into `'done'`, which is the opposite of what it looks like.

## arq: explicit, and deletion is the default

arq removes the job key on failure, so a failed job is gone unless you asked otherwise:

```python
    async def finish_failed_job(self, job_id: str, result_data: Optional[bytes]) -> None:
        async with self.pool.pipeline(transaction=True) as tr:
            tr.delete(
                retry_key_prefix + job_id,
                in_progress_key_prefix + job_id,
                job_key_prefix + job_id,
            )
```
([arq `worker.py`](https://raw.githubusercontent.com/python-arq/arq/master/arq/worker.py))

Three keys deleted, including the queue entry. Retry is a parameter you pass per job, and cron jobs
get a longer in-progress window because they have a fixed intended execution time:

> # how long to keep the "in_progress" key after a cron job ends to prevent the job duplication
> # this can be a long time since each cron job has an ID that is unique for the intended execution time
> keep_cronjob_progress = 60
> ([arq `constants.py`](https://raw.githubusercontent.com/python-arq/arq/master/arq/constants.py))

The trade is legible: at-most-once by default, and the one place duplication is genuinely possible
is cron, where the library admits it and widens the window to compensate.

## RQ: the work-horse is monitored, so `timeout` is what makes it useful

RQ forks each job and watches it, and the monitor is the part to understand:

```python
                # Kill the job from this side if something is really wrong (interpreter lock/etc).
                if job.timeout != -1 and working_time > (job.timeout + 60):  # type: ignore
                    self.heartbeat(self.job_monitoring_interval + 60)
                    self.kill_horse()
```
([RQ `worker_classes.py`](https://raw.githubusercontent.com/rq/rq/master/rq/worker/worker_classes.py))

A stuck job is only killed if `job.timeout` is set, and the default window is wide:

```python
DEFAULT_WORKER_TTL = 420
""" The default Time To Live (TTL) for the Worker in seconds
Defines the effective timeout period for a worker
"""


DEFAULT_JOB_MONITORING_INTERVAL = 30
""" The interval in seconds for Job monitoring
"""
```
([RQ `defaults.py`](https://raw.githubusercontent.com/rq/rq/master/rq/defaults.py))

Seven minutes is a long time for a hung job to hold a slot, and the monitor only checks every 30
seconds. Set `job_timeout` per job. Note also that `DEFAULT_FAILURE_TTL` is a year — failed jobs
accumulate in Redis by default.

## The other queues, briefly

**Huey** defaults to at-least-once with immediate retries and a scheduled-task mode, and keeps
results in Redis. The one to check: its default `results` setting means the return value of every
job is persisted whether you need it or not.

**taskiq** is a FastAPI-first library with broker-agnostic (AMQP, Redis, NATS, in-memory) task
objects and separate result backends. Worth it when the framework binding and the typing are the
deciding factors; the delivery guarantee then comes from the broker and middleware you pick, so the
same analysis applies one level down.

**Django-Q** stores its queue in the database rather than a broker, which is why its clusters and
scheduler are one process — no extra infrastructure to run, and the queue survives a broker outage
because there is no broker. Its `sync` mode is not async at all, which is the default worth
checking. Django-Q2 is the maintained fork; the original is archived.

**In-process.** FastAPI's `BackgroundTasks` runs the function in the same process after the
response:

> You can define background tasks to be run after returning a response.
> ([FastAPI `background-tasks.md`](https://fastapi.tiangolo.com/tutorial/background-tasks/))

See `rules/fastapi/background-tasks-run-in-process-after-the-response.md` — a deploy kills every
in-flight background task, and the size limit means it is not a queue at all.

## The rule that generalises

Ask two questions, in this order, before choosing a package:

1. **What is the guarantee when a worker dies?** At-most-once (work is lost) or at-least-once (work
   may repeat). Both defaults exist in production libraries and both are silent.
2. **Is the task idempotent?** If it is not, at-least-once is a bug factory and you need either
   `acks_late=False` plus retry, or a deduplication key at the destination. There is no third
   option, and this is Celery's stated reason for its default.

Only then compare features. Routing, rate limits, schedules and result backends are all negotiable
against a guarantee you have decided on.

## What to check in an existing service

```bash
# Celery config, the four settings that change delivery
grep -rn "acks_late\|reject_on_worker_lost\|prefetch_multiplier\|always_eager" --include=*.py .

# Which queue is actually in use
grep -rn "celery\|dramatiq\|from arq\|import arq\|rq\b\|huey\|django_q\|taskiq" --include=*.py --include=*.toml --include=*.txt .

# Retry that is not bounded — the duplicate generator
grep -rn "retry\|max_retries\|autoretry\|max_attempts" --include=*.py .

# The trap: eager mode makes tests pass and never exercises serialization
grep -rn "always_eager\|CELERY_TASK_ALWAYS_EAGER\|task_always_eager" --include=*.py --include=*.env* --include=*.yml .

# Non-idempotent writes, which decide whether at-least-once is safe here
grep -rn "increment\|charge\|create_order\|send_email\|\.save()" --include=*.py tasks.py jobs.py workers.py 2>/dev/null
```

The last command is the one that answers the real question: at-least-once is a decision about your
task bodies, not about your broker.

## Caveats

- **Guarantees are stated by the broker and pool, not only by the client.** The Celery FAQ says so
  explicitly — "The exact behavior depends on the worker pool and message transport" — so a
  guarantee you read off a library's docs is a statement about a default configuration, not a
  property of the library.
- **This asset does not cover:** Celery canvas (`chord`, `group`, `chain`) and its result backends,
  RabbitMQ vs Redis broker selection and quorum queues, Redis Streams and SQS as brokers,
  `taskiq`'s and Huey's scheduling syntax, Kubernetes-native queueing (KEDA, `Kombu`), task
  idempotency patterns and outbox tables, observability (`flower`, `rq info`, Prometheus metrics),
  and priority or rate-limit semantics — all of which matter after the guarantee is settled, and
  none of which change which column of the first table you are in.