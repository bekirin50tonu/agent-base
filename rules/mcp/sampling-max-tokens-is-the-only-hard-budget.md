---
title: "maxTokens Is the Only Sampling Parameter the Client Must Honour"
rule_id: "RULE-MCP-006"
category: "correctness"
scope: "all"
applies_to: "MCP servers issuing sampling/createMessage, client implementations of sampling, tool-use loops inside sampling, message-array construction"
last_updated: "2026-10-04"
source: "https://modelcontextprotocol.io/specification/2026-07-28/client/sampling"
---

# maxTokens Is the Only Sampling Parameter the Client Must Honour

Sampling lets a server ask the client's model to generate. Four tuning parameters are defined, and
the specification draws a hard line between one that binds and three that do not. A server that
sets only the other three has expressed a preference, not a limit.

## Why

> The client MUST respect the maxTokens parameter.
> The client MAY modify or ignore temperature, stopSequences and metadata. For
> example, a client could use a model that does not support one or more of these parameters,
> and would therefore be unable to leverage them.
> ([Sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling))

`maxTokens` is the only MUST in the set, and it is the only one that bounds spend. Everything else
is advisory by explicit permission — so a client that honours `temperature` while ignoring
`maxTokens` is not merely unusual, it is the shape the specification describes.

The reporting side closes the loop: `stopReason: "maxTokens"` is how a client says it truncated.
A server that never receives that reason has no evidence its limit was applied, and there is no
field that would tell it otherwise. The guarantee exists only if the server sets the parameter.

The tool-result structure carries two MUSTs that are validation rules rather than preferences:

> When a user message contains tool results (type: "tool_result"), it MUST contain ONLY tool results. Mixing tool results with other content types (text, image, audio) in the same message is not allowed.
> ([Sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling))

> When using tool use in sampling, every assistant message containing ToolUseContent blocks MUST be followed by a user message that consists entirely of ToolResultContent blocks, with each tool use (e.g. with id: $id) matched by a corresponding tool result (with toolUseId: $id), before any other message.
> ([Sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling))

The specification gives the reason for the first: compatibility with provider APIs that use
dedicated roles for tool results. That is why the failure is nasty — a mixed content array passes
local validation, fails at the model provider with an opaque `400`, and surfaces nowhere near the
code that built it.

Iteration limits are deliberately weaker:

> Both parties SHOULD implement iteration limits for tool loops
> ([Sampling](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling))

SHOULD, because legitimate multi-step work exists. The consequence is that a tool loop's bound is
a **local policy with no protocol signal** — nothing in the conversation records that a limit was
approached, so it must be enforced where the loop runs.

## Do

- Set `maxTokens` on every sampling request. It is required, and it is the only lever that
  constrains cost and latency.
- Treat the other three as hints. A client ignoring them is conformant, so do not build behaviour
  that depends on them.
- Validate outgoing message arrays before they leave the server: a user message containing tool
  results contains *only* tool results, and every `ToolUseContent` id has a matching
  `ToolResultContent` before any other message follows.
- Enforce a maximum iteration count in your own tool loop, with an explicit terminal result, and
  report the truncation rather than stopping mid-sequence.
- Record `stopReason` per sampling result. `maxTokens` is the only evidence your limit bound
  anything.
- Cap `maxTokens` relative to what the operation can actually consume, and size it per operation —
  a summarisation call and a code-generation call do not share a budget.

## Don't

- Don't rely on `temperature`, `stopSequences`, or `metadata` as limits. The client may ignore all
  three, by permission.
- Don't treat a missing `maxTokens` as "unlimited but fine". It is unlimited.
- Don't build a mixed-content user message ("Here are the results:" plus tool results). It is
  invalid, and it fails at the provider rather than at your validation.
- Don't continue a tool loop past its iteration bound because the model asked for another tool.
  Nothing in the protocol stops it; only your counter does.
- Don't assume `stopReason` is one of the defined values — the spec says implementations MAY
  provide their own — so handle unknown reasons without erroring.
- Don't pass through a `toolUseId` that no outstanding tool use matches. The balance rule requires
  the match, and an unmatched result is a provider error.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Sampling cost far above plan | `maxTokens` unset or ignored | Set it on every request |
| Truncation nobody noticed | `stopReason` not inspected | Record and check it |
| Opaque 400 from the model provider | Mixed content in a tool-result message | Tool results only |
| Tool loop runs until the provider cuts it off | No iteration bound | Local maximum with a terminal result |
| Client behaves differently per vendor | Relied on `temperature`/`stopSequences` | Only `maxTokens` is binding |
| Unmatched `toolUseId` rejected | Result without a pending tool use | Maintain outstanding-use ids |

## Verifying

```bash
# 1. Every sampling request sets maxTokens. A call without it is unbounded.
grep -rniE 'sampling|createMessage|maxTokens' \
  --include=*.ts --include=*.js --include=*.py --include=*.go . | head -20

# 2. Any code building a user message with tool results should assert the
#    array is homogeneous. Mixed arrays fail at the provider, not locally.

# 3. Where is the tool loop? Is there a counter, and a defined result when
#    it trips? A `while (true)` around tool use is the finding.
```

What this check cannot see: whether the client's model actually honours `maxTokens` is outside the
repository, and the spec's permission to ignore the other parameters means a client may be
conformant and unhelpful at the same time. The check that settles the first is a cost measurement
against a deliberately low `maxTokens` — if a request billed as bounded produces an unbounded
response, the client is not conforming, and only that observation distinguishes it from a bug in
your budget.
