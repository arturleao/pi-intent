# Evidence: 011-gate-config-allow-agents-to-edit-iced-co

Agents can tune the ICED config except its integrity keys

Verdict: **PASS** (attempt 2, 2026-10-02T12:31:15Z, independent verifier: no, needs human review)

Verifiers (pi): full [openai-codex/gpt-6-astra, effort medium] (no answer: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached, 13s)

## Builder summary

classifyPath returns kind 'config' for .iced/config.json. gateDecision allows a write/edit when the predicted file parses as JSON and every integrity key is deep-equal to before; it hard-blocks (reason naming the keys) when an integrity key is changed, added or removed, when the result is invalid JSON, or when the edit cannot be predicted. CONFIG_INTEGRITY_KEYS (gate, autonomy, maxAutonomy, autonomyByRisk, verify.model, verify.independent, verify.lenses, verify.maxAttempts, build.testWriterModel) is exported once from iced-core guard.mjs with changedConfigIntegrityKeys(before, after) (null for invalid JSON) and re-exported by gate.mjs. .iced/active, .iced/metrics.jsonl, evidence.md and verify.json stay owned. Shell writes to the config stay blocked two ways: writesProtectedShellTarget on the literal text, and the new shellWritesProtectedPath(root, cwd, command) which resolves operands and redirect targets through cd/pushd/git -C so `cd .iced && echo '{}' > config.json`, `cd .iced; echo x > active`, `cd intent/<id> && rm iced.md` are hard blocks (attempt-1 finding). Both READMEs list the integrity keys and the operational keys. Units 007-010 and 012 are implemented in the same working tree.

## Problems

- Independent verifier unavailable: full: verifier exited 1: MCP: Project servers blocked: github (blocked: project server approval required — approve it in a trusted interactive session or set user-global settings.projectServers to "allow") Codex error: The usage limit has been reached. Result needs human review.

## Expectations

### [E1] Write/edit of `.iced/config.json` that changes only operational keys is allowed; changing, removing or adding any integrity key, or producing invalid JSON, is blocked with a reason naming the key.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '011 E1': operational key changes (verify.commands, timeoutSec, parallel, build.testWriter, memory, new key, reordered) allow for write and edit; changing, removing or adding each of the nine integrity keys blocks (hard) with the key named and a /iced command; invalid JSON and [] block)
- Verifier: Not independently verified.

### [E2] `.iced/active`, `.iced/metrics.jsonl`, `evidence.md` and `verify.json` stay blocked; shell writes to the config stay blocked.

- Result: **claimed**
- Verify: test | packages/pi-intent/test/gate.test.mjs
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (test '011 E2/E3': .iced/active, .iced/metrics.jsonl, evidence.md, verify.json writes block at autonomy 3; literal and directory-relative shell writes (Set-Content, redirect, node/.NET writers, cd .iced && echo > config.json / active / metrics.jsonl, cd intent/<id> && rm iced.md, cd intent && rm -rf <id>, pushd .iced; Set-Content, cd .iced && sed -i) block hard; cd .iced && cat config.json and redirects to /dev/null allow)
- Verifier: Not independently verified.

### [E3] The integrity-key list is exported from one place and documented in README; full suite passes.

- Result: **claimed**
- Verify: check | npm test
- Builder evidence: test: packages/pi-intent/test/gate.test.mjs (same test asserts the exact CONFIG_INTEGRITY_KEYS list from gate.mjs (re-export of @arturleao/iced-core/guard) and that packages/pi-intent/README.md names each key in backticks; packages/iced-core/README.md 'Guarding changes' documents the list too; npm test: 130 pass, 0 fail)
- Verifier: Not independently verified.

## Failure conditions

- [F1] not checked
- [F2] not checked
- [F3] not checked

## Constraints

- [C1] not checked
- [C2] not checked
- [C3] not checked
- [C4] not checked

## Checks

- `npm test`: exit 0, 16.9s

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
