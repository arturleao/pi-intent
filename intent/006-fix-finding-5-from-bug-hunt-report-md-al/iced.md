---
iced: 0.1
id: 006-fix-finding-5-from-bug-hunt-report-md-al
title: Stop cancelled verification work
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 1
created: 2026-10-01T15:25:12Z
approved_at: 2026-10-01T16:07:56Z
approved_by: Artur Leao
contract_hash: 90ac05c201e9054606741c87800002af53bfbaaf7feb936b75fdb5425ee229fc
base_ref: 4ce0f0eab0bf1af939a8124f55d91df4875cd42e
blocked_from: null
accepted_at: 2026-10-01T16:13:48Z
accepted_by: Artur Leao
---

# Stop cancelled verification work

<!-- Request: Fix finding 5 from BUG-HUNT-REPORT.md: already-aborted signals still launch processes. Prevent launches after cancellation and propagate cancellation through checks and verification stages. -->

## Intent

### Goal
Cancellation prevents new verification work and does not produce successful or accepted outcomes.

### Constraints
- [C1] Preserve runProcess non-throwing result API and normal timeout behavior.
- [C2] Cancelled submission leaves unit building without consuming an attempt or publishing a successful report.
- [C3] BUG-HUNT-REPORT.md and changes implementing the other four approved bug-hunt units are allowed batch artifacts, not out-of-scope violations; this unit remains responsible only for cancellation propagation.

### Failure conditions
- [F1] Pre-aborted signal still executes child command.
- [F2] Cancellation allows later commands or verifiers to launch or unit to become done/accepted.

### Scope
- In: cancellation checks in process and verification pipeline and regression tests
- Out: redesign of process-tree termination and other reported findings

## Context
- [code] BUG-HUNT-REPORT.md finding 5 demonstrates a child completing after pre-abort.
- [code] runProcess subscribes after spawn without checking signal.aborted; pipeline does not stop between stages on cancellation.
- [code] submitUnit already restores building when verification throws.
- [knowledge] CONTRIBUTING.md runs tests on Windows and Linux and requires npm test.
- [assumed] Cancelled low-level process results should be explicit non-success results; pipeline should stop with cancellation error and preserve attempts.

## Expectations
- [E1] Pre-aborted runProcess returns non-success cancellation result without executing child; mid-process abort returns promptly and clears listeners/timer. {verify: test | packages/iced-core/test/verify.test.mjs}
- [E2] Cancellation prevents subsequent sequential checks and new verifier/test-writer agent calls. {verify: test | packages/iced-core/test/verify.test.mjs}
- [E3] Cancelled submitUnit stays building with unchanged attempts and no successful report, while normal tests pass. {verify: check | npm test}

## Open questions
