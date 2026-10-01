import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { INTENT_README, detectVerifyCommands, initRepo } from "../src/init.mjs";
import { defaultConfig } from "../src/core.mjs";
import { cleanup, tempDir } from "./helpers.mjs";

const read = (root, p) => fs.readFileSync(path.join(root, p), "utf8");
const count = (s, sub) => s.split(sub).length - 1;

/** Every file under dir, relative, with forward slashes (skips .git). */
function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out.sort();
}

const TEMPLATES = ["bug", "chore", "feature", "project", "review"].map((t) => `.iced/templates/${t}.md`);
const EXPECTED = [
  ".gitattributes", ".gitignore", ".iced/config.json", ".iced/memory/knowledge.md", ".iced/memory/product.md",
  ...TEMPLATES, "intent/README.md",
].sort();

test("initRepo in an empty git repo writes only ICED's own files", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  const r = initRepo(root, {});
  assert.deepEqual(listFiles(root), EXPECTED);
  assert.deepEqual([...r.created].sort(), EXPECTED);
  assert.deepEqual(r.updated, []);
  for (const banned of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".claude", ".codex", ".agents", ".cursor", ".github", ".iced/bin", ".iced/lib", ".iced/ICED.md", ".iced/rubric.md"]) {
    assert.ok(!fs.existsSync(path.join(root, banned)), `${banned} must not be created`);
  }
  assert.equal(read(root, "intent/README.md"), INTENT_README);
  assert.match(read(root, ".gitattributes"), /^intent\/\*\*\/\*\.md text eol=lf$/m);
  assert.match(read(root, ".gitignore"), /^\.iced\/active$/m);
  assert.match(read(root, ".gitignore"), /^\.iced\/tmp\/$/m);
  const cfg = JSON.parse(read(root, ".iced/config.json"));
  assert.equal(cfg.gate, "strict");
  assert.ok(!("targets" in cfg), "no harness targets in config");
  assert.ok(!("runner" in cfg.verify), "no agent runner in config");
  assert.deepEqual(Object.keys(cfg).sort(), Object.keys(defaultConfig()).sort());
});

test("initRepo: re-running is safe, keeps config and memory, refreshes templates, never duplicates lines", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  initRepo(root, {});
  const cfgFile = path.join(root, ".iced", "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({ gate: "warn" }));
  fs.writeFileSync(path.join(root, ".iced", "memory", "product.md"), "# Mine\n");
  fs.writeFileSync(path.join(root, "intent", "README.md"), "my notes\n");
  fs.writeFileSync(path.join(root, ".iced", "templates", "bug.md"), "stale\n");
  const again = initRepo(root, {});
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.updated, [".iced/templates/bug.md"]);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, "utf8")).gate, "warn");
  assert.equal(read(root, ".iced/memory/product.md"), "# Mine\n");
  assert.equal(read(root, "intent/README.md"), "my notes\n");
  assert.notEqual(read(root, ".iced/templates/bug.md"), "stale\n");
  const gi = read(root, ".gitignore");
  assert.match(gi, /^node_modules\/$/m);
  assert.equal(count(gi, ".iced/active"), 1);
  assert.equal(count(read(root, ".gitattributes"), "intent/**/*.md"), 1);
  initRepo(root, { force: true });
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, "utf8")).gate, "strict");
});

test("initRepo never deletes files left by older versions", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  fs.mkdirSync(path.join(root, ".iced", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".iced", "bin", "old.mjs"), "x");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# House rules\n");
  initRepo(root, {});
  assert.ok(fs.existsSync(path.join(root, ".iced", "bin", "old.mjs")));
  assert.equal(read(root, "AGENTS.md"), "# House rules\n");
});

test("detectVerifyCommands", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  assert.deepEqual(detectVerifyCommands(root), []);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } }));
  assert.deepEqual(detectVerifyCommands(root), []);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  assert.deepEqual(detectVerifyCommands(root), ["npm test"]);
  initRepo(root, {});
  assert.deepEqual(JSON.parse(read(root, ".iced/config.json")).verify.commands, ["npm test"]);
});
