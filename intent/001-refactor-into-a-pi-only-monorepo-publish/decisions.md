# Decisions: 001-refactor-into-a-pi-only-monorepo-publish

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-01T12:03:19Z (agent)
- Decision: Layout: packages/iced-core/{src,spec,test} and packages/pi-intent/{extensions,src,test,docs}; root is a private npm-workspaces root whose `pi` manifest points at packages/pi-intent so the existing local install keeps loading. Gate split: generic path/shell classification (classifyPath, predictContent, changedProtectedKeys, isMutatingShell) stays in core as guard.mjs; gateDecision with pi tool names and iced_* tool messages moves to pi-intent. Agent execution in core is an injected `agent({root, prompt, role, access, model, effort, timeoutSec, signal})` function; pi-intent supplies the pi subprocess runner mapping access read-only/write to pi tool lists.
- Why: Gate messages and tool names are pi UX, so keeping gateDecision in core would break C1; the classification primitives are host-neutral and reusable. Access levels instead of tool names keep core free of any host's tool vocabulary.
- Alternatives: Whole gate in core with a tool-name map (core would still carry pi-specific wording); Whole gate in pi-intent (loses reusable classification); Change ~/.pi settings to the new package path (forbidden by C6)

## 2026-10-01T12:03:19Z (agent)
- Decision: Config: verify.model / verify.effort become a single value or list. Core keeps reading legacy per-host maps through an optional generic `host` argument (pi-intent passes "pi"); writers always store the plain value. verify.runner and targets are dropped from defaults and ignored when present.
- Why: Satisfies C4/E5 (old configs with {"pi": [...]} still resolve) without core naming any host.
- Alternatives: Rewrite old configs on load (mutates user files silently); Hardcode a 'pi' key in core (breaks C1)

## 2026-10-01T12:19:18Z (agent)
- Decision: package.json repository/homepage/bugs point at github.com/arturleao/pi-intent (the URL the old schema $id used); the schema $id became urn:iced:0.1:frontmatter so the core spec names no host. The core agnostic scan ignores repository/homepage/bugs fields (source location, not an agent reference).
- Why: E7 needs complete metadata and no git remote exists to read the real URL; the old $id is the only URL in the codebase. Change it before publishing if the repo lives elsewhere.
- Alternatives: Omit repository (fails E7); Ask the user now (blocks the build for a cosmetic value)

## 2026-10-01T12:28:45Z (human)
- Decision: Contract changed by the human after change-expectation escalation (applied the agent's proposal).
- Why: E4 says verifiers AND the test writer run "with read-only tools". The verifier read it literally and failed E4. The test writer exists to write tests before the build (build.testWriter), so it needs write/edit; this matches the behavior before the refactor (it had write, edit). Verifiers stay strictly read-only (read, grep, find, ls, shell + the ICED_ROLE=verifier guard blocking write/edit and mutating shell). Proposal: reword E4 so only verifiers are read-only and the test writer may write tests.
