---
iced: 0.1
id: 010-gate-unit-file-after-sign-off-allow-edit
title: Agents can keep notes in a signed-off unit
type: feature
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 3
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T10:47:18Z
approved_by: Artur Leao
contract_hash: 0ecbbe9332a44ebcf8cffb5ce7ab366bb924f8c83499704e0294c5ea1ab4ecc5
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
blocked_from: null
accepted_at: 2026-10-02T14:34:54Z
accepted_by: Artur Leao
---

# Agents can keep notes in a signed-off unit

<!-- Request: Gate unit file: after sign-off, allow edits to iced.md that leave the contract hash and protected frontmatter unchanged (Context, Open questions, notes, missing frontmatter keys); block contract changes with a message naming the changed section and iced_escalate change-expectation -->

## Intent

### Goal
After sign-off, an agent can update a unit's Context, Open questions, title and other unprotected fields, while Intent, Expectations and protected fields stay frozen.

### Constraints
- [C1] An edit is allowed only when the predicted file keeps `contractHash` identical and changes no protected key; anything else is blocked.
- [C2] Edits that cannot be predicted (missing, ambiguous, overlapping or empty `oldText`) stay blocked.
- [C3] Edits that would make the unit invalid at validate stage (for example duplicate canonical sections, missing required sections) are blocked.
- [C4] Accepted and rejected units stay frozen entirely.
- [C5] Draft behaviour (edits allowed except protected keys) is unchanged.

### Failure conditions
- [F1] An edit after sign-off that changes Intent or Expectations text, or a protected key, is allowed.
- [F2] An edit after sign-off that changes only Context, Open questions, title, tier, risk or type is blocked.
- [F3] The block message for a contract change does not name the changed section or `iced_escalate` with kind `change-expectation`.

### Scope
- In: the `unit` branch of `gateDecision`, a core helper to compare contract hash and protected keys between two texts, regression tests, README/SPEC wording.
- Out: changing how the contract is hashed, auto-applying change-expectation escalations, the `decisions.md` flow.

## Context
- [code] gate.mjs `unit` branch returns block whenever `status !== "draft"` before any prediction, so even adding an `[assumed]` line to Context is refused.
- [code] `predictFileContent` and `changedProtectedKeys` already exist in guard.mjs; `contractHash(text)` in core.mjs hashes the normalized Intent and Expectations sections only.
- [code] `lintIced(parsed, "validate")` reports `contract-changed` and `section-duplicate`, usable to refuse invalid results before they are written.
- [code] Session logs of a downstream project show four blocked edits during building that only added missing frontmatter keys (title, type, tier, parent) and did not touch the contract.
- [product] SPEC section 8: "While a unit is draft, the agent MAY edit its body and unprotected fields. After sign-off the agent..." freezes the contract; it does not require freezing Context or Open questions.
- [assumed] Title, tier, risk and type are unprotected fields and may change after sign-off; `effectiveAutonomy` reads `risk`, so raising risk can only lower autonomy, never raise it.
- [assumed] The changed-section name comes from comparing normalized Intent vs Expectations blocks separately.

## Expectations
- [E1] After sign-off (approved, building, verifying, done, blocked), edits that change only Context, Open questions or unprotected frontmatter are allowed; the same edits in accepted/rejected units are blocked. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] Edits that change Intent or Expectations text or a protected key, or produce an invalid unit, are blocked, and the reason names the changed section (Intent or Expectations) and `iced_escalate` kind `change-expectation`. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] Draft edit behaviour and unpredictable-edit blocking are unchanged; full suite passes. {verify: check | npm test}
- [E4] README and SPEC say what may change after sign-off and what may not. {verify: manual | docs review}

## Open questions
