# Decisions: 003-fix-finding-2-from-bug-hunt-report-md-in

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-01T15:48:24Z (human)
- Decision: Contract changed by the human after conflict escalation (applied the agent's proposal).
- Why: All five approved units share working tree and approval base revision. Verification therefore sees bug-hunt report and fixes for sibling findings, even though implementation is tracked separately. Recommend explicit scope allowance for batch artifacts; unit expectations still judged independently.

## 2026-10-01T15:49:58Z (agent)
- Decision: Incomplete or non-boolean rule checks require human review, with per-rule notes. Boolean merge rank is true over false over malformed.
- Why: Allows complete coverage across lenses while preserving every violation; missing checks cannot authorize automatic acceptance.
- Alternatives: Failing all partial reports conflicts with approved human-review policy.; Treating missing values as false reproduces bug.
