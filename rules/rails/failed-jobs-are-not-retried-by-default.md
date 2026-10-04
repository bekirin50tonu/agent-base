---
title: "Failed jobs are not retried by default"
rule_id: "RULE-RAILS-006"
category: "correctness"
scope: "backend"
applies_to: "ActiveJob, retry_on, discard_on, perform_later, deliver_later, queue, solid_queue, sidekiq, default queue"
last_updated: "2026-10-04"
source: "https://guides.rubyonrails.org/active_job_basics.html"
---

# Failed jobs are not retried by default

The default Active Job behaviour on an unrescued exception is: do not retry, mark as failed. An
application that assumes a queue gives at-least-once delivery has assumed a behaviour Rails does
not ship.

This is the messaging counterpart of `RULE-RAILS-002` — the guarantee lives in the author's model
of the queue, not in the framework. The queue name default makes it worse: unassigned jobs share
the `default` queue, so a burst of unrelated work competes with the job whose delivery was
assumed.

## Why

Every queue is documented as at-least-once, and that is true of the *transport*. It is not true
of Active Job's failure handling. A job that raises is done, and "done" is the only outcome the
framework will produce on its own.

> A failed job will not be retried, unless configured otherwise.
> ([Active Job Basics](https://guides.rubyonrails.org/active_job_basics.html))

> Failed jobs that aren't configured with retry_on will go straight to failed executions without
> retrying.
> ([Active Job Basics](https://guides.rubyonrails.org/active_job_basics.html))

Two sentences, one behaviour, and it is the opposite of what "a queue" implies. The work is not
lost in the sense of a crash — it lands in a failed-executions table that nothing reads by default.
The user's email is not sent, the payment is not captured, and the row that was supposed to be
updated keeps its old value, silently.

Nothing about a delivery API hints at this. `deliver_later` in particular reads as "it will go
out", and it does go out — the question is only what happens if it fails:

> Under the hood, deliver_later works by enqueuing an ActionMailer::MailDeliveryJob — a built-in
> Active Job job that Rails provides — which goes through the same queuing pipeline as any job you
> define yourself, and will eventually call the perform method in your Job class.
> ([Active Job Basics](https://guides.rubyonrails.org/active_job_basics.html))

That "same queuing pipeline" is exactly where the no-retry default applies — mail delivery inherits
the guarantee of the job framework, including its lack of one.

The queue name compounds it. Everything unassigned lands in one queue:

> Can be used to change the default queue name. By default this is "default".
> ([Configuring Rails Applications](https://guides.rubyonrails.org/configuring.html))

A slow, retry-happy job on `default` delays the critical one beside it, and neither is visible in
the code that enqueued them.

## Do

State the retry policy in the job, where it is reviewable and where the failure semantics live:

```ruby
class CapturePaymentJob < ApplicationJob
  queue_as :payments

  retry_on Stripe::RateLimitError, wait: :exponentially_longer, attempts: 5
  retry_on Stripe::APIConnectionError, wait: 5.seconds, attempts: 3

  # Terminal for the business: retrying a declined card cannot succeed.
  discard_on ActiveRecord::RecordNotFound

  def perform(payment_id)
    Payment.find(payment_id).capture!
  end
end
```

Separate transient failures from terminal ones explicitly. `retry_on` for the first,
`discard_on` for the second, and neither for the third — a validation error retried five times
just delays the same failure.

Give every job its own queue for anything latency-sensitive, and let operators prioritise:

```ruby
class ReconcileJob < ApplicationJob
  queue_as :low_priority
end
```

Instrument the failure path, since nothing else will report it:

```ruby
retry_on StandardError, attempts: 3 do |job, error|
  Sentry.capture_exception(error, extra: { job: job.class.name })
  raise error   # re-raise so the job still lands in failed executions
end
```

Set a default retry policy in the application job if most jobs need one, and let individual jobs
opt out — this is a deliberate choice, not an accident of defaults:

```ruby
class ApplicationJob < ActiveJob::Base
  retry_on ActiveRecord::Deadlocked, attempts: 3
  rescue_from ActiveJob::DeserializationError, with: :log_orphaned_job
end
```

## Don't

Don't assume enqueuing means delivery:

```ruby
# Incorrect — if perform raises, this is never retried and nothing reports it
OrderMailer.welcome(order).deliver_later
```

Don't retry a failure that cannot become a success. A `retry_on StandardError, attempts: 10` on a
job that validates will run ten times, log ten identical entries, and still fail.

Don't put every job on the default queue and treat throughput as a scaling concern. The competition
is between unrelated work, not between replicas.

Don't treat the failed-executions table as a monitoring strategy. It is a place failures go, not a
place anyone looks, and it has a retention policy that discards old rows.

Don't build a retry loop inside `perform` as a substitute for `retry_on`. The framework's policy
is inspectable in the class; a hand-rolled loop with its own sleep, its own counter, and its own
backoff is none of those things and will not interact with the queue's concurrency limits.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Email never arrives, no error anywhere | Job failed; no `retry_on` | Add `retry_on` and alert on failed executions |
| Occasional missing rows under load | Transient deadlock/timeout, job discarded | `retry_on ActiveRecord::Deadlocked` |
| The same failure logged many times | Blanket retry on a terminal error | `discard_on` for the permanent cases |
| A low-priority job delays a critical one | Everything on `default` | `queue_as` per job class |
| `DeserializationError` for a deleted record | GlobalID raised on load | `rescue_from ActiveRecord::RecordNotFound` |
| Queue is idle, work is "lost" | Jobs in failed executions, not pending | Read failed executions; nothing polls it |
| Retries never appear | Retries are enqueued but the adapter is not running | Check the queue backend's process |

## Verifying

Find every job with no stated failure policy, and every job sharing the default queue:

```bash
grep -rn 'class .*Job\b' app/jobs/ --include='*.rb' -A6 \
  | grep -E 'class |retry_on|discard_on|rescue_from|queue_as'
```

Jobs that appear with only a `class` line and no policy line are the ones relying on the default:

```bash
grep -rln 'class .*Job\b' app/jobs/ --include='*.rb' | xargs grep -Ln 'retry_on\|discard_on\|rescue_from'
```

Then confirm the failures are somewhere visible:

```bash
# depends on the adapter; Solid Queue keeps them in the database
bin/rails runner 'puts ActiveRecord::Base.connection.tables.grep(/failed/)'
```

The check that actually catches this is a test that raises and asserts the retry was scheduled,
because "it did not retry" is indistinguishable from "it did and the second attempt succeeded":

```ruby
test "a transient failure is retried" do
  assert_enqueued_with(job: CapturePaymentJob) do
    job = CapturePaymentJob.new(1)
    job.stub(:perform, -> { raise Stripe::RateLimitError }) { job.perform_now }
  end
end
```

What this check cannot see: it cannot tell you whether the retry policy is *right* — five
attempts with exponential backoff on a job that will always fail just costs you the backoff. Nor
can it see whether the queue backend is actually running, which is the failure that looks exactly
like "no retries configured". Check the worker process separately, and treat a queue whose
enqueued jobs are not decreasing as its own investigation.