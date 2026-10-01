# pi-intent: ICED for pi and any coding agent

**ICED** = **Intent, Context, Expectations, Done**. You say what you want in one line, answer a few
questions, sign off on what "done" means, and the agent builds it on its own. An independent verifier
then tries to prove the work is broken before you accept it.

ICED is derived from IDSD (Intent-Driven Software Development) by Kapil Viren Ahuja. The normative
spec is [`spec/SPEC.md`](spec/SPEC.md).

```text
/iced add dark mode to settings
  -> agent reads code, product memory, standards; drafts intent/004-add-dark-mode/iced.md
  -> asks 0-5 high-risk questions
  -> you sign off (goal, constraints, failure conditions, expectations, assumptions)
  -> agent plans, decides and builds autonomously (logs decisions, escalates only when it must)
  -> iced_submit: checks + independent verifier -> evidence.md
  -> you accept (or it auto-accepts at autonomy 2+)
```

## Install

```powershell
pi install /path/to/pi-intent            # or: pi install git:github.com/<you>/pi-intent
```

Then, in any repository:

```text
/iced init              # optional; the first /iced <request> offers to do it
/iced fix users getting logged out after 15 minutes
```

Step by step, including what to do when you request changes, reject a result or a unit gets blocked:
[Quick start](docs/usage-examples.md#quick-start-the-whole-flow-in-pi).

## What `init` sets up

| File | For |
|---|---|
| `.iced/config.json` | gate, autonomy, verify commands (auto-detects `npm test`, `cargo test`, `go test`, `pytest`), verifier models |
| `.iced/ICED.md` | full protocol for any agent |
| `.iced/memory/product.md`, `knowledge.md` | product memory and standards (context sources) |
| `.iced/templates/*.md` | unit templates per type |
| `.iced/bin/iced.mjs`, `.iced/lib/`, `.iced/rubric.md` | the CLI, copied in, so any agent or CI can run it with plain Node |
| `intent/README.md` | where units live |
| `AGENTS.md` block | Codex, pi, Cursor, Copilot, Gemini CLI, Jules, Amp... |
| `CLAUDE.md` block, `.claude/commands/iced.md`, `.claude/skills/iced/` | Claude Code (`/iced ...` works there too) |
| `.agents/skills/iced/` | Codex and other Agent Skills readers |
| `.claude/agents/iced-verifier.md`, `.codex/agents/iced-verifier.toml` | read-only verifier subagents for Claude Code and Codex |
| `--targets cursor,copilot,gemini` | `.cursor/rules/iced.mdc` + `/iced` command, `.github/copilot-instructions.md`, `GEMINI.md` |

Blocks are managed (`<!-- ICED:BEGIN -->...<!-- ICED:END -->`), so your own content is kept and
re-running `init` is safe. In pi, `init` then asks which models verify the work (see Configuration).

## Updating

pi loads the extension from the installed package, so after updating pi-intent run `/reload` in pi. That is
all pi needs.

The copies in each repo (`.iced/bin`, `.iced/lib`, `.iced/rubric.md`, `.iced/ICED.md`, templates, skills, verifier
agents, managed blocks) are used by other agents and CI. Refresh them by running `init` again from the package:
`/iced init` in pi, or `node <pi-intent>/bin/iced.mjs init --yes` in the repo (the vendored copy cannot re-init
itself). It keeps `.iced/config.json` (unless `--force`) and everything in `intent/`, and doesn't touch unit
status or attempts, so it is safe mid-unit. Commit the refreshed files.

## Commands (pi)

| Command | |
|---|---|
| `/iced <what you want>` | start a unit; `bug:`, `feature:`, `project:`, `chore:` prefixes optional (`fix ...` means bug) |
| `/iced child <parent> <line>` | a unit under a project; parent rules cascade |
| `/iced list`, `/iced status [id]`, `/iced use <id \| none>` | inspect, switch (`none`: set the unit aside and work outside ICED) |
| `/iced approve [id]` | sign off (the agent usually asks for you) |
| `/iced build [id]` | start or resume a build |
| `/iced accept [id]`, `/iced reject [id] <reason>` | acceptance |
| `/iced abandon [id]` | drop a unit |
| `/iced review <id or what>` | read-only review |
| `/iced memory` | agent drafts `.iced/memory` from the repo |
| `/iced stats [apply]` | metrics and autonomy promotion |
| `/iced models [show]` | pick the verifier and test writer models and effort from your scoped models |
| `/iced models effort <level\|clear> [test-writer]` | effort for models that don't set their own |
| `/iced autonomy <0-3> [id]`, `/iced gate <strict\|always\|warn\|off>` | settings |

You can also just ask in plain words: in an ICED repo the agent calls `iced_start` itself.

Agent tools: `iced_start`, `iced_questions`, `iced_request_signoff`, `iced_build`, `iced_decision`,
`iced_escalate`, `iced_submit`, `iced_status`. The extension tells the model to use these whenever it is
loaded, and the skill and `AGENTS.md` block say the same, so agents don't fall back to the manual protocol.
`/iced init` reloads pi afterwards so the new skill and agent files load immediately.

## What is enforced (pi)

The gate applies while a unit is active: from `/iced <request>` until you accept, reject or abandon it, or run
`/iced use none`. With no active unit the agent works normally. Set `"gate": "always"` in `.iced/config.json` if
every code change in the repo must go through ICED.

- While a unit is active, no code changes unless it is `building` (write, edit and shell commands that look like
  they change files are blocked; read-only commands and `git add|commit|push|tag` are fine).
- The unit file is editable only while `draft`, and never its protected fields (status, autonomy,
  hashes, approvals).
- After sign-off, Intent and Expectations are frozen by `contract_hash`; changes go through
  `iced_escalate` and your edit.
- Agents cannot approve or accept, or change the models that verify their work.
- A build that stops without submitting gets up to two nudges to finish or escalate.
- "Done" is decided by `verify.commands` (run in parallel) plus independent verifiers: separate agent processes
  with fresh context and read-only tools that try to prove the work fails, including parent constraints.
  M/L/XL or high-risk units get three verifiers in parallel (expectations, breaking it, rules and scope); any
  failure from any of them fails the unit. Three failed attempts block the unit.

The shell check is a heuristic, not a sandbox; the verifier also reports every file changed since sign-off.

## Autonomy

| Level | You do |
|---|---|
| 0 Assist | confirm each change and decision |
| 1 Gated (default) | sign off, accept |
| 2 Trusted | sign off; passing independent verification auto-accepts |
| 3 Autonomous | low-risk units also auto-approve; you are notified |

`risk: high` caps at 1. `/iced stats` suggests raising a risk level's default after `promotion.window`
clean units in a row; `/iced stats apply` applies it.

## Other agents (Claude Code, Codex, Cursor...)

They follow the same protocol from `AGENTS.md`/`CLAUDE.md` and the `iced` skill, without the hard gate.
The human approves and accepts with the copied CLI:

```powershell
node .iced/bin/iced.mjs list
node .iced/bin/iced.mjs approve 4     # human sign-off; starts the build (--later: approve only)
node .iced/bin/iced.mjs build 4       # start later, or resume a blocked unit (resets attempts)
node .iced/bin/iced.mjs verify 4      # agent: checks + independent verifiers (reads intent/004-*/submission.json)
node .iced/bin/iced.mjs accept 4      # human acceptance
node .iced/bin/iced.mjs validate      # CI: fails on contract tampering or missing evidence
```

`verify` starts the verifiers as headless agents. `verify.runner` picks which one: `auto` (the agent it runs
inside, else the first of `pi`, `claude`, `codex`, `cursor-agent`, `gemini` on PATH), a name, or your own
`{"command": "...", "args": ["...", "{prompt}"]}` (placeholders: `{instruction}`, `{prompt}`, `{output}`, `{model}`, `{effort}`).
Presets run read-only: Claude `-p --permission-mode dontAsk` without edit tools, Codex `exec --sandbox read-only`,
Cursor `-p --mode plan`.

Agents with their own subagents can use them instead: `verify 4 --prepare` runs the checks and writes one prompt
per verifier, the agent starts one `iced-verifier` subagent per prompt in parallel, then `verify 4 --finish` merges
the answers. `init` installs `iced-verifier` for Claude Code (`.claude/agents/`) and Codex (`.codex/agents/`).

Outside pi, nothing stops the builder from tampering with verifier answers; rerun `verify` or the checks in CI
for units that matter.

CI (GitHub Actions):

```yaml
- uses: actions/checkout@v4
- uses: <you>/pi-intent@v0.1
```

## Configuration (`.iced/config.json`)

```json
{
  "gate": "strict",
  "autonomy": 1,
  "maxAutonomy": 3,
  "questions": { "max": 5 },
  "verify": {
    "commands": ["npm run lint", "npm run typecheck", ["npm run build", "npm run test:e2e"]],
    "parallel": true, "maxAttempts": 3, "independent": true,
    "runner": "auto", "lenses": "auto", "timeoutSec": 900,
    "model": { "pi": ["anthropic/claude-sonnet-5:high", "openai/gpt-5.6"], "claude": "opus" },
    "effort": null
  },
  "build": { "testWriter": false, "testWriterModel": null, "testWriterEffort": null },
  "memory": { "product": ".iced/memory/product.md", "knowledge": [".iced/memory/knowledge.md", "../org-standards/security.md"] },
  "promotion": { "mode": "suggest", "window": 10 }
}
```

- `verify.commands`: run in parallel; a nested list runs in order and stops at the first failure.
  `"parallel": false` runs everything in order.
- `verify.lenses`: `auto` (three parallel verifiers for M/L/XL or high risk, one otherwise), `single`,
  `parallel`, or a list of `expectations`, `failures`, `rules`.
- `verify.model`: model for the verifiers, or a list rotated across them (for example two different
  vendors, so they don't share blind spots). Agent CLIs name models differently, so it can be an object
  per runner (`pi`, `claude`, `codex`, `cursor`, `gemini`, plus `default`). A `:level` suffix sets the effort.
  Unset, pi verifiers use the session's model and thinking level; other CLIs use their own default.
  A comma-separated string such as `"cursor/a, cursor/b"` is read as a list.
- `verify.effort`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`, one value or per runner.
  pi passes `--thinking`, Claude `--effort`, Codex `model_reasoning_effort`; Cursor and Gemini put effort in
  the model name, so the report marks it as not supported there.

Setting the models:

- In pi, `/iced init` asks once, offering your scoped models (`/scoped-models`, with their thinking levels),
  a rotation of up to three, the session model, or a typed name. Change it later with `/iced models`.
  Without a UI it pins the session model. "Don't pin" is remembered as `{"pi": null}`, so init doesn't ask
  again. In the terminal picker:

  | Key | Does |
  |---|---|
  | ←/→ or `shift+tab` (pi's thinking key) | cycle the highlighted model's effort: default, off, minimal ... max |
  | `space` | add or remove the model from the rotation (up to three, in order) |
  | letters | filter the list; `esc` clears the filter, then cancels |
  | `enter` | choose the picked models, or the highlighted row |

  On a rotation row the effort applies to all its models; on "Don't pin" it sets the effort used with the
  session model. "default" means `verify.effort`, else the session's thinking level. In the VS Code panel
  (RPC mode) custom pickers aren't available, so a plain list opens and then asks for the effort.
  `/iced models effort high` sets the effort without opening the picker.
- From a terminal, `iced init` asks once for the models of the runner it will use (Enter = don't pin). Or:

  ```powershell
  node .iced/bin/iced.mjs models                                   # show
  node .iced/bin/iced.mjs models list pi                           # pi --list-models (cursor: cursor-agent models)
  node .iced/bin/iced.mjs models set anthropic/claude-sonnet-5:high openai/gpt-5.6 --runner pi
  node .iced/bin/iced.mjs models set opus --runner claude
  node .iced/bin/iced.mjs models effort high --runner codex
  node .iced/bin/iced.mjs models test-writer anthropic/claude-sonnet-5 --effort medium
  node .iced/bin/iced.mjs models clear --runner claude
  ```

  Changes also update `.claude/agents/iced-verifier.md` and `.codex/agents/iced-verifier.toml`
  (`model`, `effort`/`model_reasoning_effort`), so split mode uses them too.
- `verify.runner`: which agent CLI runs verifiers from `iced verify` (see above). `ICED_RUNNER` overrides it.
- `build.testWriter`: after sign-off, a separate agent that sees only the contract writes the tests first.
- `memory.knowledge`: may point outside the repo (shared enterprise standards).

On Windows, checks and verifiers always start from an uppercase drive (`D:\`), even when pi runs from `d:\`,
because some tools (Vitest) crash otherwise.

## Small to enterprise

Same file, more depth. A bug is one short unit (tier S). A feature adds product memory and a parent
(M). A project holds program-level constraints and failure conditions that every child inherits and the
verifier checks (L). A program spans projects and shared knowledge files (XL). See
[`spec/examples`](spec/examples).

## Development

```powershell
npm test                      # node:test, no dependencies
npm run validate:examples
pi -e ./extensions/iced/index.ts
```
