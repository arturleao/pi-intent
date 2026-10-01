# Evidence: 001-refactor-into-a-pi-only-monorepo-publish

Pi-only ICED as two npm packages (agnostic core + pi extension)

Verdict: **FAIL** (attempt 1, 2026-10-01T13:09:16Z, independent verifier: yes, needs human review)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 77s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 39s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 81s)

## Builder summary

Resumed after the block. E4/F4 fixed by construction instead of patching the shell deny-list: verifiers now get no shell. pi-intent runner grants read-only agents exactly read, grep, find, ls (TOOLS["read-only"] === VERIFIER_TOOLS); the extension's ICED_ROLE=verifier handler blocks every other tool (write, edit, bash, powershell, any extension tool) via verifierToolDecision, so even a misconfigured --tools list cannot give a verifier a shell. The core verifier prompt now tells verifiers to judge from code, tests and the check results ICED already ran (verify.commands output is in the prompt). The test writer keeps write, edit and the shell (E4 as reworded). Docs updated. Everything else unchanged from attempts 1-3: iced-core host-neutral with injected agent, pi-intent extension, CLI/Action/skills/other harnesses removed, repo cleaned.

## Problems

- Verifier failed the unit: [expectations] Fail denotes insufficient independent evidence under D1, not demonstrated implementation defect. Read-only verifier gate prevents required command reruns. Have authorized test executor independently run npm test, git ls-files and npm pack --dry-run; human must demonstrate /reload and /iced status. No files modified.
[failures] No shell available, so npm test and npm pack were not re-run; I relied on the check output in the prompt plus static inspection. Human should confirm E8 (/iced status after /reload). Leftover model names containing 'codex' and 'claude' in .iced/config.json are model refs, not harness targets. Check that the harness scan test excludes .iced/config.json.
[rules] E8 needs human reload/status confirmation before acceptance.

## Expectations

### [E1] The core package has no reference to pi or any other agent (no host imports, no agent CLI names or spawns) and runs verification end to end with an injected fake agent.

- Result: **pass**
- Verify: test | packages/iced-core/test (agnostic source scan + verifyUnit with injected runner)
- Builder evidence: test: packages/iced-core/test/agnostic.test.mjs + verify-parallel.test.mjs + models.test.mjs (injected fake agent end to end)
- Verifier: Core source scan found no host names. verify.mjs injects agent function. End-to-end execution unavailable: shell tool blocked. | grep of packages/iced-core (excl. tests) finds no agent names or host imports; only generic spawn in src/verify.mjs; agnostic.test and injected-runner tests exist and npm test passes. | Read core source and agnostic/verify-parallel tests. Core imports Node/self only; verifier/test-writer execution requires injected agent function.

### [E2] No file in the repo or packed tarballs targets Claude Code, Codex, Cursor, Copilot or Gemini, and bin/, action.yml, the CLI and the --prepare/--finish flow are gone.

- Result: **pass**
- Verify: test | packages/*/test harness scan + check: git ls-files
- Builder evidence: test: packages/pi-intent/test/harness.test.mjs (tracked-file scan incl. intent/README.md; removed paths absent; repo config without targets/runner; no bin)
- Verifier: Root listing confirms bin/, lib/, skills/, action.yml and generated harness directories absent. Reviewed harness scanner; git ls-files and packed-content checks could not run. | find shows no bin/, lib/, skills/, root spec/, .claude/.codex/.agents, AGENTS.md, CLAUDE.md, action.yml, .github. Grep hits outside tests are only model names in .iced/config.json and unit records. harness.test.mjs present and passing. | Read harness test. No current bin/, action.yml, or skills/ found. No forbidden terms in pi docs. Historical intent/.iced records contain removal terms but do not target harnesses.

### [E3] /iced init in an empty git repo creates only .iced/config.json, .iced/memory/, .iced/templates/, intent/README.md and the .gitignore/.gitattributes lines; re-running it is safe.

- Result: **pass**
- Verify: test | packages/pi-intent or iced-core init test
- Builder evidence: test: packages/iced-core/test/init.test.mjs
- Verifier: init.mjs writes only specified paths, preserves config and memory, refreshes templates and deduplicates Git lines. Fresh-repo/idempotence tests not independently executed. | packages/iced-core/test/init.test.mjs exists and npm test passes. I did not run init myself (no shell). | Read init.mjs and init.test.mjs. Init creates config, memory, templates, intent README, git lines only; rerun preserves config/memory and refreshes templates.

### [E4] In pi, verifiers run as pi subprocesses with read-only tools, and the test writer runs as a pi subprocess allowed to write tests; both use the configured models and effort.

- Result: **pass**
- Verify: test | packages/pi-intent/test/runner.test.mjs (pi runner args)
- Builder evidence: test: packages/pi-intent/test/runner.test.mjs ('verifier tools never include write, edit or a shell; the test writer may write'; piArgs --tools read,grep,find,ls; --model/--thinking; submitUnit through piAgent; runTestWriter gets write tools and model) + packages/pi-intent/test/gate.test.mjs ('verifier tools: read, grep, find and ls only...' incl. TOOLS['read-only'] deepEqual VERIFIER_TOOLS; 'the extension's verifier role uses the verifier tool rule for every tool call') (Live: ICED_ROLE=verifier pi -p --tools 'read,grep,find,ls,powershell,bash' -> ls ran; powershell `ni probe.txt` and bash `touch probe2.txt` both blocked; neither file created.)
- Verifier: runner.mjs grants verifiers read,grep,find,ls; test writers additionally receive write,edit,shell. piArgs forwards model/effort. Core supplies role/access/model/effort; extension injects piAgent. gate.mjs rejects every non-read verifier tool. My npm test attempt was blocked by this live gate. | gate.mjs VERIFIER_TOOLS = read,grep,find,ls; index.ts blocks all other tools when ICED_ROLE=verifier; runner sets ICED_ROLE. My own powershell calls were blocked by this rule. runner.test passes. | runner.mjs grants verifier only read,grep,find,ls. Extension ICED_ROLE=verifier intercepts every tool call and blocks all others. Tests cover args, role, models, effort, test-writer write access.

### [E5] Existing ICED repos keep working: spec examples and previously approved units lint clean with unchanged contract hashes, and old configs (per-runner model maps, runner, targets) load with the pi entries applied.

- Result: **pass**
- Verify: test | packages/iced-core/test (compat)
- Builder evidence: test: packages/iced-core/test/compat.test.mjs (golden hash from 4d53c01), core.test.mjs spec examples, runner.test.mjs [E5] legacy pi map
- Verifier: Reviewed golden-hash compatibility tests and legacy-config handling. loadConfig preserves legacy keys; model/effort selection uses host entries. Hash and lint tests not independently executed. | compat.test.mjs, core.test.mjs and the runner.test [E5] legacy-config test exist and pass in npm test. Golden hash not independently recomputed. | compat.test checks pre-refactor golden hash, approved-unit lint/accept, and legacy targets/runner/per-host maps. runner test verifies legacy pi entry applied.

### [E6] Every existing behavior still covered by the current test suite (lint, hashing, transitions, proposals, gate, models, picker, verification) passes after the move.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test: iced-core 67/67, pi-intent 33/33
- Verifier: Attempted npm test; tool returned: The ICED verifier is read-only and may use only read, grep, find, ls; read the code and the check results in the prompt. Supplied successful output is not an independent rerun. | Prompt check output: iced-core 67/67 and pi-intent 33/33 passing, exit 0. | Provided configured npm test result exit 0, 67 iced-core plus 33 pi-intent tests. Read coverage for core lifecycle, gate, picker, verification.

### [E7] Both packages are publish-ready: `npm pack --dry-run` lists only intended files, metadata is complete (name, version, license, repository, exports/files, publishConfig), pi-intent depends on @arturleao/iced-core and declares pi packages as peers.

- Result: **pass**
- Verify: check | npm pack --dry-run -w packages/iced-core -w packages/pi-intent
- Builder evidence: test: packages/pi-intent/test/package.test.mjs (npm pack --dry-run --json for both packages, metadata, deps/peers, imports packed or declared)
- Verifier: Both manifests contain publish metadata and restrictive files lists; dependency/peer declarations match requirements. Reviewed package tests. npm pack --dry-run could not run. | Read both package.json files: name, version, license, repository, files, exports, publishConfig complete. Dependency and peerDependencies correct. package.test.mjs runs npm pack --dry-run and passes. Did not run pack myself. | Read manifests and package.test. Files/exports/publish metadata present; core dependency correct; pi host packages peers '*' only; dry-run tarball test covers runtime files and exclusions.

### [E8] pi installed from a local checkout loads the extension after /reload: /iced status and the iced_* tools work.

- Result: **unknown**
- Verify: manual | /reload in pi, run /iced status
- Builder evidence: manual: Human ran /reload in pi installed from a local checkout; the new gate then allowed deleting .iced/bin and .iced/lib; fresh pi -p listed all 8 iced_* tools; ICED_ROLE=verifier children load the new verifier rule from the installed path (live check above). (Human confirms /iced status in their session.)
- Verifier: Root manifest points at existing extension; source registers /iced. Live verifier gate loaded here, but interactive /reload, /iced status and iced_* tools were not demonstrated. | Manual expectation. Builder says the human ran /reload and fresh pi listed the iced_* tools. I could not verify. Human should run /iced status after /reload. | Manual /reload and /iced status not independently executed. Root pi manifest points to packages/pi-intent/extensions/iced/index.ts.

### [E9] READMEs and docs describe only pi (install via `pi install npm:@arturleao/pi-intent`) and the core library API, with no other harness or CLI instructions.

- Result: **pass**
- Verify: check | grep docs and READMEs for claude|codex|cursor|copilot|gemini|iced.mjs
- Builder evidence: check: README.md, packages/*/README.md, packages/pi-intent/docs/*.md, intent/README.md scanned by harness.test.mjs; install documented as pi install npm:@arturleao/pi-intent
- Verifier: Read root and both package READMEs. Required pi install command present; core API documented. Markdown scan under packages found no claude|codex|cursor|copilot|gemini|iced.mjs matches. | Grep finds no harness names or iced.mjs in READMEs or docs outside unit records; harness.test scans them. design.md consistent with pi-only verifier rule. | Read root and package READMEs; pi install command present. Grep packages/pi-intent/docs found no forbidden harness/CLI terms.

## Failure conditions

- [F1] not triggered: Not demonstrated; hash/lint runtime compatibility remains unverified. | compat.test golden hash and spec example lint pass in npm test. | Golden hash and contract-tampering lint tests cover legacy approved units.
- [F2] not triggered: Verifier extension demonstrably loaded; normal interactive command/tool loading remains unverified. | Root package.json pi manifest points to packages/pi-intent/extensions/iced/index.ts; the extension imports @arturleao/iced-core via the workspace. Builder's live pi -p listed 8 iced_* tools; not independently run. | Not manually exercised; package manifest and extension source support loading. See E8 unknown.
- [F3] not triggered: Manifest allowlists and package tests look correct; actual pack contents not independently checked. | files lists in both packages include only src, spec, extensions, docs, README, LICENSE; package.test checks the tarball. | package.test dry-run tarball checks required sources/spec/templates/rubric and excludes tests, intent, .iced.
- [F4] not triggered: Verifier invocation excludes write/edit/shell; verifier role rejects every tool outside read,grep,find,ls. | Verifier gets only read/grep/find/ls, enforced in the child extension; confirmed from the code and by my own blocked shell. | Verifier subprocess tools omit write/edit/shell; verifier-role extension hook blocks every non-read tool.
- [F5] not triggered: Read complete init.mjs; no writes to prohibited harness or vendored paths. | init.test and harness.test pass; no code path found in core init for the removed files. | initRepo source and empty-repo test prohibit all listed legacy paths.

## Constraints

- [C1] respected: Core source scan found no coding-agent names; verification invokes injected agent. | Core source has no agent references; agent is injected. | Core has no host imports/names or host runner. Generic process spawning only runs configured checks; agent start is injected.
- [C2] respected: No targeting found in inspected sources/docs; exhaustive tracked-file and tarball scans unavailable. | No harness files or runners in the repo; only model-name strings in config. | No active harness files or instructions found outside historical unit records and scanner tests.
- [C3] respected: Root and .iced listings lack removed CLI/vendor paths; manifests expose no bin. | No bin, .iced/bin, .iced/lib or action.yml. | No CLI/action/vendor directories found; package manifests contain no bin.
- [C4] respected: Legacy configuration preserved by deep merge and host-aware lookup. Contract compatibility tests inspected, not rerun. | compat tests pass, including legacy per-runner maps. | Compatibility tests cover contract hash, old approved unit lint, and old config map loading.
- [C5] respected: Both manifests specify ESM and Node >=20. pi-intent declares all three host packages as '*' peers, not dependencies. | pi hosts are peerDependencies '*'; engines node>=20; type module. | Both manifests ESM Node >=20. pi packages declared peerDependencies '*' and not dependencies.
- [C6] respected: No publish or settings modification performed by this verifier; builder's external side effects not independently established. | Nothing indicates a publish; the root is private. Settings unchanged as far as I can see. | No publish command executed by this verification. No settings files changed in listed scope.

## Checks

- `npm test`: exit 0, 11.6s

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

[expectations] Fail denotes insufficient independent evidence under D1, not demonstrated implementation defect. Read-only verifier gate prevents required command reruns. Have authorized test executor independently run npm test, git ls-files and npm pack --dry-run; human must demonstrate /reload and /iced status. No files modified.
[failures] No shell available, so npm test and npm pack were not re-run; I relied on the check output in the prompt plus static inspection. Human should confirm E8 (/iced status after /reload). Leftover model names containing 'codex' and 'claude' in .iced/config.json are model refs, not harness targets. Check that the harness scan test excludes .iced/config.json.
[rules] E8 needs human reload/status confirmation before acceptance.
