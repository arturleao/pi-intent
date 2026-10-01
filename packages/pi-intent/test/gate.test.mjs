import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as core from "@arturleao/iced-core";
import { changedProtectedKeys, classifyPath, gateDecision, isMutatingShell } from "../src/gate.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "../../iced-core/test/helpers.mjs";

test("classifyPath", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const k = (p) => classifyPath(root, root, p).kind;
  assert.equal(k("src/a.ts"), "code");
  assert.equal(k("intent/001-x/iced.md"), "unit");
  assert.equal(k("intent/001-x/decisions.md"), "decisions");
  assert.equal(k("intent/001-x/evidence.md"), "owned");
  assert.equal(k("intent/001-x/verify.json"), "owned");
  assert.equal(k("intent/001-x/review.md"), "aux");
  assert.equal(k(".iced/config.json"), "owned");
  assert.equal(k(".iced/active"), "owned");
  assert.equal(k(".iced/metrics.jsonl"), "owned");
  assert.equal(k(".iced/templates/bug.md"), "meta");
  assert.equal(k(".iced/memory/product.md"), "memory");
  assert.equal(k(path.join(root, "..", "elsewhere.txt")), "outside");
  assert.equal(k("@src/b.ts"), "code");
});

test("isMutatingShell", () => {
  for (const c of ["echo x > a.txt", "rm -rf src", "git reset --hard", "git push --force origin main", "git push -f", "npm install lodash", "Set-Content a.txt x", "sed -i s/a/b/ f", "cp a b", "New-Item -Path x", 'git commit -m "x" && echo done > log.txt']) {
    assert.equal(isMutatingShell(c), true, c);
  }
  for (const c of ["npm test", "git status", "git diff HEAD", "ls -la", "cat a.txt", "node --test test/", "grep -r foo src 2>&1", "Get-Content a.txt",
    "git add -A", 'git add . && git commit -m "feat: picker -> combobox (E1 > E2)"', "git commit -m 'a > b'", "git push origin chore/iced-playground", "git tag v1.0.0",
    "git commit -F - <<'EOF'\nfeat: x -> y\n\nE1 > E2\nEOF", 'git commit -m @"\nfeat: x -> y\n"@']) {
    assert.equal(isMutatingShell(c), false, c);
  }
});

test("changedProtectedKeys", () => {
  const a = unitText();
  assert.deepEqual(changedProtectedKeys(a, a.replace("status: draft", "status: approved")), ["status"]);
  assert.deepEqual(changedProtectedKeys(a, a.replace("risk: low", "risk: medium")), []);
});

function setup(status, extra = {}) {
  const root = tempRepo();
  const id = "001-dark-mode";
  writeUnit(root, id, unitText({ status, ...extra }));
  core.setActive(root, id);
  const decide = (toolName, input, autonomy = 1) => gateDecision({ root, cwd: root, toolName, input, autonomy });
  return { root, id, decide };
}

test("gate: no active unit leaves normal work alone but still protects ICED files", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "accepted" }));
  const d = (toolName, input) => gateDecision({ root, cwd: root, toolName, input, autonomy: 1 });
  assert.equal(d("write", { path: "src/a.ts", content: "" }).action, "allow");
  assert.equal(d("edit", { path: "src/a.ts", edits: [] }).action, "allow");
  assert.equal(d("bash", { command: "rm a" }).action, "allow");
  assert.equal(d("bash", { command: "npm install zod" }).action, "allow");
  assert.equal(d("bash", { command: "git reset --hard" }).action, "allow");
  assert.equal(d("write", { path: "intent/001-dark-mode/iced.md", content: "" }).action, "block");
  assert.equal(d("write", { path: "intent/001-dark-mode/evidence.md", content: "" }).action, "block");
  assert.equal(d("write", { path: ".iced/config.json", content: "" }).action, "block");
  assert.equal(d("bash", { command: "echo x > intent/001-dark-mode/iced.md" }).action, "block");
  assert.equal(d("powershell", { command: "Set-Content .iced/config.json '{}'" }).action, "block");
  assert.equal(d("bash", { command: "npm test" }).action, "allow");
  assert.equal(d("bash", { command: "git add -A && git commit -m \"feat: done\"" }).action, "allow");
  assert.equal(d("read", { path: "src/a.ts" }).action, "allow");
  assert.equal(d("write", { path: ".iced/memory/product.md", content: "" }).action, "allow");
});

test("gate always: no active unit blocks code and mutating shell, allows reads and commits", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const d = (toolName, input) => gateDecision({ root, cwd: root, toolName, input, autonomy: 1, always: true });
  assert.equal(d("write", { path: "src/a.ts", content: "" }).action, "block");
  assert.match(d("write", { path: "src/a.ts", content: "" }).reason, /gate: always[\s\S]*iced_start/);
  assert.equal(d("bash", { command: "rm a" }).action, "block");
  assert.equal(d("bash", { command: "npm test" }).action, "allow");
  assert.equal(d("bash", { command: "git add -A && git commit -m \"feat: done\"" }).action, "allow");
  assert.equal(d("read", { path: "src/a.ts" }).action, "allow");
});

test("gate: draft allows drafting the unit but not protected keys or code", (t) => {
  const { root, id, decide } = setup("draft");
  t.after(() => cleanup(root));
  const unitPath = `intent/${id}/iced.md`;
  assert.equal(decide("edit", { path: unitPath, edits: [{ oldText: "No new runtime dependencies.", newText: "No new deps." }] }).action, "allow");
  assert.equal(decide("edit", { path: unitPath, edits: [{ oldText: "status: draft", newText: "status: approved" }] }).action, "block");
  assert.equal(decide("edit", { path: unitPath, edits: [{ oldText: "autonomy: 1", newText: "autonomy: 3" }] }).action, "block");
  assert.equal(decide("write", { path: "src/a.ts", content: "" }).action, "block");
  assert.equal(decide("write", { path: `intent/${id}/evidence.md`, content: "" }).action, "block");
  assert.equal(decide("write", { path: "intent/009-new/iced.md", content: "" }).action, "block");
  assert.equal(decide("powershell", { command: "Remove-Item src/a.ts" }).action, "block");
});

test("gate: building allows code, freezes the contract", (t) => {
  const { root, id, decide } = setup("building");
  t.after(() => cleanup(root));
  assert.equal(decide("write", { path: "src/a.ts", content: "" }).action, "allow");
  assert.equal(decide("bash", { command: "npm install zod" }).action, "allow");
  assert.equal(decide("edit", { path: `intent/${id}/iced.md`, edits: [] }).action, "block");
  assert.match(decide("edit", { path: `intent/${id}/iced.md`, edits: [] }).reason, /change-expectation/);
  assert.equal(decide("write", { path: `intent/${id}/decisions.md`, content: "" }).action, "allow");
  assert.equal(decide("bash", { command: `echo x > intent/${id}/iced.md` }).action, "block");
  assert.equal(decide("write", { path: "src/a.ts", content: "" }, 0).action, "confirm");
  assert.equal(decide("write", { path: `intent/${id}/verify.json`, content: "" }).action, "block");
  assert.equal(decide("write", { path: ".iced/metrics.jsonl", content: "" }).action, "block");
  assert.equal(decide("bash", { command: "npm test" }).action, "allow");
});

test("gate: other statuses freeze code; review units are read-only; closed units count as none", (t) => {
  for (const status of ["approved", "verifying", "done", "blocked"]) {
    const { root, decide } = setup(status);
    assert.equal(decide("write", { path: "src/a.ts", content: "" }).action, "block", status);
    cleanup(root);
  }
  const review = setup("building", { type: "review" });
  t.after(() => cleanup(review.root));
  assert.equal(review.decide("write", { path: "src/a.ts", content: "" }).action, "block");
  assert.equal(review.decide("write", { path: `intent/${review.id}/review.md`, content: "" }).action, "allow");
  const closed = setup("accepted");
  t.after(() => cleanup(closed.root));
  assert.equal(closed.decide("write", { path: "src/a.ts", content: "" }).action, "allow");
  const always = gateDecision({ root: closed.root, cwd: closed.root, toolName: "write", input: { path: "src/a.ts", content: "" }, always: true });
  assert.match(always.reason, /No active ICED unit/);
});

test("gate: committing the work is allowed once the unit is done or accepted", () => {
  const commit = `git add -A && git commit -m "feat: combobox (intent/001-dark-mode/iced.md)"`;
  for (const status of ["done", "accepted"]) {
    const { root, decide } = setup(status);
    assert.equal(decide("powershell", { command: commit }).action, "allow", status);
    assert.equal(decide("bash", { command: "git push origin HEAD" }).action, "allow", status);
    const frozen = status === "done" ? "block" : "allow";
    assert.equal(decide("bash", { command: "git push --force" }).action, frozen, status);
    assert.equal(decide("bash", { command: "git reset --hard HEAD~1" }).action, frozen, status);
    cleanup(root);
  }
});
