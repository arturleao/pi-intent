---
name: iced
description: Plan and deliver work with ICED (Intent, Context, Expectations, Done), an intent-driven method derived from IDSD. Use when the user gives a one-line request to build, fix, review or change something in a repo that has an .iced/ folder or intent/ units, asks for intent-driven development, or mentions /iced, iced.md, sign-off or expectations. In pi, when iced_* tools exist, use those tools instead of the manual steps here.
license: MIT
---

# ICED

Turn a one-line request into an approved contract, then build it autonomously and prove it is done.
Humans own **what** (Intent) and **done** (Expectations). You own **how**.

**First, check your tools.** If you have `iced_start` / `iced_status` (pi with the `pi-intent`
extension), use the `iced_*` tools for every step: `iced_start`, `iced_questions`,
`iced_request_signoff`, `iced_build`, `iced_decision`, `iced_escalate`, `iced_submit`. They create
units, record sign-off, gate edits and run verification. Skip the manual file steps and the CLI below.

Otherwise, read `references/protocol.md` before starting a unit. Use `references/rubric.md` for reviews and
self-checks. In a repository, `.iced/ICED.md` is the same protocol.

## Quick flow

1. **Find or create the unit.** Check `.iced/active` and `intent/`. For new work, create
   `intent/<next-id>-<slug>/iced.md` from `.iced/templates/<type>.md` (in pi: `/iced <request>`).
   If the repo has no `.iced/`, run `/iced init` in pi (or `node <pi-intent>/bin/iced.mjs init`).
2. **Draft Intent.** Outcome-only Goal, Constraints `[C#]`, Failure conditions `[F#]`, Scope In/Out.
3. **Gather Context** in order: `[code]`, `[product]`, `[knowledge]`, `[parent]`, then `[assumed]`.
4. **Ask at most a few questions**, only high-risk gaps context cannot answer. Record `[Q#] ... -> A: ...`.
5. **Derive Expectations** `[E#]`, each with `{verify: test|check|metric|manual | ref}`.
6. **Stop for sign-off.** Show goal, constraints, failures, expectations and all assumptions. Do not
   approve for the human. (pi: `iced_request_signoff`; elsewhere `node .iced/bin/iced.mjs approve <id>` after the
   human agrees; it also starts the build.)
7. **Build autonomously.** Decide the design yourself. Log significant decisions in `decisions.md`
   (pi: `iced_decision`). Never edit Intent or Expectations after approval. Escalate only for ambiguity,
   conflict, change-expectation, irreversible, or stuck (pi: `iced_escalate`).
8. **Submit evidence** for every expectation (pi: `iced_submit`). Elsewhere: write `intent/<id>/submission.json`
   (`{"summary", "evidence": [{"expectation", "kind", "ref"}]}`) and run `node .iced/bin/iced.mjs verify <id>`,
   which runs checks and independent verifiers in parallel. With your own `iced-verifier` subagents (Claude Code,
   Codex): `verify <id> --prepare`, one subagent per prompt in parallel, then `verify <id> --finish`.
   Then ask the human to accept.

## Hard rules

- No code changes for a unit before it is approved. Work outside ICED (no active unit) is fine unless
  `.iced/config.json` has `"gate": "always"`.
- Never set `status: approved` or `status: accepted`, and never edit `contract_hash`, `approved_*`,
  `accepted_*`, `autonomy` or `attempts`.
- Never change the models that verify your work (`verify.model`, `verify.effort`, `iced models set|effort|clear`).
- Parent constraints and failure conditions apply to children.
- Evidence is a claim until verified. Prefer tests that fail without the change.
