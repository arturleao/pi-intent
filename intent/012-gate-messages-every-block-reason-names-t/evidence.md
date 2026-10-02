# Evidence: 012-gate-messages-every-block-reason-names-t

Every gate block tells the agent its next step

Verdict: **PASS** (attempt 2, 2026-10-02T12:31:39Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 9s)

## Builder summary

Every block reason from gateDecision, verifierToolDecision and the extension's confirm branch ends with a next-step sentence naming an iced_* tool, intent/<id>/decisions.md, a /iced human command, review.md or read-only commands: owned files -> iced_submit/iced_decision/decisions.md; protected keys -> iced_request_signoff/iced_decision (and, when contract text changed too, the frozen section plus iced_escalate change-expectation); frozen contract -> iced_escalate change-expectation or decisions.md (the 'Context and Open questions may be edited' hint now precedes the next step); invalid edit -> fix or decisions.md (first lint message truncated, count of the rest); closed unit -> iced_start/decisions.md; draft -> iced_request_signoff; approved -> iced_build or /iced build <id>; verifying -> /iced accept|reject <id> and decisions.md; done -> /iced accept|reject <id>; blocked -> /iced build <id> or /iced reject <id>; review -> review.md and iced_decision; no active unit under always -> iced_start; config integrity -> /iced autonomy|gate|models (key list bounded with 'and N more'); shell owned -> edit tool for notes/operational config, iced_submit, iced_decision ('reading them is fine' precedes); verifier -> read-only commands (read, grep, find, ls); autonomy 0 without UI / declined -> decisions.md and /iced autonomy 1 <id>. Decisions are unchanged. Reasons stay at most 330 characters with no absolute local paths. README lists the next step per block kind. Attempt-1 findings (verifying reason, confirm-branch reasons, unbounded lists, final-sentence rule, missing lint/combined paths in the enumeration, README coverage) are addressed. Units 007-011 are implemented in the same working tree.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] A test enumerates every block path of `gateDecision` and `verifierToolDecision` and asserts each reason matches the next-step pattern (names an `iced_*` tool, `decisions.md`, a `/iced` command, `review.md` or "read-only").

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '012 E1': everyBlock enumerates 60+ labelled block decisions (per status: code, shell, owned, new unit, protected, unpredictable, contract, protected+contract, invalid, invalid twice, shell owned, shell owned via cd, config missing; review code/shell; closed unit; always code/shell; config integrity, invalid JSON, emptied, unpredictable; verifierToolDecision for write/edit/bash/powershell/iced_submit) and asserts NEXT_STEP, length <= 330, no local paths, no advice to edit frozen/owned content, and that the last sentence is the next step; the extension's two confirm-branch reasons are extracted from index.ts and asserted against NEXT_STEP)
- Verifier: Not independently verified.

### [E2] The `blocked`, `verifying`, `done` and shell not-building reasons name the human command or tool to use.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '012 E2': blocked code/shell name /iced build and /iced reject <id>; verifying code/shell name /iced accept <id> and decisions.md; done names /iced accept <id>; approved names iced_build and /iced build <id>; draft shell names iced_request_signoff; protected+contract names the key, 'Intent is frozen', iced_escalate and iced_request_signoff; config emptied shows 'gate, autonomy, maxAutonomy and 6 more' with a /iced command; verifier names read-only commands (read, grep, find, ls))
- Verifier: Not independently verified.

### [E3] Full suite passes; README gate section lists the next step for each block.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: check: npm test (130 pass, 0 fail, git diff --check clean; packages/pi-intent/README.md 'What is enforced' ends with a per-block next-step list (frozen contract, owned files, protected fields, config integrity, shell writes, each status, review units, always mode, autonomy 0, verifier))
- Verifier: Not independently verified.

## Failure conditions

- [F1] not checked
- [F2] not checked

## Constraints

- [C1] not checked
- [C2] not checked
- [C3] not checked

## Checks

- `npm test`: exit 0, 16.2s

## Files changed since approval

- packages/iced-core/README.md
- packages/iced-core/spec/SPEC.md
- packages/iced-core/src/core.mjs
- packages/iced-core/src/guard.mjs
- packages/pi-intent/README.md
- packages/pi-intent/docs/design.md
- packages/pi-intent/extensions/iced/index.ts
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs
