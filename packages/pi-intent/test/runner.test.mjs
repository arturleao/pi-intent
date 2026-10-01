// [E4] Verifiers and the test writer run as pi subprocesses with read-only (or write) tools, models and effort.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as core from "@arturleao/iced-core";
import { piAgent, piArgs, TOOLS, SHELL_TOOL } from "../src/runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, "..", "..", "iced-core", "test", "fixtures", "fake-verifier.mjs");
const ECHO = ["-e", "console.log(JSON.stringify({ args: process.argv.slice(1), role: process.env.ICED_ROLE }))", "--"];

function tempRepo(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-intent-test-"));
  fs.mkdirSync(path.join(root, ".iced"));
  fs.writeFileSync(path.join(root, ".iced", "config.json"), JSON.stringify(config));
  const g = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  return root;
}
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

const UNIT = `---
iced: 0.1
id: 001-dark-mode
title: Dark mode
type: feature
tier: S
parent: null
status: building
autonomy: 1
risk: low
attempts: 0
---

# Dark mode

## Intent

### Goal
Users can switch to a dark theme from Settings and it persists.

### Constraints
- [C1] No new runtime dependencies.

### Failure conditions
- [F1] Theme resets after reload.

### Scope
- In: settings toggle
- Out: marketing site

## Context
- [code] Tokens live in src/styles/tokens.css.

## Expectations
- [E1] Toggle switches theme without reload. {verify: test | tests/theme.spec.ts}
- [E2] Choice persists across reloads. {verify: check}

## Open questions
`;
const evidence = [{ expectation: "E1", kind: "test", ref: "t" }, { expectation: "E2", kind: "check", ref: "c" }];

test("piArgs: print mode, no session, tools for the access level, model and thinking, the prompt attached", () => {
  const a = piArgs({ promptFile: "/r/.iced/tmp/x/prompt.md", access: "read-only", model: "a/b", effort: "high" });
  assert.deepEqual(a, ["-p", "--no-session", "--tools", TOOLS["read-only"].join(","), "--model", "a/b", "--thinking", "high", "@/r/.iced/tmp/x/prompt.md", "Follow the attached instructions exactly."]);
  assert.deepEqual(piArgs({ promptFile: "p", access: "write" }).slice(0, 4), ["-p", "--no-session", "--tools", TOOLS.write.join(",")]);
  assert.ok(!piArgs({ promptFile: "p", access: "read-only" }).includes("--model"));
  assert.ok(!piArgs({ promptFile: "p", access: "read-only" }).includes("--thinking"));
  assert.deepEqual(piArgs({ promptFile: "p", access: "bogus" }).slice(2, 4), ["--tools", TOOLS["read-only"].join(",")], "unknown access falls back to read-only");
});

test("verifier tools never include write or edit; the test writer may write", () => {
  assert.deepEqual(TOOLS["read-only"], ["read", "grep", "find", "ls", SHELL_TOOL]);
  assert.ok(!TOOLS["read-only"].includes("write") && !TOOLS["read-only"].includes("edit"));
  assert.ok(TOOLS.write.includes("write") && TOOLS.write.includes("edit"));
});

test("piAgent spawns pi with ICED_ROLE and cleans its temp prompt", async (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const agent = piAgent({ invocation: (args) => ({ command: process.execPath, args: [...ECHO, ...args] }) });
  const r = await agent({ root, prompt: "hi", role: "verifier", access: "read-only", model: "a/b", effort: "low", timeoutSec: 30 });
  assert.equal(r.ok, true);
  const out = JSON.parse(r.text.trim());
  assert.equal(out.role, "verifier");
  assert.deepEqual(out.args.slice(0, 8), ["-p", "--no-session", "--tools", TOOLS["read-only"].join(","), "--model", "a/b", "--thinking", "low"]);
  assert.match(out.args[8], /^@.*[\\/]\.iced[\\/]tmp[\\/]verifier-.*[\\/]prompt\.md$/);
  assert.deepEqual(fs.readdirSync(path.join(root, ".iced", "tmp")), [], "temp prompt folder removed");
});

test("iced-core submitUnit through piAgent: parallel pi verifiers with the session model and pinned effort", async (t) => {
  const root = tempRepo({ verify: { commands: [], effort: "high" } });
  t.after(() => cleanup(root));
  fs.mkdirSync(path.join(root, "intent", "001-dark-mode"), { recursive: true });
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "iced.md"), UNIT.replace("tier: S", "tier: M"));
  const calls = [];
  const invocation = (args) => {
    calls.push(args);
    const prompt = args.find((a) => a.startsWith("@")).slice(1);
    return { command: process.execPath, args: [FAKE, prompt] };
  };
  const res = await core.submitUnit({ root, id: "001-dark-mode", evidence, agent: piAgent({ invocation }), host: "pi", defaultModel: "s/m", defaultEffort: "low" });
  assert.equal(res.outcome, "done");
  assert.equal(calls.length, 3);
  for (const a of calls) {
    assert.equal(a[a.indexOf("--tools") + 1], TOOLS["read-only"].join(","));
    assert.equal(a[a.indexOf("--model") + 1], "s/m");
    assert.equal(a[a.indexOf("--thinking") + 1], "high");
  }
  assert.match(fs.readFileSync(core.unitPaths(root, "001-dark-mode").evidence, "utf8"), /Verifiers \(pi\): expectations \[s\/m, effort high\] \(answered/);
});

test("runTestWriter through piAgent gets write tools and the test writer model", async (t) => {
  const root = tempRepo({ build: { testWriter: true, testWriterModel: "t/w:medium" } });
  t.after(() => cleanup(root));
  fs.mkdirSync(path.join(root, "intent", "001-dark-mode"), { recursive: true });
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "iced.md"), UNIT);
  const agent = piAgent({ invocation: (args) => ({ command: process.execPath, args: [...ECHO, ...args] }) });
  const r = await core.runTestWriter({ root, unit: core.readUnit(root, "001-dark-mode"), ancestorUnits: [], config: core.loadConfig(root), agent });
  assert.equal(r.ok, true);
  const out = JSON.parse(r.text.trim());
  assert.equal(out.role, "test-writer");
  assert.equal(out.args[out.args.indexOf("--tools") + 1], TOOLS.write.join(","));
  assert.deepEqual(out.args.slice(out.args.indexOf("--model"), out.args.indexOf("--model") + 4), ["--model", "t/w", "--thinking", "medium"]);
});

test("[E5] configs written by older versions (per-host maps, runner, targets) load with the pi entries applied", async (t) => {
  const legacy = {
    targets: ["agents", "skills"],
    verify: { runner: "auto", commands: [], model: { pi: ["a/b:high", "c/d"], "other-host": "x/y", default: "z/z" }, effort: { pi: "low", default: "max" } },
  };
  const root = tempRepo(legacy);
  t.after(() => cleanup(root));
  const cfg = core.loadConfig(root);
  assert.deepEqual(core.verifyModels(cfg, "pi"), ["a/b:high", "c/d"]);
  assert.equal(core.verifyEffort(cfg, "pi"), "low");
  assert.match(core.describeModels(cfg, { host: "pi" }), /a\/b \(effort high\), c\/d \(effort low\), rotated across verifiers/);
  fs.mkdirSync(path.join(root, "intent", "001-dark-mode"), { recursive: true });
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "iced.md"), UNIT.replace("tier: S", "tier: M"));
  const seen = [];
  const answer = "```json\n" + JSON.stringify({ verdict: "pass", expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "pass" }] }) + "\n```";
  const agent = async (job) => { seen.push(`${job.model}:${job.effort}`); return { ok: true, text: answer }; };
  const res = await core.submitUnit({ root, id: "001-dark-mode", evidence, agent, host: "pi" });
  assert.equal(res.outcome, "done");
  assert.deepEqual(seen, ["a/b:high", "c/d:low", "a/b:high"]);
});
