# Decisions: 007-gate-shell-heuristic-stop-treating-stder

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:35:00Z (human)
- Decision: Contract changed by the human after change-expectation escalation (applied the agent's proposal).
- Why: Units 007-012 are one approved gate-simplification batch implemented in the same working tree (guard.mjs, gate.mjs, index.ts, tests, docs). The independent verifier for 007 flagged the other units' changes as out of scope. Same situation as units 003-006 last time. Proposal: add a constraint allowing the sibling units' implementations as batch artifacts, each unit still responsible only for its own finding.

## 2026-10-02T11:35:39Z (agent)
- Decision: Strip stderr-only and benign-target redirects before the redirect test; protected-target blocking now uses writesProtectedShellTarget, which matches the protected path only as a redirect target, a file-writing command/API argument, or a cp/mv destination in the same command segment.
- Why: Reading an ICED-owned file never changes it; stderr and temp/null redirects never change the repository. Keeping the heuristic text-based keeps it host-neutral and cheap.
- Alternatives: Resolve every redirect target against the root (too much shell parsing, variables unresolvable); Drop protected-target shell checks entirely (would let shell writes bypass the file-tool gate)

## 2026-10-02T12:12:50Z (agent)
- Decision: After the attempt-3 failure: PowerShell cmdlets count as mutating only in command position (segment start, after a pipe/separator, optional assignment or &), so `grep Set-Content <file>` is a read; command regexes run on text with quoted strings masked, so `git commit -m "Set-Content ..."` is not mutating; a cp/Copy-Item destination may be followed by a discard/temp redirect (`cp a <protected> > /dev/null` still blocks). All three are regression cases in 007 E1/E2, including a live done unit.
- Why: Verifier counterexamples F3, F4 and C3 were real: unanchored cmdlet names, raw quoted text and a strict end-of-segment destination match.
- Alternatives: Tokenizing every segment fully (too much for a heuristic that is not a sandbox); Keeping the unanchored cmdlet regex and whitelisting grep/rg (fragile)
