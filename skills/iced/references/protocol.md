# ICED protocol (v0.1)

ICED = **Intent, Context, Expectations, Done**. Derived from IDSD (Intent-Driven Software Development,
Kapil Viren Ahuja). Humans own *what* and *done*; agents own *how*.

This file is the agent-facing protocol. It works with any coding agent.

**If you have tools named `iced_*`** (pi with the `pi-intent` extension), use them for every step:
`iced_start`, `iced_questions`, `iced_request_signoff`, `iced_build` (when the human asks to implement
an approved unit), `iced_decision`, `iced_escalate`, `iced_submit`, `iced_status`. They enforce the rules
below; don't do the manual file steps or run `node .iced/bin/iced.mjs approve|accept`. Without those
tools, follow this protocol yourself.

## Files

| Path | Owner | Purpose |
|---|---|---|
| `intent/<id>/iced.md` | human (agent drafts while `draft`) | The contract: Intent, Context, Expectations |
| `intent/<id>/decisions.md` | agent, append-only | Significant choices with reasons |
| `intent/<id>/submission.json` | agent | Builder's summary and evidence claims for `iced verify` |
| `intent/<id>/evidence.md` | verifier | Proof per expectation |
| `intent/<id>/verify.json` | verifier | Machine verdict |
| `.iced/active` | tooling | Id of the active unit |
| `.iced/memory/product.md` | human + agent | Product memory |
| `.iced/memory/knowledge.md` | human | Standards (may point to shared org files) |
| `.iced/config.json` | human | Gate, autonomy, verify commands, verifier models and effort |

Ids look like `042-short-slug` (next free number in `intent/`).

## Lifecycle

```text
draft -> approved -> building -> verifying -> done -> accepted
                        ^            |          |
                        +---- fail --+          +-- human rejects --> building
any active state -> blocked -> back ; draft|approved|blocked -> rejected
```

Only a human (or the autonomy rule) sets `approved` and `accepted`.

## 1. Intent (from one line)

Given a one-line request:

1. Classify `type` (`bug`, `feature`, `project`, `review`, `chore`) and `tier` (S bug/chore, M feature,
   L project, XL program). Set `risk` (`low`, `medium`, `high`): high when it touches money, auth,
   personal data, production data, or is hard to undo.
2. Create the unit from `.iced/templates/<type>.md` (pi: `/iced <line>` does this).
3. Write **Goal** as an outcome for users or the business. No technologies or designs in the goal.
4. Write **Constraints** `[C1]...`: limits that hold regardless of approach.
5. Write **Failure conditions** `[F1]...`: observable ways the intent is missed. For bugs, `[F1]` is
   "the bug reproduces".
6. Write **Scope** `In:` / `Out:`. Out-of-scope stops drive-by changes.

## 2. Context (gather before asking)

Look things up in this order and tag every fact with its source:

1. `[code]` the codebase (the most honest record of what exists)
2. `[product]` `.iced/memory/product.md`
3. `[knowledge]` `.iced/memory/knowledge.md` and files in `config.memory.knowledge`
4. `[parent]` constraints and failure conditions of parent units (they cascade)
5. `[assumed]` your own inference, only when 1-4 are silent. Always tag it.

Resolve gaps from context yourself. Do not ask the human what the code can tell you.

## 3. Questions (few, high value)

Ask only about gaps that are **high risk or irreversible** and cannot be resolved from context,
at most `config.questions.max` (default 5), ideally 0-3, in one batch. Offer concrete options with your
recommendation first. Record each as `[Qn] question -> A: answer`. Everything else becomes an
`[assumed]` line the human can correct at sign-off.

## 4. Expectations (the definition of done)

Derive `[E1]...` from Intent plus Context, in user or business terms. Each MUST name how it is proven:

```text
- [E1] Toggle switches theme without reload. {verify: test | tests/theme.spec.ts}
```

Kinds: `test` (automated test), `check` (command/lint/scan), `metric` (measured number), `manual` (human steps).
Every failure condition should be covered by at least one expectation or test.

## 5. Sign-off (human gate)

Stop and present a short summary: goal, constraints, failure conditions, expectations, and every
`[assumed]` line. The human approves, requests changes, or rejects.

- pi: call `iced_request_signoff`.
- Other agents: ask the human; only after an explicit yes, run `node .iced/bin/iced.mjs approve <id>`
  (the human can run it too). It records `contract_hash` and moves the unit to `building`, so hand-editing
  `status: approved` fails `validate`. Never approve on the human's behalf. (`approve <id> --later` approves
  without starting; `build <id>` starts it when the human asks.)

At autonomy 3 with `risk: low` and no open questions, tooling may auto-approve.

After approval **Intent and Expectations are frozen** (`contract_hash`). To change them, escalate.

## 6. Build (autonomous)

You own the design and the plan. Do not ask for approval of either.

- Plan in your own working notes. Keep it current; do not drift silently.
- Write or update tests for expectations before or alongside the implementation. Failing first is best.
- Record significant decisions in `decisions.md` (pi: `iced_decision`): decision, why, alternatives rejected.
- Stay inside Scope and every Constraint, including parent constraints.
- **Escalate only** for (pi: `iced_escalate`):
  - `ambiguity`: the intent can reasonably mean two different things with different outcomes
  - `conflict`: a constraint and an expectation cannot both hold
  - `change-expectation`: an expectation is wrong or impossible and must change
  - `irreversible`: an action cannot be undone (data migration, deletion, external side effect)
  - `stuck`: repeated failed attempts with no new approach

  For `change-expectation` and `conflict`, give the contract lines exactly as they should read, one per line
  (`- [E4] New text. {verify: test | path}`; a new id adds one, `- [E5] (remove)` drops one). In pi the human then
  applies them with one choice; never ask the human to edit or paste the contract themselves.

## 7. Done (independent verification)

Submit evidence per expectation. Evidence is a claim; verification decides:

1. Configured `verify.commands` run, in parallel, and must pass.
2. Independent verifiers with fresh context try to prove the work **fails**: each expectation, whether any
   failure condition triggers, whether any constraint (including parents) is violated. Larger or risky units
   get three verifiers in parallel (expectations, breaking it, rules and scope); any failure from any of them fails.
3. Pass moves the unit to `done`; fail returns it to `building` with findings (up to `maxAttempts`, then `blocked`).

How to submit:

- pi: call `iced_submit`.
- Other agents: write `intent/<id>/submission.json`:

  ```json
  { "summary": "what changed", "evidence": [{ "expectation": "E1", "kind": "test", "ref": "tests/theme.spec.ts", "note": "optional" }] }
  ```

  then run `node .iced/bin/iced.mjs verify <id>`. It starts the verifiers as separate headless agents
  (`verify.runner`: `auto`, `pi`, `claude`, `codex`, `cursor`, `gemini` or a custom command) and writes
  `evidence.md` and `verify.json`. Exit code 0 means done; otherwise fix the listed problems and run it again.
- With your own subagents (Claude Code and Codex both get an `iced-verifier` agent from `init`): run
  `node .iced/bin/iced.mjs verify <id> --prepare`, start one `iced-verifier` per printed prompt **in parallel**
  (give it the prompt and answer paths), make sure each answer file holds the verifier's complete answer, then run
  `node .iced/bin/iced.mjs verify <id> --finish`.

Never set `status: done` or edit `evidence.md`, `verify.json` or the answer files yourself. Never change which models
verify your work (`.iced/config.json` `verify.model`/`verify.effort`, `iced models set|effort|clear|test-writer`); only
the human picks them. `node .iced/bin/iced.mjs models` shows them.

## 8. Accept (human gate)

The human reviews `evidence.md` and accepts (`/iced accept`, `node .iced/bin/iced.mjs accept <id>`) or rejects with a
reason (back to `building`). At autonomy 2+ a passing independent verification auto-accepts.

## Autonomy levels

| Level | Name | Human does |
|---|---|---|
| 0 | Assist | Confirms each code change and decision |
| 1 | Gated (default) | Signs off expectations, accepts result |
| 2 | Trusted | Signs off expectations; passing verification auto-accepts |
| 3 | Autonomous | Low-risk units with no open questions auto-approve; human is notified |

`risk: high` caps autonomy at 1.

## Layers (small to enterprise)

- `project` units (tier L/XL) hold program-level constraints and failure conditions.
- Child units set `parent: <project-id>` (pi: `/iced child <project-id> <line>`).
- Parent constraints and failure conditions apply to every child and are checked at child verification.
  A child that passes its own expectations but breaks a parent rule fails.
- Shared org knowledge: list external files in `.iced/config.json` `memory.knowledge`.

## Review units

`type: review` is read-only: produce findings (by severity, with file:line evidence) against the rubric in
`references/rubric.md` or the target's own ICED unit. No code changes.
