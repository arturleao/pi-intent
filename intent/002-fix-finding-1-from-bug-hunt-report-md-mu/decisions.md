# Decisions: 002-fix-finding-1-from-bug-hunt-report-md-mu

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-01T15:32:29Z (agent)
- Decision: Resolve edit offsets against original content, reject invalid matches, apply replacements from right to left; block null predictions for draft unit edits.
- Why: Predictor must match host edit semantics and never authorize protected-field changes based on a different resulting file.
- Alternatives: Sequential matching reproduces bypass.; Allowing unknown predictions leaves protection unenforced.

## 2026-10-01T15:36:33Z (human)
- Decision: Contract changed by the human after conflict escalation (applied the agent's proposal).
- Why: Verifier flagged BUG-HUNT-REPORT.md as out of scope because Git lists pre-existing untracked report as changed since approval. Report was created during requested bug hunt, before all five units, and remains unchanged. Recommend explicitly allowing this baseline artifact rather than deleting report or making an unrelated commit.

## 2026-10-01T15:41:43Z (human)
- Decision: Contract changed by the human after conflict escalation (applied the agent's proposal).
- Why: Verifier cannot prove historical unchanged status of untracked report from Git, so conditional baseline allowance still fails. Recommend unconditional allowance for requested bug-hunt report. No report edits made during implementation.
