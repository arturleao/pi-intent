# Decisions: 006-fix-finding-5-from-bug-hunt-report-md-al

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-01T16:07:56Z (human)
- Decision: Contract changed by the human after conflict escalation (applied the agent's proposal).
- Why: Verification sees accumulated changes for all approved units and untracked bug-hunt report because units share Git base. Recommend explicit batch artifact scope allowance.

## 2026-10-01T16:10:35Z (agent)
- Decision: Return explicit cancelled non-success process results and stop pipeline at launch/stage boundaries. Cancellation throws before report generation; submit recovery restores building with attempts unchanged.
- Why: Already-aborted signals must never spawn work; cancellation during checks or agent calls must not look like pass or consume verification attempts. Existing process-tree termination retained.
- Alternatives: Relying only on abort listeners misses pre-aborted signals.; Treating cancellation as ordinary verification failure consumes attempts and can block units unnecessarily.
