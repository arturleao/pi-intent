import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as core from "../src/core.mjs";
import { lensSetting, settingLabel, submitUnit } from "../src/verify.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const cfgOf = (verify = {}, build = {}) => ({ verify, build });
const rawConfig = (root) => JSON.parse(fs.readFileSync(core.configPath(root), "utf8"));

test("splitEffort reads a :level suffix and leaves other colons alone", () => {
  assert.deepEqual(core.splitEffort("provider/model-5:high"), { model: "provider/model-5", effort: "high" });
  assert.deepEqual(core.splitEffort("vendor/auto"), { model: "vendor/auto", effort: null });
  assert.deepEqual(core.splitEffort("ollama/qwen3:32b"), { model: "ollama/qwen3:32b", effort: null });
  assert.deepEqual(core.splitEffort(null), { model: null, effort: null });
});

test("verifyModels and verifyEffort: one value or a list", () => {
  assert.deepEqual(core.verifyModels(cfgOf({ model: "a/b" })), ["a/b"]);
  assert.deepEqual(core.verifyModels(cfgOf({ model: ["a/b", " ", "c/d"] })), ["a/b", "c/d"]);
  assert.equal(core.verifyEffort(cfgOf({ effort: "high" })), "high");
  assert.equal(core.verifyEffort(cfgOf({ effort: "bogus" })), null);
  assert.deepEqual(core.verifyModels(cfgOf({ model: null })), []);
  assert.deepEqual(core.verifyModels(cfgOf({ model: [] })), []);
});

test("legacy per-host maps still resolve: the host's entry, then default", () => {
  const per = cfgOf({ model: { "host-a": ["a/b", "c/d"], "host-b": "x/y", default: "z/z" }, effort: { "host-b": "high", default: "low" } });
  assert.deepEqual(core.verifyModels(per, "host-a"), ["a/b", "c/d"]);
  assert.deepEqual(core.verifyModels(per, "host-b"), ["x/y"]);
  assert.deepEqual(core.verifyModels(per, "host-c"), ["z/z"]);
  assert.deepEqual(core.verifyModels(per), ["z/z"]);
  assert.equal(core.verifyEffort(per, "host-b"), "high");
  assert.equal(core.verifyEffort(per, "host-a"), "low");
  assert.deepEqual(core.verifyModels(cfgOf({ model: { "host-a": null } }), "host-a"), [], "asked-but-not-pinned marker");
  assert.deepEqual(lensSetting(per, 1, "host-a"), { model: "c/d", effort: "low" });
});

test("setters store plain values and replace legacy maps", (t) => {
  const root = tempRepo({ config: { verify: { model: { "host-a": ["old/one"], default: "old/two" }, effort: { "host-a": "low" } } } });
  t.after(() => cleanup(root));
  core.setVerifyModels(root, ["a/b", "c/d"]);
  assert.deepEqual(rawConfig(root).verify.model, ["a/b", "c/d"]);
  core.setVerifyModels(root, ["only/one"]);
  assert.equal(rawConfig(root).verify.model, "only/one");
  core.setVerifyEffort(root, "high");
  assert.equal(rawConfig(root).verify.effort, "high");
  assert.throws(() => core.setVerifyEffort(root, "turbo"), /Unknown effort/);
  core.setVerifyModels(root, []);
  assert.equal(rawConfig(root).verify.model, null);
  core.setTestWriterModel(root, " a/b ");
  core.setTestWriterEffort(root, "low");
  assert.equal(rawConfig(root).build.testWriterModel, "a/b");
  assert.equal(rawConfig(root).build.testWriterEffort, "low");
});

test("lensSetting: rotates models, suffix beats verify.effort, falls back to the session", () => {
  const c = cfgOf({ model: ["a/b:high", "c/d"], effort: "medium" });
  assert.deepEqual(lensSetting(c, 0), { model: "a/b", effort: "high" });
  assert.deepEqual(lensSetting(c, 1), { model: "c/d", effort: "medium" });
  assert.deepEqual(lensSetting(c, 2), { model: "a/b", effort: "high" });
  assert.deepEqual(lensSetting(cfgOf(), 0, null, { model: "s/m", effort: "low" }), { model: "s/m", effort: "low" });
  assert.deepEqual(lensSetting(cfgOf({ effort: "xhigh" }), 0, null, { model: "s/m", effort: "low" }), { model: "s/m", effort: "xhigh" });
  assert.equal(settingLabel({ model: "m", effort: "high" }), "m, effort high");
});

test("describeModels explains what runs when nothing is pinned", () => {
  assert.match(core.describeModels(cfgOf(), { sessionModel: "vendor/auto", sessionEffort: "high" }), /Verifier models \(verify\.model, verify\.effort\): not set \(uses the session model, now vendor\/auto, effort high\)/);
  assert.match(core.describeModels(cfgOf({ model: ["a/b", "c/d:low"] })), /a\/b, c\/d \(effort low\), rotated across verifiers/);
  assert.match(core.describeModels(cfgOf({ model: { "host-a": "x/y" }, effort: { "host-a": "high" } }), { host: "host-a" }), /: x\/y \(effort high\)$/m);
  assert.match(core.describeModels(cfgOf({}, { testWriterModel: "t/w" })), /Test writer \(build\.testWriterModel\): t\/w; the test writer is off/);
});

test("submitUnit passes model and effort to the agent: pinned effort beats the session effort", async (t) => {
  const root = tempRepo({ git: true, config: { verify: { commands: [], effort: "high" } } });
  t.after(() => cleanup(root));
  const evidence = [{ expectation: "E1", kind: "test", ref: "t" }, { expectation: "E2", kind: "check", ref: "c" }];
  const seen = [];
  const answer = "```json\n" + JSON.stringify({ verdict: "pass", expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "pass" }] }) + "\n```";
  const agent = async (job) => { seen.push({ role: job.role, access: job.access, model: job.model, effort: job.effort }); return { ok: true, text: answer }; };
  const text = unitText({ status: "building", tier: "S" });
  writeUnit(root, "001-dark-mode", core.setFrontmatter(text, { contract_hash: core.contractHash(text) }));
  const res = await submitUnit({ root, id: "001-dark-mode", evidence, agent, host: "host-a", defaultModel: "s/m", defaultEffort: "low" });
  assert.equal(res.outcome, "done");
  assert.deepEqual(seen, [{ role: "verifier", access: "read-only", model: "s/m", effort: "high" }]);
  assert.deepEqual(res.report.lenses[0], { name: "full", model: "s/m", effort: "high", ok: true, error: null, durationMs: res.report.lenses[0].durationMs });
  assert.equal(res.report.host, "host-a");
  assert.match(fs.readFileSync(core.unitPaths(root, "001-dark-mode").evidence, "utf8"), /Verifiers \(host-a\): full \[s\/m, effort high\] \(answered/);
});
