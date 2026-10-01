# ICED implementation contract (v0.1)

ICED = Intent, Context, Expectations, Done. A method derived from IDSD (Kapil Viren Ahuja).
This document is the single contract every part of `pi-intent` implements. Change it first, then code.

## Decisions (phase 0)

| Decision | Value |
|---|---|
| Method name | ICED |
| Package | `pi-intent` (pi package; also a zero-dependency Node CLI) |
| Unit layout | one folder per unit: `intent/<id>/iced.md` |
| Default autonomy | 1 (Gated) |
| Visibility | private for now, MIT license, all text original |
| Runtime deps | none (Node >= 20 built-ins only) |

## Repository layout (this package)

```text
pi-intent/
  package.json                 pi manifest, bin, scripts
  README.md
  LICENSE
  docs/design.md               this contract
  spec/SPEC.md                 normative spec (RFC 2119)
  spec/iced.schema.json        JSON Schema for the frontmatter
  spec/rubric.md               conformance rubric (used by review + verifier)
  spec/templates/{project,feature,bug,review,chore}.md
  spec/examples/<id>/iced.md   worked examples (bug, feature, project + child)
  skills/iced/SKILL.md         portable agent protocol (pi, Claude Code, Codex, ...)
  skills/iced/references/*.md
  lib/iced-core.mjs            parse, lint, hash, status machine, repo ops, metrics
  lib/iced-init.mjs            init + agent-discovery files
  lib/iced-gate.mjs            pure gate decisions (path classes, shell heuristic)
  lib/iced-verify.mjs          checks, runners, parallel verifiers, verdict, evidence reports, verifier agent files
  lib/iced-picker.mjs          UI-free state of the pi model picker (effort cycling, rotation, filter)
  bin/iced.mjs                 CLI (see the CLI section)
  action.yml                   GitHub Action (composite) running `iced validate`
  extensions/iced/index.ts     pi extension (commands, tools, gate, verify loop, model picker)
  test/*.test.mjs              node:test suites
```

## Target repository layout (after `iced init`)

```text
.iced/
  config.json
  ICED.md                      canonical protocol copy for any agent
  bin/iced.mjs                 vendored CLI (overwritten by init)
  lib/iced-core.mjs            vendored libs used by the CLI (overwritten by init)
  lib/iced-verify.mjs
  rubric.md                    rubric copy for verifiers started by the vendored CLI
  tmp/                         verifier prompts and split-mode state (gitignored)
  memory/product.md            product memory (what the product is / must do)
  memory/knowledge.md          org standards, patterns (or pointers to shared KB)
  templates/*.md               copied from spec/templates
  metrics.jsonl                append-only events
  active                       id of the active unit (plain text, may be absent; gitignored)
intent/
  README.md                    how to use ICED in this repo
  <id>/iced.md                 the unit (human-owned contract)
  <id>/decisions.md            agent decision log (agent-owned, append-only)
  <id>/evidence.md             verifier report (extension/verifier-owned)
  <id>/verify.json             machine verdict of the last verification
  <id>/submission.json         builder's evidence claims for `iced verify` (agents without the extension)
  <id>/review.md               findings of a review unit
```

Ids: `NNN-slug`, NNN zero-padded 3 digits, next free number across `intent/`. Slug: lowercase, `a-z0-9-`, max 40 chars.

## `iced.md` format

Frontmatter is a restricted YAML subset: one `key: value` per line, scalar values only
(string, optionally double-quoted; integer; `true`/`false`; `null`). No nesting, no lists.

```markdown
---
iced: 0.1
id: 042-dark-mode
title: Dark mode in settings
type: feature
tier: M
parent: 010-settings
status: draft
autonomy: 1
risk: low
attempts: 0
created: 2026-09-30T11:00:00Z
approved_at: null
approved_by: null
contract_hash: null
base_ref: null
accepted_at: null
accepted_by: null
---

# Dark mode in settings

## Intent

### Goal
Users can switch the app to a dark theme from Settings and it persists.

### Constraints
- [C1] No new runtime dependencies.
- [C2] Existing light theme unchanged.

### Failure conditions
- [F1] Theme resets after reload.
- [F2] Any text below WCAG AA contrast in dark mode.

### Scope
- In: settings page toggle, theme persistence
- Out: per-component theming, marketing site

## Context
- [code] Theme tokens live in src/styles/tokens.css as CSS variables.
- [product] Settings is the only place users change preferences.
- [knowledge] Accessibility standard is WCAG 2.2 AA.
- [assumed] Persist in localStorage (no user profile API exists).

## Expectations
- [E1] Toggle in Settings switches theme without reload. {verify: test | tests/settings-theme.spec.ts}
- [E2] Choice persists across reloads. {verify: test | tests/settings-theme.spec.ts}
- [E3] All dark-mode text meets AA contrast. {verify: check | npm run a11y}

## Open questions
- [Q1] Should it follow the OS preference by default? -> A: yes, until the user chooses.
```

### Parsing rules

- Sections are matched by heading text, case-insensitive: `## Intent`, `### Goal`, `### Constraints`,
  `### Failure conditions`, `### Scope`, `## Context`, `## Expectations`, `## Open questions`.
- Item line: `- [<ID>] <text>`. IDs: `C<n>`, `F<n>`, `E<n>`, `Q<n>`. Items may wrap: following non-blank lines
  that are not a heading or list item are joined before `{verify: ...}` and `-> A:` are read; a blank line ends it.
- Context line: `- [<tag>] <text>`, tag in `code | product | knowledge | assumed | parent`.
- Expectation verify suffix: `{verify: <kind> | <ref>}`, kind in `test | check | metric | manual`.
  `<ref>` is free text (path, command, metric name, manual steps).
- Question answered when the text contains `-> A:`; the part after it is the answer.
- Scope lines: `- In: a, b` and `- Out: c, d`.
- Unknown sections are preserved and ignored.

### Contract hash

`contract_hash` = sha256 hex of the normalized text of `## Intent` (all subsections) plus
`## Expectations`. Normalization: CRLF -> LF, trim trailing whitespace per line, drop blank lines.
Set at approval. Any later mismatch = tampering; lint error `contract-changed`.

## Types, tiers, autonomy

- `type`: `project | feature | bug | review | chore`.
- `tier`: `S | M | L | XL`. Default: bug/chore S, feature M, project L.
- `risk`: `low | medium | high`.
- `autonomy`: `0 Assist` (confirm each write and decision), `1 Gated` (sign off + accept),
  `2 Trusted` (sign off; auto-accept when verification passes), `3 Autonomous`
  (auto-approve when risk low and no open questions; otherwise behaves as 2).
- Effective autonomy = `min(unit.autonomy, config.maxAutonomy)`, capped at 1 when `risk: high`.

## Status machine

```text
draft -> approved -> building -> verifying -> done -> accepted
                        ^            |          |
                        +---- fail --+          +-- human rejects with reason --> building
any active state -> blocked (escalation or attempts exhausted) -> previous state
draft|approved|blocked -> rejected (abandoned)
```

Allowed transitions (from -> to):
`draft->approved`, `draft->rejected`, `approved->building`, `approved->rejected`,
`building->verifying`, `building->blocked`, `verifying->done`, `verifying->building`,
`verifying->blocked`, `done->accepted`, `done->building`, `blocked->draft`,
`blocked->approved`, `blocked->building`, `blocked->rejected`.

Owners: only a human (or the autonomy rule) moves `draft->approved` and `done->accepted`.
Only the verifier moves `verifying->done`.

## Lint rules (`lintIced(parsed, stage)`)

| Code | Stage | Rule |
|---|---|---|
| `frontmatter-missing` | all | frontmatter absent or unparsable |
| `field-invalid` | all | required field missing or value not in enum (`iced,id,title,type,tier,status,autonomy,risk`) |
| `goal-missing` | signoff | Goal empty |
| `goal-has-solution` | signoff (warning) | Goal names a technology/tool (heuristic word list) |
| `failures-missing` | signoff | no F item (except type review) |
| `expectations-missing` | signoff | no E item |
| `expectation-unverifiable` | signoff | E item without `{verify: ...}` |
| `open-questions` | signoff | any Q unanswered |
| `assumptions-present` | signoff (warning) | any `[assumed]` context line |
| `ids-duplicate` | all | duplicate item id |
| `contract-changed` | accept, validate | hash mismatch when status past approved |
| `evidence-missing` | accept | status done/accepted without evidence.md |

Return `{ errors: Issue[], warnings: Issue[] }`, `Issue = { code, message, line? }`.

## Config (`.iced/config.json`)

```json
{
  "iced": "0.1",
  "gate": "strict",
  "autonomy": 1,
  "maxAutonomy": 3,
  "questions": { "max": 5 },
  "verify": { "commands": [], "parallel": true, "maxAttempts": 3, "independent": true, "runner": "auto", "lenses": "auto",
              "model": null, "effort": null, "timeoutSec": 900 },
  "memory": { "product": ".iced/memory/product.md", "knowledge": [".iced/memory/knowledge.md"] },
  "promotion": { "mode": "suggest", "window": 10 },
  "build": { "testWriter": false, "testWriterModel": null, "testWriterEffort": null },
  "autonomyByRisk": { "low": null, "medium": null, "high": null },
  "targets": ["agents", "claude", "codex", "skills"]
}
```

`gate`: `strict` blocks while a unit is active (no active unit: normal work), `always` also blocks code changes
with no active unit, `warn` notifies, `off` disables. `memory.knowledge` entries may be paths outside
the repo (shared org knowledge base for enterprise use). Missing keys take these defaults.

Models and effort:

- `verify.model`: `null`, a model, a list rotated across lenses, or an object per runner (`pi`, `claude`, `codex`,
  `cursor`, `gemini`, `default`). A string may also list models separated by commas (commas inside `[...]`, as in
  cursor's `model[effort=high]`, are kept). A model may end in `:<level>`.
- `{"pi": null}` means "asked at init, not pinned": it resolves like no model, but `/iced init` and `iced init` only
  ask while `verify.model` is `null`.
- `verify.effort`: a level (`off|minimal|low|medium|high|xhigh|max`) or an object per runner; used when the model has
  no `:level`. `build.testWriterModel` / `build.testWriterEffort` do the same for the test writer (always pi).
- Unset in pi: verifiers (pi runner only) and the test writer use the session model and thinking level.

## Metrics (`.iced/metrics.jsonl`)

One JSON object per line: `{ "ts": ISO, "id": unitId, "event": name, ...data }`.
Events: `created {type,tier,risk}`, `questions {count}`, `signoff {result: approved|changes|rejected, auto:bool}`,
`verify {result: pass|fail, attempt}`, `escalation {kind}`, `accept {auto:bool}`, `reject {reason}`.

Stats: units, questions per unit, sign-off first-time approval rate, verify first-pass rate,
human rejection rate, escalations per unit, by risk and autonomy.
Promotion: when `promotion.window` most recent accepted units of a risk level at autonomy L had
zero rejections and zero failed-then-accepted escalations, suggest raising that level's default by one
(never above `maxAutonomy`; never auto-applied when `mode` is `suggest`).

## lib/iced-core.mjs API (ESM, JSDoc types, no deps)

```js
export const SPEC_VERSION;            // "0.1"
export const TYPES, TIERS, RISKS, STATUSES, VERIFY_KINDS, CONTEXT_TAGS;
export const TRANSITIONS;             // { [from]: string[] }
export function canTransition(from, to) -> boolean
export function parseFrontmatter(text) -> { data, body, ok }
export function setFrontmatter(text, patch) -> string          // updates/appends keys, keeps body + key order
export function parseIced(text) -> ParsedIced
// ParsedIced = { frontmatter, title, goal, constraints: Item[], failures: Item[], scope: {in: string[], out: string[]},
//   context: {tag, text, line}[], expectations: Item[], questions: Item[], ok, errors }
// Item = { id, text, line, verify?: {kind, ref}, answer?: string }
export function contractHash(text) -> string
export function lintIced(parsed, stage /* "draft"|"signoff"|"accept"|"validate" */, text?) -> { errors, warnings }
export function effectiveAutonomy(frontmatter, config) -> 0|1|2|3
export function defaultConfig() -> Config
export function loadConfig(root) -> Config                     // merged with defaults
export function saveConfigPatch(root, patch)                   // deep-merge into the raw file
export function updateConfig(root, fn)                         // edit the raw file in place (can delete keys)
export const EFFORTS;                 // off, minimal, low, medium, high, xhigh, max
export function splitEffort(ref) -> { model, effort }          // "a/b:high"; leaves "qwen3:32b" alone
export function verifyModels(config, runner?) -> string[]      // per runner, then default; splits comma lists
export function verifyEffort(config, runner?) -> string|null
export function setVerifyModels(root, models, runner?)         // [] clears; no runner = every runner
export function setVerifyEffort(root, level|null, runner?)
export function setTestWriterModel(root, model|null), setTestWriterEffort(root, level|null)
export function markModelsAsked(root, runner)                  // {runner: null} when nothing is pinned
export function describeModels(config, { sessionModel?, sessionEffort? }) -> string
export function normalizeDir(dir) -> string                    // absolute, uppercase Windows drive letter
export function findRoot(cwd) -> string|null                   // nearest ancestor containing .iced/, normalized
export function slugify(title) -> string
export function nextId(root, title) -> string                  // "043-dark-mode"
export function unitPaths(root, id) -> { dir, iced, decisions, evidence, verify }
export function listUnits(root) -> { id, dir, file, frontmatter }[]  // sorted by id
export function readUnit(root, id) -> { text, parsed, paths }
export function createUnit(root, { title, type, tier?, parent?, autonomy?, risk?, templateDir? }) -> { id, paths }
export function transition(root, id, to, patch?) -> frontmatter // validates canTransition, writes file
export function ancestors(root, id) -> ParsedIced[]           // parent chain, nearest first, cycle-safe
export function children(root, id) -> string[]
export function getActive(root) -> string|null
export function setActive(root, id|null)
export function appendDecision(root, id, { decision, why, alternatives? })
export function appendMetric(root, event)
export function readMetrics(root) -> object[]
export function computeStats(events) -> Stats
export function promotionSuggestions(events, config) -> { risk, from, to, reason }[]
export function renderStatus(root, id?) -> string              // human-readable summary
```

## lib/iced-init.mjs API

```js
export const TARGETS;  // agents | claude | codex | skills | cursor | copilot | gemini
export const DEFAULT_TARGETS;  // agents, claude, codex, skills
export function upsertManagedBlock(text, body, { begin = "<!-- ICED:BEGIN -->", end = "<!-- ICED:END -->" }) -> string
export function detectTargets(root) -> string[]    // defaults + those whose tool dirs/files already exist
export function initRepo(root, { targets?, force?, packageRoot? }) -> { created: string[], updated: string[], skipped: string[] }
```

`initRepo` is idempotent. Re-running it after updating pi-intent refreshes the vendored CLI, protocol, templates,
skills, verifier agents and managed blocks, and keeps `config.json` and `intent/`. It writes:

| Target | Files |
|---|---|
| always | `.iced/bin/iced.mjs`, `.iced/lib/iced-core.mjs`, `.iced/lib/iced-verify.mjs`, `.iced/rubric.md` (vendored CLI, overwrite), `.iced/config.json` (only if absent, or with `--force`; `verify.commands` auto-detected),  `.iced/ICED.md` (overwrite), `.iced/memory/*.md` (if absent), `.iced/templates/*` (overwrite), `intent/README.md` (if absent), `.gitattributes` line `intent/**/*.md text eol=lf`, `.gitignore` lines `.iced/active` and `.iced/tmp/` |
| `agents` | managed block in `AGENTS.md` (Codex, pi, Cursor, Copilot agent, Jules, Amp, Aider...) |
| `claude` | managed block in `CLAUDE.md`; `.claude/commands/iced.md` (one-liner `/iced ...`); `.claude/agents/iced-verifier.md` |
| `codex` | `.codex/agents/iced-verifier.toml` |
| `skills` | `.agents/skills/iced/**` and `.claude/skills/iced/**` copied from `skills/iced` |
| `cursor` | `.cursor/rules/iced.mdc` (alwaysApply) and `.cursor/commands/iced.md` |
| `copilot` | managed block in `.github/copilot-instructions.md` |
| `gemini` | managed block in `GEMINI.md` |

Managed block body (short, same everywhere): what ICED is, that units live in `intent/<id>/iced.md`,
read the active unit (`.iced/active`) before changing code and change code only while it is `building`
(no active unit: work normally unless the gate is `always`), never edit Intent or Expectations after
approval, never set `approved`/`accepted` yourself, log decisions in `decisions.md`, full protocol in
`.iced/ICED.md` and the `iced` skill.

## pi extension (`extensions/iced`)

Imports `../../lib/iced-core.mjs`, `iced-init.mjs`, `iced-gate.mjs`, `iced-verify.mjs` and `iced-picker.mjs` straight
from the package, so `/reload` picks up package changes (the vendored `.iced/` copies are only for the CLI). Paths
come from `normalizeDir(ctx.cwd)`, so a pi started from `d:\` still runs checks and verifiers from `D:\`.

### Command `/iced`

| Input | Behavior |
|---|---|
| `/iced <one line>` | init if needed (confirm), infer type from leading word (`bug`, `fix`, `feature`, `project`, `review`, `chore`) else feature, create unit, set active, send drafting message to the agent |
| `/iced init [targets...]` | `initRepo`, model picker once (while `verify.model` is `null`; headless: pin the session model), report files, then `ctx.reload()` when files changed so the skill and agent files load |
| `/iced child <parentId> <one line>` | same as one-liner with `parent` set |
| `/iced list` / `/iced status [id]` | `renderStatus` |
| `/iced use <id>` | make a unit active |
| `/iced approve [id]` | sign off the draft (same dialog as `iced_request_signoff`) |
| `/iced build [id]` | approved/blocked/done-rejected unit -> building, send build message |
| `/iced accept [id]` / `/iced reject [id] <reason>` | human acceptance; reject -> building with reason |
| `/iced abandon [id]` | -> rejected |
| `/iced review [id\|path]` | read-only rubric review message to agent |
| `/iced memory` | agent drafts/refreshes `.iced/memory/*` from the repo |
| `/iced stats` | stats + promotion suggestions |
| `/iced autonomy <0-3> [id]` | set unit or config default |
| `/iced models [show]` | pick verifier / test writer models and effort (scoped models, rotation, session model, typed); also asked once by `/iced init`. Terminal picker (`lib/iced-picker.mjs` state): ←/→ or shift+tab cycle effort, space picks up to 3 for rotation, typing filters. RPC: select, then an effort select |
| `/iced models effort <level\|clear> [test-writer]` | set `verify.effort.pi` or `build.testWriterEffort` |
| `/iced gate <strict\|always\|warn\|off>` | session override |
| `/iced help` | command list |

### Tools (model-callable)

| Tool | Effect |
|---|---|
| `iced_start({request, type?, parent?})` | create a unit from a request and make it active (used when the user asks in plain words) |
| `iced_build({id?})` | start or resume the build of an `approved`/`building` unit when the human asks; never for draft or blocked units |
| `iced_questions({id, questions:[{id?, text, options?}]})` | asks the human (max `questions.max`), writes answers as `Q` items, metric `questions` |
| `iced_request_signoff({id})` | lint stage `signoff`; if errors return them. Else show summary (goal, constraints, failures, expectations, assumptions) and ask Approve / Request changes (text) / Reject. Autonomy 3 + low risk + no questions: auto-approve. On approve: set `approved_*`, `contract_hash`, `base_ref` (git HEAD or null), status approved -> building, set active, reply "build now". |
| `iced_decision({id, decision, why, alternatives?})` | append to `decisions.md`; autonomy 0 asks confirm |
| `iced_escalate({id, kind, message, proposal?})` | kind `ambiguity\|conflict\|change-expectation\|irreversible\|stuck`. status -> blocked, ask human, return answer, restore previous status. For `change-expectation`/`conflict`, `proposal` holds contract lines (`- [E4] text {verify: ...}`; same id replaces, new id adds, `(remove)` drops; C, F, E). `applyProposal` in core computes the change; the human sees was/becomes and picks Apply this change, Edit it first (editor with the change applied), guidance, or abandon. Applying keeps protected keys, strips proposal comments, re-hashes and logs a human decision. Without applicable lines: Edit the contract now. |
| `iced_submit({id, summary, evidence:[{expectation, kind, ref, note?}]})` | status -> verifying, run verification, write `evidence.md` + `verify.json`; pass -> done (auto-accept at effective autonomy >= 2), fail -> building (attempts+1) with failures returned, or blocked when attempts >= maxAttempts |
| `iced_status({id?})` | read-only summary |

### Gate (`tool_call`)

Applies when `findRoot(cwd)` exists and gate is not off. Code and shell rules apply only while a unit is
active (`.iced/active` names a unit that is not accepted or rejected), unless the gate is `always`. The ICED
file rules and blocked CLI commands apply in every mode except `off`. `/iced use none` clears the active unit.

- `write`/`edit` to a path outside `intent/` and `.iced/`: with an active unit, allowed only when it is
  `building`; with none, allowed (blocked when the gate is `always`). At autonomy 0 each such call asks confirm.
- `write`/`edit` of `intent/<id>/iced.md`: allowed only while that unit is `draft`. `decisions.md` always
  allowed. `evidence.md`, `verify.json`, `.iced/config.json`, `.iced/active`, `.iced/metrics.jsonl`,
  `.iced/bin/**`, `.iced/lib/**`, `.iced/rubric.md`: never (extension-owned; also protected from shell writes).
- Shell commands that run the CLI to self-approve (`iced approve|accept`), to verify inside pi (`iced verify`; use
  `iced_submit`) or to change models (`iced models set|effort|clear|test-writer`; only the human picks the models
  that check the work) are blocked. `iced models` (show) is allowed.
- `bash`/`powershell`: when the active unit is not `building` (or, with `always`, no unit is active), block
  commands matching a mutation heuristic
  (redirection `>`/`>>`, `Set-Content`, `Out-File`, `Add-Content`, `New-Item`, `Remove-Item`, `rm`, `mv`, `cp`,
  `del`, `git reset|checkout|switch|merge|rebase|restore|clean|stash|pull`, `git push --force|--delete`, package
  installs, `sed -i`). Redirection inside quoted strings and heredocs doesn't count. `git add|commit|push|tag`
  only record work, so they are allowed in any state, including after accept. Also block commands
  that write into `intent/*/iced.md` after approval. Documented as best effort; verification also reports
  files changed since `base_ref`.
- Block reason tells the agent exactly what to do next (e.g. "Run /iced <intent> or call iced_request_signoff").

### Prompt injection (`before_agent_start`)

When a unit is active, add a short section: active id, status, effective autonomy, goal, constraint/failure/
expectation ids+text, ancestor constraints and failure conditions (cascade), and the rules for the current
status (draft: draft + ask + sign off; building: decide and build autonomously, log decisions, escalate only
for the 5 kinds, finish with iced_submit).

### Build loop (`agent_before_settle`)

If the active unit is `building` and the agent stops without calling `iced_submit` or `iced_escalate`,
request one continuation with a nudge. Max 2 nudges per build attempt (tracked in memory, reset on submit).

### Verification

Shared by `iced_submit` and `iced verify` (`submitUnit` in `lib/iced-verify.mjs`).

1. Run `config.verify.commands` from the repo root (drive letter uppercased on Windows: Vitest crashes when started
   from `d:\`) in parallel (`verify.parallel`, default true; a nested list is
   a sequence that stops at its first failure), timeout each, capture exit code and tail.
2. Collect changed files since `base_ref` (`git diff --name-only base_ref` + untracked) if git present.
3. If `verify.independent`: pick lenses (`verify.lenses`: `auto` = `expectations`, `failures`, `rules` for tier
   M/L/XL or risk high, else one `full` verifier) and run one verifier per lens in parallel, each a fresh headless
   agent chosen by `verify.runner` (`auto`: pi inside pi, Claude inside Claude Code, Codex inside Codex, else the
   first CLI on PATH; presets are read-only; or a custom `{command, args}` with `{prompt}`/`{instruction}`/
   `{output}`/`{model}`/`{effort}`). `verify.model` is a model, a list rotated across lenses, or an object per runner
   (+ `default`); a `:level` suffix or `verify.effort` sets effort (pi `--thinking`, Claude `--effort`, Codex
   `model_reasoning_effort`; others record it as unsupported). Unset in pi: the session model and thinking level.
   The gate blocks agents from `iced models set|effort|clear|test-writer`. The prompt goes to
   `.iced/tmp/<role>-*/prompt.md` (gitignored). Prompt: unit text, ancestor constraints and failures, agent
   evidence (treated as claims, not facts), command results, changed files, rubric, lens focus. It must try
   to prove the work fails and answer with a fenced JSON block:
   `{ "verdict": "pass"|"fail", "expectations": [{"id","result":"pass"|"fail"|"unknown","evidence"}],
      "failures": [{"id","triggered":bool,"evidence"}], "constraints": [{"id","violated":bool,"evidence"}], "notes" }`
   Answers are merged: any fail/trigger/violation/out-of-scope wins, pass outranks unknown; a lens without an
   answer sets `needsHuman`.
4. Verdict pass requires: all commands exit 0, every E pass, no F triggered, no C violated (including ancestors).
   Without an independent verifier, verdict is based on commands only and E items of kind `manual` stay
   `unknown` for the human at acceptance.
5. Write `verify.json` (full) and `evidence.md` (human-readable), append metric `verify`, and move the unit
   (`done`, auto-accept at autonomy >= 2 without `needsHuman`, `building`, or `blocked` at `maxAttempts`).

Split mode for hosts with their own subagents: `iced verify <id> --prepare` runs steps 1-2 and writes one prompt per
lens plus `state.json` to `.iced/tmp/verify-<id>/`; the host runs an `iced-verifier` subagent per prompt (installed by
init as `.claude/agents/iced-verifier.md` and `.codex/agents/iced-verifier.toml`) that writes `<lens>.answer.md`;
`iced verify <id> --finish` does steps 4-5. Inside pi the gate blocks shell `iced verify`; `iced_submit` is the path.

## Portable protocol (agents without the extension)

`skills/iced/SKILL.md` and `.iced/ICED.md` describe the same flow for Claude Code, Codex, Cursor, etc.:
draft from the one-liner using the template, ask at most N high-risk questions, stop and ask the human to
approve (`node .iced/bin/iced.mjs approve <id>`, which starts the build), build autonomously, log decisions,
write `intent/<id>/submission.json` and run `node .iced/bin/iced.mjs verify <id>` (or `--prepare`/`--finish`
with host subagents), and let the human accept. Without the extension the gates are honor-based;
`iced validate` in CI catches contract tampering via `contract_hash`.

## CLI (`bin/iced.mjs`)

`iced init [--targets a,b] [--force] [--yes]` (asks for the verifier models once on a TTY unless `--yes`; only from the
package, not the vendored copy), `iced new <type> <title> [--parent id] [--risk level]`, `iced validate [--strict] [--json]` (lint all units at stage `validate`, exit 1 on
errors; used by `action.yml`), `iced list`, `iced status [id]`, `iced stats`, `iced approve <id> [--by name]
[--later]` and `iced accept <id> [--by name]` (for humans using other agents; sets hash/base_ref like the tool
does), `iced build <id>`, `iced verify <id> [--evidence file] [--runner name] [--prepare | --finish]`,
`iced activate <id> | --clear`, `iced stats [--apply]`, and `iced models` (`show`, `set <model...> [--runner]`,
`effort <level|clear> [--runner]`, `clear [--runner]`, `test-writer <model|clear> [--effort level]`, `list [runner]`;
changes rewrite the Claude/Codex verifier agent files). The gate blocks agents from changing models. The vendored
copy in `.iced/` includes `lib/iced-verify.mjs` and `rubric.md`.
