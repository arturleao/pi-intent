---
iced: 0.1
id: 012-gate-messages-every-block-reason-names-t
title: Every gate block tells the agent its next step
type: feature
tier: S
parent: null
status: accepted
autonomy: 1
risk: low
attempts: 2
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T10:47:36Z
approved_by: Artur Leao
contract_hash: 58a594b3dd62a281687a0e38d1407c05ba2d07bae024a29d3f97150f12c95344
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
accepted_at: 2026-10-02T14:34:59Z
accepted_by: Artur Leao
---

# Every gate block tells the agent its next step

<!-- Request: Gate messages: every block reason names the exact next step for the agent (iced_escalate, iced_decision, decisions.md, iced_submit, or which human command to ask for) so a blocked agent recovers instead of stopping -->

## Intent

### Goal
When the gate blocks a tool call, the reason always names one concrete next action the agent can take now (a tool to call, a file it may write instead, or the exact human command to ask for), so the agent continues instead of stopping.

### Constraints
- [C1] Every `block` reason returned by `gateDecision` and `verifierToolDecision` ends with a next-step sentence naming at least one of: an `iced_*` tool, `intent/<id>/decisions.md`, a `/iced ...` human command, or "read-only commands".
- [C2] Reasons stay under about 300 characters and contain no absolute local paths.
- [C3] Decisions (allow/block/confirm/notify) are unchanged; only reason text changes.

### Failure conditions
- [F1] A block reason exists that names no next step.
- [F2] A reason tells the agent to do something the gate would block (for example edit a frozen contract or an owned file).

### Scope
- In: reason strings in gate.mjs and the extension's gate wrapper, a test that walks every block path, README wording of the gate.
- Out: changing decisions, the agent's build/submit instructions, the system-prompt sections.

## Context
- [code] Current reasons: owned files point to `iced_submit / iced_decision / /iced commands`; frozen contract points to `iced_escalate change-expectation`; not-building code block has a status-specific hint but the `blocked` hint only says "waiting for the human" (no command); the shell not-building block says "Read-only commands are fine" but not what to do with the pending change; verifier block names the allowed tools.
- [code] The extension prefixes `ICED gate: ` and in `warn` mode `ICED (warn): `.
- [code] Session logs of a downstream project show agents ending their turn after a block in most cases rather than choosing an alternative.
- [assumed] Recommended next steps per block: owned files -> `iced_submit`/`iced_decision`, or `decisions.md` for notes; frozen contract -> `iced_escalate` `change-expectation`, or `decisions.md`; not building (draft) -> finish draft, `iced_request_signoff`; (approved) -> `iced_build` or ask for `/iced build <id>`; (verifying/done) -> wait or ask for `/iced accept <id>`; (blocked) -> ask the human for `/iced build <id>` to retry or `/iced reject <id>`; review unit -> write `intent/<id>/review.md`; no active unit (always) -> `iced_start`; autonomy 0 declined -> record in `decisions.md` and ask the human.

## Expectations
- [E1] A test enumerates every block path of `gateDecision` and `verifierToolDecision` and asserts each reason matches the next-step pattern (names an `iced_*` tool, `decisions.md`, a `/iced` command, `review.md` or "read-only"). {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] The `blocked`, `verifying`, `done` and shell not-building reasons name the human command or tool to use. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] Full suite passes; README gate section lists the next step for each block. {verify: check | npm test}

## Open questions
