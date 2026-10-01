---
iced: 0.1
id: 003-fix-finding-2-from-bug-hunt-report-md-in
title: Require verifier rule coverage before auto-acceptance
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: high
attempts: 2
created: 2026-10-01T15:23:17Z
approved_at: 2026-10-01T15:48:21Z
approved_by: Artur Leao
contract_hash: 6f815505d9a0bc7161d96bfc9d45532a07da71fa04f55fd855172d48e6d1d818
base_ref: 4ce0f0eab0bf1af939a8124f55d91df4875cd42e
blocked_from: null
accepted_at: 2026-10-01T16:13:41Z
accepted_by: Artur Leao
---

# Require verifier rule coverage before auto-acceptance

<!-- Request: Fix finding 2 from BUG-HUNT-REPORT.md: incomplete verifier rule checks permit auto-acceptance. Require complete explicit merged coverage for own and inherited constraints and failure conditions before automatic acceptance. -->

## Intent

### Goal
Incomplete verifier reports never authorize automatic acceptance of unchecked rules.

### Constraints
- [C1] Preserve any-failure-wins behavior across parallel reports and inherited rules.
- [C2] Incomplete rule coverage requires human acceptance; explicit violations still fail verification.
- [C3] BUG-HUNT-REPORT.md and changes implementing the other four approved bug-hunt units are allowed batch artifacts, not out-of-scope violations; this unit remains responsible only for verifier rule coverage.

### Failure conditions
- [F1] Omitted or malformed rule results permit automatic acceptance.
- [F2] A violation is lost while merging reports with missing or malformed results.

### Scope
- In: verifier rule coverage and merging and report diagnostics and regression tests
- Out: model runner permissions and other reported findings

## Context
- [code] BUG-HUNT-REPORT.md finding 2 demonstrates accepted outcome with constraints and failures omitted.
- [code] computeVerdict marks unchecked rules without requiring human review; applyVerdict trusts needsHuman.
- [code] SPEC.md section 9 requires verifier checks of ancestor constraints and failures.
- [knowledge] CONTRIBUTING.md requires npm test and host-neutral core.
- [assumed] Human review rather than verification failure is appropriate for incomplete coverage when no concrete failure exists.

## Expectations
- [E1] Omitted own or inherited constraint/failure entries and non-boolean results require human review with actionable diagnostics. {verify: test | packages/iced-core/test/verify.test.mjs}
- [E2] Autonomy-2 submission with incomplete rule coverage reaches done but never accepted; complete passing coverage remains auto-acceptable. {verify: test | packages/iced-core/test/verify-parallel.test.mjs}
- [E3] Parallel reports combine explicit checks without losing violations, and existing suite passes. {verify: check | npm test}

## Open questions
