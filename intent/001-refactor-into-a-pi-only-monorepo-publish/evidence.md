# Evidence: 001-refactor-into-a-pi-only-monorepo-publish

Pi-only ICED as two npm packages (agnostic core + pi extension)

Verdict: **FAIL** (attempt 2, 2026-10-01T12:32:34Z, independent verifier: yes, needs human review)

Verifiers (pi): expectations [openai-codex/gpt-6-astra, effort medium] (answered, 96s), failures [anthropic/claude-sonnet-5-5, effort medium] (answered, 43s), rules [openai-codex/gpt-5.6-terra, effort medium] (answered, 111s)

## Builder summary

Attempt 2. Fixed attempt-1 findings: intent/README.md rewritten to the new pi-neutral text (no other agents, no .iced/ICED.md); the human removed targets and verify.runner from this repo's .iced/config.json (its verify.model is a pi model list, keyed by "pi"); harness.test.mjs now also scans intent/README.md and asserts this repo's config has no targets, runner or non-pi model keys. E4 reworded by the human via escalation: verifiers read-only, test writer may write tests. Rest unchanged: iced-core (host-neutral, injected agent) + pi-intent (extension, gate, pi runner, picker); CLI, Action, skills and all other harnesses removed.

## Problems

- [E4] failed: Runner tests passed for subprocess arguments, models, effort and tool lists. However, verifier receives powershell/bash; extensions/iced/index.ts:475-483 allows shell whenever isMutatingShell returns false. Read-only classification probe returned false for WriteAllBytes, Set-Item and node --eval writeFileSync commands. Commands were tested as strings only, not executed. Verifier shell is not read-only. | packages/pi-intent/src/runner.mjs: read-only tools are read,grep,find,ls plus the shell tool; the write access level adds write and edit. runner.test.mjs passes. index.ts line 475 has a guard for ICED_ROLE=verifier. | `runner.test.mjs` passed. Read-only verifier tools exclude write/edit; test writer receives write/edit. `ICED_ROLE=verifier` blocks write/edit.

## Expectations

### [E1] The core package has no reference to pi or any other agent (no host imports, no agent CLI names or spawns) and runs verification end to end with an injected fake agent.

- Result: **pass**
- Verify: test | packages/iced-core/test (agnostic source scan + verifyUnit with injected runner)
- Builder evidence: test: packages/iced-core/test/agnostic.test.mjs + verify-parallel.test.mjs + models.test.mjs (injected fake agent end to end)
- Verifier: npm test: agnostic source/import scans and injected-agent end-to-end verification tests passed. Core has no host dependencies. | Agnostic source scan test is in packages/iced-core/test/agnostic.test.mjs. I also grepped packages/iced-core/src and the package files and found no pi or agent references. verify-parallel and models tests use an injected fake agent, and npm test passes. | `npm test`: iced-core 67/67 passed. Reviewed core source: Node-only imports; agent execution injected.

### [E2] No file in the repo or packed tarballs targets Claude Code, Codex, Cursor, Copilot or Gemini, and bin/, action.yml, the CLI and the --prepare/--finish flow are gone.

- Result: **pass**
- Verify: test | packages/*/test harness scan + check: git ls-files
- Builder evidence: test: packages/pi-intent/test/harness.test.mjs (tracked-file scan incl. intent/README.md; removed paths absent; repo config without targets/runner; no bin)
- Verifier: Harness scan passed; independently inspected git ls-files. Removed harness files, CLI, Action and split-flow code absent. Historical unit records retain removal-related mentions, not harness instructions. | git ls-files has no bin/, action.yml, AGENTS, CLAUDE, .claude, .codex, .cursor or skills/. git grep for claude|codex|cursor|copilot|gemini|iced.mjs|ICED.md|--prepare|--finish, excluding intent/ and tests, matched only the pi model ids in .iced/config.json (openai-codex/..., anthropic/claude-sonnet-5-5). Those are pi model names, not harness targets. harness.test.mjs passes. | Harness tests passed. `git ls-files` and filesystem check: no bin/, action.yml, skills/, agent files, vendored .iced/bin or .iced/lib. Pack lists clean.

### [E3] /iced init in an empty git repo creates only .iced/config.json, .iced/memory/, .iced/templates/, intent/README.md and the .gitignore/.gitattributes lines; re-running it is safe.

- Result: **pass**
- Verify: test | packages/pi-intent or iced-core init test
- Builder evidence: test: packages/iced-core/test/init.test.mjs
- Verifier: Ran init tests and inspected assertions: exact fresh-repo file inventory, forbidden paths absent, repeat initialization preserves config/memory/README and avoids duplicate lines. | init.test.mjs asserts only the allowed files and that the banned paths are absent. It passes. I did not run init myself, because the verifier is read-only. | `init.test.mjs` passed: exact owned files only, rerun safe, banned paths absent. Reviewed `packages/iced-core/src/init.mjs`.

### [E4] In pi, verifiers run as pi subprocesses with read-only tools, and the test writer runs as a pi subprocess allowed to write tests; both use the configured models and effort.

- Result: **fail**
- Verify: test | packages/pi-intent/test/runner.test.mjs (pi runner args)
- Builder evidence: test: packages/pi-intent/test/runner.test.mjs (verifier tools read,grep,find,ls,shell only; test writer adds write,edit; --model/--thinking from config/session; ICED_ROLE set)
- Verifier: Runner tests passed for subprocess arguments, models, effort and tool lists. However, verifier receives powershell/bash; extensions/iced/index.ts:475-483 allows shell whenever isMutatingShell returns false. Read-only classification probe returned false for WriteAllBytes, Set-Item and node --eval writeFileSync commands. Commands were tested as strings only, not executed. Verifier shell is not read-only. | packages/pi-intent/src/runner.mjs: read-only tools are read,grep,find,ls plus the shell tool; the write access level adds write and edit. runner.test.mjs passes. index.ts line 475 has a guard for ICED_ROLE=verifier. | `runner.test.mjs` passed. Read-only verifier tools exclude write/edit; test writer receives write/edit. `ICED_ROLE=verifier` blocks write/edit.

### [E5] Existing ICED repos keep working: spec examples and previously approved units lint clean with unchanged contract hashes, and old configs (per-runner model maps, runner, targets) load with the pi entries applied.

- Result: **pass**
- Verify: test | packages/iced-core/test (compat)
- Builder evidence: test: packages/iced-core/test/compat.test.mjs (golden hash from 4d53c01), core.test.mjs spec examples, runner.test.mjs [E5] legacy pi map
- Verifier: Ran compatibility, example-lint and legacy pi-map tests: golden contract hash matched, previously approved fixture accepted, examples validated, legacy model/effort settings applied. | compat.test.mjs (golden hash from 4d53c01), the core spec examples and the runner.test.mjs [E5] legacy-config test all pass in npm test. This repo's own config also loads. | Compat tests passed: golden pre-refactor contract hash unchanged; approved unit lints/accepts; legacy maps, runner, targets load with pi entry.

### [E6] Every existing behavior still covered by the current test suite (lint, hashing, transitions, proposals, gate, models, picker, verification) passes after the move.

- Result: **pass**
- Verify: check | npm test
- Builder evidence: check: npm test: iced-core 67/67, pi-intent 31/31
- Verifier: Independently ran npm test: iced-core 67/67; pi-intent 31/31; exit 0. | npm test output given in the prompt: iced-core 67/67 and pi-intent 31/31 pass. I did not re-run the full suite. | `npm test` passed: iced-core 67/67, pi-intent 31/31.

### [E7] Both packages are publish-ready: `npm pack --dry-run` lists only intended files, metadata is complete (name, version, license, repository, exports/files, publishConfig), pi-intent depends on @arturleao/iced-core and declares pi packages as peers.

- Result: **pass**
- Verify: check | npm pack --dry-run -w packages/iced-core -w packages/pi-intent
- Builder evidence: test: packages/pi-intent/test/package.test.mjs (npm pack --dry-run --json for both packages, metadata, deps/peers, imports packed or declared)
- Verifier: Ran npm pack --dry-run for both workspaces: core 22 files, extension 9 files. Runtime sources/templates/rubric included; tests, intent and .iced excluded. Inspected manifests; metadata, core dependency, public access and wildcard peers present. Package import-coverage tests passed. | I ran npm pack --dry-run for both packages. iced-core ships 22 files: src, spec, README, LICENSE and package.json. pi-intent ships 9 files: extensions, src, docs, README, LICENSE and package.json. Neither ships tests, intent/ or .iced/. The package.json files have name, version, license, repository, files, exports and publishConfig. pi-intent depends on @arturleao/iced-core and lists the pi packages, typebox included, as peerDependencies "*". The root package is private. | `npm pack --dry-run --json -w packages/iced-core -w packages/pi-intent` succeeded. Tarballs contain runtime sources/spec/docs, exclude tests and repo data. Metadata and peer deps reviewed.

### [E8] pi installed from a local checkout loads the extension after /reload: /iced status and the iced_* tools work.

- Result: **unknown**
- Verify: manual | /reload in pi, run /iced status
- Builder evidence: manual: Human ran /reload in pi installed from a local checkout; this session's new gate then allowed deleting .iced/bin and .iced/lib; fresh pi -p listed all 8 iced_* tools. (Human confirms /iced status in their session.)
- Verifier: Cannot independently demonstrate interactive /reload and /iced status in user's installed session. Root manifest test passed, but does not prove interactive loading. Human must perform requested check. | Manual expectation. node_modules/@arturleao has junctions to the workspace packages, so the extension's import of @arturleao/iced-core resolves. The root pi manifest points at packages/pi-intent/extensions/iced/index.ts. The human should run /reload and /iced status. | Cannot independently run interactive pi `/reload` and `/iced status`. Builder/human claim is not concrete verifier evidence.

### [E9] READMEs and docs describe only pi (install via `pi install npm:@arturleao/pi-intent`) and the core library API, with no other harness or CLI instructions.

- Result: **pass**
- Verify: check | grep docs and READMEs for claude|codex|cursor|copilot|gemini|iced.mjs
- Builder evidence: check: README.md, packages/*/README.md, packages/pi-intent/docs/*.md, intent/README.md scanned by harness.test.mjs; install documented as pi install npm:@arturleao/pi-intent
- Verifier: Executed harness scan covering READMEs and docs; passed. Additional case-insensitive docs search for claude|codex|cursor|copilot|gemini|iced.mjs found no matches. | git grep of READMEs and docs for the harness names and iced.mjs found no hits. Only intent/<id>/iced.md paths matched, which are unit files. | Harness documentation scan passed. Reviewed root and package READMEs: pi install documented; no removed-harness or standalone ICED CLI instructions.

## Failure conditions

- [F1] not triggered: Compatibility golden-hash, approved-unit lint/accept and spec-example tests passed. | The compat golden hash test passes, and the spec examples lint clean. | Current unit computed contract hash equals stored hash; lint has no errors. Legacy approved-unit compat test passed.
- [F2] not triggered: Not demonstrated; interactive installed-session behavior remains unknown. | The root pi manifest path exists. The workspace links resolve. The extension imports are consistent. The runtime load is covered by E8 (manual). | Not independently manually tested; no code evidence of broken extension loading found.
- [F3] not triggered: Independent pack dry-run and runtime import-coverage tests passed; required assets included, forbidden repository/test paths excluded. | Both packed file lists contain templates, rubric, extension sources, src and docs, and no tests, intent/ or .iced/. | Dry-run pack lists include extension, source, templates and rubric; tests, intent and .iced absent.
- [F4] not triggered: Verifier tool list excludes named write/edit tools and extension blocks them. Shell still permits writes, reported separately under E4. | The verifier tool list in runner.mjs has no write or edit. index.ts also guards the shell for ICED_ROLE=verifier. | Verifier tool list is read, grep, find, ls, shell; no write/edit. Extension blocks write/edit for verifier role.
- [F5] not triggered: Fresh-init exact-inventory and forbidden-path assertions passed. | init.test.mjs asserts the banned paths are absent after init. | Fresh-init test passed and checks all prohibited files/directories absent.

## Constraints

- [C1] respected: Core agnostic scans and injected-runner tests passed; no host dependency. | The agnostic scan test passes and the core src is clean. | Core source imports Node built-ins only; verifier/test-writer runner injected. Agnostic scan passed.
- [C2] respected: Harness scan and tracked-file inspection found no retained other-host integration. | No harness files, runners or docs for other agents exist in tracked files. | No active removed-host runner, instruction, skill, agent file, or context block found. Historical unit records only describe removal.
- [C3] respected: Removed-path and no-bin tests passed; git ls-files contains no standalone CLI or Action. | No bin/, action.yml, .iced/bin or .iced/lib in the tracked files. The working tree .iced has only config, memory, templates, metrics and tmp. | CLI, vendored copies and GitHub Action absent; init source does not create them.
- [C4] respected: Compatibility tests passed for hashes, approved units, old config keys and pi model/effort maps. | The compat tests and the legacy-config test pass. | Compatibility and hash tests passed; legacy config loading tested.
- [C5] respected: Both manifests declare ESM and Node >=20. Host packages appear only as wildcard peerDependencies. | The pi host packages and typebox are peerDependencies "*". Node >=20 and ESM are set. | Package manifests: Node >=20, ESM; pi host packages are peerDependencies `*`, not dependencies.
- [C6] respected: Verification used tests and pack dry-run, not publish or settings changes. Builder's historical external actions not independently established. | Nothing was published. I found no sign of pi settings changes. | Only dry-run pack executed. No publish script or settings-file change found in repository.

## Checks

- `npm test`: exit 0, 10.6s

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

[expectations] Blocking finding: E4/D3 read-only guarantee relies on explicitly heuristic shell detection in packages/iced-core/src/guard.mjs. Safe string-only probes proved mutating commands bypass it. Smallest reliable fix: remove unrestricted verifier shell or replace it with constrained read/check execution. Add regression coverage. E8 still needs human verification.
[failures] I did not re-run the full npm test; I relied on the supplied output plus targeted checks. The repo's .iced/config.json lists model ids containing 'claude' and 'codex'. They are pi provider/model names, so I judged them acceptable. A strict grep-based reading of E2 might flag them. The harness.test.mjs file asserts that config only has the 'pi' key. E8 needs the human to run /reload and /iced status.
[rules] Smallest fix: human independently run `/reload`, then `/iced status` in pi loaded from a local checkout; record concrete result. E8 unknown makes D1 unmet.
