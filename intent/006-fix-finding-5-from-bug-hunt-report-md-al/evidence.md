# Evidence: 006-fix-finding-5-from-bug-hunt-report-md-al

Stop cancelled verification work

Verdict: **PASS** (attempt 1, 2026-10-01T16:11:46Z, independent verifier: yes)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (answered, 46s)

## Builder summary

Pre-aborted processes return explicit cancelled non-success without spawn. Running processes recheck signal after listener registration and clean up on close. Pipeline checks cancellation between checks and agents and before reports; cancelled submit returns building with unchanged attempts. C3 permits batch artifacts.

## Expectations

### [E1] Pre-aborted runProcess returns non-success cancellation result without executing child; mid-process abort returns promptly and clears listeners/timer.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify.test.mjs
- Builder evidence: test: packages/iced-core/test/verify.test.mjs: runProcess: pre-aborted and mid-process cancellation prevent successful execution and clean listeners (Checks marker absence, running-child abort, event listener cleanup, normal completion and timeout.)
- Verifier: Read packages/iced-core/src/verify.mjs and referenced regression test. Pre-abort returns cancelled:true and exitCode:-1 before spawn; test confirms no marker file. Mid-process test confirms prompt termination and listener removal. Close handler clears timer. Supplied npm test output confirms pass.

### [E2] Cancellation prevents subsequent sequential checks and new verifier/test-writer agent calls.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify.test.mjs
- Builder evidence: test: packages/iced-core/test/verify.test.mjs: cancellation: sequential checks and verifier/test-writer calls stop before new launches
- Verifier: Cancellation guards precede sequential commands and verifier launches. Tests confirm second command never executes, pre-aborted verifier/test-writer make zero agent calls, and cancellation before verifier stage prevents launches and reports. Named tests passed.

### [E3] Cancelled submitUnit stays building with unchanged attempts and no successful report, while normal tests pass.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test; git diff --check (116 tests passed including submitUnit cancellation preserves building and attempts without reports; diff whitespace check passed.)
- Verifier: Submission regression covers cancellation before submission, during checks, and during verifier response with autonomy 2. Assertions require building status, unchanged attempts, absent reports, and empty metrics. Supplied npm test passed all 116 tests.

## Failure conditions

- [F1] not triggered: runProcess checks signal.aborted before spawn; passing marker-file regression confirms child command never executes.
- [F2] not triggered: Pipeline checks cancellation around asynchronous work and before report generation. Submission catches cancellation and restores building before applyVerdict.

## Constraints

- [C1] respected: Cancellation resolves non-success process result rather than throwing. Passing tests retain normal exit success and timeout behavior.
- [C2] respected: Passing submission tests assert unchanged attempts, building status, no verify.json or evidence.md, and no metrics after cancellation.
- [C3] respected: BUG-HUNT-REPORT.md and companion findings are permitted batch artifacts; cancellation implementation stays within process and verification pipeline.

## Checks

- `npm test`: exit 0, 12.7s

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

Read-only review. Used supplied tooling results; no commands rerun. Process-tree termination redesign remains excluded.
