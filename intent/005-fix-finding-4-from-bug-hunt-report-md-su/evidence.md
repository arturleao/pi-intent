# Evidence: 005-fix-finding-4-from-bug-hunt-report-md-su

Validate contracts before submission

Verdict: **PASS** (attempt 1, 2026-10-01T16:05:51Z, independent verifier: yes)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (answered, 46s)

## Builder summary

Submission validates own and existing ancestor contracts before effects, returns unit-qualified invalid-contract errors, extension handles them before success reporting. Updated test fixtures with valid approval hashes and added eight invalid contract cases. C3 permits batch artifacts.

## Expectations

### [E1] Own lint errors including missing or mismatched approval hash reject submission with actionable errors and unchanged status and attempts.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify-parallel.test.mjs
- Builder evidence: test: packages/iced-core/test/verify-parallel.test.mjs: submitUnit: invalid own and ancestor contracts stop before any work
- Verifier: submitUnit validates before effects. Passing verify-parallel.test.mjs regression covers changed expectation, missing hash, duplicate sections and invalid fields; asserts unit-qualified errors, unchanged unit text and attempts.

### [E2] Invalid existing ancestor contracts reject submission before any checks or agent calls.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify-parallel.test.mjs
- Builder evidence: test: packages/iced-core/test/verify-parallel.test.mjs: submitUnit: invalid own and ancestor contracts stop before any work (Tests changed/missing hash, duplicate sections, invalid fields for own and ancestor contracts, with check marker and agent spy.)
- Verifier: submitUnit applies validate-stage lint to every returned ancestor. Passing regression repeats four invalid-contract cases against parent; asserts no check marker, agent calls, reports or metrics.

### [E3] Extension handles invalid submission without claiming success, and valid/missing-evidence paths plus existing suite pass.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test (113 tests passed; extension invalid outcome handling regression and valid/missing-evidence paths passed.)
- Verifier: Extension returns actionable invalid-contract diagnostics before report access or success handling. Read corresponding passing regression plus valid submission and missing-evidence tests. Supplied npm test output confirms 113 passes.

## Failure conditions

- [F1] not triggered: Changed expectation with stale approval hash returns invalid-contract before transition; regression confirms unchanged building unit.
- [F2] not triggered: All eight invalid-contract cases preserve attempts at 2 and launch neither configured check nor agent.

## Constraints

- [C1] respected: Validation precedes attempt calculation, transition and verifyUnit. Regression confirms unchanged text, absent reports and empty metrics.
- [C2] respected: Passing tests demonstrate valid submissions reaching done or accepted and missing evidence returning missing-evidence without transition.
- [C3] respected: Other bug-hunt fixes and BUG-HUNT-REPORT.md are permitted batch artifacts; submission change remains confined to validation, diagnostics and regression coverage.

## Checks

- `npm test`: exit 0, 12.2s

## Files changed since approval

- BUG-HUNT-REPORT.md
- packages/iced-core/spec/SPEC.md
- packages/iced-core/src/core.mjs
- packages/iced-core/src/guard.mjs
- packages/iced-core/src/verify.mjs
- packages/iced-core/test/core.test.mjs
- packages/iced-core/test/models.test.mjs
- packages/iced-core/test/verify-parallel.test.mjs
- packages/iced-core/test/verify.test.mjs
- packages/pi-intent/extensions/iced/index.ts
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs
- packages/pi-intent/test/runner.test.mjs

## Verifier notes

Used supplied tooling results and read implementation/tests. Extension regression checks source structure; inspected branch confirms early diagnostic return. Ancestors retain existing validate-stage lifecycle policy.
