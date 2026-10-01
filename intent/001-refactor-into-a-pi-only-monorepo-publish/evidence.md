# Evidence: 001-refactor-into-a-pi-only-monorepo-publish

Pi-only ICED as two npm packages (agnostic core + pi extension)

Verdict: **FAIL** (attempt 3, 2026-10-01T12:39:12Z, independent verifier: yes, needs human review)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 98s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 57s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 114s)

## Builder summary

Attempt 3. Fixed the attempt-2 E4 finding (verifier shell could write via WriteAllBytes, Set-Item, node --eval). (1) core guard isMutatingShell now covers .NET File/Directory write APIs and StreamWriter, Set-Item/ItemProperty/archives/Export-*, downloads with -OutFile/-o, and inline node/bun/deno, python, ruby, perl file operations. (2) New verifierShellDecision in pi-intent src/gate.mjs, used by the extension's ICED_ROLE=verifier handler: besides the write heuristic it blocks ALL inline code (node -e/--eval/-p/--import, python -c, perl/ruby/php -e, pwsh/powershell -Command/-EncodedCommand/-File, bash/sh/cmd -c or /c, Invoke-Expression/iex, Start-Process, Add-Type, .NET static calls, New-Object IO/WebClient, eval), so obfuscated writes cannot get through; running tests, builds, linters, git reads and repo scripts stays allowed. Live check: pi with ICED_ROLE=verifier and --tools read,grep,find,ls,powershell blocked `node -e "require('fs').writeFileSync(...)"` (no file created) and ran npm --version. Earlier fixes kept: intent/README.md cleaned, repo config without targets/runner, E4 reworded by the human.

## Problems

- [E4] failed: Runner tests pass model, effort and tool arguments. Read-only enforcement fails: directly evaluated verifierShellDecision('ni probe.txt') and verifierShellDecision('git -C . clean -fd'); both return allow. Get-Alias ni confirms New-Item. Extension index.ts:475-483 permits these decisions. Commands were evaluated as strings only; no destructive commands executed. | runner.test and gate.test pass (33/33). Verifier tools are read,grep,find,ls,shell with no write/edit; the shell gate blocked my own inline node -e. Reading the rules shows the deny-list leaves gaps (ni/sc/ac aliases, find -delete, tar x, dd of=, sort -o, npx/npm exec, repo scripts that write), so shell read-only is heuristic. | runner.mjs grants read-only verifiers powershell. gate.mjs uses deny-list only. PowerShell alias ri is Remove-Item (confirmed by Get-Alias ri) and command `ri <path>` matches neither mutating nor inline-code patterns, so verifier can delete files.
- Failure condition [F4] triggered: Verifier tool list excludes literal write/edit tools. Shell still permits mutation, reported separately under E4. | The verifier gets no write/edit tools. Shell can still write through deny-list gaps (see E4 evidence); noted as a risk. | Verifier receives powershell, capable of writes. `ri` aliases Remove-Item and bypasses shell deny-list.

## Expectations

### [E1] The core package has no reference to pi or any other agent (no host imports, no agent CLI names or spawns) and runs verification end to end with an injected fake agent.

- Result: **pass**
- Verify: test | packages/iced-core/test (agnostic source scan + verifyUnit with injected runner)
- Builder evidence: test: packages/iced-core/test/agnostic.test.mjs + verify-parallel.test.mjs + models.test.mjs (injected fake agent end to end)
- Verifier: npm test passed core source/import scans and injected-runner verification tests. | Grep of iced-core src/package.json/README finds no pi/claude/codex/cursor/gemini/copilot except 'pi-intent' in repo URLs. agnostic.test and verify tests pass in npm test (67/67). | Ran npm test: iced-core 67/67 passed, including agnostic source scan and injected verification tests.

### [E2] No file in the repo or packed tarballs targets Claude Code, Codex, Cursor, Copilot or Gemini, and bin/, action.yml, the CLI and the --prepare/--finish flow are gone.

- Result: **pass**
- Verify: test | packages/*/test harness scan + check: git ls-files
- Builder evidence: test: packages/pi-intent/test/harness.test.mjs (tracked-file scan incl. intent/README.md; removed paths absent; repo config without targets/runner; no bin)
- Verifier: Harness scans passed; independently inspected git ls-files. Removed CLI, harness directories, action and split-flow implementation absent. | git ls-files has no bin, action.yml, AGENTS/CLAUDE, .claude/.codex/.agents/.cursor, skills. git grep for harness names hits only TUI 'cursor' variables, a model name in config, unit files and scan tests. harness.test passes. | Ran harness tests. git ls-files has no removed bin/action/skills/lib/harness paths. Source/docs grep outside unit records and tests found only picker state.cursor matches.

### [E3] /iced init in an empty git repo creates only .iced/config.json, .iced/memory/, .iced/templates/, intent/README.md and the .gitignore/.gitattributes lines; re-running it is safe.

- Result: **pass**
- Verify: test | packages/pi-intent or iced-core init test
- Builder evidence: test: packages/iced-core/test/init.test.mjs
- Verifier: Init tests passed exact fresh-repo file inventory, repeat initialization, preservation and forbidden-path checks. | packages/iced-core/test/init.test.mjs passes within npm test; I did not run init by hand. | npm test passed iced-core init empty-repo, idempotence, and legacy-file preservation tests.

### [E4] In pi, verifiers run as pi subprocesses with read-only tools, and the test writer runs as a pi subprocess allowed to write tests; both use the configured models and effort.

- Result: **fail**
- Verify: test | packages/pi-intent/test/runner.test.mjs (pi runner args)
- Builder evidence: test: packages/pi-intent/test/runner.test.mjs (verifier tools read,grep,find,ls,shell; test writer adds write,edit; --model/--thinking; ICED_ROLE) + packages/pi-intent/test/gate.test.mjs 'verifier shell: no file changes and no inline code...' (WriteAllBytes, Set-Item, node --eval/-e/-p/--import incl. obfuscated require, python -c, pwsh -Command/-EncodedCommand, bash -c, cmd /c, iex, Start-Process, .NET static calls blocked; npm test, node --test, git diff/log, pytest, node scripts/x.mjs allowed) and 'the extension's verifier role uses the verifier shell rule and blocks write/edit' (Live: ICED_ROLE=verifier pi -p --tools 'read,grep,find,ls,powershell' got 'The ICED verifier is read-only' for node -e writeFileSync, probe.txt not created; npm --version ran. Shell rule remains a deny-list heuristic, documented as such.)
- Verifier: Runner tests pass model, effort and tool arguments. Read-only enforcement fails: directly evaluated verifierShellDecision('ni probe.txt') and verifierShellDecision('git -C . clean -fd'); both return allow. Get-Alias ni confirms New-Item. Extension index.ts:475-483 permits these decisions. Commands were evaluated as strings only; no destructive commands executed. | runner.test and gate.test pass (33/33). Verifier tools are read,grep,find,ls,shell with no write/edit; the shell gate blocked my own inline node -e. Reading the rules shows the deny-list leaves gaps (ni/sc/ac aliases, find -delete, tar x, dd of=, sort -o, npx/npm exec, repo scripts that write), so shell read-only is heuristic. | runner.mjs grants read-only verifiers powershell. gate.mjs uses deny-list only. PowerShell alias ri is Remove-Item (confirmed by Get-Alias ri) and command `ri <path>` matches neither mutating nor inline-code patterns, so verifier can delete files.

### [E5] Existing ICED repos keep working: spec examples and previously approved units lint clean with unchanged contract hashes, and old configs (per-runner model maps, runner, targets) load with the pi entries applied.

- Result: **pass**
- Verify: test | packages/iced-core/test (compat)
- Builder evidence: test: packages/iced-core/test/compat.test.mjs (golden hash from 4d53c01), core.test.mjs spec examples, runner.test.mjs [E5] legacy pi map
- Verifier: Compatibility tests passed golden contract hash, approved-unit lint/accept, spec examples and legacy pi model/effort maps. | compat.test, core.test and runner.test [E5] pass in npm test. Existing unit 001 hash unchanged. | npm test passed 67 iced-core tests, including golden pre-split hash, approved-unit lint/accept, legacy config, and spec examples.

### [E6] Every existing behavior still covered by the current test suite (lint, hashing, transitions, proposals, gate, models, picker, verification) passes after the move.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test: iced-core 67/67, pi-intent 33/33
- Verifier: Independently ran npm test: core 67/67, extension 33/33. | npm test: iced-core 67/67, pi-intent 33/33, 0 failures. | Ran npm test successfully: iced-core 67/67; pi-intent 33/33.

### [E7] Both packages are publish-ready: `npm pack --dry-run` lists only intended files, metadata is complete (name, version, license, repository, exports/files, publishConfig), pi-intent depends on @arturleao/iced-core and declares pi packages as peers.

- Result: **pass**
- Verify: check | npm pack --dry-run -w packages/iced-core -w packages/pi-intent
- Builder evidence: test: packages/pi-intent/test/package.test.mjs (npm pack --dry-run --json for both packages, metadata, deps/peers, imports packed or declared)
- Verifier: Independently ran npm pack --dry-run for both workspaces: core 22 files, extension 9 files. Runtime assets present; excluded tests and repo state. Manifest inspection and package tests confirm metadata, dependencies and peers. | npm pack --dry-run: iced-core 22 files, pi-intent 9 files, no tests/intent/.iced. package.json metadata complete; pi-intent depends on @arturleao/iced-core and lists pi, pi-tui and typebox as peers '*'; publishConfig public; package.test passes. | Ran npm pack --dry-run --json for both workspaces. Core contains src/spec/templates/rubric; pi package contains extension/src/docs; neither contains tests, intent, or .iced. Metadata and peer/dependency declarations inspected.

### [E8] pi installed from a local checkout loads the extension after /reload: /iced status and the iced_* tools work.

- Result: **unknown**
- Verify: manual | /reload in pi, run /iced status
- Builder evidence: manual: Human ran /reload in pi installed from a local checkout; this session's new gate then allowed deleting .iced/bin and .iced/lib; fresh pi -p listed all 8 iced_* tools; ICED_ROLE=verifier child loaded the new verifier rule from the installed path. (Human confirms /iced status in their session.)
- Verifier: Root manifest test passes local extension path. Did not independently exercise interactive /reload, /iced status or iced_* tools. | Manual: needs a human /reload and /iced status in pi. Root package.json pi manifest points to packages/pi-intent/extensions/iced/index.ts, which exists. | Requires independent human /reload and /iced status in installed pi session. Not performed here.

### [E9] READMEs and docs describe only pi (install via `pi install npm:@arturleao/pi-intent`) and the core library API, with no other harness or CLI instructions.

- Result: **pass**
- Verify: check | grep docs and READMEs for claude|codex|cursor|copilot|gemini|iced.mjs
- Builder evidence: check: README.md, packages/*/README.md, packages/pi-intent/docs/*.md, intent/README.md scanned by harness.test.mjs; install documented as pi install npm:@arturleao/pi-intent
- Verifier: Independent git grep found no forbidden harness/CLI terms in READMEs and extension docs. Root and extension READMEs contain required npm installation command. | git grep for claude|codex|cursor|copilot|gemini|iced.mjs finds no README or docs hits; harness.test scans the READMEs and docs. | Inspected root and package READMEs; pi install command documented. Targeted grep outside historical unit records/tests found no removed-harness or iced.mjs instructions.

## Failure conditions

- [F1] not triggered: Golden-hash, approved-unit lint and spec-example tests passed. | compat golden-hash and spec example tests pass. | Compatibility tests passed golden hash and approved-unit lint/accept.
- [F2] not triggered: Not demonstrated; interactive reload remains unverified. | Root pi manifest and extension path are valid; not live-tested by me. | Unknown independently; manual reload check not performed.
- [F3] not triggered: Both dry-run inventories and packed-import checks passed. | Pack lists templates, rubric and the extension .ts; no tests, intent or .iced. | Dry-run pack lists required runtime files and excludes tests, intent, and .iced.
- [F4] **TRIGGERED**: Verifier tool list excludes literal write/edit tools. Shell still permits mutation, reported separately under E4. | The verifier gets no write/edit tools. Shell can still write through deny-list gaps (see E4 evidence); noted as a risk. | Verifier receives powershell, capable of writes. `ri` aliases Remove-Item and bypasses shell deny-list.
- [F5] not triggered: Fresh-init inventory and forbidden-directory tests passed. | init.test passes and checks the created files. | Empty-repo init test passed and checks all prohibited legacy paths absent.

## Constraints

- [C1] respected: Core host-reference/import scans and injected-agent tests passed. | Core source has no agent imports or mentions; only the repo URL contains 'pi-intent'. | Core agnostic scan and dependency/import test passed.
- [C2] respected: Harness scan and tracked-file inspection found no remaining harness integrations; historical unit records describe removal. | No other-harness files tracked; grep clean. | Harness scan passed; tracked product files contain no other-harness targeting.
- [C3] respected: Removed-path and no-bin tests passed; tracked inventory contains no standalone CLI or action. | No bin/, action.yml or vendored .iced/bin or .iced/lib tracked. | Removed-path, no-CLI, and init tests passed.
- [C4] respected: Hash, status, lint and legacy-config compatibility tests passed. | compat tests pass, including legacy config loading. | Compatibility tests passed existing hash, lint, status flow, and legacy config loading.
- [C5] respected: Both manifests declare ESM and Node >=20. Extension host packages are peers '*', not dependencies. | Peers are '*', Node >=20 and ESM are declared, and iced-core is the only dependency. | Package manifests inspected: Node >=20, ESM; pi host packages peers '*' only.
- [C6] respected: Executed tests and dry-run packing only; no publication or settings changes performed. Earlier external actions unknown. | No publish evidence; the git working tree is clean except the unit's iced.md. | No publish command run; changed tracked files do not include pi user settings.

## Checks

- `npm test`: exit 0, 9.8s

## Files changed since approval

- .gitattributes
- .gitignore
- .npmrc
- README.md
- action.yml
- bin/iced.mjs
- lib/iced-gate.mjs
- lib/iced-init.mjs
- package-lock.json
- package.json
- packages/iced-core/LICENSE
- packages/iced-core/README.md
- packages/iced-core/package.json
- packages/iced-core/spec/SPEC.md
- packages/iced-core/spec/examples/001-login-timeout/decisions.md
- packages/iced-core/spec/examples/001-login-timeout/evidence.md
- packages/iced-core/spec/examples/001-login-timeout/iced.md
- packages/iced-core/spec/examples/002-billing-portal/iced.md
- packages/iced-core/spec/examples/003-invoice-download/decisions.md
- packages/iced-core/spec/examples/003-invoice-download/iced.md
- packages/iced-core/spec/iced.schema.json
- packages/iced-core/spec/rubric.md
- packages/iced-core/spec/templates/bug.md
- packages/iced-core/spec/templates/chore.md
- packages/iced-core/spec/templates/feature.md
- packages/iced-core/spec/templates/project.md
- packages/iced-core/spec/templates/review.md
- packages/iced-core/src/core.mjs
- packages/iced-core/src/guard.mjs
- packages/iced-core/src/index.mjs
- packages/iced-core/src/init.mjs
- packages/iced-core/src/verify.mjs
- packages/iced-core/test/agnostic.test.mjs
- packages/iced-core/test/compat.test.mjs
- packages/iced-core/test/core.test.mjs
- packages/iced-core/test/fixtures/fake-verifier.mjs
- packages/iced-core/test/helpers.mjs
- packages/iced-core/test/init.test.mjs
- packages/iced-core/test/models.test.mjs
- packages/iced-core/test/paths.test.mjs
- packages/iced-core/test/proposal.test.mjs
- packages/iced-core/test/validate-examples.mjs
- packages/iced-core/test/verify-parallel.test.mjs
- packages/iced-core/test/verify.test.mjs
- packages/pi-intent/LICENSE
- packages/pi-intent/README.md
- packages/pi-intent/docs/design.md
- packages/pi-intent/docs/usage-examples.md
- packages/pi-intent/extensions/iced/index.ts
- packages/pi-intent/package.json
- packages/pi-intent/src/gate.mjs
- packages/pi-intent/src/picker.mjs
- packages/pi-intent/src/runner.mjs
- packages/pi-intent/test/gate.test.mjs
- packages/pi-intent/test/harness.test.mjs
- packages/pi-intent/test/package.test.mjs
- packages/pi-intent/test/picker.test.mjs
- packages/pi-intent/test/runner.test.mjs
- skills/iced/SKILL.md
- skills/iced/references/protocol.md
- spec/rubric.md
- test/init.test.mjs
- test/models.test.mjs

## Verifier notes

[expectations] D1 fails through E4. Minimal regression fixes: handle PowerShell mutation aliases and git global options before subcommands, adding tests for both demonstrated bypasses. Deny-list shell filtering cannot guarantee read-only execution; enforce a constrained execution boundary if that guarantee is required. Human must independently confirm E8. Existing tests pass but miss demonstrated cases.
[failures] Verifier shell read-only is a heuristic deny-list. PowerShell aliases (ni, sc, ac, ri), find -delete, tar x, dd of=, sort -o, npx and npm exec are not covered. Repo scripts can write by design. Human should check E8 with /reload and /iced status.
[rules] Blocking security finding. Remove verifier shell or replace heuristic with enforceable sandbox/allowlist. E8 still needs human manual check.
