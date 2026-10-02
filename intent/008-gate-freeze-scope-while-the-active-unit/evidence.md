# Evidence: 008-gate-freeze-scope-while-the-active-unit

The freeze applies only inside the repository

Verdict: **PASS** (attempt 1, 2026-10-02T14:15:09Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 18s)

## Builder summary

shellMutatesOnlyOutside(root, cwd, command) in packages/iced-core/src/guard.mjs, built on mutatingSegments, lets the gate allow mutating shell while the unit is not building (and under always mode without an active unit) only when every effective working directory and every operand resolves outside the ICED root. It tracks cd/Set-Location/pushd/popd (quoted dirs with spaces), git -C, subshell scopes, 'cd X || exit' versus 'cd X || <cmd>' (pre-cd dir, or fail closed), pipes (a cd next to | is ignored), --flag=value operands, sed/perl -i file operands (script args dropped) and WSL /mnt/<drive>/ paths. It fails closed on variables, globs, bare cd, unresolvable dirs and any inside or relative target. Fixed since attempt 3: sed -i on outside files from the root; '||' and '|' no longer leak the cd directory; 'cd ../missing || rm .iced/active' is blocked by shellWritesProtectedPath. Shared files also carry the other approved gate units' changes; this unit covers freeze scope only.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] While the active unit is draft, done or blocked, mutating commands operating only outside the root (absolute paths, `cd`/`Set-Location`/`pushd` prefixes, `git -C`) are allowed; the same commands inside the root or with relative targets are blocked as today.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '008 E1/E2' ok list: absolute outside paths, cd/Set-Location/pushd prefixes incl. quoted dirs with spaces, git -C <outside> checkout/restore, subshells, cp --target-directory=<outside>, sed -i / perl -pi on outside files, 'cd <outside> || exit 1; ...', other checkout's .iced/active; allowed for draft, done and blocked; inside equivalents blocked
- Verifier: Not independently verified.

### [E2] Mixed commands (outside then inside, or `cd` back into the root) and unresolvable targets stay blocked.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '008 E1/E2' bad list: rm outside + local.txt, $TARGET, cd back into root (quoted), bare 'cd && rm x', subshell cd then inside rm, cp --target-directory=. / -t ., 'cd <outside> || rm src/a.ts', 'cd ../missing || rm .iced/active', 'cd <outside> | rm src/a.ts', mixed sed -i operands; all blocked
- Verifier: Not independently verified.

### [E3] `always` mode without an active unit allows outside-only mutations and blocks inside ones; full suite passes.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: check: packages/pi-intent/test/gate.test.mjs '008 E3' (always mode without active unit: outside-only allowed, inside blocked); npm test 130 tests (80 iced-core, 50 pi-intent), 0 fail; git diff --check clean
- Verifier: Not independently verified.

## Failure conditions

- [F1] not checked
- [F2] not checked
- [F3] not checked

## Constraints

- [C1] not checked
- [C2] not checked
- [C3] not checked

## Checks

- `npm test`: exit 0, 20.2s

## Files changed since approval

- packages/iced-core/README.md
- packages/iced-core/spec/SPEC.md
- packages/iced-core/src/core.mjs
- packages/iced-core/src/guard.mjs
- packages/pi-intent/README.md
- packages/pi-intent/docs/design.md
- packages/pi-intent/extensions/iced/index.ts
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/test/gate.test.mjs
