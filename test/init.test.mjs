import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MANAGED_BODY, detectTargets, detectVerifyCommands, initRepo, upsertManagedBlock } from "../lib/iced-init.mjs";
import { fileURLToPath } from "node:url";
import { cleanup, tempDir, unitText } from "./helpers.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-verifier.mjs");

const read = (root, p) => fs.readFileSync(path.join(root, p), "utf8");
const count = (s, sub) => s.split(sub).length - 1;

test("upsertManagedBlock: insert, append, replace", () => {
  const empty = upsertManagedBlock("", "hello");
  assert.equal(empty, "<!-- ICED:BEGIN -->\nhello\n<!-- ICED:END -->\n");
  const appended = upsertManagedBlock("# Mine\n\nkeep me\n", "hello");
  assert.match(appended, /^# Mine\n\nkeep me\n\n<!-- ICED:BEGIN -->\nhello\n<!-- ICED:END -->\n$/);
  const replaced = upsertManagedBlock(appended, "bye");
  assert.equal(count(replaced, "ICED:BEGIN"), 1);
  assert.match(replaced, /keep me/);
  assert.match(replaced, /\nbye\n/);
  assert.equal(upsertManagedBlock(replaced, "bye"), replaced);
});

test("initRepo: default targets write discovery files for pi, Codex and Claude", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# House rules\n\nUse tabs.\n");
  const r = initRepo(root, {});
  assert.deepEqual(r.targets, ["agents", "claude", "codex", "skills"]);
  for (const f of [
    ".iced/config.json", ".iced/ICED.md", ".iced/memory/product.md", ".iced/memory/knowledge.md",
    ".iced/templates/feature.md", ".iced/templates/bug.md", ".iced/bin/iced.mjs", ".iced/lib/iced-core.mjs",
    ".iced/lib/iced-verify.mjs", ".iced/rubric.md", ".claude/agents/iced-verifier.md", ".codex/agents/iced-verifier.toml",
    "intent/README.md", "CLAUDE.md", ".claude/commands/iced.md", ".agents/skills/iced/SKILL.md",
    ".agents/skills/iced/references/protocol.md", ".claude/skills/iced/SKILL.md",
  ]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const agents = read(root, "AGENTS.md");
  assert.match(agents, /^# House rules\n\nUse tabs\.\n/);
  assert.ok(agents.includes(MANAGED_BODY.trim()));
  assert.match(read(root, "CLAUDE.md"), /intent\/<id>\/iced\.md/);
  for (const f of ["AGENTS.md", ".agents/skills/iced/SKILL.md", ".iced/ICED.md"]) assert.match(read(root, f), /iced_start/, `${f} points at the extension tools`);
  assert.match(read(root, ".claude/commands/iced.md"), /\$ARGUMENTS/);
  assert.match(read(root, ".gitattributes"), /intent\/\*\*\/\*\.md text eol=lf/);
  assert.match(read(root, ".gitignore"), /^\.iced\/active$/m);
  assert.match(read(root, ".gitignore"), /^\.iced\/tmp\/$/m);
  assert.match(read(root, ".claude/agents/iced-verifier.md"), /^---\nname: iced-verifier\ndescription: .+\ntools: Read, Grep, Glob, Bash, Write\n---\n/);
  const toml = read(root, ".codex/agents/iced-verifier.toml");
  assert.match(toml, /^name = "iced-verifier"$/m);
  assert.match(toml, /^sandbox_mode = "read-only"$/m);
  assert.match(toml, /\ndeveloper_instructions = """\n[\s\S]+\n"""\n$/);
  assert.match(agents, /iced\.mjs verify <id>/);
  assert.equal(JSON.parse(read(root, ".iced/config.json")).gate, "strict");
  assert.ok(!fs.existsSync(path.join(root, ".cursor")));
});

test("initRepo: idempotent and does not overwrite config without force", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  initRepo(root, {});
  const cfgFile = path.join(root, ".iced", "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({ gate: "warn" }));
  fs.writeFileSync(path.join(root, ".iced", "memory", "product.md"), "# Mine\n");
  const again = initRepo(root, {});
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.updated, []);
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, "utf8")).gate, "warn");
  assert.equal(read(root, ".iced/memory/product.md"), "# Mine\n");
  assert.equal(count(read(root, "AGENTS.md"), "ICED:BEGIN"), 1);
  assert.equal(count(read(root, ".gitignore"), ".iced/active"), 1);
  initRepo(root, { force: true });
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, "utf8")).gate, "strict");
});

test("initRepo: optional targets and detection", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  fs.mkdirSync(path.join(root, ".cursor"));
  assert.deepEqual(detectTargets(root), ["agents", "claude", "codex", "skills", "cursor"]);
  const r = initRepo(root, { targets: ["cursor", "copilot", "gemini"] });
  assert.deepEqual(r.targets, ["cursor", "copilot", "gemini"]);
  assert.match(read(root, ".cursor/rules/iced.mdc"), /alwaysApply: true/);
  assert.ok(fs.existsSync(path.join(root, ".cursor/commands/iced.md")));
  assert.match(read(root, ".github/copilot-instructions.md"), /ICED:BEGIN/);
  assert.match(read(root, "GEMINI.md"), /ICED:BEGIN/);
  assert.ok(!fs.existsSync(path.join(root, "CLAUDE.md")));
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

test("vendored CLI works from the repo without the package", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  initRepo(root, {});
  const cli = path.join(root, ".iced", "bin", "iced.mjs");
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.match(run("new", "bug", "Login", "timeout"), /Created intent[\\/]001-login-timeout[\\/]iced\.md/);
  assert.match(run("list"), /001-login-timeout\s+draft\s+bug/);
  assert.match(run("validate"), /1 unit\(s\), 0 error\(s\)/);
  assert.throws(() => run("approve", "1"), /Cannot approve/);
});

test("vendored CLI: approve, verify with a headless runner, accept", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  const g = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  initRepo(root, {});
  const cfgFile = path.join(root, ".iced", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  cfg.verify = { ...cfg.verify, commands: [`node -e "process.exit(0)"`], runner: { command: process.execPath, args: [FAKE, "{prompt}"] } };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  const cli = path.join(root, ".iced", "bin", "iced.mjs");
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("new", "feature", "Dark", "mode");
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "iced.md"), unitText({ tier: "S", created: "2026-09-30T00:00:00Z" }));
  assert.match(run("approve", "1"), /Status building/);
  assert.throws(() => run("verify", "1"), /Cannot read evidence/);
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "submission.json"), JSON.stringify({
    summary: "Added a theme toggle", evidence: [{ expectation: "E1", kind: "test", ref: "tests/theme.spec.ts" }, { expectation: "E2", kind: "check", ref: "reload" }],
  }));
  const out = run("verify", "1");
  assert.match(out, /001-dark-mode: PASS -> done/);
  assert.match(read(root, "intent/001-dark-mode/evidence.md"), /Verifiers \(custom\): full \(answered/);
  assert.match(run("accept", "1"), /Accepted 001-dark-mode/);
  assert.match(run("validate"), /0 error\(s\)/);
});
