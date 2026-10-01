# Bug hunt report

## Summary

Five reproduced findings: **3 high, 2 medium**. No implementation changes.

Baseline: `npm test` passed **103/103 tests** (70 core, 33 pi-intent). Additional probes exercised exported functions with synthetic data and disposable temporary repositories; temporary repositories were removed.

Scope: core parsing, contract hashing, lifecycle, verification, guard, pi gate/runner/extension, initialization, release script and publishing workflow. Not exhaustive. Live pi UI, real model subprocesses and npm publishing were not exercised.

## 1. High — Multi-edit prediction can allow protected status changes

**Locations:** `packages/iced-core/src/guard.mjs:44–54`; `packages/pi-intent/src/gate.mjs:61–63`.

`predictFileContent` applies replacements sequentially against already-modified text. Host edit tool instead matches each replacement against original text. Prediction can therefore modify different regions than actual edit.

Reproduction: draft unit contains `title: Dark mode` and `status: draft`. Submit these two disjoint edits:

```json
[
  { "oldText": "title: Dark mode", "newText": "title: status: draft" },
  { "oldText": "status: draft", "newText": "status: building" }
]
```

Both matches are unique in original file. Predictor applies second edit inside newly inserted title, leaving status unchanged. Actual original-file matching changes status to `building`.

Observed probe:

```text
gate decision: allow
predicted protected changes: []
actual protected changes: ["status"]
```

**Impact:** agent can bypass protected-field gate and enter building without approval. Probe confirmed gate result and original-file replacement outcome; did not execute protected edit against this repository.

**Fix:** resolve all matches against original file; validate uniqueness and non-overlap; apply replacements by descending offset. Fail closed when protected-file edits cannot be predicted. Add regression test using example above.

## 2. High — Missing verifier rule checks still permit auto-acceptance

**Locations:** `packages/iced-core/src/verify.mjs:310`, `331–342`, `561`.

Missing failure-condition and constraint entries become `checked: false`, but add no problems and do not set `needsHuman`. Passing expectations alone can count as complete independent verification, including when inherited rules were never checked.

Reproduction: approved autonomy-2 unit has expectations, constraints and failure conditions. Fake agent returns valid JSON containing only `verdict: "pass"` and passing expectation entries; omits constraints and failures entirely.

Observed:

```text
verdict: pass
independent: true
needsHuman: false
constraints/failures: checked: false
submitUnit outcome: accepted
```

**Impact:** incomplete model output silently bypasses rule coverage and human acceptance. Missing fields are treated like evidence that no violation exists.

**Fix:** validate report field types and merged coverage for every own/inherited rule. Missing or malformed checks must fail verification or require human review; never auto-accept. Require explicit boolean results rather than treating absent values as false.

## 3. High — Duplicate contract sections evade hash protection

**Locations:** `packages/iced-core/src/core.mjs:204`, `215–219`, `234`.

Body parser accumulates items from repeated sections. Hash helper resets its section buffer on every repeated heading, so only final `Intent` and `Expectations` sections contribute to hash. Linter does not reject duplicates.

Reproduction: unit contains two `## Intent` sections and two `## Expectations` sections, with distinct expectation IDs. Set approval hash, then change E1 in first Expectations section.

Observed:

```text
parsed E1: changed
contract hash: unchanged
validate lint errors: []
```

**Impact:** contract changes can evade detection through verification and acceptance. Requires duplicate headings; normal single-section units unaffected. Particularly relevant to manual edits, alternate hosts and accidentally duplicated drafts.

**Fix:** reject duplicate canonical sections before approval and during validation. Keep parser and hash section semantics aligned without changing hashes of valid existing units.

## 4. Medium — Submission reports success for changed, unapproved contracts

**Location:** `packages/iced-core/src/verify.mjs:577–595`.

`submitUnit` checks status and evidence IDs, but never validates unit or approval hash before running verification.

Reproduction: approve valid unit, change expectation text without refreshing hash, then submit matching evidence with passing fake verifier.

Observed:

```text
pre-submit lint: contract-changed
submitUnit outcome: done
verification verdict: pass
stored status: done
```

**Impact:** changed contract can be reported as verified successfully. Existing acceptance lint correctly blocks final acceptance, so this does not alone permit auto-acceptance; nevertheless it produces misleading success and wastes checks/model calls before discovering invalid contract.

**Fix:** run validation, including hash comparison, before transition to `verifying`. Return actionable validation errors without consuming attempt or launching checks. Consider validating inherited contracts too.

## 5. Medium — Already-aborted signals still launch processes

**Location:** `packages/iced-core/src/verify.mjs:28–49`.

`runProcess` starts child, then subscribes to future abort events. It never checks `signal.aborted`. Abort events are not replayed for listeners added after cancellation.

Reproduction:

```js
const controller = new AbortController();
controller.abort();
await runProcess(process.execPath, ["-e", "console.log('EXECUTED AFTER ABORT')"], {
  signal: controller.signal,
});
```

Observed: `exitCode: 0`, output `EXECUTED AFTER ABORT`.

**Impact:** cancelled verification can still launch checks or model jobs, especially stages reached after cancellation. Consumes resources and can run checks with filesystem side effects despite cancellation.

**Fix:** reject/return cancelled result before spawning when signal already aborted; close race between spawn and listener registration; stop subsequent command groups/stages on cancellation. Add pre-aborted and mid-pipeline cancellation tests.

## Recommended order

1. Correct edit prediction and add protected-field regression test.
2. Require verifier rule coverage before auto-acceptance.
3. Reject duplicate contract sections.
4. Validate contract before submission.
5. Propagate cancellation through subprocess pipeline.

Existing green suite does not cover these reproduced edge cases. Findings 1–3 affect central approval/verification guarantees, not cosmetic behavior.
