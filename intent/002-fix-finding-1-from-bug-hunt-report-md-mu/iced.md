---
iced: 0.1
id: 002-fix-finding-1-from-bug-hunt-report-md-mu
title: Prevent protected-field multi-edit bypass
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: high
attempts: 3
created: 2026-10-01T15:22:23Z
approved_at: 2026-10-01T15:41:43Z
approved_by: Artur Leao
contract_hash: 32eb87c5073e822eab972d233c6b33e60ffa9e618773b0fb1ea26556ee577070
base_ref: 4ce0f0eab0bf1af939a8124f55d91df4875cd42e
blocked_from: null
accepted_at: 2026-10-01T16:13:38Z
accepted_by: Artur Leao
---

# Prevent protected-field multi-edit bypass

<!-- Request: Fix finding 1 from BUG-HUNT-REPORT.md: multi-edit prediction can allow protected status changes. Resolve edits against original content, validate unique non-overlapping matches, and fail closed for unpredictable protected-file edits. -->

## Intent

### Goal
Agents cannot change protected unit fields by exploiting differences between predicted and actual edits.

### Constraints
- [C1] Keep public prediction return shape (content or null) and valid write behavior compatible.
- [C2] Match each edit against original file content; valid edits must be unique and non-overlapping.
- [C3] BUG-HUNT-REPORT.md is an allowed artifact of the requested bug hunt and is not an out-of-scope violation.

### Failure conditions
- [F1] Reported title/status multi-edit bypass is allowed.
- [F2] Unpredictable edits to a draft unit are allowed without protected-field validation.

### Scope
- In: edit prediction and draft unit gate and regression tests
- Out: shell classification and other reported findings

## Context
- [code] BUG-HUNT-REPORT.md finding 1 reproduces a protected status bypass.
- [code] packages/iced-core/src/guard.mjs applies edits sequentially; packages/pi-intent/src/gate.mjs allows null predictions.
- [code] Host edit contract matches unique non-overlapping regions of original content.
- [knowledge] CONTRIBUTING.md requires npm test and prohibits private host details in records.
- [assumed] Invalid edits should return null and protected-unit gate should block them with actionable reason.

## Expectations
- [E1] Reported two-edit title/status bypass is blocked and predicted valid multi-edit content matches original-file semantics. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] Missing or ambiguous or empty matches and overlapping edits cannot bypass draft-unit protection. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] Valid disjoint unprotected edits remain allowed and existing suite passes. {verify: check | npm test}

## Open questions
