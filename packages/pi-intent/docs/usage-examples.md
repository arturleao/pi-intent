# ICED usage examples

Real-world walkthroughs of `pi-intent`, from an empty folder to an enterprise program. Transcripts are
illustrative: the exact wording, ids and questions depend on your repo and model, but the commands,
dialogs and file layout are the real ones.

Each scenario shows what you type, what the agent does on its own, and the two moments you decide:
**sign-off** (is this what I want?) and **acceptance** (is this done?).

## Quick start: the whole flow in pi

### The normal path

```text
/iced init                                              # once per repo
/iced Implement a combobox in the model selection       # start a unit
  ...answer the agent's questions (0-5 dialogs)
  ...sign-off dialog: Approve and build
  ...wait: the agent builds, tests and submits; verifiers check it
/iced status                                            # read the result (or open intent/<id>/evidence.md)
/iced accept                                            # done
```

| Step | You do | What happens | Status after |
|---|---|---|---|
| 1 | `/iced init` (once per repo) | Creates `.iced/` and `intent/`, and asks which models verify the work. Check `verify.commands` in `.iced/config.json` (for example `["npm run lint", "npm test"]`) and commit the setup. | - |
| 2 | `/iced Implement a combobox in the model selection` | Creates `intent/004-implement-a-combobox-in-the-model-select/iced.md` and makes it the active unit. The agent reads the code and memory, then drafts the goal, constraints, failure conditions and expectations. | `draft` |
| 3 | Answer the question dialogs | Only for gaps that are risky and not answered by the code. Pick the recommended option when you don't care. The answers are saved in the unit. | `draft` |
| 4 | Sign-off dialog: **Approve and build** | Read the expectations and every **Assumption**, because this is the cheapest place to catch a wrong guess. Approving freezes the contract and starts the build. | `building` |
| 5 | Wait | The agent plans and builds on its own, logs decisions in `decisions.md` and calls `iced_submit`. The checks and independent verifiers run. On a failure it fixes and resubmits by itself (up to 3 attempts). | `done` |
| 6 | `/iced status`, read `evidence.md`, try it | The evidence lists proof for each expectation, what the verifiers found and which files changed. | `done` |
| 7 | `/iced accept` | You accept, so the unit is closed. Commit the code with `intent/004-*`: the unit files are the record. | `accepted` |

You can also skip the command and ask in plain words ("implement a combobox in the model selection");
in an ICED repo the agent starts the unit itself with `iced_start`. Without an id, the commands act on the
active unit; add the number to target another one (`/iced accept 4`).

### When it doesn't go straight through

| Situation | Do this | What happens |
|---|---|---|
| **The draft is wrong at sign-off** | Choose **Request changes** and say what ("E2 must also cover keyboard navigation"). | The unit stays a draft. The agent revises it and shows the sign-off again. While it's a draft you may also edit `iced.md` yourself, then run `/iced approve`. |
| **You closed the sign-off dialog** | `/iced approve` | The unit was left as a draft; this reopens the sign-off. |
| **Approve now, build later** | Choose **Approve, build later**; later run `/iced build 4` (or tell the agent "build unit 4"). | The unit waits as `approved`. |
| **You don't want it at all** | **Reject** at sign-off, or `/iced abandon 4` at any time. | `rejected`, and the unit is closed. |
| **The agent asks you mid-build** | Answer the dialog (see below). | The unit is `blocked` while it waits, then carries on building. |
| **You change your mind mid-build** | Tell the agent: "E2 must change to ...; escalate it as a change-expectation". | It escalates with the new lines; you see the change and choose **Apply this change**, and the contract is re-approved. Don't edit `iced.md` yourself after sign-off: lint then reports `contract-changed` and acceptance refuses the unit. |
| **A verification failed** | Nothing. | The agent gets the findings, fixes them and resubmits, up to `verify.maxAttempts` (3). |
| **Blocked after 3 failed attempts** | `/iced status 4` to read the findings, then `/iced build 4`, optionally followed by a hint in chat. | The attempts reset to 0 and the build resumes. Or `/iced abandon 4`. |
| **Everything passed, but you want changes** | `/iced reject 4 <what to change>` (before accepting). | The unit goes back to `building` with your reason, the agent changes it and resubmits, and you accept. The verifiers check the contract, not your reason, so confirm the change yourself. |
| **...and the change alters what "done" means** | Same, and add "an expectation must change" to the reason. | The agent escalates a change-expectation, you edit the contract, and the verifiers check the new expectation from then on. |
| **Already accepted, want more** | Start a new unit: `/iced fix ...`, `/iced feature: ...`, `/iced chore: ...`. | Accepted is final; the new unit has its own contract and evidence. |
| **Want it checked on every future unit** | Add it to `.iced/memory/knowledge.md`. | Every unit inherits it as context (scenario 8). |
| **The agent stopped before submitting** | Usually nothing: it is nudged twice. Otherwise `/iced build 4`. | The build resumes with the unit's rules. |
| **New session, or you switched work** | `/iced list`, then `/iced use 4` and `/iced build 4`. | The unit becomes active again and the build continues. |
| **Quick work outside ICED** | Nothing, once the unit is accepted, rejected or abandoned. With a unit still open: `/iced use none`, and later `/iced use 4`. | With no active unit the gate stays out of the way and the agent works normally. Set `"gate": "always"` in `.iced/config.json` to require a unit for every change. |
| **Verifiers hit rate limits or you want another model** | `/iced models` | Scenario 13. |
| **You updated pi-intent** | `/reload` | Scenario 14. |

The mid-build dialogs, by escalation kind:

| The agent says | Your choices |
|---|---|
| `change-expectation` or `conflict` | **Apply this change** (ICED writes the agent's proposed lines and re-approves the contract), **Edit it first** (an editor opens with the change already applied), **Keep the contract, give guidance** (type a hint), or **Abandon the unit**. If the proposal has no contract lines ICED can apply, you get **Edit the contract now** instead. |
| `irreversible` (migration, deletion, external side effect) | **Yes** (it goes ahead exactly as described) or **No** (it must find another way) |
| `ambiguity` or `stuck` | Type an answer (its proposal is prefilled) |

**Attempts are shared.** A verification that passes also uses an attempt, and `/iced reject` doesn't reset
the count. So after a reject, one failed resubmit can block the unit sooner than you'd expect; `/iced build 4`
resets it and carries on.

```text
draft --sign-off--> building --submit--> done --accept--> accepted
  |                  ^   |                |
  | request changes  |   +-- fail (x3) --> blocked --/iced build--> building
  +--(stays draft)   +------- /iced reject <reason> ---+
```

---

| # | Scenario | Type | Tier | Shows |
|---|---|---|---|---|
| 1 | [New project from scratch](#1-new-project-from-scratch) | project + children | L | init in an empty folder, cascade, first verify commands |
| 2 | [New feature in an existing app](#2-new-feature-in-an-existing-app) | feature | M | the default one-line flow |
| 3 | [Bug fix](#3-bug-fix) | bug | S | failure condition = the bug, regression test first |
| 4 | [New UI screen](#4-new-ui-screen) | feature | M | visual expectations, manual checks, e2e tests |
| 5 | [Refactor / chore](#5-refactor-or-chore) | chore | S | "no behavior change" as the contract |
| 6 | [Code review or audit](#6-code-review-or-audit) | review | S | read-only unit |
| 7 | [Agent hits a wrong expectation](#7-agent-hits-a-wrong-expectation-mid-build) | any | - | escalation, contract edit |
| 8 | [Verification fails, you reject](#8-verification-fails-and-you-reject) | any | - | retries, blocked, human reject |
| 9 | [Risky change: migration or payments](#9-risky-change-migration-or-payments) | feature | M | high risk, irreversible actions |
| 10 | [Enterprise program](#10-enterprise-program-across-teams) | project tree | XL | shared standards, inherited rules |
| 11 | [Team workflow](#11-team-workflow-units-in-git-and-pull-requests) | any | - | units in git, pull requests, a CI check with the core library |
| 12 | [Growing trust](#12-growing-trust-raising-autonomy) | - | - | stats, autonomy promotion |
| 13 | [Choosing verifier models and effort](#13-choosing-verifier-models-and-effort) | - | - | model picker, rotation, effort |
| 14 | [Updating pi-intent in your repos](#14-updating-pi-intent-in-your-repos) | - | - | `/reload`, re-running init |

---

## 1. New project from scratch

**Situation:** an empty folder. You want a small internal tool: a web app where the team logs
on-call handovers.

```powershell
mkdir ~/src/oncall-log; cd ~/src/oncall-log; git init; pi
```

```text
> /iced project: on-call handover log for the platform team, web app, runs on our Azure tenant
```

ICED is not set up yet, so pi asks:

```text
ICED is not set up here
Initialize ICED in ~/src/oncall-log? (creates .iced/ and intent/)   [Yes] [No]
```

After **Yes**, pi asks once which models should verify the work (scenario 13 has the details). Pick the
recommended rotation, or **Don't pin** to use whatever model the session has:

```text
ICED verifier models
  > Rotate (recommended): anthropic/sonnet-5:high, openai/gpt-5.6, openrouter/auto
    [ ] anthropic/sonnet-5 (session)      effort high
    ...
```

Then the agent creates `intent/001-on-call-handover-log/iced.md` from the project template,
looks for context (there is no code yet, so almost everything is `[knowledge]` or `[assumed]`), and
asks only what it cannot guess safely:

```text
001-on-call-handover-log: Who can read handovers?
  > Anyone in the platform team (Entra ID group) (recommended)
    Anyone in the company
    Other...

001-on-call-handover-log: Stack preference?
  > No preference, pick what fits Azure App Service (recommended)
    TypeScript / Node
    .NET
    Other...
```

Then the sign-off dialog shows the drafted contract:

```text
ICED sign-off: 001-on-call-handover-log

Goal: The on-call engineer coming on shift knows open incidents, risks and
      pending actions within 5 minutes, without a meeting.
Constraints:
  [C1] Only members of the platform-team Entra ID group can read or write.
  [C2] Runs on the existing Azure tenant; no new paid services.
  [C3] Handovers are kept 1 year, then deleted.
Failure conditions:
  [F1] Someone outside the group can see a handover.
  [F2] A handover is lost or silently edited after submission.
Expectations:
  [E1] An engineer writes a handover in under 3 minutes.   {verify: manual | timed walkthrough}
  [E2] The incoming engineer sees the latest handover on the home page. {verify: test | e2e}
  [E3] Every child unit is accepted.                         {verify: check | /iced list}
Assumptions:
  [assumed] Entra ID app registration exists or can be created by the team.

  > Approve and build   Approve, build later   Request changes   Reject
```

For a project, choose **Approve, build later**: the project is the umbrella, and the work happens in
children. Its constraints and failure conditions now apply to every child.

```text
> /iced child 1 chore: scaffold the app with sign-in, CI and a test runner
> /iced child 1 feature: write and submit a handover
> /iced child 1 feature: home page shows latest handover and open actions
> /iced child 1 chore: retention job deletes handovers older than 1 year
```

Run the scaffold child first. Once it has added a test runner, tell ICED how to check the work.
`.iced/config.json` is yours (the agent may not edit it), so set it yourself:

```json
{ "verify": { "commands": ["npm run lint", "npm test"] } }
```

From then on, every child is verified by those commands plus the independent verifier, which also
checks the parent's `001-on-call-handover-log:C1` (group-only access) on every feature.

**Tip:** `/iced memory` after the scaffold lands makes the agent draft `.iced/memory/product.md`
(users, domain terms) and `knowledge.md` (conventions it found). Review them once; every later unit
uses them as `[product]` and `[knowledge]` context.

---

## 2. New feature in an existing app

**Situation:** an established SaaS app with ICED set up. You want CSV export on the reports page.

```text
> /iced add CSV export to the reports page
```

No prefix means `feature`. The agent reads the reports page, the API it calls and product memory, then
asks one question, because the rest is answered by the code:

```text
002-add-csv-export: Large reports (100k+ rows): what should happen?
  > Generate in the background and email a link (recommended)
    Stream the file directly, however long it takes
    Cap at 10k rows and say so
```

Sign-off shows, among others:

```text
Constraints:
  [C1] Export respects the same filters and permissions as the on-screen report.
Failure conditions:
  [F1] The CSV contains rows the user cannot see on screen.
  [F2] Numbers in the CSV differ from the report.
Expectations:
  [E1] "Export CSV" downloads the current view with the same columns.   {verify: test | e2e/reports-export.spec.ts}
  [E2] Reports over 10k rows are emailed as a link within 10 minutes.   {verify: test | test/export-job.test.ts}
  [E3] Values match the report, including dates and currency.           {verify: test | test/export-format.test.ts}
Assumptions:
  [assumed] Semicolon-free RFC 4180 CSV, UTF-8 with BOM for Excel.
```

You read the assumption, it is fine, you pick **Approve and build**. From here you can walk away.
The agent plans, logs choices in `decisions.md` (for example "reuse the existing job queue instead
of a new worker"), writes tests, implements, and calls `iced_submit`.

```text
ICED 002-add-csv-export: PASS (attempt 1). Checks: npm test exit 0. Independent verifier: 3/3 expectations pass,
no failure conditions triggered. Review intent/002-add-csv-export/evidence.md, then /iced accept.
> /iced accept
```

---

## 3. Bug fix

**Situation:** support reports that users are logged out after 15 minutes while active.

```text
> /iced fix users getting logged out after 15 minutes even when active
```

`fix` makes it a `bug`, tier S. A bug unit always gets the bug itself as a failure condition:

```text
Failure conditions:
  [F1] A user who made a request in the last 15 minutes is logged out.
  [F2] An idle user stays signed in for more than 30 minutes.
```

The agent found the cause while gathering context (`[code] session.ts sets a fixed 15 minute expiry
and never extends it`), so it asks at most one question, about the absolute session limit.

After sign-off it writes a failing test that reproduces the bug, fixes it, and submits. The
independent verifier then tries to trigger `F1` itself, instead of trusting the builder's test.
If you want proof that the test fails on the old code, put it in the contract, for example
`[E3] The regression test fails on base_ref and passes now. {verify: check | ...}`.

The full, finished version of this unit is in [`spec/examples/001-login-timeout`](../spec/examples/001-login-timeout).

**Production hotfix?** Same command. Speed comes from the tier (S units have few expectations and
usually zero questions), not from skipping the gate.

---

## 4. New UI screen

**Situation:** design has a Figma for a new onboarding checklist on the dashboard.

```text
> /iced feature: onboarding checklist on the dashboard, design in docs/design/onboarding.png
```

UI work is where "done" is easiest to leave vague. Help the agent by putting design facts where it
looks: the screenshot in the repo, and design-system rules in `.iced/memory/knowledge.md`
("use components from `@acme/ui`, spacing tokens only, WCAG 2.1 AA"). Those show up as
`[knowledge]` context and become constraints.

A good UI contract mixes automated and manual checks:

```text
Constraints:
  [C1] Only components and tokens from @acme/ui; no custom colors.
  [C2] Meets WCAG 2.1 AA (keyboard, contrast, labels).
Failure conditions:
  [F1] The checklist blocks the dashboard for users who dismissed it.
  [F2] Progress resets after reload.
Expectations:
  [E1] New users see 4 steps with progress; done steps show a check.   {verify: test | e2e/onboarding.spec.ts}
  [E2] Dismissing hides it for good, per user.                         {verify: test | e2e/onboarding.spec.ts}
  [E3] Axe reports no serious or critical violations on the dashboard.  {verify: check | npm run test:a11y}
  [E4] Layout matches docs/design/onboarding.png at 1280px and 375px.   {verify: manual | compare screenshots in evidence}
```

The verifier cannot see pixels, so `E4` comes back `unknown`. That is by design: a manual expectation
with an unknown result means ICED will not auto-accept, even at autonomy 2 or 3. You look at the
screenshots the agent attached to its evidence, then accept or reject:

```text
> /iced reject spacing between steps is 24px, design says 16px; mobile title wraps
```

The unit goes back to `building` with your reason; the contract is unchanged.

**Tip:** if the repo has Playwright, ask for visual snapshots in the request ("...with screenshot
tests"). The agent can then make `E4` a `test` instead of `manual`.

---

## 5. Refactor or chore

```text
> /iced refactor: split the 2,000-line billing/service.ts into modules, no behavior change
```

`refactor` becomes a `chore`. For a refactor, the contract is mostly "nothing changes":

```text
Constraints:
  [C1] Public exports of billing/ keep the same names and signatures.
Failure conditions:
  [F1] Any existing test changes or is deleted.
  [F2] Behavior changes for any caller.
Expectations:
  [E1] No file in billing/ is over 400 lines.        {verify: check | find billing -name "*.ts" | xargs wc -l}
  [E2] The existing test suite passes unmodified.     {verify: check | npm test}
```

The verifier gets the list of changed files since sign-off, so edited tests are caught by `F1` even if
they pass.

Other good chores: dependency upgrades ("upgrade to React 19, no visual change"), CI changes, dead
code removal.

---

## 6. Code review or audit

```text
> /iced review 002                       # review a finished unit against its contract and the rubric
> /iced review auth module for OWASP top 10 issues
```

The first form reviews unit `002` (its contract, decisions, evidence and changed code) and reports
findings by severity with file and line references. The second creates a `review` unit: its
expectations describe the deliverable ("every endpoint in src/auth checked for..."), and the output is
`intent/<id>/review.md`. A review unit can never change code, even while building.

Findings you want fixed become new units:

```text
> /iced fix missing rate limit on /auth/reset-password (finding H2 in intent/007-auth-review/review.md)
```

---

## 7. Agent hits a wrong expectation mid-build

**Situation:** unit `004` expects "the export includes the customer's VAT number", but the agent finds
VAT numbers are stored in a separate service that this app cannot call.

The agent does not quietly drop the expectation. It cannot edit the frozen contract anyway (the gate
blocks it), so it escalates:

```text
ICED change-expectation (004-invoice-export)

E3 needs VAT numbers, which live in the tax service; this app has no credentials for it.

The change:
E3 was:     Export includes the customer's VAT number. {verify: test | test/export.test.ts}
E3 becomes: Export includes the VAT number when present on the invoice record. {verify: test | test/export.test.ts}

  > Apply this change   Edit it first   Keep the contract, give guidance   Abandon the unit
```

- **Apply this change** writes the new `E3` into the unit, recomputes the contract hash, records the change in
  `decisions.md` and resumes the build. You don't edit anything. The change is visible in git history.
- **Edit it first** opens an editor with the change already applied, for when you want to tweak the wording.
  Save to apply; press Esc to go back to the choices.
- **Keep the contract, give guidance**, for example: "credentials are in Key Vault as `tax-api-key`, use
  them".
- **Abandon the unit** if the premise was wrong.

The other escalation kinds work the same way: `ambiguity` (two readings of the intent), `conflict`
(a constraint and an expectation clash), `irreversible` (see scenario 9), and `stuck`.

---

## 8. Verification fails and you reject

**Verifier failure:**

```text
ICED 005-bulk-invite: FAIL (attempt 1 of 3)
  - E2 fail: invites to existing members send a second email (verifier ran test with duplicate address)
  - C1 violated: new dependency "p-limit" added to package.json
Back to building with these findings.
```

The agent fixes and resubmits on its own. After 3 failed attempts (`verify.maxAttempts`) the unit goes
to `blocked` and waits for you: `/iced status 5` shows every attempt's findings.

**Your rejection** after a pass is different: the verifier said yes, you say no.

```text
> /iced reject works, but the invite email has no company name, looks like spam
```

Ask yourself whether the verifier *should* have caught it. If yes, the contract was missing
something. Reject, then next time say it up front, or add it to `knowledge.md` ("all outbound email
includes company name and logo") so every future unit inherits it.

---

## 9. Risky change: migration or payments

```text
> /iced feature: let customers pay invoices by SEPA direct debit
```

The agent sets `risk: high` (money). Effects:

- Effective autonomy is capped at 1, whatever the config says: you always sign off and accept.
- The sign-off shows every assumption; expect more questions (up to `questions.max`).
- Anything irreversible stops for you, even mid-build:

```text
ICED irreversible action (008-sepa-direct-debit)
Migration 0042 adds NOT NULL column mandate_id to payments, backfilling from the provider API.
Rollback drops data written after deploy. Run it on the dev database now?        [Yes] [No]
```

For database work, a good failure condition is concrete: `[F2] Migration cannot be rolled back
without data loss on staging.`

---

## 10. Enterprise program across teams

**Situation:** a program to move customer self-service onto a new portal, three teams, several
repos, shared security and accessibility standards.

**Shared knowledge.** Keep org standards in one repo and point every project at it:

```json
{
  "memory": {
    "product": ".iced/memory/product.md",
    "knowledge": [".iced/memory/knowledge.md", "../org-standards/security.md", "../org-standards/accessibility.md"]
  },
  "verify": { "commands": ["npm run lint", "npm test", "npm run test:e2e"], "model": "<a stronger or different model>" }
}
```

**The tree.** One program unit states rules for everyone; projects and features inherit them:

```text
010-self-service-portal (project, XL)      C: PII never logged; EU data residency.  F: any customer sees another's data.
├── 011-billing-portal (project, L)        C: card data only at the provider.       F: charged without confirmation.
│   ├── 012-invoice-download (feature, M)
│   └── 013-update-card (feature, M)
└── 014-account-settings (project, L)
    └── 015-change-email (feature, M)
```

```text
> /iced project: customer self-service portal replacing the support-ticket flows
> /iced child 10 project: billing portal
> /iced child 11 feature: download past invoices as PDF
```

When `012` is verified, the verifier checks its own rules plus `011:C1`, `010:C1`, `010:F1` and so on.
A feature that passes its own tests but logs an email address fails on `010:C1`.

See [`spec/examples/002-billing-portal`](../spec/examples/002-billing-portal) and
[`003-invoice-download`](../spec/examples/003-invoice-download) for real files.

**Across repos:** units live in the repo where the code changes. The program unit can live in a
planning repo; child repos restate the inherited rules in their own project unit's constraints (for
example `[C1] Inherited from portal-program 010:C1: PII never logged`) until cross-repo parents are
supported.

**Governance:** `iced.md` is the approval record (who, when, contract hash), `decisions.md` is the
audit trail, `evidence.md` is the proof, all in git and reviewable in PRs. CI fails if anyone changes an
approved contract without going through sign-off (scenario 11).

---

## 11. Team workflow: units in git and pull requests

**Situation:** several people on the team use pi with pi-intent on the same repository.

Commit `intent/` and `.iced/` (except `.iced/active` and `.iced/tmp/`, which `init` puts in `.gitignore`). Then:

- Everyone sees the same units: `/iced list` shows what is drafted, building, done and accepted.
- A pull request carries the unit with the code: `iced.md` (the contract and who approved it), `decisions.md`
  (why the agent chose what it did) and `evidence.md` (what the verifiers checked and saw). Reviewers start there.
- Anyone can pick up a unit: `/iced use 16` makes it active in their session; `/iced build 16` resumes it.
- An approved contract carries its `contract_hash`. If someone edits Intent or Expectations by hand after sign-off,
  `/iced status 16` reports `contract-changed`, and acceptance refuses the unit until the change goes through
  `iced_escalate` and a human re-approval.

To check this in CI without pi, a few lines with the core library are enough:

```js
// scripts/check-units.mjs (run with: node scripts/check-units.mjs, after npm install @arturleao/iced-core)
import fs from "node:fs";
import { findRoot, listUnits, readUnit, lintIced } from "@arturleao/iced-core";

const root = findRoot(process.cwd());
let errors = 0;
for (const { id } of listUnits(root)) {
  const unit = readUnit(root, id);
  const lint = lintIced(unit.parsed, "validate", unit.text);
  if (["done", "accepted"].includes(unit.parsed.frontmatter.status) && !fs.existsSync(unit.paths.evidence)) {
    lint.errors.push({ code: "evidence-missing", message: "no evidence.md" });
  }
  for (const e of lint.errors) console.error(`${id}: ${e.code}: ${e.message}`);
  errors += lint.errors.length;
}
process.exit(errors ? 1 : 0);
```

It fails when an approved contract was edited (hash mismatch), a unit is done or accepted without evidence, or a
unit file is malformed.

---

## 12. Growing trust: raising autonomy

After a few weeks:

```text
> /iced stats
Units: 23   questions/unit: 1.4   first-pass verify: 78%   human rejections: 4%   escalations/unit: 0.2
By risk:
  low     11 units, 0 rejections, 0 escalations in the last 10
  medium   9 units, 1 rejection
  high     3 units
Suggestion: raise default autonomy for low risk from 1 to 2 (10 clean units in a row).
> /iced stats apply
```

Now low-risk units auto-accept when the independent verifier passes (you still get notified, and
manual expectations still wait for you). Medium stays at 1 until it earns it; high risk never goes
above 1.

Per unit you can go further or back:

```text
> /iced autonomy 3 17        # low-risk chore: auto-approve once the draft is clean (no open questions), auto-accept on pass
> /iced autonomy 0 18        # unfamiliar area: confirm every change and decision
```

---

## 13. Choosing verifier models and effort

**Situation:** verifiers keep hitting a rate limit on your default model, or you want a second vendor to
check the work so the builder and verifier don't share blind spots.

```text
> /iced models
Which ICED models do you want to change?   > Verifier models   Test writer model   Nothing
```

The picker lists your scoped models (`/scoped-models`), or every model with credentials when none are
scoped:

```text
ICED verifier models
From your scoped models. Independent verifiers check the build; different models catch different mistakes...

  > Rotate (recommended): anthropic/sonnet-5, openai/gpt-5.6, openrouter/auto
    [1] anthropic/sonnet-5 (session)       effort high
    [2] openai/gpt-5.6                     effort default (high)
    [ ] openrouter/auto                    effort default (high)
    Type a model...
    Don't pin: verifiers use the session model   effort default (high)

  ↑↓ move • ←→ or shift+tab: effort • space: add to rotation (up to 3) • type to filter • enter choose • esc cancel
```

- **Space** adds the highlighted model to the rotation (numbered in order). Three lenses with three models
  means each verifier uses a different one.
- **← / → or shift+tab** cycles that model's effort: `default`, `off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`. It is saved as a suffix (`openai/gpt-5.6:low`). `default` means `verify.effort`, else your
  session's thinking level.
- On the **Rotate** row, the effort applies to all three; on **Don't pin** it sets `verify.effort` for the
  session model.

The result in `.iced/config.json`:

```json
"verify": { "model": ["anthropic/sonnet-5:high", "openai/gpt-5.6:low", "openrouter/auto"], "effort": null }
```

Quick changes without the picker:

```text
> /iced models effort medium               # verifiers, when a model has no :level
> /iced models effort high test-writer     # the isolated test writer
> /iced models show
```

In the VS Code panel (RPC mode) the picker is a plain list followed by an effort question.

The agent can read the settings (`/iced models show` output appears in its context when you run it) but cannot
change them: you pick who checks its work.

---

## 14. Updating pi-intent in your repos

**Situation:** a new pi-intent is out (a fix or new feature) and you have repos already using ICED.

```powershell
pi update --extensions
```

Then run `/reload` in each open session. pi loads the extension from the installed package, so that's all it
needs, even mid-unit. Nothing in your repositories has to change.

`/iced init` again is only needed to refresh the unit templates in `.iced/templates/`. It keeps
`.iced/config.json` (models, verify commands), memory and everything in `intent/`, and leaves unit status and
attempts untouched, so it is safe in the middle of a build.

Repos set up by older versions may still have copies under `.iced/` (`bin/`, `lib/`, the protocol and rubric files), a
managed ICED block in agent instruction files, and verifier agent definitions for other tools. pi-intent no longer
uses them; delete them when convenient.

---

## Writing good one-liners

| Instead of | Try | Why |
|---|---|---|
| `/iced use Redis to cache the dashboard` | `/iced dashboard loads in under 1s for accounts with 5k projects` | Say the outcome; the agent picks the how (and may still pick Redis) |
| `/iced fix the bug` | `/iced fix CSV export shows dates in UTC instead of the user's timezone` | The symptom becomes the failure condition |
| `/iced improve onboarding` | `/iced feature: new users reach their first report without help, see docs/onboarding.md` | Measurable goal, and a pointer to context |
| `/iced build the whole CRM` | `/iced project: ...` then `/iced child` per capability | Big work goes in a tree, not one unit |

Answer questions with the recommended option when you don't care; the agent only asks when a wrong
guess would be expensive. And read the **Assumptions** at sign-off: they are the agent's guesses, and
the cheapest place to catch a wrong one.
