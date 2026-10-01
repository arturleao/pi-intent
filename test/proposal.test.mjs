import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../lib/iced-core.mjs";

const UNIT = `---
iced: 0.1
id: 004-combobox
title: Combobox
type: feature
tier: M
status: building
autonomy: 1
risk: low
---

# Combobox

## Intent

### Goal
Users find a model quickly.

### Constraints
- [C1] No new dependencies.

### Failure conditions
- [F1] Typing loses the selection.

### Scope
- In: model selection

## Context
- [code] Picker lives in src/picker.ts.

## Expectations
- [E1] Typing filters the list. {verify: test | test/picker.test.ts}
- [E2] Enter selects the highlighted model. {verify: test | test/picker.test.ts}

## Open questions
`;

test("proposalItems reads contract lines from free text and ignores other items", () => {
  const items = core.proposalItems("Replace E2 with:\n- [E2] Enter or click selects. {verify: test | x}\n- [e3] Esc closes. {verify: manual | try it}\n- [Q1] not a contract item\nThanks");
  assert.deepEqual(items, [
    { id: "E2", text: "Enter or click selects. {verify: test | x}" },
    { id: "E3", text: "Esc closes. {verify: manual | try it}" },
  ]);
  assert.deepEqual(core.proposalItems("just change the second expectation"), []);
  assert.deepEqual(core.proposalItems(undefined), []);
});

test("applyProposal replaces, adds and removes items in the right sections", () => {
  const r = core.applyProposal(UNIT, core.proposalItems([
    "- [E2] Enter or click selects the model. {verify: test | test/picker.test.ts}",
    "- [E3] Esc closes without changing. {verify: test | test/picker.test.ts}",
    "- [C2] Works with keyboard only.",
    "- [F1] (remove)",
  ].join("\n")));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changes.map((c) => `${c.id}:${c.action}`), ["E2:replace", "E3:add", "C2:add", "F1:remove"]);
  const p = core.parseIced(r.text);
  assert.deepEqual(p.expectations.map((e) => e.id), ["E1", "E2", "E3"]);
  assert.equal(p.expectations[1].text, "Enter or click selects the model.");
  assert.deepEqual(p.constraints.map((c) => c.id), ["C1", "C2"]);
  assert.deepEqual(p.failures, []);
  assert.match(r.text, /- \[E3\] Esc closes[^\n]*\n\n## Open questions/, "added at the end of its section, before the blank line");
  assert.match(core.describeChanges(r.changes), /E2 was: {5}Enter selects[\s\S]*E2 becomes: Enter or click/);
});

test("applyProposal reports what it cannot do and skips unchanged items", () => {
  const same = core.applyProposal(UNIT, [{ id: "E1", text: "Typing filters the list. {verify: test | test/picker.test.ts}" }]);
  assert.deepEqual(same.changes, []);
  const bad = core.applyProposal(UNIT, [{ id: "E9", text: "(remove)" }]);
  assert.match(bad.errors[0], /E9 is not in the contract/);
  const noSection = core.applyProposal(UNIT.replace(/### Constraints\n- \[C1\][^\n]*\n\n/, ""), [{ id: "C2", text: "x" }]);
  assert.match(noSection.errors[0], /no Constraints section/);
});

test("items inside comments are not matched, and proposal comments are stripped", () => {
  const withComment = UNIT.replace("## Open questions", "<!-- Agent proposal (delete this comment when done):\n- [E2] old idea\n-->\n\n## Open questions");
  const r = core.applyProposal(withComment, [{ id: "E2", text: "Enter selects it. {verify: test | t}" }]);
  assert.doesNotMatch(r.text, /Agent proposal|old idea/);
  assert.equal(core.parseIced(r.text).expectations[1].text, "Enter selects it.");
  assert.equal(core.stripProposalComments("a\n\n<!-- Agent proposal:\nx\n-->\nb"), "a\nb");
});

const WRAPPED = UNIT
  .replace("- [E2] Enter selects the highlighted model. {verify: test | test/picker.test.ts}",
    "- [E2] Enter selects the highlighted model, and the list closes\n  without losing the filter text.\n  {verify: test | test/picker.test.ts}")
  .replace("## Open questions\n", "## Open questions\n- [Q1] Should Esc clear the filter?\n  -> A: yes, first Esc clears it\n");

test("wrapped items are read as one: verify tags and answers on later lines count", () => {
  const p = core.parseIced(WRAPPED);
  const e2 = p.expectations[1];
  assert.equal(e2.text, "Enter selects the highlighted model, and the list closes without losing the filter text.");
  assert.deepEqual(e2.verify, { kind: "test", ref: "test/picker.test.ts" });
  assert.equal(p.questions[0].answer, "yes, first Esc clears it");
  const codes = core.lintIced(p, "signoff").errors.map((e) => e.code);
  assert.ok(!codes.includes("expectation-unverifiable"), codes.join(", "));
  assert.ok(!codes.includes("open-questions"), codes.join(", "));
  const unwrapped = core.parseIced(UNIT.replace("{verify: test | test/picker.test.ts}\n- [E2]", "\n  {verify: test | test/picker.test.ts}\n- [E2]"));
  assert.deepEqual(unwrapped.expectations[0].verify, { kind: "test", ref: "test/picker.test.ts" });
  const blankLine = core.parseIced(UNIT.replace("Typing filters the list. {verify: test | test/picker.test.ts}", "Typing filters the list.\n\n{verify: test | x}"));
  assert.equal(blankLine.expectations[0].verify, undefined, "a blank line ends the item");
});

test("proposals replace and remove every line of a wrapped item, and may wrap themselves", () => {
  const items = core.proposalItems("- [E2] Enter or click selects\n  the model. {verify: test | t}\n\nThat's all.");
  assert.deepEqual(items, [{ id: "E2", text: "Enter or click selects the model. {verify: test | t}" }]);
  const r = core.applyProposal(WRAPPED, items);
  assert.match(core.describeChanges(r.changes), /E2 was: {5}Enter selects the highlighted model, and the list closes without losing the filter text\. \{verify/);
  assert.doesNotMatch(r.text, /without losing|\n  \{verify/);
  assert.equal(core.parseIced(r.text).expectations[1].text, "Enter or click selects the model.");
  const gone = core.applyProposal(WRAPPED, [{ id: "E2", text: "(remove)" }]);
  assert.doesNotMatch(gone.text, /highlighted|without losing/);
  assert.deepEqual(core.parseIced(gone.text).expectations.map((e) => e.id), ["E1"]);
});

test("the contract hash changes when a proposal is applied", () => {
  const r = core.applyProposal(UNIT, [{ id: "E2", text: "Enter or click selects. {verify: test | t}" }]);
  assert.notEqual(core.contractHash(r.text), core.contractHash(UNIT));
});
