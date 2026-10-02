# ICED specification, version 0.1

ICED stands for **Intent, Context, Expectations, Done**. It is a way to hand software work to coding
agents: a human states what they want and what counts as done, the agent decides how, and an independent
check decides whether it is done.

ICED is derived from IDSD (Intent-Driven Software Development) by Kapil Viren Ahuja, in particular its
ICE model (Intent, Context, Expectations) and its context lookup order. ICED adds a file format, a
lifecycle, autonomy levels and independent verification (the "Done" part). The wording here is original.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in RFC 2119.

## 1. Principles

1. Humans own the **what** (Intent) and the **done** (Expectations). Agents own the **how**.
2. The intent is the source of truth. Plans, designs and code are the agent's working material, not
   contracts, and are not approved.
3. An agent MUST NOT write, change or approve the criteria it is judged by.
4. Guesses are always visible. Anything the agent inferred without a source is tagged `[assumed]` and
   shown to the human before approval.
5. Human attention goes to the two ends: sign-off before building, acceptance after. Everything in
   between is autonomous, bounded by constraints and escalation rules.
6. One format from a one-line bug fix to an enterprise program. Size changes depth, not process.

## 2. Terminology

| Term | Meaning |
|---|---|
| Unit | One piece of work: a project, feature, bug, review or chore. |
| Contract | The Intent and Expectations sections of a unit, frozen at approval. |
| Sign-off | The human gate that approves a drafted contract. |
| Acceptance | The human gate that accepts a verified result. |
| Verifier | A process, independent of the builder, that tries to prove the unit is not done. |
| Evidence | The builder's claims, per expectation, of how it was met. Claims are not facts until verified. |
| Autonomy | How much the agent may do without a human (levels 0-3). |
| Layer | A parent/child relation between units (program, capability, feature). |

## 3. Repository layout

A conforming repository MUST contain:

```text
.iced/config.json          configuration (section 12)
intent/<id>/iced.md        one file per unit
```

and SHOULD contain:

```text
.iced/memory/product.md    product memory
.iced/memory/knowledge.md  standards (or pointers to shared files)
.iced/templates/<type>.md  unit templates
.iced/active               id of the active unit (local, not committed)
.iced/metrics.jsonl        append-only events (section 11)
intent/<id>/decisions.md   agent decision log
intent/<id>/evidence.md    human-readable verification report
intent/<id>/verify.json    machine-readable verification report
```

A unit id MUST match `^\d{3,}-[a-z0-9-]+$` (for example `042-dark-mode`). The number is the next free
number in `intent/`; the slug is at most 40 characters.

## 4. Unit file format

A unit file is Markdown with frontmatter. The frontmatter MUST be a block delimited by `---` lines at the
start of the file, containing one `key: value` pair per line. Values are scalars only: a string
(optionally double-quoted, JSON escaping), an integer, `true`, `false` or `null`. Nesting and lists are
not allowed. `spec/iced.schema.json` is the JSON Schema of the resulting object.

### 4.1 Frontmatter fields

| Field | Type | Required | Owner | Meaning |
|---|---|---|---|---|
| `iced` | string | yes | tooling | Spec version, `0.1` |
| `id` | string | yes | tooling | Unit id (section 3) |
| `title` | string | yes | agent/human | Short name |
| `type` | enum | yes | agent/human | `project`, `feature`, `bug`, `review`, `chore` |
| `tier` | enum | yes | agent/human | `S`, `M`, `L`, `XL` |
| `parent` | id or null | no | agent/human | Parent unit (section 9) |
| `status` | enum | yes | tooling/human | Lifecycle state (section 6) |
| `autonomy` | 0-3 | yes | human | Autonomy level (section 7) |
| `risk` | enum | yes | agent/human | `low`, `medium`, `high` |
| `attempts` | integer | no | tooling | Failed verification count |
| `created` | ISO 8601 | no | tooling | Creation time |
| `approved_at`, `approved_by` | string or null | no | tooling | Sign-off record |
| `contract_hash` | 64 hex or null | no | tooling | Section 5 |
| `base_ref` | string or null | no | tooling | VCS revision at approval |
| `accepted_at`, `accepted_by` | string or null | no | tooling | Acceptance record |
| `blocked_from` | status or null | no | tooling | State before `blocked` |

Fields owned by tooling or the human (`iced`, `id`, `status`, `autonomy`, `attempts`, `approved_*`,
`contract_hash`, `base_ref`, `accepted_*`, `blocked_from`) are **protected**: an agent MUST NOT change
them. Unknown fields MUST be preserved by tools.

Default tiers: `bug`, `chore` and `review` are `S`; `feature` is `M`; `project` is `L`. `XL` is a program
spanning several projects or repositories. Risk SHOULD be `high` when the work touches money, access
control, personal data or production data, or is hard to undo.

### 4.2 Body sections

Sections are identified by heading text, case-insensitive. Canonical level-two sections (`Intent`, `Context`,
`Expectations`, `Open questions`) MUST NOT repeat; validators MUST report duplicates at every lint stage.
Other sections MAY exist and MUST be preserved.

```text
# <title>
## Intent
### Goal
### Constraints
### Failure conditions
### Scope
## Context
## Expectations
## Open questions
```

HTML comments are ignored when parsing.

- **Goal**: free text. The outcome for users or the business. It SHOULD NOT name technologies or designs.
- **Constraints**: items `[C<n>]`. Limits that hold regardless of approach. A sentence that picks a
  tool, pattern or design is Context, not a constraint.
- **Failure conditions**: items `[F<n>]`. Observable ways the intent is missed. They become negative
  tests. For a bug, `[F1]` SHOULD be "the reported behavior still occurs".
- **Scope**: lines `- In: a, b` and `- Out: c, d`.
- **Context**: lines `- [<tag>] <fact>`, tag one of `code`, `product`, `knowledge`, `parent`, `assumed`.
- **Expectations**: items `[E<n>] <text> {verify: <kind> | <ref>}`. `kind` is `test`, `check`, `metric`
  or `manual`; `ref` names the test, command, measurement or manual steps.
- **Open questions**: items `[Q<n>] <question> -> A: <answer>`. A question without `-> A:` is open.

An item line is `- [<ID>] <text>`. Item ids MUST be unique within a unit. An item MAY wrap: following non-blank
lines that are not a heading or a new list item continue it, so a `{verify: ...}` tag or `-> A:` answer on a
wrapped line still counts. A blank line ends the item.

## 5. Contract hash

`contract_hash` is the lowercase hex SHA-256 of the UTF-8 string

```text
"## intent\n" + N(intent) + "\n## expectations\n" + N(expectations)
```

where `N(section)` is the section's lines after its `##` heading up to the next `##` heading, with HTML
comments removed, CRLF converted to LF, trailing whitespace removed from each line, and empty lines
dropped, joined with `\n`. Frontmatter, Context and Open questions are not part of the hash.

The hash MUST be set at sign-off. For any unit past sign-off (`approved`, `building`, `verifying`,
`done`, `accepted`), a mismatch between the stored and computed hash means the contract was changed
without approval; validators MUST report it as an error.

## 6. Lifecycle

```text
draft -> approved -> building -> verifying -> done -> accepted
                        ^            |          |
                        +---- fail --+          +-- human rejects --> building
```

| From | Allowed to |
|---|---|
| `draft` | `approved`, `rejected` |
| `approved` | `building`, `rejected` |
| `building` | `verifying`, `blocked` |
| `verifying` | `done`, `building`, `blocked` |
| `done` | `accepted`, `building` |
| `blocked` | `draft`, `approved`, `building`, `rejected` |
| `accepted`, `rejected` | (terminal) |

Ownership of transitions:

- `draft -> approved` (sign-off): the human, or the autonomy rule in section 7. It sets `approved_*`,
  `contract_hash` and `base_ref`.
- `verifying -> done`: only the verification process (section 8).
- `done -> accepted` (acceptance): the human, or the autonomy rule in section 7.
- `done -> building`: the human rejects the result with a reason.
- A human MAY abandon a unit (`rejected`) from any non-terminal state.

While a unit is `draft`, the agent MAY edit its body and unprotected fields. After sign-off the agent
MUST NOT edit the Intent or Expectations sections; the only path to change them is an escalation that
the human resolves by editing the contract, after which the hash is recomputed. Other parts of the unit
(Context, Open questions, title, tier, risk) MAY still be edited by the agent after sign-off, provided the
contract hash and protected fields stay unchanged and the unit stays valid. Accepted and rejected units
are closed and MUST NOT be edited.

## 7. Autonomy

| Level | Name | Sign-off | Acceptance |
|---|---|---|---|
| 0 | Assist | human | human; the human also confirms each code change and decision |
| 1 | Gated (default) | human | human |
| 2 | Trusted | human | automatic when an independent verifier passed and no `manual` expectation is unknown |
| 3 | Autonomous | automatic when `risk: low` and no open questions; otherwise human | as level 2 |

Effective autonomy is `min(unit.autonomy, config.maxAutonomy)`, and at most 1 when `risk: high`.
Automatic transitions MUST be recorded (`approved_by: auto`, `accepted_by: auto`) and SHOULD notify the
human.

Tools SHOULD suggest raising the default autonomy for a risk level when the most recent
`config.promotion.window` accepted units at that level had no human rejection and no escalation. Tools
MUST NOT raise it automatically unless the human asks.

## 8. Flow

### 8.1 Intent

From a one-line request the agent drafts the unit: type, tier, risk, Goal, Constraints, Failure
conditions and Scope.

### 8.2 Context

The agent MUST gather context before asking the human anything, in this order, and tag each fact:

1. `[code]` the codebase;
2. `[product]` product memory;
3. `[knowledge]` standards and shared knowledge files;
4. `[parent]` rules inherited from parent units;
5. `[assumed]` the agent's own inference, only when 1-4 are silent.

### 8.3 Questions

The agent MAY ask questions only about gaps that are high risk or hard to undo and that context cannot
resolve, in one batch, at most `config.questions.max` per unit (default 5). Questions SHOULD offer
concrete options with a recommendation. Answers are recorded as `[Q<n>]` items. Other gaps become
`[assumed]` context lines.

### 8.4 Expectations and sign-off

The agent derives Expectations from Intent and Context, in user or business terms. Every expectation
MUST have a verify suffix. Every failure condition SHOULD be covered by an expectation or a test.

Before sign-off the unit MUST have a Goal, at least one expectation, at least one failure condition
(except `review` units), no open questions, and verify suffixes on all expectations. The human sees the
goal, constraints, failure conditions, expectations and every `[assumed]` line, and approves, requests
changes or rejects.

### 8.5 Build

After sign-off the agent builds autonomously. It MUST stay within Scope and every constraint, including
inherited ones. It SHOULD record significant decisions in `decisions.md` with the reason and rejected
alternatives. Plans are the agent's own and are not approved.

The agent MUST stop and escalate only for:

| Kind | When |
|---|---|
| `ambiguity` | The intent has two reasonable readings with different outcomes. |
| `conflict` | A constraint and an expectation cannot both hold. |
| `change-expectation` | An expectation is wrong or impossible. |
| `irreversible` | An action cannot be undone (data deletion, migration, external side effect). |
| `stuck` | Repeated failure with no new approach. |

While escalated the unit is `blocked`.

### 8.6 Done

The builder submits evidence for every expectation. Verification then:

1. runs `config.verify.commands`; any non-zero exit fails verification. Entries MAY run in parallel; an
   entry that is a list runs in order;
2. when `config.verify.independent` is true, runs a verifier with fresh context and no write access,
   given the unit, inherited rules, the builder's evidence (as claims), check results and changed files.
   It tries to prove the work fails and answers with:

   ```json
   { "verdict": "pass", "expectations": [{ "id": "E1", "result": "pass", "evidence": "..." }],
     "failures": [{ "id": "F1", "triggered": false, "evidence": "..." }],
     "constraints": [{ "id": "C1", "violated": false, "evidence": "..." }],
     "outOfScope": [], "notes": "..." }
   ```

   Inherited rules use qualified ids, `<parent-id>:<item-id>`.

   Tools MAY run several verifiers in parallel, each with a focus (for example expectations, failure
   conditions, rules and scope). Their answers are merged so that any `fail`, triggered failure condition,
   violated constraint or out-of-scope change from any verifier counts, and `pass` outranks `unknown`. If
   some verifiers answer and others do not, a pass requires human acceptance.

The verdict is **pass** only when every check command passed, every expectation has evidence, and, with
a verifier, every expectation passed (a `manual` expectation MAY be `unknown`, which then requires human
acceptance), no failure condition is triggered, no constraint is violated and nothing is out of scope.
ICED's own records under `intent/` and `.iced/` (unit files, evidence, `verify.json`, `.iced/metrics.jsonl`,
config, tmp) are never out of scope: out-of-scope entries naming only such paths are ignored (reported as
`ignoredOutOfScope`), and a verifier `fail` with nothing else behind it does not fail the unit.
Without a verifier, a pass always requires human acceptance.

On pass the unit moves to `done`. On fail it returns to `building` with the findings and `attempts`
increases; when `attempts` reaches `config.verify.maxAttempts` it moves to `blocked`. Results are written
to `evidence.md` and `verify.json`.

Tools MAY run an isolated test writer after sign-off that sees only the contract and writes tests before
the implementation (`config.build.testWriter`).

### 8.7 Acceptance

The human reviews `evidence.md` and accepts or rejects with a reason. A `done` or `accepted` unit MUST
have `evidence.md`.

## 9. Layers and cascade

A unit MAY name a `parent`. Parent chains MUST NOT contain cycles; tools MUST stop at a repeated id.

Every ancestor's constraints and failure conditions apply to the child. The builder MUST respect them
and the verifier MUST check them. A child that meets its own expectations but violates an ancestor rule
fails. A project's expectations are met by its accepted children plus any end-to-end checks it names.

Shared organisational knowledge MAY live outside the repository; `config.memory.knowledge` lists the
files.

## 10. Review units

`type: review` units are read-only: during `building` the agent MUST NOT change code. Findings go to
`intent/<id>/review.md`, by severity, with file and line evidence, checked against `spec/rubric.md`.

## 11. Metrics

Tools SHOULD append one JSON object per line to `.iced/metrics.jsonl`:
`{ "ts": ISO, "id": unit, "event": name, ... }`, with events `created`, `questions {count}`,
`signoff {result, auto}`, `verify {result, attempt}`, `escalation {kind}`, `accept {auto}`,
`reject {reason}` and `abandon`, each carrying `risk` and `autonomy` where known.

## 12. Configuration

`.iced/config.json` keys (missing keys take the defaults shown):

```json
{
  "iced": "0.1",
  "gate": "strict",
  "autonomy": 1,
  "maxAutonomy": 3,
  "autonomyByRisk": { "low": null, "medium": null, "high": null },
  "questions": { "max": 5 },
  "verify": {
    "commands": [], "parallel": true, "maxAttempts": 3, "independent": true,
    "lenses": "auto", "model": null, "effort": null, "timeoutSec": 900
  },
  "build": { "testWriter": false, "testWriterModel": null, "testWriterEffort": null },
  "memory": { "product": ".iced/memory/product.md", "knowledge": [".iced/memory/knowledge.md"] },
  "promotion": { "mode": "suggest", "window": 10 }
}
```

`verify.lenses` is `auto`, `single`, `parallel` or a list of focus names. `verify.model` is a model or a list rotated
across verifiers; a string MAY list several models separated by commas outside brackets, and a model MAY end in
`:<effort>`. An empty list means the human chose no model; it resolves like an unset model. Older configurations MAY
hold an object keyed by host name with an optional `default`; a tool SHOULD read its own host's entry, then `default`.
`verify.effort` is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Unknown keys MUST be ignored.
`build.testWriterModel` and
`build.testWriterEffort` set the same for the test writer. Only a human SHOULD change the verifier models, and
an Enforcer SHOULD block agents from changing them. `gate` is `strict` (block while a unit is active), `always` (also block code changes when no unit is active),
`warn` (notify instead of blocking code changes; protection of owned files, protected fields, the frozen contract
and the verifier settings MUST still block) or `off`. With no active unit and gate `strict`, agents work normally.

## 13. Hosts

A host is the integration that brings ICED to a coding agent. It tells the agent, in its own way, where units live,
that while a unit is active code changes wait for its sign-off, and that the contract and protected fields must not be
changed. It also starts the independent verifiers (section 8.6) as separate agents with fresh context and read-only
access. Set-up writes only the files in section 3; anything a host needs beyond them is the host's concern.

## 14. Conformance

| Level | A tool... |
|---|---|
| Reader | parses units per section 4 and reports lint errors per `spec/rubric.md` and section 5. |
| Writer | also creates units from templates, keeps unknown fields and sections, records sign-off and acceptance with the contract hash, and follows the transitions in section 6. |
| Enforcer | also prevents agents from editing a frozen contract, protected fields or ICED-owned files, and from self-approving or choosing their own verifiers; freezes code changes inside the repository outside a building unit at effective autonomy 0 and 1 (at 2 and 3 it MAY allow them with a notice, since verification checks the result against the contract); and runs verification per section 8.6. |

Without an Enforcer the rules are followed on trust; a Reader still detects contract changes through the hash.

## 15. Versioning

The `iced` field names the spec version. Versions `0.x` MAY change incompatibly; a tool SHOULD warn on a
version it does not know and MUST NOT rewrite a unit of a newer major version.
