---
iced: 0.1
id: 011-gate-config-allow-agents-to-edit-iced-co
title: Agents can tune the ICED config except its integrity keys
type: feature
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 2
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T10:47:30Z
approved_by: Artur Leao
contract_hash: 98f9ceb882371a591909839f24f3fc43379362b1a444bf8d6129a8844e13111b
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
accepted_at: 2026-10-02T14:34:56Z
accepted_by: Artur Leao
---

# Agents can tune the ICED config except its integrity keys

<!-- Request: Gate config: allow agents to edit .iced/config.json except the integrity keys gate, autonomy, maxAutonomy, autonomyByRisk, verify.model and verify.independent, which stay blocked -->

## Intent

### Goal
An agent can change operational settings in the ICED config (verify commands, timeouts, attempts, memory paths, test-writer options) when asked, while the settings that decide how much the agent is trusted and who verifies it remain human-only.

### Constraints
- [C1] Integrity keys stay blocked for agents at every autonomy and gate mode except `off`: `gate`, `autonomy`, `maxAutonomy`, `autonomyByRisk`, `verify.model`, `verify.independent`, `verify.lenses`, `verify.maxAttempts`, `build.testWriterModel`.
- [C2] A config edit is allowed only when the predicted file parses as JSON and every integrity key has the same value as before (deep equality); unpredictable edits or invalid JSON are blocked.
- [C3] `.iced/active` and `.iced/metrics.jsonl` stay ICED-owned and blocked.
- [C4] Shell commands that write to `.iced/config.json` stay blocked (shell content cannot be predicted); the write/edit tools are the only agent path.

### Failure conditions
- [F1] An agent write/edit that changes only non-integrity keys of `.iced/config.json` is blocked.
- [F2] An agent write/edit that changes an integrity key, removes it, or makes the file invalid JSON is allowed.
- [F3] `.iced/active` or `.iced/metrics.jsonl` become editable by agents.

### Scope
- In: config classification and prediction in guard/gate, the integrity-key list exported from core or guard, regression tests, README/SPEC wording.
- Out: validating other config values, new config keys, `/iced models` command behaviour.

## Context
- [code] `classifyPath` returns `owned` for `.iced/config.json`, `.iced/active`, `.iced/metrics.jsonl`; the gate blocks all `owned` writes with one message.
- [code] `loadConfig` in core merges defaults and the file; `effectiveAutonomy` reads `autonomy`, `maxAutonomy`, `autonomyByRisk`; verification reads `verify.model`, `verify.independent`, `verify.lenses`, `verify.maxAttempts`; the test writer reads `build.testWriterModel`.
- [code] Session logs of a downstream project show agents blocked when the human asked them to change `verify.commands` and `verify.model` through the config file; the second is correctly refused, the first is not.
- [product] README: "Agents cannot approve or accept, or change the models that verify their work."
- [assumed] `verify.maxAttempts` and `verify.lenses` count as integrity keys because they decide how much verification an agent must survive; `build.testWriterModel` because it picks the independent test writer. `verify.timeoutSec`, `verify.commands`, `verify.parallel`, `verify.effort`, `build.testWriter`, `build.testWriterEffort`, `questions`, `memory`, `promotion` are operational.
- [assumed] Deep JSON equality on the predicted vs current value is enough; key order and whitespace do not matter.

## Expectations
- [E1] Write/edit of `.iced/config.json` that changes only operational keys is allowed; changing, removing or adding any integrity key, or producing invalid JSON, is blocked with a reason naming the key. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] `.iced/active`, `.iced/metrics.jsonl`, `evidence.md` and `verify.json` stay blocked; shell writes to the config stay blocked. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] The integrity-key list is exported from one place and documented in README; full suite passes. {verify: check | npm test}

## Open questions
