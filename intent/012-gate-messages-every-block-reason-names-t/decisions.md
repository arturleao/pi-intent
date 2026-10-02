# Decisions: 012-gate-messages-every-block-reason-names-t

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:36:02Z (agent)
- Decision: Every block reason ends with a 'Next step:' sentence built by nextStep(id, status) or a fixed START string; a test enumerates 40+ block paths and asserts the pattern, a 330-char ceiling and no absolute paths.
- Why: One shared helper keeps wording consistent and makes the test exhaustive over statuses; a regex over the reason is cheap and catches regressions when new blocks are added.
- Alternatives: Structured { reason, nextStep } fields (would change the extension contract and the pi block API only takes a string)
