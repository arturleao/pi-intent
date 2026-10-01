# Evidence: 002-fix-finding-1-from-bug-hunt-report-md-mu

Prevent protected-field multi-edit bypass

Verdict: **PASS** (attempt 3, 2026-10-01T15:42:50Z, independent verifier: yes)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 37s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 18s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 41s)

## Builder summary

Fixed predictor and protected draft gate. Implementation changes guard.mjs, gate.mjs, gate.test.mjs. Human revised C3 explicitly permits BUG-HUNT-REPORT.md without historical Git proof.

## Expectations

### [E1] Reported two-edit title/status bypass is blocked and predicted valid multi-edit content matches original-file semantics.

- Result: **pass**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs: gate: original-file multi-edits cannot bypass protected status
- Verifier: Read guard.mjs and gate.test.mjs. Regression reproduces reported title/status edits, asserts exact original-file prediction in both edit orders, and asserts gate blocks. Named test passed. | predictFileContent resolves all edits against the original text, so the two-edit title/status bypass now produces the status change and the gate blocks it. The test 'gate: original-file multi-edits cannot bypass protected status' passes in the npm test output. I did not open the test body. | guard.mjs resolves every oldText against original content, rejects non-unique matches, sorts offsets, rejects overlaps, then applies replacements descending. gate.test.mjs regression proves reported title/status payload predicts original-file result in either edit order and draft gate blocks it. Supplied npm test output shows named test passed.

### [E2] Missing or ambiguous or empty matches and overlapping edits cannot bypass draft-unit protection.

- Result: **pass**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs: gate: unpredictable draft edits fail closed
- Verifier: Regression asserts null prediction and blocked draft edit for missing, ambiguous, empty, overlapping, duplicate matches and missing newText. Fixture confirms ambiguous matches. Named test passed. gate.mjs blocks null predictions with actionable reason. | Missing, ambiguous, empty and overlapping edits all return null. The gate blocks a null prediction for a draft unit. The test 'gate: unpredictable draft edits fail closed' passes. | guard.mjs returns null for absent, ambiguous, empty oldText, overlapping, duplicate, or malformed edits. gate.mjs blocks null prediction for draft units. gate.test.mjs covers missing, ambiguous, empty, overlapping, duplicate, and malformed edits; supplied output shows test passed.

### [E3] Valid disjoint unprotected edits remain allowed and existing suite passes.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test (105 tests passed.)
- Verifier: Regression asserts two disjoint unprotected edits remain allowed. Supplied npm test output confirms 105 passed, zero failures. | npm test exited 0 with 70 iced-core tests and 35 pi-intent tests passing. Valid disjoint edits still get a predicted result and are allowed when no protected key changes. | gate.test.mjs permits valid disjoint unprotected draft edits. Supplied npm test output exits 0: 70 iced-core tests and 35 pi-intent tests passed.

## Failure conditions

- [F1] not triggered: Reported bypass now predicts actual status change and gate blocks; passing regression confirms. | Edits are matched against the original content, so the sequential-application bypass is gone. | Reported payload now predicts status change from original content; changedProtectedKeys detects status; draft gate blocks.
- [F2] not triggered: Draft-unit gate rejects null prediction before protected-field comparison; regression covers invalid edit cases. | A null prediction on a draft unit returns a block. I found no allow path that skips protected-field validation, apart from the legacy-form risk noted above. | Unpredictable draft edit prediction is null and gate returns block with actionable reason.

## Constraints

- [C1] respected: Predictor still returns string or null. Full string writes return unchanged content; regression verifies full-write prediction. | predictFileContent still returns a string or null, and full writes (`content`) still work. | predictFileContent public return remains string or null. Full writes and valid exact replacements remain supported.
- [C2] respected: Every match resolves against original content. Second occurrence search includes self-overlapping occurrences. Sorted ranges reject overlaps; descending-offset replacements preserve original positions and permit adjacency. | Each edit is matched against the original file. Edits must have a unique match and must not overlap. | Each edit locates uniquely in original text; overlapping ranges return null; replacement uses descending original offsets.
- [C3] respected: BUG-HUNT-REPORT.md is explicitly permitted artifact; remaining listed changes match implementation and regression scope. | BUG-HUNT-REPORT.md is explicitly allowed by C3. | BUG-HUNT-REPORT.md change explicitly allowed by constraint.

## Checks

- `npm test`: exit 0, 9.9s

## Files changed since approval

- BUG-HUNT-REPORT.md
- packages/iced-core/src/guard.mjs
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs

## Verifier notes

[expectations] Read-only verification used source, tests, fixtures and supplied tooling output. No files changed. No expectation gaps found.
[failures] Check whether the pi edit tool can deliver top-level oldText/newText to the gate (legacy form). If it can, predictContent should convert it to an edits array or return null, because the current code treats it as an empty edit list that changes nothing. Empty `edits: []` is also predicted as unchanged, which is probably harmless.
[rules] No inherited constraints: parent is null. Changed implementation and test files fit edit prediction, draft gate, regression-test scope.
