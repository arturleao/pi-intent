---
iced: 0.1
id: 009-gate-policy-at-autonomy-2-or-3-code-chan
title: Trusted and autonomous units are not frozen before building
type: feature
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 1
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T10:46:48Z
approved_by: Artur Leao
contract_hash: 791d3520540fda3208721d033aa9da38fa63b36f35babbf3503982c68dcc4286
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
blocked_from: null
accepted_at: 2026-10-02T14:34:51Z
accepted_by: Artur Leao
---

# Trusted and autonomous units are not frozen before building

<!-- Request: Gate policy: at autonomy 2 or 3, code changes while the active unit is not building are allowed with a notification instead of blocked; owned files, protected keys and the frozen contract stay blocked at every autonomy level -->

## Intent

### Goal
At effective autonomy 2 or 3, an agent is never stopped by the "code only while building" rule: code and repository-state changes while the active unit is draft, approved, verifying, done or blocked go through with a visible notice, and the contract, protected fields and ICED-owned files remain the only hard stops.

### Constraints
- [C1] At effective autonomy 0 and 1 the freeze blocks exactly as today.
- [C2] ICED-owned files, protected frontmatter keys, the frozen contract and the verifier's read-only rule block at every autonomy level and in every gate mode except `off`.
- [C3] Review units stay read-only at every autonomy level.
- [C4] Independent verification still checks scope against `base_ref`; this unit does not weaken verification or acceptance.
- [C5] The notice is emitted once per tool call, in the UI when present, and otherwise does not block.

### Failure conditions
- [F1] An autonomy 2 or 3 unit's code change or mutating shell command is blocked solely because the unit is not building.
- [F2] An autonomy 0 or 1 unit's code change while not building is allowed by this change.
- [F3] Any autonomy level can edit a frozen contract, a protected key or an ICED-owned file through this change.

### Scope
- In: a new non-blocking decision kind from `gateDecision`, its handling in the extension, system-prompt and README/SPEC wording describing the policy, regression tests.
- Out: outside-root scoping (unit 008), unit-file edit rules (unit 010), config edits (unit 011), message wording (unit 012), changing default autonomy.

## Context
- [code] gate.mjs `code` and shell branches return `block` whenever `!building`, regardless of `autonomy`; `autonomy` is used only for the autonomy-0 `confirm` path.
- [code] extension `tool_call` handler maps `allow`/`confirm`/`block`; `warn` mode downgrades every block including owned files, which is why `warn` is too loose as a workaround.
- [code] `effectiveAutonomy` already caps by risk and `maxAutonomy`; high risk caps at 1, so high-risk units are unaffected by this unit.
- [code] Session logs of a downstream project running autonomy 3 show the freeze as the main reason agents stop mid-task.
- [product] README: "Agent owns the how"; sign-off and acceptance are the human's gates; done is decided by verification.
- [assumed] A `notify` decision `{ action: "notify", reason }` is the right shape: the extension shows `ICED: <reason>` as an info/warning notice and allows the call; in `warn` mode it behaves the same.
- [assumed] The notice text says which unit and status, and that verification will check scope.

## Expectations
- [E1] `gateDecision` returns a non-blocking notify decision for code edits and mutating shell commands when the active unit is not building and effective autonomy is 2 or 3; returns block at autonomy 0 or 1 as today. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] Owned files, protected keys, frozen contract and review units still return block at autonomy 2 and 3. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] The extension allows notify decisions and shows a notice when a UI exists; README and SPEC describe the policy per autonomy level. {verify: check | npm test}
- [E4] README and SPEC state the rule: autonomy 0-1 freeze code outside building, autonomy 2-3 notify; contract, protected fields and owned files always block. {verify: manual | docs review}

## Open questions
