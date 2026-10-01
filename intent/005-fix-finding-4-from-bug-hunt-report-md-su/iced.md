---
iced: 0.1
id: 005-fix-finding-4-from-bug-hunt-report-md-su
title: Validate contracts before submission
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 1
created: 2026-10-01T15:24:38Z
approved_at: 2026-10-01T16:02:15Z
approved_by: Artur Leao
contract_hash: 107a3720fb3e98c831a0b224d3dceb17438800f543ec8e0fe8a4fcceb386f26c
base_ref: 4ce0f0eab0bf1af939a8124f55d91df4875cd42e
blocked_from: null
accepted_at: 2026-10-01T16:13:46Z
accepted_by: Artur Leao
---

# Validate contracts before submission

<!-- Request: Fix finding 4 from BUG-HUNT-REPORT.md: submission reports success for changed unapproved contracts. Validate unit and inherited contracts before verification, without launching checks or consuming attempts on invalid contracts. -->

## Intent

### Goal
Invalid or changed unapproved contracts cannot produce successful submission results or launch verification work.

### Constraints
- [C1] Reject invalid submission before status changes, attempts, reports, checks, or agent calls.
- [C2] Preserve valid submission and missing-evidence behavior.
- [C3] BUG-HUNT-REPORT.md and changes implementing the other four approved bug-hunt units are allowed batch artifacts, not out-of-scope violations; this unit remains responsible only for submission validation.

### Failure conditions
- [F1] Reported changed expectation reaches done through submission.
- [F2] Rejected invalid submission consumes an attempt or launches work.

### Scope
- In: submission validation and inherited contract validation and extension diagnostics and regression tests
- Out: parent lifecycle policy and other reported findings

## Context
- [code] BUG-HUNT-REPORT.md finding 4 reproduces successful submission despite contract-changed lint.
- [code] submitUnit currently validates only status and evidence IDs before transition; lintIced checks approval hashes.
- [code] Ancestor rules are passed to verifiers, so invalid inherited contracts affect judged criteria.
- [knowledge] CONTRIBUTING.md requires host-neutral core and npm test.
- [assumed] Existing ancestors are validated at validate stage; this change does not require parents to be approved or add new parent lifecycle policy.

## Expectations
- [E1] Own lint errors including missing or mismatched approval hash reject submission with actionable errors and unchanged status and attempts. {verify: test | packages/iced-core/test/verify-parallel.test.mjs}
- [E2] Invalid existing ancestor contracts reject submission before any checks or agent calls. {verify: test | packages/iced-core/test/verify-parallel.test.mjs}
- [E3] Extension handles invalid submission without claiming success, and valid/missing-evidence paths plus existing suite pass. {verify: check | npm test}

## Open questions
