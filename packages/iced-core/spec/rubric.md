# ICED conformance rubric (v0.1)

Used by `/iced review`, the independent verifier, and humans reviewing a unit. Each check is
**MUST** (fail blocks sign-off or acceptance) or **SHOULD** (report as a finding).

## A. Intent

| # | Level | Check |
|---|---|---|
| A1 | MUST | Goal states an outcome for users or the business, not a solution or technology. |
| A2 | MUST | Constraints are limits that hold regardless of approach. A sentence that picks a tool, pattern or design is Context, not a Constraint. |
| A3 | MUST | At least one failure condition (except `review` units), each observable and testable. |
| A4 | SHOULD | Scope lists what is out, not only what is in. |
| A5 | SHOULD | Goal, constraints and failure conditions are kept separate (no mixing in one line). |

## B. Context

| # | Level | Check |
|---|---|---|
| B1 | MUST | Every context line has a source tag: `code`, `product`, `knowledge`, `parent`, `assumed`. |
| B2 | MUST | Model inference is tagged `[assumed]` and was shown to the human at sign-off. |
| B3 | SHOULD | Code was consulted before product memory, before knowledge, before assumptions. |
| B4 | SHOULD | Questions asked were only those context could not answer, and were high risk. |

## C. Expectations

| # | Level | Check |
|---|---|---|
| C1 | MUST | Every expectation names a verification (`test`, `check`, `metric`, `manual`) and reference. |
| C2 | MUST | Expectations are derivable from the Intent and Context (no invented requirements). |
| C3 | MUST | Expectations were approved by a human (or auto-approved under autonomy 3, low risk). |
| C4 | MUST | Intent and Expectations did not change after approval (`contract_hash` matches). |
| C5 | SHOULD | Every failure condition is covered by an expectation or a negative test. |
| C6 | SHOULD | Expectations are stated in user or business terms, not implementation steps. |

## D. Done

| # | Level | Check |
|---|---|---|
| D1 | MUST | Each expectation has evidence that actually demonstrates it (test output, command result, measurement). Claims without proof are `unknown`. |
| D2 | MUST | No failure condition is triggered. |
| D3 | MUST | No constraint is violated, including every ancestor unit's constraints (cascade). |
| D4 | MUST | Changes stay within Scope; out-of-scope changes are findings. |
| D5 | SHOULD | Significant decisions are logged in `decisions.md` with reasons and rejected alternatives. |
| D6 | SHOULD | Tests for expectations exist and would fail without the change. |

## E. Layers

| # | Level | Check |
|---|---|---|
| E1 | MUST | A child unit's `parent` exists and the parent's constraints/failure conditions are respected. |
| E2 | SHOULD | A project's expectations are satisfied by its accepted children plus end-to-end checks. |

## Verdict

- **pass**: every MUST holds.
- **fail**: any MUST fails. Report the check id, the evidence, and the smallest fix.
- Report SHOULD findings separately; they do not fail the verdict.
