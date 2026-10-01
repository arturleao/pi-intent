import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as core from "@arturleao/iced-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { VERIFIER_TOOLS, changedProtectedKeys, classifyPath, gateDecision, isMutatingShell, verifierToolDecision } from "../src/gate.mjs";
import { TOOLS } from "../src/runner.mjs";
import { predictFileContent } from "@arturleao/iced-core/guard";
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
  for (const c of ["echo x > a.txt", "rm -rf src", "git reset --hard", "git push --force origin main", "git push -f", "npm install lodash", "Set-Content a.txt x", "sed -i s/a/b/ f", "cp a b", "New-Item -Path x", 'git commit -m "x" && echo done > log.txt',
    "[IO.File]::WriteAllBytes('a.bin', $b)", "[System.IO.File]::AppendAllLines('a', $l)", "Set-Item -Path a.txt -Value x", "Set-ItemProperty a.txt -Name IsReadOnly -Value $true",
    "node --eval \"require('fs').writeFileSync('a','x')\"", "node -e \"fs.rmSync('src',{recursive:true})\"", "node -p \"require('fs').appendFileSync('a','x')\"",
    "python -c \"open('a','w').write('x')\"", "python3 -c \"import pathlib; pathlib.Path('a').write_text('x')\"", "Invoke-WebRequest https://x -OutFile a.zip",
    "curl -o a.zip https://x", "Expand-Archive a.zip -DestinationPath out", "Get-Process | Export-Csv p.csv"]) {
    assert.equal(isMutatingShell(c), true, c);
  }
  for (const c of ["npm test", "git status", "git diff HEAD", "ls -la", "cat a.txt", "node --test test/", "grep -r foo src 2>&1", "Get-Content a.txt",
    "git add -A", 'git add . && git commit -m "feat: picker -> combobox (E1 > E2)"', "git commit -m 'a > b'", "git push origin chore/iced-playground", "git tag v1.0.0",
    "git commit -F - <<'EOF'\nfeat: x -> y\n\nE1 > E2\nEOF", 'git commit -m @"\nfeat: x -> y\n"@',
    "node -e \"console.log(require('fs').readFileSync('a','utf8'))\"", "python -c \"print(open('a').read())\"", "Get-Item a.txt", "curl https://x"]) {
    assert.equal(isMutatingShell(c), false, c);
  }
});

test("verifier tools: read, grep, find and ls only; write, edit and every shell are blocked", () => {
  for (const t of ["read", "grep", "find", "ls"]) assert.equal(verifierToolDecision(t).action, "allow", t);
  for (const t of ["write", "edit", "bash", "powershell", "pwsh", "iced_submit", "mcp", "anything"]) assert.equal(verifierToolDecision(t).action, "block", t);
  assert.deepEqual(TOOLS["read-only"], VERIFIER_TOOLS, "the runner grants exactly what the verifier role allows");
});

test("the extension's verifier role uses the verifier tool rule for every tool call", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../extensions/iced/index.ts", import.meta.url)), "utf8");
  const block = src.slice(src.indexOf('if (role === "verifier")'), src.indexOf("if (role) return;"));
  assert.match(block, /pi\.on\("tool_call", async \(event\) => \{\s*const d: any = verifierToolDecision\(event\.toolName\);\s*return d\.action === "block" \? \{ block: true, reason: d\.reason \} : undefined;/);
  assert.match(block, /\breturn;\s*\}\s*$/);
});

test("extension: invalid submission reports errors before success report handling", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../extensions/iced/index.ts", import.meta.url)), "utf8");
  const start = src.indexOf('if (res.outcome === "invalid-contract")');
  const report = src.indexOf("const report = res.report;", start);
  assert.ok(start > 0 && report > start);
  const block = src.slice(start, src.indexOf('if (res.outcome === "missing-evidence")', start));
  assert.match(block, /return textResult/);
  assert.match(block, /no attempt was consumed/);
  assert.match(block, /e\.unit.*e\.code.*e\.message/);
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

test("gate: original-file multi-edits cannot bypass protected status", (t) => {
  const { root, id, decide } = setup("draft");
  t.after(() => cleanup(root));
  const unitPath = `intent/${id}/iced.md`;
  const abs = path.join(root, unitPath);
  const original = fs.readFileSync(abs, "utf8");
  const edits = [
    { oldText: "title: Dark mode", newText: "title: status: draft" },
    { oldText: "status: draft", newText: "status: building" },
  ];
  const expected = original.replace("status: draft", "status: building").replace("title: Dark mode", "title: status: draft");
  assert.equal(predictFileContent(abs, { edits }), expected);
  assert.equal(predictFileContent(abs, { edits: [...edits].reverse() }), expected);
  assert.equal(decide("edit", { path: unitPath, edits }).action, "block");
  const valid = [
    { oldText: "No new runtime dependencies.", newText: "Keep dependencies." },
    { oldText: "Light theme unchanged.", newText: "Keep light theme." },
  ];
  assert.equal(decide("edit", { path: unitPath, edits: valid }).action, "allow");
  assert.equal(predictFileContent(abs, { content: original }), original);
});

test("gate: unpredictable draft edits fail closed", (t) => {
  const { root, id, decide } = setup("draft");
  t.after(() => cleanup(root));
  const unitPath = `intent/${id}/iced.md`;
  for (const edits of [
    [{ oldText: "not present", newText: "x" }],
    [{ oldText: "theme", newText: "x" }],
    [{ oldText: "", newText: "x" }],
    [{ oldText: "status: draft", newText: "x" }, { oldText: "draft", newText: "y" }],
    [{ oldText: "status: draft", newText: "x" }, { oldText: "status: draft", newText: "y" }],
    [{ oldText: "status: draft" }],
  ]) {
    assert.equal(predictFileContent(path.join(root, unitPath), { edits }), null);
    assert.equal(decide("edit", { path: unitPath, edits }).action, "block");
  }
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
