# Evidence: 009-gate-policy-at-autonomy-2-or-3-code-chan

Trusted and autonomous units are not frozen before building

Verdict: **PASS** (attempt 1, 2026-10-02T14:27:05Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 9s)

## Builder summary

gateDecision in packages/pi-intent/src/gate.mjs returns { action: "notify", reason } for code edits and mutating shell when the active unit is not building and effective autonomy is 2 or 3. At autonomy 0 and 1 it blocks as before. Protection blocks (ICED-owned files, config integrity keys, protected keys, frozen contract, accepted or rejected units, review units, shell writes to protected targets) carry hard: true and block at every autonomy level. The extension's warn mode downgrades only non-hard blocks, so protections hold in every gate mode except off. The extension shows notify decisions once per call via ctx.ui.notify('ICED: <reason>') and allows the call. Fixed since attempt 3: quoted protected directories (rm -rf "intent/<id>") are kept through quote masking, so they hard-block instead of returning notify. Shared files also carry the other approved gate units' changes; this unit covers the autonomy policy only.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] `gateDecision` returns a non-blocking notify decision for code edits and mutating shell commands when the active unit is not building and effective autonomy is 2 or 3; returns block at autonomy 0 or 1 as today.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '009 E1' (notify at autonomy 2/3 and block at 0/1 for draft, approved, verifying, done and blocked, for code edits and mutating shell)
- Verifier: Not independently verified.

### [E2] Owned files, protected keys, frozen contract and review units still return block at autonomy 2 and 3.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '009 E2' (owned files, protected keys, frozen contract, review units, mv/rm of iced.md, unit folders and .iced, quoted or not, block at autonomy 2/3) and '009 C2/C3' (protection blocks hard: true; freeze blocks not hard; index.ts warn branch checks !d.hard)
- Verifier: Not independently verified.

### [E3] The extension allows notify decisions and shows a notice when a UI exists; README and SPEC describe the policy per autonomy level.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: check: npm test: 130 tests (80 iced-core, 50 pi-intent), 0 fail, including '009 E3' source check of the extension's notify branch in packages/pi-intent/extensions/iced/index.ts; git diff --check clean
- Verifier: Not independently verified.

### [E4] README and SPEC state the rule: autonomy 0-1 freeze code outside building, autonomy 2-3 notify; contract, protected fields and owned files always block.

- Result: **claimed**
- Verify: manual | docs review
- Builder evidence: manual: packages/pi-intent/README.md 'What is enforced' (autonomy 0-1 freeze inside the repo while not building, autonomy 2-3 proceed with a notice, protections block in every mode except off) and packages/iced-core/spec/SPEC.md section 14 Enforcer row plus section 12 (warn keeps protection blocks)
- Verifier: Not independently verified.

## Failure conditions

- [F1] not checked
- [F2] not checked
- [F3] not checked

## Constraints

- [C1] not checked
- [C2] not checked
- [C3] not checked
- [C4] not checked
- [C5] not checked

## Checks

- `npm test`: exit 0, 18.7s

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
