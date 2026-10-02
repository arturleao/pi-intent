import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as core from "@arturleao/iced-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIG_INTEGRITY_KEYS, VERIFIER_TOOLS, changedProtectedKeys, classifyPath, gateDecision, isMutatingShell, verifierToolDecision } from "../src/gate.mjs";
import { TOOLS } from "../src/runner.mjs";
import { changedConfigIntegrityKeys, predictFileContent, shellMutatesOnlyOutside, writesProtectedShellTarget } from "@arturleao/iced-core/guard";
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
  assert.equal(k(".iced/config.json"), "config");
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

/** A unit in `status`; past sign-off it carries the matching contract_hash so it lints clean. */
function setup(status, extra = {}) {
  const root = tempRepo();
  const id = "001-dark-mode";
  const signed = ["approved", "building", "verifying", "done", "accepted", "blocked"].includes(status);
  const fm = { status, ...(signed ? { contract_hash: core.contractHash(unitText()) } : {}), ...extra };
  for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k];
  writeUnit(root, id, unitText(fm));
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
  const contractEdit = [{ oldText: "Choice persists across reloads.", newText: "Choice persists forever." }];
  assert.equal(decide("edit", { path: `intent/${id}/iced.md`, edits: contractEdit }).action, "block");
  assert.match(decide("edit", { path: `intent/${id}/iced.md`, edits: contractEdit }).reason, /change-expectation/);
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

// ---------------------------------------------------------------------------
// 007: read-only shell commands pass the gate
// ---------------------------------------------------------------------------

test("007 E1: stderr-only, discard and temp-dir redirects are not mutating; repo redirects are", () => {
  for (const c of ["ls x 2>/dev/null", "rg -l foo . 2>$null", "pwd; git worktree list; ls ../other 2>/dev/null", "grep -rn x dir 2>/dev/null | head -20",
    "sed -n 1,40p a.ts 2>/dev/null || ls rules", "npm test 2>&1 | tail", "npm test *> $env:TEMP/out.txt", "node x.mjs > /tmp/out.txt", "cmd > %TEMP%\\x.log",
    "go build 2> build.err", "echo x > $null", "echo x > /dev/null", "ls >/dev/null 2>&1", "npm test > \"$env:TEMP/o.txt\" 2>&1",
    "ls 2> \"errors > log.txt\"", "echo x > \"/tmp/errors > log.txt\"", "ls 2> 'a > b'", "echo x > '/tmp/a > b'"]) {
    assert.equal(isMutatingShell(c), false, c);
  }
  for (const c of ["echo x > a.txt", "npm test > out.txt 2>&1", "ls 2>/dev/null > list.txt", "cmd >> log.md", "echo x > ./tmp/a.txt", "echo x > \"my file.txt\"", "ls 2> err.log > out.log",
    "echo x > NUL.txt", "echo x > NULL", "echo x > /dev/null.bak", "echo x > $nullable", "echo x > tmp/a.txt", "echo x > tmpfile"]) {
    assert.equal(isMutatingShell(c), true, c);
  }
  // Command names inside quoted strings are text, not commands; inline scripts still count.
  for (const c of ['git commit -m "Set-Content intent/001-dark-mode/iced.md"', 'git commit -m "rm -rf src"', 'echo "npm install"', "grep 'Remove-Item' a.ps1", 'git log --grep "sed -i"']) {
    assert.equal(isMutatingShell(c), false, c);
  }
  for (const c of ['node -e "fs.writeFileSync(\'a\', \'x\')"', 'python -c "open(\'a\', \'w\').write(\'x\')"', "[IO.File]::WriteAllText('a.txt', $t)", 'Set-Content a.txt "rm"']) {
    assert.equal(isMutatingShell(c), true, c);
  }
});

test("007 E2: reading an ICED-owned file is allowed; writing to it is blocked", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "accepted" }));
  const d = (command) => gateDecision({ root, cwd: root, toolName: "powershell", input: { command }, autonomy: 1 });
  const u = "intent/001-dark-mode/iced.md";
  for (const c of [`Get-Content ${u} -TotalCount 20 | Select-String status`, `cat ${u}`, `type ${u}`, `grep -n status ${u}`, `rg status ${u} 2>$null`,
    `git diff HEAD -- ${u}`, `git show HEAD:${u}`, "git stash push .iced/metrics.jsonl", `git status --short; Get-Content ${u}; rg x . 2>$null`,
    "Select-String -Path intent/001-dark-mode/evidence.md -Pattern E1", "cat .iced/config.json", `node -e \"console.log(require('fs').readFileSync('${u}','utf8'))\"`,
    `grep 'Set-Content' ${u}`, `rg \"rm \" ${u}`, `git commit -m \"Set-Content ${u}\"`, `git commit -m \"fix: echo x > ${u}\"`, `git add ${u} && git commit -m \"chore: record\"`,
    `cp ${u} /tmp/backup.md`, `Copy-Item ${u} $env:TEMP`, `Copy-Item -Path ${u} -Destination /tmp`,
    `cmp ${u} other.md`, `diff ${u} other.md > /dev/null`, `cat ${u} 2>/dev/null | head`,
    `grep 'Set-Content ${u}' README.md`, `rg "rm ${u}" docs/`, `grep -rn "echo x > ${u}" test/`, `git log --grep "Set-Content ${u}"`, `(git diff -- ${u})`,
    `grep Set-Content ${u}`, `grep rm ${u}`, `rg Remove-Item ${u} 2>$null`, `grep -c tee ${u}`, "ls intent/001-dark-mode", "ls -la intent .iced", "rm -rf intentional",
    "rm -rf intent/001-dark-mode/review.md", "rm -rf intent/001-dark-mode/scratch", "du -sh .iced", "find intent -name '*.md'", "git status intent"]) {
    assert.equal(writesProtectedShellTarget(c), false, c);
    assert.equal(d(c).action, "allow", c);
  }
  for (const c of [`echo x > ${u}`, `echo x >> ${u}`, `Set-Content ${u} x`, `Add-Content -Path ${u} -Value x`, `'x' | Out-File ${u}`, `sed -i s/a/b/ ${u}`,
    `[IO.File]::WriteAllText('${u}', $t)`, `cp a ${u}`, `mv a ${u}`, "Copy-Item a .iced/config.json", "Move-Item a intent/001-dark-mode/verify.json", `rm ${u}`,
    "Remove-Item .iced/active", `git checkout -- ${u}`, `git rm ${u}`, `node -e \"require('fs').writeFileSync('${u}','x')\"`, `python -c \"open('${u}','w').write('x')\"`,
    "echo x > .iced/metrics.jsonl", `tee ${u} < a`,
    `echo x > ./${u}`, `echo x > \"${u}\"`, `echo x > '${u}'`, `echo x > \"./${u}\"`, `echo x > ${root}/${u}`, `echo x > /mnt/d/repo/${u}`, `cat a 2> ${u}`,
    `cp a ./${u}`, `cp a \"${u}\"`, `mv a ${root}/${u}`, `Copy-Item a -Destination ${u}`, `Copy-Item -Destination ${u} -Path a`, `Move-Item a ./${u}`, `Rename-Item a -NewName ${u}`,
    `git commit -m \"x\" && Set-Content ${u} y`, `cat a | Set-Content ${u}`, `cat a | tee ${u}`, `git -C . checkout -- ${u}`, `node -e \"fs.writeFileSync('${u}', 'x')\"`,
    `python -c \"open('./${u}', 'w').write('x')\"`,
    `git diff > ${u}`, `git show HEAD:${u} > ${u}`, `git log >> ${u}`, `(git diff > ${u})`, `git status && git diff > "${u}"`,
    `cp a ${u} > /dev/null`, `cp a ${u} 2>&1`, `cp a "${u}" 2>$null`, `Copy-Item a ${u} *> $null`, `$r = Copy-Item a ${u}`, `sudo cp a ${u}`,
    `mv ${u} backup.md`, `mv ${u} ../elsewhere.md`, `Move-Item ${u} C:/tmp/x.md`, `Rename-Item ${u} old.md`, `git mv ${u} old.md`,
    "rm -rf intent/001-dark-mode", "rm -rf intent/001-dark-mode/", "rm -rf ./intent", "rm -rf .iced", "rm -r intent", "rmdir /s /q intent\\001-dark-mode", "Remove-Item -Recurse -Force intent/001-dark-mode",
    "Remove-Item .iced -Recurse", "git rm -r intent/001-dark-mode", "mv intent/001-dark-mode old", "Move-Item intent/001-dark-mode old", "git mv intent/001-dark-mode intent/999-x",
    'rm -rf "intent/001-dark-mode"', "Remove-Item -Recurse 'intent/001-dark-mode'", 'rm -rf ".iced"', 'mv "intent/001-dark-mode" old',
    `rm -rf ${root}/intent/001-dark-mode`, "npm test && rm -rf .iced"]) {
    assert.equal(writesProtectedShellTarget(c), true, c);
    assert.equal(d(c).action, "block", c);
    assert.match(d(c).reason, /ICED-owned/);
  }
  // With an active, closed unit the freeze does not turn a commit message into a write.
  const live = setup("done");
  t.after(() => cleanup(live.root));
  const lu = `intent/${live.id}/iced.md`;
  assert.equal(live.decide("bash", { command: `git commit -m "Set-Content ${lu}"` }).action, "allow");
  assert.equal(live.decide("bash", { command: `git add ${lu} && git commit -m "docs: rm old note"` }).action, "allow");
  assert.equal(live.decide("bash", { command: `grep Set-Content ${lu}` }).action, "allow");
});

// ---------------------------------------------------------------------------
// 008: the freeze applies only inside the repository
// ---------------------------------------------------------------------------

test("008 E1/E2: not building, mutations outside the root are allowed; inside, relative, mixed or unresolvable stay blocked", (t) => {
  for (const status of ["draft", "done", "blocked"]) {
    const { root, decide } = setup(status);
    t.after(() => cleanup(root));
    const outside = path.join(path.dirname(root), "sibling-worktree");
    const back = path.basename(root);
    const spaced = path.join(path.dirname(root), "my worktree");
    const ok = [`cd ${outside} && npm ci`, `cd \"${outside}\"; npm install`, `Set-Location ${outside}; Remove-Item x`, `pushd ${outside} && sed -i s/a/b/ f.ts`,
      `git -C ${outside} reset --hard`, `rm -rf ${outside}/node_modules`, `mkdir ${outside}/scratch`, "cd ../sibling-worktree && npm ci", "rm -rf /tmp/scratch",
      `cd ${outside} && npm ci && echo done > log.txt`, `git -C ${outside} checkout -- src/a.ts`, `git -C "${outside}" restore .`, `cd "${spaced}" && rm -rf dist`,
      `Set-Location '${spaced}'; Remove-Item -Recurse dist`, `(cd ${outside} && npm ci)`, `rm -rf ${outside}/x ../sibling-worktree/y`, `cd ${outside} && rm local.txt other.txt`,
      // Another checkout's ICED files are not ours.
      "cd ../sibling-worktree && rm .iced/active", `rm -rf ${outside}/intent/001-dark-mode`, `cd ${outside} && echo x > intent/001-dark-mode/iced.md`,
      `(cd ${outside} && npm ci); (cd ${outside} && rm x)`, `cp --target-directory=${outside} ${outside}/a ${outside}/b`,
      // sed/perl in-place on outside files from the root; `cd X || exit` then work in X.
      `sed -i s/a/b/ ${outside}/file.txt`, `sed -i -e s/a/b/ ../sibling-worktree/f.ts`, `perl -pi -e 's/a/b/' ${outside}/f.ts`, `cd ${outside} || exit 1; rm x`, `cd ${outside} || exit 1 && npm ci`];
    for (const c of ok) {
      assert.equal(shellMutatesOnlyOutside(root, root, c), true, `${status}: ${c}`);
      assert.equal(decide("bash", { command: c }).action, "allow", `${status}: ${c}`);
    }
    const bad = ["npm ci", "rm -rf node_modules", "sed -i s/a/b/ src/a.ts", `rm -rf ${root}/src`, `cd ${outside} && cd ../${back} && rm x`, `cd ${outside} && rm x; cd ${root} && rm y`,
      `rm -rf ${outside}/x src/y`, "cd $DIR && rm x", "rm -rf $DIR/x", `cd ${outside}/* && rm x`, `pushd ${outside} && popd && rm x`, `cd ${outside} && git -C ${root} reset --hard`,
      `rm -rf ${outside}/x local.txt`, `rm -rf ${outside}/x $TARGET`, `rm -rf local.txt ${outside}/x`, `git -C ${outside} checkout -- ${root}/src/a.ts`, `npm ci --prefix ${outside}`,
      `cd ${outside} && rm -rf ${root}`, `cd ${outside} && rm ../${back}/x`, `cd "${spaced}" && cd "${root}" && rm x`, "cd && rm x",
      // A subshell's `cd` ends with the parenthesis; a flag value is a path too.
      `(cd ${outside} && npm ci); rm src/a.ts`, `(cd ${outside}); rm src/a.ts`, `(cd ${outside} && (cd .. && ls)); rm x`, `cp --target-directory=. ${outside}/a ${outside}/b`,
      `cp -t . ${outside}/a`, `rm -rf --one-file-system=src ${outside}/x`,
      // A failed `cd` leaves the shell where it was; a `cd` in a pipeline changes nothing.
      `cd ${outside} || rm src/a.ts`, `cd ../missing || rm .iced/active`, `cd ${outside} || echo no; rm x`, `cd ${outside} | rm src/a.ts`, `echo ${outside} | cd ${outside}; rm x`,
      `sed -i s/a/b/ ${outside}/a src/b`, `sed -i s/a/b/`, `sed -i -e s/a/b/ src/a.ts`];
    for (const c of bad) {
      assert.equal(shellMutatesOnlyOutside(root, root, c), false, `${status}: ${c}`);
      assert.equal(decide("bash", { command: c }).action, "block", `${status}: ${c}`);
    }
    assert.equal(shellMutatesOnlyOutside(root, root, "npm test"), false, "read-only is not an outside mutation");
  }
});

test("008 E3: gate always without an active unit allows outside-only mutations and blocks inside ones", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const outside = path.join(path.dirname(root), "elsewhere");
  const d = (command) => gateDecision({ root, cwd: root, toolName: "bash", input: { command }, autonomy: 1, always: true });
  assert.equal(d(`cd ${outside} && npm ci`).action, "allow");
  assert.equal(d(`rm -rf ${outside}`).action, "allow");
  assert.equal(d("npm ci").action, "block");
  assert.equal(d("rm -rf src").action, "block");
});

// ---------------------------------------------------------------------------
// 009: trusted and autonomous units are not frozen before building
// ---------------------------------------------------------------------------

test("009 E1: at autonomy 2 or 3 the not-building freeze notifies instead of blocking; 0 and 1 block", (t) => {
  for (const status of ["draft", "approved", "verifying", "done", "blocked"]) {
    const { root, decide } = setup(status);
    t.after(() => cleanup(root));
    for (const a of [2, 3]) {
      const w = decide("write", { path: "src/a.ts", content: "" }, a);
      assert.equal(w.action, "notify", `${status} write @${a}`);
      assert.match(w.reason, new RegExp(`${status}[\\s\\S]*verification`), `${status} @${a}`);
      assert.equal(decide("edit", { path: "src/a.ts", edits: [] }, a).action, "notify", `${status} edit @${a}`);
      assert.equal(decide("bash", { command: "npm install zod" }, a).action, "notify", `${status} shell @${a}`);
      assert.equal(decide("bash", { command: "git pull --ff-only origin dev" }, a).action, "notify", `${status} git pull @${a}`);
    }
    for (const a of [0, 1]) {
      assert.equal(decide("write", { path: "src/a.ts", content: "" }, a).action, "block", `${status} write @${a}`);
      assert.equal(decide("bash", { command: "npm install zod" }, a).action, "block", `${status} shell @${a}`);
    }
  }
});

test("009 E2: owned files, protected keys, the frozen contract and review units still block at autonomy 2 and 3", (t) => {
  for (const a of [2, 3]) {
    const { root, id, decide } = setup("approved");
    t.after(() => cleanup(root));
    const u = `intent/${id}/iced.md`;
    assert.equal(decide("write", { path: `intent/${id}/evidence.md`, content: "" }, a).action, "block");
    assert.equal(decide("write", { path: `intent/${id}/verify.json`, content: "" }, a).action, "block");
    assert.equal(decide("write", { path: ".iced/active", content: "" }, a).action, "block");
    assert.equal(decide("edit", { path: u, edits: [{ oldText: "status: approved", newText: "status: building" }] }, a).action, "block");
    assert.equal(decide("edit", { path: u, edits: [{ oldText: "from Settings and it persists.", newText: "from Settings." }] }, a).action, "block");
    assert.equal(decide("bash", { command: `echo x > ${u}` }, a).action, "block");
    for (const c of [`mv ${u} backup.md`, `Move-Item ${u} old.md`, `rm -rf intent/${id}`, `Remove-Item -Recurse intent/${id}`, "rm -rf .iced", `git mv ${u} x.md`, `cp a ${u} > /dev/null`,
      `rm -rf "intent/${id}"`, `Remove-Item -Recurse 'intent/${id}'`, `rm -rf "./intent/${id}/"`, `mv "intent/${id}" old`, `rm -rf ".iced"`, `git rm -r "intent/${id}"`]) {
      const d = decide("bash", { command: c }, a);
      assert.equal(d.action, "block", c);
      assert.equal(d.hard, true, c);
    }
    assert.equal(decide("edit", { path: ".iced/config.json", edits: [] }, a).action, "block", "no config file yet: unpredictable");
    const review = setup("draft", { type: "review" });
    t.after(() => cleanup(review.root));
    assert.equal(review.decide("write", { path: "src/a.ts", content: "" }, a).action, "block");
    assert.equal(review.decide("bash", { command: "rm a" }, a).action, "block");
  }
});

test("009 C2/C3: protection blocks are hard (kept in gate mode warn); the not-building freeze is not", (t) => {
  const { root, id, decide } = setup("approved");
  t.after(() => cleanup(root));
  const u = `intent/${id}/iced.md`;
  const hard = [
    decide("write", { path: `intent/${id}/evidence.md`, content: "" }),
    decide("write", { path: ".iced/active", content: "" }),
    decide("edit", { path: u, edits: [{ oldText: "status: approved", newText: "status: building" }] }),
    decide("edit", { path: u, edits: [{ oldText: "from Settings and it persists.", newText: "from Settings." }] }),
    decide("edit", { path: u, edits: [{ oldText: "nope", newText: "x" }] }),
    decide("write", { path: "intent/009-new/iced.md", content: "" }),
    decide("bash", { command: `echo x > ${u}` }),
    decide("edit", { path: ".iced/config.json", edits: [] }),
  ];
  for (const d of hard) { assert.equal(d.action, "block"); assert.equal(d.hard, true, d.reason); }
  const soft = [decide("write", { path: "src/a.ts", content: "" }), decide("bash", { command: "npm install zod" })];
  for (const d of soft) { assert.equal(d.action, "block"); assert.equal(d.hard, undefined, d.reason); }
  const review = setup("building", { type: "review" });
  t.after(() => cleanup(review.root));
  assert.equal(review.decide("write", { path: "src/a.ts", content: "" }).hard, true);
  assert.equal(review.decide("bash", { command: "rm a" }).hard, true);
  const closed = setup("accepted");
  t.after(() => cleanup(closed.root));
  assert.equal(closed.decide("edit", { path: `intent/${closed.id}/iced.md`, edits: [{ oldText: "title: Dark mode", newText: "title: X" }] }).hard, true);
  const { root: cr, write } = configRepo();
  t.after(() => cleanup(cr));
  assert.equal(write((c) => { c.gate = "off"; return c; }).hard, true);
  assert.equal(gateDecision({ root: cr, cwd: cr, toolName: "write", input: { path: ".iced/config.json", content: "{" }, autonomy: 1 }).hard, true);
  // The extension's warn mode downgrades only soft blocks.
  const src = fs.readFileSync(fileURLToPath(new URL("../extensions/iced/index.ts", import.meta.url)), "utf8");
  assert.match(src, /if \(mode === "warn" && !d\.hard\) \{\s*if \(ctx\.hasUI\) ctx\.ui\.notify\(`ICED \(warn\): \$\{d\.reason\}`, "warning"\);\s*return undefined;\s*\}\s*return \{ block: true, reason: `ICED gate: \$\{d\.reason\}` \};/);
});

test("009 E3: the extension allows notify decisions and shows a notice when a UI exists", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../extensions/iced/index.ts", import.meta.url)), "utf8");
  const start = src.indexOf('if (d.action === "notify")');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('if (d.action === "confirm")', start));
  assert.match(block, /ctx\.hasUI[\s\S]*ctx\.ui\.notify\(`ICED: \$\{d\.reason\}`/);
  assert.match(block, /return undefined;/);
  assert.doesNotMatch(block, /block: true/);
});

// ---------------------------------------------------------------------------
// 010: agents can keep notes in a signed-off unit
// ---------------------------------------------------------------------------

test("010 E1: after sign-off, Context, Open questions and unprotected frontmatter may change; closed units are frozen", (t) => {
  const edits = {
    context: [{ oldText: "- [assumed] Persist in localStorage.", newText: "- [assumed] Persist in localStorage.\n- [code] Settings page lives in src/settings." }],
    question: [{ oldText: "-> A: yes", newText: "-> A: yes (confirmed with the human)" }],
    title: [{ oldText: "title: Dark mode", newText: "title: Dark theme in Settings" }],
    tier: [{ oldText: "tier: M", newText: "tier: S" }],
    risk: [{ oldText: "risk: low", newText: "risk: medium" }],
    many: [{ oldText: "title: Dark mode", newText: "title: Dark theme" }, { oldText: "-> A: yes", newText: "-> A: yes!" }],
  };
  for (const status of ["approved", "building", "verifying", "done", "blocked"]) {
    const { root, id, decide } = setup(status);
    t.after(() => cleanup(root));
    for (const [name, e] of Object.entries(edits)) assert.equal(decide("edit", { path: `intent/${id}/iced.md`, edits: e }).action, "allow", `${status} ${name}`);
    const whole = fs.readFileSync(path.join(root, "intent", id, "iced.md"), "utf8").replace("## Context\n", "## Context\n- [code] Added by the agent.\n");
    assert.equal(decide("write", { path: `intent/${id}/iced.md`, content: whole }).action, "allow", `${status} write`);
  }
  for (const status of ["accepted", "rejected"]) {
    const { root, id, decide } = setup(status);
    t.after(() => cleanup(root));
    const d = decide("edit", { path: `intent/${id}/iced.md`, edits: edits.context });
    assert.equal(d.action, "block", status);
    assert.match(d.reason, /closed/);
  }
  // Blocked before sign-off: no approved contract, so the body is still the agent's to draft.
  const unsigned = setup("blocked", { contract_hash: undefined });
  t.after(() => cleanup(unsigned.root));
  const u = `intent/${unsigned.id}/iced.md`;
  assert.equal(fs.readFileSync(path.join(unsigned.root, u), "utf8").includes("contract_hash"), false);
  assert.equal(unsigned.decide("edit", { path: u, edits: [{ oldText: "Choice persists across reloads.", newText: "Choice persists forever." }] }).action, "allow");
  assert.equal(unsigned.decide("edit", { path: u, edits: [{ oldText: "status: blocked", newText: "status: approved" }] }).action, "block");
});

test("010 E2: contract text, protected keys and invalid results are blocked with the changed section named", (t) => {
  const { root, id, decide } = setup("building");
  t.after(() => cleanup(root));
  const u = `intent/${id}/iced.md`;
  const goal = decide("edit", { path: u, edits: [{ oldText: "from Settings and it persists.", newText: "from Settings." }] });
  assert.equal(goal.action, "block");
  assert.match(goal.reason, /Intent is frozen[\s\S]*iced_escalate[\s\S]*change-expectation/);
  const exp = decide("edit", { path: u, edits: [{ oldText: "Choice persists across reloads.", newText: "Choice persists forever." }] });
  assert.match(exp.reason, /Expectations is frozen[\s\S]*change-expectation/);
  const both = decide("edit", { path: u, edits: [{ oldText: "- [C2] Light theme unchanged.", newText: "- [C2] Light theme kept." }, { oldText: "{verify: check}", newText: "{verify: manual}" }] });
  assert.match(both.reason, /Intent and Expectations is frozen/);
  const constraintAdded = decide("edit", { path: u, edits: [{ oldText: "- [C2] Light theme unchanged.", newText: "- [C2] Light theme unchanged.\n- [C3] Allow anything." }] });
  assert.equal(constraintAdded.action, "block");
  assert.equal(decide("edit", { path: u, edits: [{ oldText: "status: building", newText: "status: done" }] }).action, "block");
  assert.equal(decide("edit", { path: u, edits: [{ oldText: "attempts: 0", newText: "attempts: 9" }] }).action, "block");
  // Protected key and contract text in one edit: the reason names both the field and the frozen section.
  const combo = decide("edit", { path: u, edits: [{ oldText: "status: building", newText: "status: done" }, { oldText: "from Settings and it persists.", newText: "from Settings." }] });
  assert.equal(combo.action, "block");
  assert.equal(combo.hard, true);
  assert.match(combo.reason, /status[\s\S]*Intent is frozen[\s\S]*iced_escalate[\s\S]*change-expectation/);
  const dup = decide("edit", { path: u, edits: [{ oldText: "## Open questions", newText: "## Context\n- [code] Again.\n\n## Open questions" }] });
  assert.equal(dup.action, "block");
  assert.match(dup.reason, /invalid[\s\S]*more than once/);
  const badRisk = decide("edit", { path: u, edits: [{ oldText: "risk: low", newText: "risk: extreme" }] });
  assert.equal(badRisk.action, "block");
  assert.match(badRisk.reason, /invalid/);
  for (const e of [[{ oldText: "nope", newText: "x" }], [{ oldText: "theme", newText: "x" }], [{ oldText: "", newText: "x" }]]) {
    assert.equal(decide("edit", { path: u, edits: e }).action, "block");
  }
});

// ---------------------------------------------------------------------------
// 011: agents can tune the ICED config except its integrity keys
// ---------------------------------------------------------------------------

const CONFIG = {
  iced: "0.1", gate: "strict", autonomy: 1, maxAutonomy: 3, autonomyByRisk: { low: null, medium: null, high: null },
  verify: { commands: ["npm test"], parallel: true, maxAttempts: 3, independent: true, lenses: "auto", model: { pi: ["a/b"] }, timeoutSec: 900 },
  build: { testWriter: false, testWriterModel: null }, memory: { product: ".iced/memory/product.md", knowledge: [] },
};

function configRepo() {
  const root = tempRepo({ config: CONFIG });
  const write = (patch) => gateDecision({ root, cwd: root, toolName: "write", input: { path: ".iced/config.json", content: JSON.stringify(patch(structuredClone(CONFIG)) ?? "", null, 2) }, autonomy: 1 });
  return { root, write };
}

test("011 E1: operational config keys may change; integrity keys, their removal or invalid JSON are blocked", (t) => {
  const { root, write } = configRepo();
  t.after(() => cleanup(root));
  for (const [name, patch] of Object.entries({
    commands: (c) => { c.verify.commands = ["npm run test:unit"]; return c; },
    timeout: (c) => { c.verify.timeoutSec = 1200; return c; },
    parallel: (c) => { c.verify.parallel = false; return c; },
    testWriter: (c) => { c.build.testWriter = true; return c; },
    memory: (c) => { c.memory.knowledge = ["docs/arch.md"]; return c; },
    newKey: (c) => { c.promotion = { mode: "off" }; return c; },
    reordered: (c) => Object.fromEntries(Object.entries(c).reverse()),
  })) assert.equal(write(patch).action, "allow", name);
  for (const [key, patch] of Object.entries({
    gate: (c) => { c.gate = "off"; return c; },
    autonomy: (c) => { c.autonomy = 3; return c; },
    maxAutonomy: (c) => { c.maxAutonomy = 0; return c; },
    autonomyByRisk: (c) => { c.autonomyByRisk.high = 3; return c; },
    "verify.model": (c) => { c.verify.model = { pi: ["x/y"] }; return c; },
    "verify.independent": (c) => { c.verify.independent = false; return c; },
    "verify.lenses": (c) => { c.verify.lenses = 1; return c; },
    "verify.maxAttempts": (c) => { c.verify.maxAttempts = 99; return c; },
    "build.testWriterModel": (c) => { c.build.testWriterModel = "x/y"; return c; },
  })) {
    const d = write(patch);
    assert.equal(d.action, "block", key);
    assert.ok(d.reason.includes(key), `${key}: ${d.reason}`);
    assert.match(d.reason, /\/iced (autonomy|gate|models)/);
  }
  assert.equal(write((c) => { delete c.verify.model; return c; }).action, "block", "removing an integrity key");
  assert.equal(write((c) => { delete c.verify; return c; }).action, "block", "removing the verify section");
  const raw = (content) => gateDecision({ root, cwd: root, toolName: "write", input: { path: ".iced/config.json", content }, autonomy: 1 });
  assert.equal(raw("{ not json").action, "block");
  assert.match(raw("{ not json").reason, /valid JSON/);
  assert.equal(raw("[]").action, "block");
  const e = (edits) => gateDecision({ root, cwd: root, toolName: "edit", input: { path: ".iced/config.json", edits }, autonomy: 1 });
  assert.equal(e([{ oldText: '"timeoutSec":900', newText: '"timeoutSec":600' }]).action, "allow");
  assert.equal(e([{ oldText: '"independent":true', newText: '"independent":false' }]).action, "block");
  assert.equal(e([{ oldText: "missing", newText: "x" }]).action, "block");
  assert.equal(e([{ oldText: '"timeoutSec":900', newText: '"timeoutSec":' }]).action, "block", "edit producing invalid JSON");
  assert.deepEqual(changedConfigIntegrityKeys("{}", '{"gate":"off"}'), ["gate"], "adding an integrity key the file lacked");
  assert.deepEqual(changedConfigIntegrityKeys('{"verify":{"model":{"pi":["a"]}}}', '{"verify":{"model":{"pi":["a"]},"timeoutSec":1}}'), []);
  assert.equal(changedConfigIntegrityKeys("{}", "nope"), null);
});

test("011 E2/E3: other ICED-owned files and shell writes to the config stay blocked; the key list is exported once", (t) => {
  const { root } = configRepo();
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "building", contract_hash: core.contractHash(unitText()) }));
  core.setActive(root, "001-dark-mode");
  const d = (toolName, input) => gateDecision({ root, cwd: root, toolName, input, autonomy: 3 });
  for (const p of [".iced/active", ".iced/metrics.jsonl", "intent/001-dark-mode/evidence.md", "intent/001-dark-mode/verify.json"]) {
    assert.equal(d("write", { path: p, content: "" }).action, "block", p);
  }
  for (const c of ["Set-Content .iced/config.json '{}'", "echo '{}' > .iced/config.json", "node -e \"require('fs').writeFileSync('.iced/config.json','{}')\"", "[IO.File]::WriteAllText('.iced/config.json', $t)",
    // Directory-relative writes resolve through cd.
    "cd .iced && echo '{}' > config.json", "cd .iced; echo x > active", "cd .iced && echo x >> metrics.jsonl", "cd intent/001-dark-mode && rm iced.md", "cd intent && rm -rf 001-dark-mode",
    "cd intent/001-dark-mode && cp ../../a evidence.md", "pushd .iced; Set-Content config.json '{}'", "cd .iced && sed -i s/a/b/ config.json"]) {
    const r = d("powershell", { command: c });
    assert.equal(r.action, "block", c);
    assert.equal(r.hard, true, c);
  }
  for (const c of ["cd .iced && cat config.json", "cd intent/001-dark-mode && grep status iced.md", "cd .iced && echo x > /dev/null"]) {
    assert.equal(d("bash", { command: c }).action, "allow", c);
  }
  assert.equal(d("bash", { command: "cat .iced/config.json" }).action, "allow");
  assert.deepEqual(CONFIG_INTEGRITY_KEYS, ["gate", "autonomy", "maxAutonomy", "autonomyByRisk", "verify.model", "verify.independent", "verify.lenses", "verify.maxAttempts", "build.testWriterModel"]);
  const readme = fs.readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  for (const k of CONFIG_INTEGRITY_KEYS) assert.ok(readme.includes(`\`${k}\``), `README documents ${k}`);
});

// ---------------------------------------------------------------------------
// 012: every gate block tells the agent its next step
// ---------------------------------------------------------------------------

const NEXT_STEP = /Next step:[\s\S]*(iced_\w+|decisions\.md|\/iced \w+|review\.md|read-only)/i;

/** Every block decision the gate can produce, labelled. */
function everyBlock(t) {
  const out = [];
  const add = (label, d) => { assert.equal(d.action, "block", label); out.push([label, d.reason]); };
  for (const status of ["draft", "approved", "verifying", "done", "blocked"]) {
    const { root, id, decide } = setup(status);
    t.after(() => cleanup(root));
    add(`${status} code`, decide("write", { path: "src/a.ts", content: "" }));
    add(`${status} shell`, decide("bash", { command: "npm install zod" }));
    add(`${status} owned`, decide("write", { path: `intent/${id}/evidence.md`, content: "" }));
    add(`${status} new unit`, decide("write", { path: "intent/009-new/iced.md", content: "" }));
    add(`${status} protected`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "autonomy: 1", newText: "autonomy: 3" }] }));
    add(`${status} unpredictable`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "nope", newText: "x" }] }));
    if (status !== "draft") {
      add(`${status} contract`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "from Settings and it persists.", newText: "from Settings." }] }));
      add(`${status} protected+contract`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "autonomy: 1", newText: "autonomy: 3" }, { oldText: "from Settings and it persists.", newText: "from Settings." }] }));
      add(`${status} invalid`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "risk: low", newText: "risk: extreme" }] }));
      add(`${status} invalid twice`, decide("edit", { path: `intent/${id}/iced.md`, edits: [{ oldText: "risk: low", newText: "risk: extreme" }, { oldText: "## Open questions", newText: "## Context\n- [code] Again.\n\n## Open questions" }] }));
    }
    add(`${status} shell owned via cd`, decide("bash", { command: "cd .iced && echo x > active" }));
    add(`${status} shell owned`, decide("bash", { command: `echo x > intent/${id}/iced.md` }));
    add(`${status} config missing`, decide("edit", { path: ".iced/config.json", edits: [] }));
  }
  const review = setup("building", { type: "review" });
  t.after(() => cleanup(review.root));
  add("review code", review.decide("write", { path: "src/a.ts", content: "" }));
  add("review shell", review.decide("bash", { command: "rm a" }));
  const closed = setup("accepted");
  t.after(() => cleanup(closed.root));
  add("closed unit", closed.decide("edit", { path: `intent/${closed.id}/iced.md`, edits: [{ oldText: "title: Dark mode", newText: "title: X" }] }));
  const always = (toolName, input) => gateDecision({ root: closed.root, cwd: closed.root, toolName, input, autonomy: 1, always: true });
  add("always code", always("write", { path: "src/a.ts", content: "" }));
  add("always shell", always("bash", { command: "rm a" }));
  const { root: cr, write } = configRepo();
  t.after(() => cleanup(cr));
  add("config integrity", write((c) => { c.gate = "off"; return c; }));
  add("config json", gateDecision({ root: cr, cwd: cr, toolName: "write", input: { path: ".iced/config.json", content: "{" }, autonomy: 1 }));
  add("config emptied", gateDecision({ root: cr, cwd: cr, toolName: "write", input: { path: ".iced/config.json", content: "{}" }, autonomy: 1 }));
  add("config unpredictable", gateDecision({ root: cr, cwd: cr, toolName: "edit", input: { path: ".iced/config.json", edits: [{ oldText: "missing", newText: "x" }] }, autonomy: 1 }));
  for (const tool of ["write", "edit", "bash", "powershell", "iced_submit"]) add(`verifier ${tool}`, verifierToolDecision(tool));
  return out;
}

test("012 E1: every block reason names a concrete next step, stays short and has no absolute local path", (t) => {
  const blocks = everyBlock(t);
  assert.ok(blocks.length >= 40, `enumerated ${blocks.length} block paths`);
  for (const [label, reason] of blocks) {
    assert.match(reason, NEXT_STEP, `${label}: ${reason}`);
    assert.ok(reason.length <= 330, `${label}: ${reason.length} chars`);
    assert.doesNotMatch(reason, /[A-Za-z]:\\|\/home\/|\/Users\//, `${label} leaks a local path`);
    assert.doesNotMatch(reason, /edit (the )?(Intent|Expectations|evidence\.md|verify\.json)/i, `${label} suggests a blocked action`);
    // The next-step sentence is the last one.
    const last = reason.trim().split(/(?<=\.)\s+(?=[A-Z])/).pop();
    assert.match(last, /^Next step:|iced_\w+|decisions\.md|\/iced \w+|review\.md|read-only/, `${label}: last sentence is not the next step: ${last}`);
  }
  // The extension's own block reasons (autonomy 0 without a UI, human declined) name a next step too.
  const src = fs.readFileSync(fileURLToPath(new URL("../extensions/iced/index.ts", import.meta.url)), "utf8");
  const confirmBranch = src.slice(src.indexOf('if (d.action === "confirm")'), src.indexOf('if (mode === "warn"'));
  const reasons = [...confirmBranch.matchAll(/reason: `([^`]*)`/g)].map((m) => m[1]);
  assert.equal(reasons.length, 2);
  for (const r of reasons) assert.match(r, NEXT_STEP, r);
});

test("012 E2: blocked, verifying, done and shell not-building reasons name the human command or tool", (t) => {
  const by = Object.fromEntries(everyBlock(t));
  assert.match(by["blocked code"], /\/iced build 001-dark-mode[\s\S]*\/iced reject 001-dark-mode/);
  assert.match(by["blocked shell"], /\/iced build 001-dark-mode/);
  assert.match(by["verifying code"], /wait[\s\S]*\/iced accept 001-dark-mode[\s\S]*decisions\.md/i);
  assert.match(by["verifying shell"], /\/iced accept 001-dark-mode/);
  assert.match(by["approved protected+contract"], /autonomy[\s\S]*Intent is frozen[\s\S]*iced_escalate[\s\S]*iced_request_signoff/);
  assert.match(by["approved invalid"], /invalid[\s\S]*decisions\.md/);
  assert.match(by["config emptied"], /gate, autonomy, maxAutonomy and 6 more[\s\S]*\/iced (autonomy|gate|models)/);
  assert.match(by["draft shell owned"], /reading them is fine[\s\S]*iced_submit[\s\S]*iced_decision/);
  assert.match(by["draft shell owned via cd"], /ICED-owned/);
  assert.match(by["done code"], /\/iced accept 001-dark-mode/);
  assert.match(by["done shell"], /\/iced accept 001-dark-mode/);
  assert.match(by["approved code"], /iced_build[\s\S]*\/iced build 001-dark-mode/);
  assert.match(by["draft shell"], /Read-only commands[\s\S]*outside this repository[\s\S]*iced_request_signoff/);
  assert.match(by["review code"], /review\.md/);
  assert.match(by["always code"], /iced_start/);
  assert.match(by["draft owned"], /iced_submit[\s\S]*iced_decision[\s\S]*decisions\.md/);
  assert.match(by["approved contract"], /iced_escalate[\s\S]*change-expectation[\s\S]*decisions\.md/);
  assert.match(by["config integrity"], /\/iced (autonomy|gate|models)/);
  assert.match(by["closed unit"], /iced_start[\s\S]*decisions\.md/);
  assert.match(by["verifier bash"], /read-only commands \(read, grep, find, ls\)[\s\S]*verdict/);
});
