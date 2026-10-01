---
iced: 0.1
id: 001-refactor-into-a-pi-only-monorepo-publish
title: Pi-only ICED as two npm packages (agnostic core + pi extension)
type: feature
tier: L
parent: null
status: building
autonomy: 1
risk: medium
attempts: 1
created: 2026-10-01T11:59:25Z
approved_at: 2026-10-01T12:28:44Z
approved_by: Artur Leao
contract_hash: 063401c16a0b264deffd3d60b42fb53eb957da6fbf54b677bced2916cc3dbd2a
base_ref: 4d53c01397587e4c6c3023b508b93d74d9128c3e
blocked_from: null
accepted_at: null
accepted_by: null
---

# Pi-only ICED as two npm packages (agnostic core + pi extension)

<!-- Request: Refactor into a pi-only monorepo published to npm: packages/iced-core (@arturleao/iced-core, harness-agnostic pure Node library: units, contract, lint, config, verification orchestration with injected agent runner, no pi and no other agent CLIs) and packages/pi-intent (@arturleao/pi-intent, the pi extension, depends on core). Remove every other harness (Claude Code, Codex, Cursor, Copilot, Gemini, AGENTS.md/CLAUDE.md blocks, verifier agent files, non-pi runners, --prepare/--finish subagent flow). Drop the standalone CLI (bin/iced.mjs, vendored .iced/bin and .iced/lib) and the GitHub Action. Both packages ready for npm publish. -->
<!-- Human owns Intent and Expectations. Agent drafts; human signs off. Agent owns the how. -->

## Intent

### Goal
ICED is a pi-only product that pi users install from npm in one step, built on a reusable ICED core library that
knows nothing about any coding agent, so the core can later serve other hosts without carrying their code today.

### Constraints
- [C1] The core package does not import, spawn or mention any coding agent (pi included): starting a verifier or test writer agent is a function the host passes in.
- [C2] Nothing in the published packages or the repo targets Claude Code, Codex, Cursor, Copilot or Gemini (no runners, agent files, context-file blocks, skills copies or instructions for them).
- [C3] No standalone CLI, no vendored copies in user repos (.iced/bin, .iced/lib) and no GitHub Action.
- [C4] Repos already using ICED keep working: existing units, statuses and contract hashes stay valid, and an existing .iced/config.json (including per-runner verify.model/effort maps and targets) still loads.
- [C5] pi host packages (@earendil-works/pi-coding-agent, pi-tui, typebox) are peerDependencies "*", never dependencies; Node >= 20, ESM.
- [C6] Nothing is published to npm and the user's pi settings are not changed by this unit.

### Failure conditions
- [F1] A unit approved before the refactor fails lint or reports contract tampering afterwards.
- [F2] pi, still installed from a local checkout, no longer loads the extension (iced_* tools or /iced missing) after /reload.
- [F3] A packed tarball lacks a runtime file (templates, rubric, extension sources) or ships tests, intent/ or .iced/.
- [F4] A verifier agent gets write or edit tools.
- [F5] /iced init in a fresh repo still creates AGENTS.md, CLAUDE.md, .claude/, .codex/, .agents/, .cursor/, .iced/bin or .iced/lib.

### Scope
- In: npm workspaces monorepo (packages/iced-core, packages/pi-intent); moving and splitting lib/, extensions/, spec/, tests; pi verifier/test-writer runner in pi-intent; simplified config (single verifier model list); init writing only ICED's own files; removal of bin/, action.yml, other-harness code, files and docs; package READMEs and publish metadata; removing this repo's own generated harness files.
- Out: running npm publish; a CI workflow; new ICED features or protocol changes beyond dropping harness and CLI mentions; cleaning other harness files out of existing user repos.

## Context
- [code] Only extensions/iced/index.ts imports pi (@earendil-works/pi-coding-agent, pi-tui, typebox); lib/*.mjs and bin/iced.mjs are plain Node.
- [code] lib/iced-verify.mjs holds RUNNERS for pi/claude/codex/cursor/gemini, resolveRunner, piInvocation, runAgent, verifierAgentFiles, refreshVerifierAgents and the prepareSplit/finishSplit subagent flow; verifyUnit already accepts runVerifierImpl, a seam for injection.
- [code] lib/iced-init.mjs TARGETS = agents, claude, codex, skills, cursor, copilot, gemini; initRepo vendors bin/iced.mjs, iced-core.mjs, iced-verify.mjs and rubric.md into .iced/.
- [code] lib/iced-core.mjs verifyModels/verifyEffort/setVerifyModels support per-runner maps; defaultConfig has verify.runner and targets.
- [code] lib/iced-picker.mjs is TUI picker state used only by the extension; lib/iced-gate.mjs decides on pi tool names (write, edit, bash/powershell).
- [code] Templates are read from <package>/spec/templates and .iced/templates; rubric from spec/rubric.md or skills/iced/references/rubric.md (PACKAGE_ROOT-relative).
- [code] The extension injects its own system prompt section (before_agent_start) telling the agent it does not need the iced skill, .iced/ICED.md or the CLI.
- [code] npm test runs 87 node:test tests, all passing at baseline commit 4d53c01.
- [code] This repo had no git until 4d53c01; /iced init here created AGENTS.md, CLAUDE.md, .claude/, .codex/, .agents/, .iced/bin, .iced/lib.
- [knowledge] pi packages (pi docs packages.md): `pi` manifest keys extensions/skills; host packages as peerDependencies "*"; local path installs are loaded in place and never npm-installed; `pi-package` keyword lists it in the gallery.
- [knowledge] pi settings install this package from a local checkout path.
- [knowledge] npm: `pi-intent` unscoped is free, `iced` is taken; user's npm scope is @arturleao.
- [assumed] Package names @arturleao/iced-core and @arturleao/pi-intent, both version 0.1.0, publishConfig access public.
- [assumed] The repo root stays a private workspace root with a `pi` manifest pointing at packages/pi-intent, so the existing local install keeps working.
- [assumed] The iced skill and .iced/ICED.md are dropped: in pi the extension's tools and system prompt carry the protocol; spec/ (SPEC.md, rubric, templates, schema, examples) moves to iced-core.
- [assumed] TUI picker moves to pi-intent; gate policy stays in core but is expressed on generic operations (write, edit, shell) with the pi tool-name mapping in pi-intent.
- [assumed] /iced init does not delete files left by older versions in user repos; the README says what can be removed.

## Expectations
- [E1] The core package has no reference to pi or any other agent (no host imports, no agent CLI names or spawns) and runs verification end to end with an injected fake agent. {verify: test | packages/iced-core/test (agnostic source scan + verifyUnit with injected runner)}
- [E2] No file in the repo or packed tarballs targets Claude Code, Codex, Cursor, Copilot or Gemini, and bin/, action.yml, the CLI and the --prepare/--finish flow are gone. {verify: test | packages/*/test harness scan + check: git ls-files}
- [E3] /iced init in an empty git repo creates only .iced/config.json, .iced/memory/, .iced/templates/, intent/README.md and the .gitignore/.gitattributes lines; re-running it is safe. {verify: test | packages/pi-intent or iced-core init test}
- [E4] In pi, verifiers run as pi subprocesses with read-only tools, and the test writer runs as a pi subprocess allowed to write tests; both use the configured models and effort. {verify: test | packages/pi-intent/test/runner.test.mjs (pi runner args)}
- [E5] Existing ICED repos keep working: spec examples and previously approved units lint clean with unchanged contract hashes, and old configs (per-runner model maps, runner, targets) load with the pi entries applied. {verify: test | packages/iced-core/test (compat)}
- [E6] Every existing behavior still covered by the current test suite (lint, hashing, transitions, proposals, gate, models, picker, verification) passes after the move. {verify: check | npm test}
- [E7] Both packages are publish-ready: `npm pack --dry-run` lists only intended files, metadata is complete (name, version, license, repository, exports/files, publishConfig), pi-intent depends on @arturleao/iced-core and declares pi packages as peers. {verify: check | npm pack --dry-run -w packages/iced-core -w packages/pi-intent}
- [E8] pi installed from a local checkout loads the extension after /reload: /iced status and the iced_* tools work. {verify: manual | /reload in pi, run /iced status}
- [E9] READMEs and docs describe only pi (install via `pi install npm:@arturleao/pi-intent`) and the core library API, with no other harness or CLI instructions. {verify: check | grep docs and READMEs for claude|codex|cursor|copilot|gemini|iced.mjs}

## Open questions
