---
title: "Gateways, Passport Strategies, and Cron Providers Must Stay Singleton"
rule_id: "RULE-NESTJS-004"
category: "correctness"
scope: "all"
applies_to: "WebSocket gateways, Passport strategies, and cron/scheduled providers"
last_updated: "2026-09-30"
source: "https://docs.nestjs.com/fundamentals/injection-scopes"
---

# Gateways, Passport Strategies, and Cron Providers Must Stay Singleton

Three component kinds are structurally incapable of being request-scoped. Marking one that way
is not a performance regression — it is a runtime failure.

## Why

The injection-scopes chapter states this in a `NOTICE`, which is the docs' marker for a
guarantee rather than a recommendation:

> WebSocket gateways should not use request-scoped providers, because they must act as
> singletons. Each gateway encapsulates a real socket and cannot be instantiated multiple times.
> The same limitation applies to some other providers, like Passport strategies or Cron
> controllers.

The reason is in the mechanism, not the caution. A gateway's identity *is* a live socket; a
strategy's and a cron provider's identity is the framework-level registration that happened once
at bootstrap. Per-request instantiation means a second instance of something the framework
registered once — a socket the client never connected to, a strategy the passport container does
not know about, a job whose schedule is already held by the original. The rebuild is not slower;
it produces objects that are structurally orphaned.

This is the sharpest contrast with the general scope rule. `Scope.REQUEST` elsewhere is a
measured cost the docs bound at ~5%. Here the docs say *"should not"*, with no latency budget,
because there is no correct version of the request-scoped gateway.

## Do

- Keep gateways, strategies, and cron providers on the default scope. To read request state in
  one, use an ALS store (`rules/nestjs/prefer-async-local-storage-over-request-scope.md`) —
  a gateway has a socket context that outlives any single request, and `REQUEST` is the wrong
  shape for it anyway.
- When a gateway needs per-message state, key it off the message/subscription, not off a
  request-scoped provider. Ws message contexts do not correspond to HTTP requests.
- Authenticate a `Scope.REQUEST` route with a strategy that stays singleton. The strategy is
  registered once; the route-scoped service is what changes.
- Grep for the combination rather than the flag alone — a request-scoped provider is only
  *this* rule's problem if it reaches one of these three:

```bash
grep -rln '@WebSocketGateway\|PassportStrategy(\|@Cron(' --include=*.ts src/
grep -rn 'Scope.REQUEST' --include=*.ts src/
```

If both return hits in the same file, that file is broken.

## Don't

- Make a gateway request-scoped "to get the socket." There is no per-request HTTP object for
  it, and the socket is per-connection, not per-request — the scope would be wrong even if it
  were allowed.
- Register a Passport strategy as request-scoped so it can close over the current user. The
  strategy runs during passport's own registration flow, before your provider exists per
  request.
- Put a cron controller's state behind a request-scoped provider on the assumption that the
  job's arguments make it a request. Cron providers are invoked by the scheduler, not by an
  inbound request; there is no `REQUEST` to bind.
- Assume a passing HTTP test suite rules this out. A gateway or strategy violation surfaces
  when a real socket connects or a real login runs, which unit tests with mocked providers do
  not do.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Client connects, handler never receives the message | Gateway re-instantiated; the live socket is bound to the old instance | Gateway back to singleton scope; move state to a subscription-keyed map |
| Auth passes in tests, fails on a real login | Strategy re-instantiated after passport registered the original | Strategy stays singleton; read the user from the validated request |
| Scheduled job runs once then stops | Cron provider re-instantiated off its registration | Cron provider stays singleton |
| No error, just a socket that closes immediately | Same as the gateway case, at the transport layer | Check scope before debugging the transport |

## Verifying

The check is structural, not behavioral — there is no linter for this. Both greps above must be
disjoint by file. If a provider declared `Scope.REQUEST` is reachable from a gateway, a
`PassportStrategy`, or a `@Cron()` handler, that is the finding.
