# Evidence: 004-fix-finding-3-from-bug-hunt-report-md-du

Reject duplicate canonical unit sections

Verdict: **PASS** (attempt 1, 2026-10-01T15:59:47Z, independent verifier: yes)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 42s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 22s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 47s)

## Builder summary

Added case-insensitive canonical section duplicate lint across stages, approval/acceptance regression and compatibility tests, clarified spec. Hash algorithm unchanged. C3 allows report and sibling fixes.

## Expectations

### [E1] Repeated canonical level-two headings fail draft, signoff, validate, and accept lint, case-insensitively.

- Result: **pass**
- Verify: test | packages/iced-core/test/core.test.mjs
- Builder evidence: test: packages/iced-core/test/core.test.mjs: duplicate canonical sections fail every lint stage case-insensitively
- Verifier: core.test.mjs tests all four canonical headings across draft, signoff, validate and accept using uppercase duplicates. core.mjs normalizes headings and rejects repeats before stage-specific rules. Named test passed. | The test 'lint: duplicate canonical sections fail every lint stage case-insensitively' appends an uppercase duplicate of Intent, Context, Expectations and Open questions. It asserts `section-duplicate` at draft, signoff, validate and accept. The lint in core.mjs 254-260 is unconditional. The test passes in the npm test output. | `core.mjs` tracks canonical H2 headings case-insensitively and emits `section-duplicate` before stage rules. `core.test.mjs` tests Intent, Context, Expectations, Open questions across draft/signoff/validate/accept. npm test passed.

### [E2] Reported duplicate Intent/Expectations example cannot be approved or accepted even when stored hash matches final sections.

- Result: **pass**
- Verify: test | packages/iced-core/test/core.test.mjs
- Builder evidence: test: packages/iced-core/test/core.test.mjs: duplicate contract sections block approval and acceptance
- Verifier: Regression test rejects duplicate Intent/Expectations approval, then rejects acceptance with evidence present and stored hash matching final sections despite earlier expectation tampering. approveUnit and acceptUnit both stop on lint errors. Named test passed. | The test 'repo ops: duplicate contract sections block approval and acceptance' builds a duplicate Intent/Expectations unit. approveUnit returns ok=false with `section-duplicate`. It then stores a hash that matches the final sections, and acceptUnit also returns ok=false with `section-duplicate`. The test passes. | `approveUnit` runs signoff lint; `acceptUnit` runs accept lint. Regression test creates duplicate Intent/Expectations, proves legacy final-section hash remains unchanged after first-section edit, then proves approval and acceptance return `ok: false` with `section-duplicate`. npm test passed.

### [E3] Commented headings and repeated unknown sections remain compatible; valid contract hashes and suite pass unchanged.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test (Commented headings and unknown repeated sections tested; previous-release hash compatibility remains pinned.)
- Verifier: Tests confirm commented canonical headings and repeated Notes sections lint clean without changing hash. compat.test.mjs pins previous-release hash and successfully accepts previously approved unit. Supplied npm test output: 111 passed, zero failures. | The same lint test checks that a unit with commented-out headings and repeated '## Notes' sections has no signoff errors and the same contractHash as the plain unit. The previous-release hash and lint tests pass. `npm test` exits 0 with 0 failures. | Duplicate test confirms HTML-comment headings ignored, repeated unknown Notes sections accepted, hash unchanged. `compat.test.mjs` pins prior-release golden hash and validates prior approved unit; both named tests passed in npm output.

## Failure conditions

- [F1] not triggered: Canonical duplicate check runs unconditionally; regression tests demonstrate lint and approval rejection. | Duplicates are rejected at all stages and in approve and accept. The parser and the lint agree on what counts as a heading. | Duplicate canonical headings produce lint error at every required stage; approval and acceptance reject duplicates.
- [F2] not triggered: Golden previous-release hash still matches; previous-release approved unit passes validation and acceptance. | The hash function is unchanged and the previous-release hash tests pass, so valid existing units need no migration. | Golden prior-release hash test passed; prior approved unit validate/accept compatibility test passed.

## Constraints

- [C1] respected: Hash implementation remains separate from duplicate validation; passing golden-hash and previous-release acceptance tests establish compatibility. | The hash algorithm is unchanged. The pinned previous-release hash test and the previous-release lint test pass. | Hash algorithm unchanged. Golden hash compatibility test passed.
- [C2] respected: parseIced blanks HTML comments before recording headings. Duplicate lint filters only canonical names and performs no rewriting. Repeated unknown-section compatibility test passes. | The lint reads parsed.sections, which come from comment-blanked text. Unknown repeated sections are skipped because they are not in H2. A test covers both. | `blankComments` removes HTML comments before headings parsed. Regression covers commented canonical headings and repeated unknown sections.
- [C3] respected: Report and sibling bug-hunt artifacts explicitly allowed. Duplicate-section implementation, spec clarification and regression tests fit unit scope. | The other changed files belong to the sibling bug-hunt fixes, which C3 allows. | Core/spec/test changes implement duplicate validation. Guard, verify, gate, and related tests match other bug-hunt findings, explicitly allowed batch artifacts.

## Checks

- `npm test`: exit 0, 10.3s

## Files changed since approval

- BUG-HUNT-REPORT.md
- packages/iced-core/spec/SPEC.md
- packages/iced-core/src/core.mjs
- packages/iced-core/src/guard.mjs
- packages/iced-core/src/verify.mjs
- packages/iced-core/test/core.test.mjs
- packages/iced-core/test/verify-parallel.test.mjs
- packages/iced-core/test/verify.test.mjs
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs

## Verifier notes

[expectations] Read-only review used supplied check output as execution evidence. No expectation gaps found.
[failures] Duplicate-section units keep the legacy last-section-only hash on purpose, and the test documents this. The lint blocks such units instead. I did not review the content of the sibling-unit changes in guard.mjs, verify.mjs and gate.mjs.
[rules] SPEC clarification matches implementation.
