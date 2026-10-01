# Decisions: 005-fix-finding-4-from-bug-hunt-report-md-su

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-01T16:02:15Z (human)
- Decision: Contract changed by the human after conflict escalation (applied the agent's proposal).
- Why: Verification sees accumulated changes for all approved units and untracked bug-hunt report because units share Git base. Recommend explicit batch artifact scope allowance.

## 2026-10-01T16:04:40Z (agent)
- Decision: Validate current unit and existing ancestors at validate stage before any verification effects. Return invalid-contract outcome with unit-qualified errors; extension displays them before accessing report.
- Why: Preserves attempts and valid/missing-evidence paths while making invalid criteria actionable without checks or model calls.
- Alternatives: Late validation wastes verification and can report done.; Requiring approved parents would introduce unapproved parent lifecycle policy.
