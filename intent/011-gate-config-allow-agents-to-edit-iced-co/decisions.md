# Decisions: 011-gate-config-allow-agents-to-edit-iced-co

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:35:58Z (agent)
- Decision: classifyPath now returns kind config for .iced/config.json; the gate predicts the content, requires valid JSON, and blocks when any CONFIG_INTEGRITY_KEYS entry (gate, autonomy, maxAutonomy, autonomyByRisk, verify.model, verify.independent, verify.lenses, verify.maxAttempts, build.testWriterModel) differs by stable deep JSON comparison. Shell writes to the config stay blocked.
- Why: Those keys decide trust and verification; everything else is operational and the human regularly asks agents to adjust it. Deep comparison ignores key order and whitespace.
- Alternatives: Whitelist operational keys instead (new keys would be blocked by default); Keep the file owned and add /iced commands for every operational key (more surface, still blocks)
