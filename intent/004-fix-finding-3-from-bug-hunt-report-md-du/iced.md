---
iced: 0.1
id: 004-fix-finding-3-from-bug-hunt-report-md-du
title: Reject duplicate canonical unit sections
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: high
attempts: 1
created: 2026-10-01T15:24:02Z
approved_at: 2026-10-01T15:57:44Z
approved_by: Artur Leao
contract_hash: ee44b4f802837c6272e73c1e7945f2c9e3c2075187103409709d752d6effb09a
base_ref: 4ce0f0eab0bf1af939a8124f55d91df4875cd42e
blocked_from: null
accepted_at: 2026-10-01T16:13:44Z
accepted_by: Artur Leao
---

# Reject duplicate canonical unit sections

<!-- Request: Fix finding 3 from BUG-HUNT-REPORT.md: duplicate contract sections evade hash protection. Reject duplicate canonical sections during lint and approval while preserving hashes of valid existing units. -->

## Intent

### Goal
Ambiguous duplicate unit sections cannot pass validation or approval and conceal contract changes.

### Constraints
- [C1] Preserve contract hashes of existing valid units and previous-release compatibility.
- [C2] Preserve unknown sections and ignore headings inside HTML comments.
- [C3] BUG-HUNT-REPORT.md and changes implementing the other four approved bug-hunt units are allowed batch artifacts, not out-of-scope violations; this unit remains responsible only for duplicate canonical section validation.

### Failure conditions
- [F1] Duplicate canonical headings pass lint or approval.
- [F2] Valid existing units need approval hash migration.

### Scope
- In: duplicate canonical section lint and spec clarification and regression tests
- Out: hash algorithm migration and other reported findings

## Context
- [code] BUG-HUNT-REPORT.md finding 3 demonstrates parser accumulation versus last-section-only hashing.
- [code] parseIced exposes section headings; lintIced currently does not reject duplicate headings.
- [code] SPEC.md identifies headings case-insensitively and compatibility tests pin prior contract hashes.
- [knowledge] CONTRIBUTING.md requires backward compatibility and npm test.
- [assumed] Reject repeated Intent, Context, Expectations, and Open questions headings rather than changing valid-unit hash algorithm.

## Expectations
- [E1] Repeated canonical level-two headings fail draft, signoff, validate, and accept lint, case-insensitively. {verify: test | packages/iced-core/test/core.test.mjs}
- [E2] Reported duplicate Intent/Expectations example cannot be approved or accepted even when stored hash matches final sections. {verify: test | packages/iced-core/test/core.test.mjs}
- [E3] Commented headings and repeated unknown sections remain compatible; valid contract hashes and suite pass unchanged. {verify: check | npm test}

## Open questions
