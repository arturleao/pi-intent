import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as core from "../lib/iced-core.mjs";
import { initRepo } from "../lib/iced-init.mjs";
import { gateDecision } from "../lib/iced-gate.mjs";
import {
  RUNNERS, lensSetting, refreshVerifierAgents, runAgent, runnerArgs, runnerEffort, settingLabel, submitUnit, verifierAgentFiles,
} from "../lib/iced-verify.mjs";
import { cleanup, tempDir, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-verifier.mjs");
const cfgOf = (verify = {}, build = {}) => ({ verify, build });
const rawConfig = (root) => JSON.parse(fs.readFileSync(core.configPath(root), "utf8"));

test("splitEffort reads a :level suffix and leaves other colons alone", () => {
  assert.deepEqual(core.splitEffort("anthropic/claude-sonnet-5:high"), { model: "anthropic/claude-sonnet-5", effort: "high" });
  assert.deepEqual(core.splitEffort("cursor/auto"), { model: "cursor/auto", effort: null });
  assert.deepEqual(core.splitEffort("ollama/qwen3:32b"), { model: "ollama/qwen3:32b", effort: null });
  assert.deepEqual(core.splitEffort(null), { model: null, effort: null });
});

test("verifyModels and verifyEffort: one value, a list, or per runner with a default", () => {
  assert.deepEqual(core.verifyModels(cfgOf({ model: "a/b" }), "pi"), ["a/b"]);
  assert.deepEqual(core.verifyModels(cfgOf({ model: ["a/b", " ", "c/d"] })), ["a/b", "c/d"]);
  const per = cfgOf({ model: { pi: ["a/b", "c/d"], claude: "opus", default: "x" }, effort: { claude: "high", default: "low" } });
  assert.deepEqual(core.verifyModels(per, "pi"), ["a/b", "c/d"]);
  assert.deepEqual(core.verifyModels(per, "claude"), ["opus"]);
  assert.deepEqual(core.verifyModels(per, "codex"), ["x"]);
  assert.equal(core.verifyEffort(per, "claude"), "high");
  assert.equal(core.verifyEffort(per, "pi"), "low");
  assert.equal(core.verifyEffort(cfgOf({ effort: "bogus" })), null);
  assert.deepEqual(core.verifyModels(cfgOf({ model: null })), []);
});

test("setVerifyModels keeps other runners and clears cleanly", (t) => {
  const root = tempRepo({ config: { verify: { model: "shared/model" } } });
  t.after(() => cleanup(root));
  core.setVerifyModels(root, ["a/b", "c/d"], "pi");
  assert.deepEqual(rawConfig(root).verify.model, { default: "shared/model", pi: ["a/b", "c/d"] });
  core.setVerifyModels(root, ["opus"], "claude");
  core.setVerifyModels(root, [], "pi");
  assert.deepEqual(rawConfig(root).verify.model, { default: "shared/model", claude: "opus" });
  core.setVerifyModels(root, ["only/one"]);
  assert.equal(rawConfig(root).verify.model, "only/one");
  core.setVerifyEffort(root, "high", "claude");
  assert.deepEqual(rawConfig(root).verify.effort, { claude: "high" });
  assert.throws(() => core.setVerifyEffort(root, "turbo"), /Unknown effort/);
  core.setVerifyModels(root, []);
  assert.equal(rawConfig(root).verify.model, null);
  core.setTestWriterModel(root, " a/b ");
  core.setTestWriterEffort(root, "low");
  assert.equal(rawConfig(root).build.testWriterModel, "a/b");
  assert.equal(rawConfig(root).build.testWriterEffort, "low");
});

test("lensSetting: rotates models, suffix beats verify.effort, falls back to the session", () => {
  const c = cfgOf({ model: { pi: ["a/b:high", "c/d"] }, effort: "medium" });
  assert.deepEqual(lensSetting(c, 0, "pi"), { model: "a/b", effort: "high" });
  assert.deepEqual(lensSetting(c, 1, "pi"), { model: "c/d", effort: "medium" });
  assert.deepEqual(lensSetting(c, 2, "pi"), { model: "a/b", effort: "high" });
  assert.deepEqual(lensSetting(cfgOf(), 0, "pi", { model: "s/m", effort: "low" }), { model: "s/m", effort: "low" });
  assert.deepEqual(lensSetting(cfgOf({ effort: "xhigh" }), 0, "pi", { model: "s/m", effort: "low" }), { model: "s/m", effort: "xhigh" });
  assert.equal(settingLabel({ model: "m", effort: "high", effortIgnored: true }), "m, effort high (not supported by this runner)");
});

test("runner flags: Claude and Codex get their own effort names, Cursor ignores effort", () => {
  const base = { instruction: "Read p.md", prompt: "p.md", output: "/tmp/a.md" };
  const claude = { name: "claude", ...RUNNERS.claude };
  const codex = { name: "codex", ...RUNNERS.codex };
  const cursor = { name: "cursor", ...RUNNERS.cursor };
  assert.equal(runnerEffort(claude, "minimal"), "low");
  assert.equal(runnerEffort(codex, "max"), "xhigh");
  assert.equal(runnerEffort(cursor, "high"), null);
  assert.equal(runnerEffort({ name: "pi" }, "max"), "max");
  const a = runnerArgs(claude, { ...base, model: "opus", effort: "high" });
  assert.deepEqual(a.slice(-4), ["--model", "opus", "--effort", "high"]);
  assert.deepEqual(runnerArgs(codex, { ...base, effort: "high" }), ["exec", "--sandbox", "read-only", "-o", "/tmp/a.md", "-c", "model_reasoning_effort=high", "Read p.md"]);
});

test("pi verifiers get --model and --thinking", async (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const invocation = (args) => ({ command: process.execPath, args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args] });
  const r = await runAgent({ root, prompt: "hi", role: "verifier", runner: { name: "pi", self: true }, model: "a/b", effort: "high", tools: ["read"], timeoutSec: 30, invocation });
  const args = JSON.parse(r.text.trim());
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4), ["--model", "a/b", "--thinking", "high"]);
});

test("verifierAgentFiles pins the Claude and Codex subagents to their own models", (t) => {
  const files = verifierAgentFiles(cfgOf({ model: { claude: "opus", codex: ["gpt-x:high", "gpt-y"], pi: "a/b" } }));
  const md = files[".claude/agents/iced-verifier.md"];
  assert.match(md, /\ntools: Read, Grep, Glob, Bash, Write\nmodel: opus\n---\n/);
  const toml = files[".codex/agents/iced-verifier.toml"];
  assert.match(toml, /^model = "gpt-x"$/m);
  assert.match(toml, /^model_reasoning_effort = "high"$/m);
  const plain = verifierAgentFiles(cfgOf());
  assert.doesNotMatch(plain[".claude/agents/iced-verifier.md"], /^model:/m);
  assert.doesNotMatch(plain[".codex/agents/iced-verifier.toml"], /^model/m);

  const root = tempDir();
  t.after(() => cleanup(root));
  initRepo(root, { targets: ["claude"] });
  core.setVerifyModels(root, ["sonnet"], "claude");
  assert.deepEqual(refreshVerifierAgents(root), [".claude/agents/iced-verifier.md"]);
  assert.match(fs.readFileSync(path.join(root, ".claude/agents/iced-verifier.md"), "utf8"), /^model: sonnet$/m);
  assert.ok(!fs.existsSync(path.join(root, ".codex")), "does not create files for targets that were not chosen");
  assert.deepEqual(refreshVerifierAgents(root), []);
});

test("describeModels explains what runs when nothing is pinned", () => {
  assert.match(core.describeModels(cfgOf(), { sessionModel: "cursor/auto", sessionEffort: "high" }), /all runners: not set \(pi uses the session model, now cursor\/auto, effort high\)/);
  const text = core.describeModels(cfgOf({ model: { pi: ["a/b", "c/d:low"], claude: "opus" }, effort: { claude: "high" } }));
  assert.match(text, /pi: a\/b, c\/d \(effort low\), rotated across verifiers/);
  assert.match(text, /claude: opus \(effort high\)/);
});

test("submitUnit uses the session model and effort in pi when none is pinned, and reports ignored effort", async (t) => {
  const runner = { name: "custom", command: process.execPath, args: [FAKE, "{prompt}"] };
  const root = tempRepo({ git: true, config: { verify: { runner: { command: process.execPath, args: [FAKE, "{prompt}"] }, commands: [], effort: "high" } } });
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "building", tier: "S" }));
  const evidence = [{ expectation: "E1", kind: "test", ref: "t" }, { expectation: "E2", kind: "check", ref: "c" }];
  const res = await submitUnit({ root, id: "001-dark-mode", evidence, runner, defaultModel: "s/m" });
  assert.equal(res.outcome, "done");
  assert.deepEqual(res.report.lenses[0], { name: "full", model: null, effort: "high", effortIgnored: true, ok: true, error: null, durationMs: res.report.lenses[0].durationMs });
  assert.match(fs.readFileSync(core.unitPaths(root, "001-dark-mode").evidence, "utf8"), /full \[effort high \(not supported by this runner\)\]/);

  const seen = [];
  const runVerifierImpl = async ({ model, effort }) => {
    seen.push({ model, effort });
    return { verifier: { verdict: "pass", expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "pass" }] } };
  };
  writeUnit(root, "002-other", unitText({ id: "002-other", status: "building", tier: "S" }));
  await submitUnit({ root, id: "002-other", evidence, runner: { name: "pi", self: true }, defaultModel: "s/m", defaultEffort: "low", runVerifierImpl });
  assert.deepEqual(seen, [{ model: "s/m", effort: "high" }], "verify.effort beats the session effort");
});

test("CLI models: set per runner, effort, clear; the gate stops agents changing them", (t) => {
  const root = tempDir();
  t.after(() => cleanup(root));
  initRepo(root, {});
  const cli = path.join(root, ".iced", "bin", "iced.mjs");
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run("models"), /all runners: not set/);
  let out = run("models", "set", "opus", "--runner", "claude");
  assert.match(out, /claude: opus/);
  assert.match(out, /updated\s+\.claude\/agents\/iced-verifier\.md/);
  out = run("models", "set", "a/b,c/d:high", "--runner", "pi");
  assert.match(out, /pi: a\/b, c\/d \(effort high\), rotated across verifiers/);
  assert.match(run("models", "effort", "xhigh", "--runner", "codex"), /codex: not set \(the agent's default model, effort xhigh\)/);
  assert.match(fs.readFileSync(path.join(root, ".codex/agents/iced-verifier.toml"), "utf8"), /^model_reasoning_effort = "xhigh"$/m);
  run("models", "clear", "--runner", "claude");
  assert.deepEqual(rawConfig(root).verify.model, { pi: ["a/b", "c/d:high"] });
  assert.throws(() => run("models", "set", "x", "--runner", "nope"), /Unknown runner/);
  assert.throws(() => run("models", "effort", "turbo"), /Unknown effort/);
  assert.match(run("models", "list", "claude"), /no model list command/);

  const decide = (command) => gateDecision({ root, cwd: root, toolName: "powershell", input: { command }, autonomy: 1 }).action;
  assert.equal(decide("node .iced/bin/iced.mjs models set weak/model"), "block");
  assert.equal(decide("node .iced/bin/iced.mjs models effort off"), "block");
  assert.equal(decide("node .iced/bin/iced.mjs models"), "allow");
});
