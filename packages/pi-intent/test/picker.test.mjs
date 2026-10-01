import { test } from "node:test";
import assert from "node:assert/strict";
import * as p from "../src/picker.mjs";

const rows = () => [
  { kind: "action", id: "keep", label: "Keep a/b" },
  { kind: "group", label: "Rotate", refs: ["a/b:high", "c/d"] },
  { kind: "model", ref: "a/b:high", note: "session" },
  { kind: "model", ref: "c/d" },
  { kind: "model", ref: "e/plain", reasoning: false },
  { kind: "action", id: "type", label: "Type a model..." },
  { kind: "action", id: "unpinned", label: "Don't pin", effortable: true, effort: null },
];
const at = (s, n) => { s.cursor = n; return s; };

test("cycleEffort walks default -> off ... max -> default, both ways", () => {
  assert.equal(p.cycleEffort(null, 1), "off");
  assert.equal(p.cycleEffort("high", 1), "xhigh");
  assert.equal(p.cycleEffort("max", 1), null);
  assert.equal(p.cycleEffort(null, -1), "max");
  assert.equal(p.cycleEffort("off", 1, false), null);
  assert.equal(p.cycleEffort(null, 1, false), "off");
});

test("effort cycles on the highlighted model and is kept in the chosen ref", () => {
  const s = at(p.createPicker({ rows: rows(), multi: 3 }), 2);
  assert.equal(p.currentRow(s).effort, "high");
  p.cycle(s, 1);
  assert.deepEqual(p.choose(s), { refs: ["a/b:xhigh"] });
  p.cycle(s, 1); p.cycle(s, 1);
  assert.deepEqual(p.choose(s), { refs: ["a/b"] }, "default drops the suffix");
  p.cycle(s, -1);
  assert.deepEqual(p.choose(s), { refs: ["a/b:max"] });
});

test("models without thinking only toggle off and say so", () => {
  const s = at(p.createPicker({ rows: rows() }), 4);
  p.cycle(s, 1);
  assert.equal(p.currentRow(s).effort, "off");
  p.cycle(s, 1);
  assert.equal(p.currentRow(s).effort, null);
  p.cycle(s, 1); p.cycle(s, 1);
  assert.equal(p.currentRow(s).effort, null);
  assert.match(s.message, /no thinking levels/);
});

test("rotation row sets one effort for all members; action rows only when effortable", () => {
  const s = at(p.createPicker({ rows: rows(), multi: 3 }), 1);
  p.cycle(s, 1);
  assert.deepEqual(p.choose(s), { refs: ["a/b:xhigh", "c/d:xhigh"] });
  at(s, 0);
  p.cycle(s, 1);
  assert.match(s.message, /Effort applies to models/);
  assert.deepEqual(p.choose(s), { action: "keep", effort: null });
  at(s, 6);
  p.cycle(s, 1); p.cycle(s, 1); p.cycle(s, 1);
  assert.deepEqual(p.choose(s), { action: "unpinned", effort: "low" });
});

test("space picks up to multi models in order; enter returns them with their efforts", () => {
  const s = p.createPicker({ rows: rows(), multi: 2 });
  at(s, 3); p.toggle(s);
  at(s, 2); p.cycle(s, -1); p.toggle(s);
  assert.equal(p.pickedPosition(s, 3), 1);
  assert.equal(p.pickedPosition(s, 2), 2);
  at(s, 4); p.toggle(s);
  assert.match(s.message, /At most 2/);
  at(s, 6);
  assert.deepEqual(p.choose(s), { refs: ["c/d", "a/b:medium"] }, "picks win over the highlighted row");
  at(s, 3); p.toggle(s);
  assert.deepEqual(p.choose(p.createPicker({ rows: rows() })), { action: "keep", effort: null });
  at(s, 0); p.toggle(s);
  assert.match(s.message, /adds a model/);
  const single = at(p.createPicker({ rows: rows() }), 3);
  p.toggle(single);
  assert.match(single.message, /Choose one model/);
});

test("typing filters models but keeps actions and rotations", () => {
  const s = p.createPicker({ rows: rows(), multi: 3 });
  for (const ch of "c/") p.typeChar(s, ch);
  assert.deepEqual(p.visibleRows(s), [0, 1, 3, 5, 6]);
  assert.equal(s.cursor, 0);
  p.move(s, 2);
  assert.equal(p.currentRow(s).model, "c/d");
  p.typeChar(s, "z");
  assert.deepEqual(p.visibleRows(s), [0, 1, 5, 6]);
  p.backspace(s);
  assert.deepEqual(p.visibleRows(s), [0, 1, 3, 5, 6]);
  for (const ch of "sess") p.typeChar(s, ch);
  p.clearFilter(s);
  assert.equal(p.visibleRows(s).length, 7);
  p.move(s, -1);
  assert.equal(s.cursor, 6, "move wraps around");
});

test("typed models are added at the top of the models, picked, and keep their effort", () => {
  const s = p.createPicker({ rows: rows(), multi: 3 });
  p.addModels(s, ["x/new:low", "c/d:high", "y/two"]);
  const models = s.rows.filter((r) => r.kind === "model").map((r) => `${r.model}${r.effort ? `:${r.effort}` : ""}`);
  assert.deepEqual(models, ["x/new:low", "y/two", "a/b:high", "c/d:high", "e/plain"]);
  assert.deepEqual(p.choose(s), { refs: ["x/new:low", "c/d:high", "y/two"] });
  assert.equal(p.currentRow(s).model, "x/new");
  const single = p.createPicker({ rows: rows() });
  p.addModels(single, ["z/one:max"]);
  assert.deepEqual(p.choose(single), { refs: ["z/one:max"] });
});

test("createPicker marks already-picked refs and ignores extras", () => {
  const s = p.createPicker({ rows: rows(), multi: 1, picked: ["c/d", "a/b"] });
  assert.deepEqual(s.picked, [3]);
  assert.equal(p.effortLabel(null, "high"), "default (high)");
  assert.equal(p.effortLabel("low", "high"), "low");
});
