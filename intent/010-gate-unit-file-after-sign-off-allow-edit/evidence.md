# Evidence: 010-gate-unit-file-after-sign-off-allow-edit

Agents can keep notes in a signed-off unit

Verdict: **PASS** (attempt 3, 2026-10-02T12:46:54Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 9s)

## Builder summary

After sign-off (approved, building, verifying, done, blocked) a write/edit to intent/<id>/iced.md is allowed when the predicted file changes no protected key, keeps contractHash identical and passes validate-stage lint; Context, Open questions, title, tier, risk and type may change. A signed-off unit lacking contract_hash (blocked before sign-off) freezes only protected keys. Accepted and rejected units are fully frozen; unpredictable edits block. Draft behaviour is unchanged. Contract changes block naming the changed section (core helper changedContractSections(before, after) in iced-core core.mjs) and point to iced_escalate kind change-expectation; when one edit changes both a protected key and contract text the reason names the key, the frozen section and the escalation (attempt-1 finding, regression case added). Attempt 2 failed only on scope notes about sibling units: units 007-009 and 011-012 are implemented in the same working tree by design of this batch; this unit is responsible only for the signed-off iced.md edit rule.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] After sign-off (approved, building, verifying, done, blocked), edits that change only Context, Open questions or unprotected frontmatter are allowed; the same edits in accepted/rejected units are blocked.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '010 E1': for approved, building, verifying, done, blocked: Context, Open questions, title, tier, risk edits and a whole-file write with a new Context line allow; unsigned blocked unit allows an Expectations edit but blocks status; accepted/rejected block any edit (hard, reason says closed))
- Verifier: Not independently verified.

### [E2] Edits that change Intent or Expectations text or a protected key, or produce an invalid unit, are blocked, and the reason names the changed section (Intent or Expectations) and `iced_escalate` kind `change-expectation`.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '010 E2': Intent, Expectations and combined section edits block naming the section and iced_escalate change-expectation; added constraint blocks; protected keys (status, attempts) block; status + Intent in one edit blocks naming status, 'Intent is frozen' and the escalation; duplicate section, invalid risk, unmatched/ambiguous/empty oldText block)
- Verifier: Not independently verified.

### [E3] Draft edit behaviour and unpredictable-edit blocking are unchanged; full suite passes.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: check: npm test (existing draft tests unchanged; packages/iced-core/test/core.test.mjs covers changedContractSections; 130 pass, 0 fail, git diff --check clean)
- Verifier: Not independently verified.

### [E4] README and SPEC say what may change after sign-off and what may not.

- Result: **claimed**
- Verify: manual | docs review
- Builder evidence: manual: packages/pi-intent/README.md, packages/iced-core/spec/SPEC.md (README 'What is enforced': Intent/Expectations frozen by contract_hash, Context/Open questions/title/tier/risk editable, protected fields never; SPEC section 6: same rule plus accepted/rejected units closed; iced-core README 'Guarding changes' mirrors it)
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

- `npm test`: exit 0, 18.1s

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
