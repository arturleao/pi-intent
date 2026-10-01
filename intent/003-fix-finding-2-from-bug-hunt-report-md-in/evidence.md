# Evidence: 003-fix-finding-2-from-bug-hunt-report-md-in

Require verifier rule coverage before auto-acceptance

Verdict: **PASS** (attempt 2, 2026-10-01T15:52:53Z, independent verifier: yes)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 38s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 26s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 46s)

## Builder summary

Added explicit boolean coverage and human-review notes. Fixed verifier-discovered duplicate-ID loophole: singleton reports normalized by merge, direct rule lookup ranks all duplicate matches so true violations cannot hide. C3 permits batch artifacts.

## Expectations

### [E1] Omitted own or inherited constraint/failure entries and non-boolean results require human review with actionable diagnostics.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify.test.mjs
- Builder evidence: test: packages/iced-core/test/verify.test.mjs: missing or malformed own and inherited rule checks require human review; duplicate own and inherited rule entries cannot hide violations
- Verifier: Read verify.test.mjs and verify.mjs. Missing entries and non-boolean results set needsHuman; diagnostics name rule ID and required boolean field. collectRules includes qualified inherited rules. Supplied output confirms regression tests pass. | In computeVerdict, `ruleChecked` requires `typeof v[field] === 'boolean'` for every own and inherited constraint and failure. A missing or non-boolean entry sets needsHuman and adds an actionable note ('has no explicit boolean ... result; human review required'). The named tests 'missing or malformed own and inherited rule checks require human review' and 'duplicate own and inherited rule entries cannot hide violations' pass. I did not read the test bodies. | Read computeVerdict ruleChecked logic: non-boolean or absent triggered/violated sets needsHuman and records qualified diagnostics. verify.test covers omitted/malformed own and inherited rules; npm test passed.

### [E2] Autonomy-2 submission with incomplete rule coverage reaches done but never accepted; complete passing coverage remains auto-acceptable.

- Result: **pass**
- Verify: test | packages/iced-core/test/verify-parallel.test.mjs
- Builder evidence: test: packages/iced-core/test/verify-parallel.test.mjs: incomplete rule coverage cannot auto-accept, complete coverage can
- Verifier: Read autonomy-2 submitUnit regression: omitted coverage returns done with needsHuman=true; complete passing coverage returns accepted. applyVerdict gates acceptance on !needsHuman. Supplied output confirms test passes. | applyVerdict auto-accepts only when `!r.needsHuman`, so incomplete coverage reaches done, not accepted. The test 'submitUnit: incomplete rule coverage cannot auto-accept, complete coverage can' passes. I did not read its body. | Read applyVerdict: auto-accept requires !needsHuman. verify-parallel test proves incomplete autonomy-2 report yields done, complete explicit coverage yields accepted. npm test passed.

### [E3] Parallel reports combine explicit checks without losing violations, and existing suite passes.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test (Singleton and parallel duplicate rule merge regression tests added; checks rerun by tooling.)
- Verifier: Merge tests cover reversed report order, malformed versus explicit checks, true violations, and singleton duplicate IDs. Direct verdict tests cover duplicate own and inherited violations. Implementation ranks true above false above malformed. Supplied npm test exits 0: 74 core and 35 integration tests pass. | npm test exited 0 with 74 core and 35 pi-intent tests passing. The merge tests 'any failure wins' and 'explicit rule checks outrank malformed checks, violations win' pass. In mergeVerifierReports, `booleanRank` ranks true above false above malformed, so a violation survives merging. finishVerification always merges, including a single report, so duplicate IDs are normalized. | Read mergeVerifierReports and byId: true violation outranks false/malformed entries; merged reports preserve failure wins. Duplicate singleton/parallel regressions pass in npm test.

## Failure conditions

- [F1] not triggered: Unchecked merged rules require human review; absent verifier also requires review. Automatic acceptance checks needsHuman. | Omitted or non-boolean rule results set needsHuman, which blocks auto-accept. Partial coverage in one lens is acceptable when another lens covers the rule, because merged coverage is what counts. A lens that fails to answer also sets needsHuman in finishVerification. | Absent and malformed rule fields set needsHuman before applyVerdict auto-acceptance gate.
- [F2] not triggered: mergeVerifierReports and boolean-field byId lookup preserve explicit true despite missing, malformed, false, or duplicate entries. | The merge ranks true > false > malformed. byId picks the highest-ranked duplicate for rules. A true violation therefore cannot be hidden by a duplicate, a missing entry or a malformed entry. | Boolean ranking gives explicit true highest rank in merge and direct rule lookup; regression tests cover duplicate entries.

## Constraints

- [C1] respected: Explicit violations dominate merging and direct lookup, including inherited qualified IDs; computeVerdict records violations as failures. | Any-failure-wins is preserved: the merged verdict is fail if any report fails, and the failure and constraint merges let triggered/violated true win. | Merged true failure/constraint results become verification problems; inherited rules collected and checked.
- [C2] respected: Incomplete coverage sets needsHuman without itself failing verification; explicit violations still populate problems and produce fail. | Incomplete coverage sets needsHuman but not a failing verdict. Explicit true triggered/violated still adds a problem and fails the unit. | Incomplete coverage needs human review; explicit true results fail verdict.
- [C3] respected: Coverage implementation and regression tests stay within unit scope. Listed bug-hunt report and sibling-unit artifacts are expressly permitted. | Changes to guard.mjs, gate.mjs and BUG-HUNT-REPORT.md are covered by the batch-artifact allowance. The verify.mjs changes stay within the unit's scope. | BUG-HUNT-REPORT.md and finding-1 guard/gate batch artifacts explicitly allowed by unit constraint.

## Checks

- `npm test`: exit 0, 13.7s

## Files changed since approval

- BUG-HUNT-REPORT.md
- packages/iced-core/src/guard.mjs
- packages/iced-core/src/verify.mjs
- packages/iced-core/test/verify-parallel.test.mjs
- packages/iced-core/test/verify.test.mjs
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs

## Verifier notes

[expectations] Read-only review. Used supplied tooling output as execution evidence; no files changed.
[failures] Minor, not blocking: a string such as 'true' for triggered/violated is treated as unchecked and needs human review. It is not treated as a violation. A merged report whose verdict is missing or malformed counts as pass for the verdict, but expectation and rule coverage still gate acceptance. In computeVerdict, byId for expectations still takes the first duplicate. finishVerification merges first, so the real pipeline is unaffected.
[rules] No inherited parent: parent is null.
