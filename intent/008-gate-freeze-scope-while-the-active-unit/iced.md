---
iced: 0.1
id: 008-gate-freeze-scope-while-the-active-unit
title: The freeze applies only inside the repository
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: low
attempts: 1
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T10:46:40Z
approved_by: Artur Leao
contract_hash: 417f4522a03d5641d433b46cfb3cc6dc5e05c1848976dd77469b4ca0c7cfdba8
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
blocked_from: null
accepted_at: 2026-10-02T14:15:22Z
accepted_by: Artur Leao
---

# The freeze applies only inside the repository

<!-- Request: Gate freeze scope: while the active unit is not building, block mutating shell commands only when they target paths inside the ICED root, not sibling worktrees, temp dirs or other repos -->

## Intent

### Goal
While the active unit is not building, agents can still change files outside this repository (sibling worktrees, temp directories, other repositories); only changes inside the repository are frozen.

### Constraints
- [C1] Mutating commands whose targets are inside the ICED root, or whose targets cannot be determined, stay frozen exactly as today.
- [C2] Protection of ICED-owned files and the `always` mode behave as today for paths inside the root.
- [C3] Classification stays a host-neutral heuristic in iced-core guard: no command execution, no sandbox.

### Failure conditions
- [F1] A mutating command that works only in a sibling directory, a temp directory or another repository (via absolute path, `cd <outside>` prefix, or `-C <outside>` for git) is blocked because the active unit is not building.
- [F2] A mutating command with a relative target, no target, or a target inside the root is allowed while the active unit is not building (regression).
- [F3] A command that `cd`s outside and then back inside the root, or chains an inside target after an outside one, is treated as outside.

### Scope
- In: target resolution for shell commands in guard/gate, its use in the not-building and `always` branches; regression tests; README wording.
- Out: redirect and read/write classification fixes (unit 007), autonomy-based notify policy (unit 009), write/edit tool paths (already classified by `classifyPath`).

## Context
- [code] gate.mjs shell branch: `if (!mutating || (!active && !always)) return allow;` then blocks whenever `!building`, with no look at where the command operates.
- [code] `classifyPath` already returns `outside` for write/edit tool paths beyond the root, so the write/edit tools are not frozen outside; shell is the inconsistency.
- [code] Session logs of a downstream project show about 33 blocks of `npm ci`, `sed -i` and similar in sibling worktrees (`<repo>-NNN`) while the active unit in the main checkout was draft or done; the largest single cause of stalled agents.
- [code] Reproduced here: `git pull --ff-only origin dev` was blocked while unit 012 was draft; that one is inside the root and stays frozen under this unit (policy change belongs to unit 009).
- [assumed] Target resolution: leading `cd <path>` / `Set-Location <path>` / `pushd <path>` segments and `git -C <path>` set the working directory for following segments; absolute paths in arguments are resolved against the root; WSL-style `/mnt/<drive>/` paths map to `<drive>:/` on Windows. Anything unresolvable counts as inside (fail closed).
- [assumed] A command is "outside" only when every resolvable target and every effective working directory is outside the root.

## Expectations
- [E1] While the active unit is draft, done or blocked, mutating commands operating only outside the root (absolute paths, `cd`/`Set-Location`/`pushd` prefixes, `git -C`) are allowed; the same commands inside the root or with relative targets are blocked as today. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] Mixed commands (outside then inside, or `cd` back into the root) and unresolvable targets stay blocked. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] `always` mode without an active unit allows outside-only mutations and blocks inside ones; full suite passes. {verify: check | npm test}

## Open questions
