# Decisions: 010-gate-unit-file-after-sign-off-allow-edit

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:35:53Z (agent)
- Decision: After sign-off the gate predicts the edit, requires unchanged protected keys, unchanged contractHash (and names the changed section via changedContractSections in core), and a validate-stage lint with no errors. Units blocked before sign-off carry no contract_hash, so only protected keys are frozen for them. Accepted/rejected units are closed.
- Why: The hash is the contract; comparing normalized Intent and Expectations separately gives the agent an exact section name. Lint prevents edits that would leave the unit unloadable (duplicate sections, bad enums).
- Alternatives: Allow only Context and Open questions by section whitelist (misses frontmatter like title, and duplicates the hash check); Keep the full freeze and add a notes file (agents already have decisions.md; the logs show they want the unit itself)
