# Evidence: 007-gate-shell-heuristic-stop-treating-stder

Read-only shell commands pass the gate

Verdict: **PASS** (attempt 1, 2026-10-02T12:53:50Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 12s)

## Builder summary

Shell heuristic in packages/iced-core/src/guard.mjs: stderr-only, 2>&1, discard ($null, /dev/null, NUL ending the token) and temp-dir redirects are not mutating, and redirect parsing is quote-aware. Command patterns run on quote-masked text, and PowerShell cmdlets count only in command position, so commit messages and grep patterns that name writer commands are reads. Protected-target detection (writesProtectedShellTarget plus shellWritesProtectedPath) fires only when a writer in the same segment targets an owned path: a redirect, Set-Content/Add-Content/Out-File, sed -i, WriteAllText, a cp/mv/Copy-Item destination, rm/mv of a protected file or unit directory (quoted or not), or git diff > path. Pure reads of owned paths pass. All findings from the last attempt are fixed and covered: anchored cmdlets (grep Set-Content <path>), cp <protected> followed by a trailing redirect, and masked commit messages under a live frozen unit. Per C4, changes in the same files for units 008-012 are batch artifacts.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] Commands whose only redirects are stderr-only, `2>&1`, `$null`/`/dev/null`, or temp-dir targets are not mutating; redirects to other repository paths still are.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '007 E1' (stderr, 2>&1, $null, /dev/null, NUL, temp-dir, quoted-redirect lists are non-mutating; NUL.txt, tmp/a.txt, repo-path redirects and inline scripts are mutating; quoted command names in messages and patterns are not mutating)
- Verifier: Not independently verified.

### [E2] Commands that only read an ICED-owned path (Get-Content, cat, type, grep, rg, Select-String, git diff/show/stash naming the path) are allowed; commands that write to such a path (redirect, Set-Content/Add-Content/Out-File, sed -i, WriteAllText, cp/mv/Copy-Item/Move-Item destination) are still blocked.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs '007 E2' (Get-Content, cat, type, grep, rg, Select-String, git diff/show/stash/log naming owned paths allowed, including grep with a writer name as argument and live done-unit cases; redirects, Set-Content/Add-Content/Out-File, sed -i, WriteAllText, cp/mv/Copy-Item/Move-Item destinations, cp with trailing redirect, git diff > path, rm/mv of quoted and unquoted unit folders blocked)
- Verifier: Not independently verified.

### [E3] Existing mutating-command cases keep their classification and the full suite passes.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: check: npm test: 130 tests (80 iced-core, 50 pi-intent), 0 fail; git diff --check clean
- Verifier: Not independently verified.

## Failure conditions

- [F1] not checked
- [F2] not checked
- [F3] not checked
- [F4] not checked

## Constraints

- [C1] not checked
- [C2] not checked
- [C3] not checked
- [C4] not checked

## Checks

- `npm test`: exit 0, 19.0s

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
