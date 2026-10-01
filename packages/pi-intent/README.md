# @arturleao/pi-intent: ICED for pi

**ICED** = **Intent, Context, Expectations, Done**. You say what you want in one line, answer a few
questions, sign off on what "done" means, and the agent builds it on its own. Independent verifiers then
try to prove the work is broken before you accept it.

This package is the [pi](https://pi.dev) extension. The protocol, contract handling and verification live in
[`@arturleao/iced-core`](https://www.npmjs.com/package/@arturleao/iced-core), which knows nothing about pi.
ICED is derived from IDSD (Intent-Driven Software Development) by Kapil Viren Ahuja; the normative spec is
`spec/SPEC.md` in iced-core.

```text
/iced add dark mode to settings
  -> agent reads code, product memory, standards; drafts intent/004-add-dark-mode/iced.md
  -> asks 0-5 high-risk questions
  -> you sign off (goal, constraints, failure conditions, expectations, assumptions)
  -> agent plans, decides and builds autonomously (logs decisions, escalates only when it must)
  -> iced_submit: checks + independent verifiers -> evidence.md
  -> you accept (or it auto-accepts at autonomy 2+)
```

## Install

```powershell
pi install npm:@arturleao/pi-intent
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
| `.iced/memory/product.md`, `knowledge.md` | product memory and standards (context sources) |
| `.iced/templates/*.md` | unit templates per type |
| `intent/README.md` | where units live |
| `.gitignore`, `.gitattributes` lines | keep `.iced/active` and `.iced/tmp/` local; LF for unit files |

Re-running `init` is safe: it keeps `.iced/config.json`, memory and everything in `intent/`, refreshes the
templates, and never deletes anything. The protocol reaches the agent through the extension's tools and
system prompt, so there is nothing else to install per repository. Files written by older versions of this
package for other tools (copies under `.iced/` such as `bin/`, `lib/` and the protocol and rubric files, managed
blocks in agent instruction files, verifier agent definitions) are no longer used and can be deleted.

## Updating

```powershell
pi update --extensions
```

Then `/reload` in pi.

## Commands

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
`iced_escalate`, `iced_submit`, `iced_status`. The extension tells the model to use these whenever it is loaded.

## What is enforced

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
- "Done" is decided by `verify.commands` (run in parallel) plus independent verifiers: separate pi processes
  with fresh context and only read tools (read, grep, find, ls; no shell, no write or edit) that try to prove the
  work fails, using the code and the check results, including parent constraints.
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
    "lenses": "auto", "timeoutSec": 900,
    "model": ["anthropic/<model>:high", "openai/gpt-5.6"],
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
- `verify.model`: pi model for the verifiers (`provider/model`), or a list rotated across them (for example two
  different vendors, so they don't share blind spots). A `:level` suffix sets the thinking level. Unset, verifiers
  use the session's model and thinking level. A comma-separated string is read as a list. Configs from older
  versions with an object per tool (`{"pi": [...], ...}`) still work: the `pi` entry is used.
- `verify.effort`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`, passed to pi as `--thinking` when
  a model has no `:level`.
- `build.testWriter`: after sign-off, a separate pi agent that sees only the contract writes the tests first.
- `memory.knowledge`: may point outside the repo (shared enterprise standards).

Setting the models: `/iced init` asks once, offering your scoped models (`/scoped-models`, with their thinking
levels), a rotation of up to three, the session model, or a typed name. Change it later with `/iced models`.
Without a UI it pins the session model. "Don't pin" is remembered as an empty list, so init doesn't ask again.
In the terminal picker:

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

On Windows, checks and verifiers always start from an uppercase drive (`D:\`), even when pi runs from `d:\`,
because some tools (Vitest) crash otherwise.

## Small to enterprise

Same file, more depth. A bug is one short unit (tier S). A feature adds product memory and a parent
(M). A project holds program-level constraints and failure conditions that every child inherits and the
verifier checks (L). A program spans projects and shared knowledge files (XL). See the worked examples in
iced-core's `spec/examples`.

## More

- [Usage examples](docs/usage-examples.md)
- [Design](docs/design.md)

## License

MIT
