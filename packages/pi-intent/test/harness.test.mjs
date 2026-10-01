// [E2] pi only: nothing in the repo targets another agent harness, and the standalone CLI, vendoring,
// split verification and GitHub Action are gone. intent/ and .iced/ are ICED's own records of this repo
// (they describe the removal itself and hold the user's model names), so they are not scanned.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const HARNESS = /\b(claude|codex|copilot|gemini|opencode|aider|windsurf)\b|cursor-agent|AGENTS\.md|CLAUDE\.md|GEMINI\.md|iced\.mjs|\.iced[\\/](bin|lib)\b|--prepare|--finish|prepareSplit|finishSplit|action\.yml|GitHub Action|ICED_RUNNER|verify\.runner|\bRUNNERS\b/i;
// Case-sensitive: the editor's name, or its config folder, but not a picker's `state.cursor`.
const CURSOR = /\bCursor\b|(?<![\w$])\.cursor\b/;
// intent/<id>/ holds unit records (they describe the removal itself); intent/README.md is scanned.
const SKIP = /^(intent\/[^/]+\/|\.iced\/|node_modules\/)/;

function repoFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" });
  return [...new Set(out.split(/\r?\n/).filter(Boolean))].filter((f) => !SKIP.test(f) && fs.existsSync(path.join(REPO, f)));
}

test("no file targets another harness or the removed CLI", () => {
  // The two scanners hold the patterns themselves; the init test names the files init must NOT create.
  const scanners = new Set([
    "packages/pi-intent/test/harness.test.mjs", "packages/iced-core/test/agnostic.test.mjs", "packages/iced-core/test/init.test.mjs",
    "package-lock.json",
  ]);
  const hits = [];
  for (const f of repoFiles()) {
    if (scanners.has(f)) continue;
    const text = fs.readFileSync(path.join(REPO, f), "utf8");
    text.split(/\r?\n/).forEach((line, i) => { if (HARNESS.test(line) || CURSOR.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`); });
  }
  assert.deepEqual(hits, []);
});

test("removed paths stay removed", () => {
  const files = repoFiles();
  const banned = /^(bin\/|action\.yml$|skills\/|lib\/|\.claude\/|\.codex\/|\.agents\/|\.cursor\/|\.github\/copilot|AGENTS\.md$|CLAUDE\.md$|GEMINI\.md$)|(^|\/)iced\.mjs$/;
  assert.deepEqual(files.filter((f) => banned.test(f)), []);
  for (const p of ["bin", "action.yml", "skills", "lib", ".claude", ".codex", ".agents", "AGENTS.md", "CLAUDE.md", ".iced/bin", ".iced/lib", ".iced/ICED.md"]) {
    assert.ok(!fs.existsSync(path.join(REPO, p)), `${p} exists`);
  }
});

test("this repo's ICED config has no harness targets or agent runner", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, ".iced", "config.json"), "utf8"));
  assert.equal(cfg.targets, undefined, "targets");
  assert.equal(cfg.verify?.runner, undefined, "verify.runner");
  const model = cfg.verify?.model;
  if (model && typeof model === "object" && !Array.isArray(model)) assert.deepEqual(Object.keys(model).filter((k) => !["pi", "default"].includes(k)), [], "per-tool model keys");
});

test("no package exposes a CLI", () => {
  for (const dir of ["", "packages/iced-core", "packages/pi-intent"]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, dir, "package.json"), "utf8"));
    assert.equal(pkg.bin, undefined, `${dir || "root"} has bin`);
  }
});
