import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../lib/iced-core.mjs";
import {
  commandGroups, finishSplit, mergeVerifierReports, pickLenses, prepareSplit, resolveRunner, runCommands, runnerArgs,
  RUNNERS, submitUnit,
} from "../lib/iced-verify.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-verifier.mjs");
const fakeRunner = { command: process.execPath, args: [FAKE, "{prompt}"] };
const evidence = [{ expectation: "E1", kind: "test", ref: "t1" }, { expectation: "E2", kind: "check", ref: "c" }];
const sleep = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;

function repoWithUnit(fm = {}, verify = {}) {
  const root = tempRepo({ git: true, config: { verify: { runner: fakeRunner, commands: [], ...verify } } });
  writeUnit(root, "001-dark-mode", unitText({ status: "building", ...fm }));
  return root;
}

test("commandGroups: entries run in parallel, nested lists in order", () => {
  assert.deepEqual(commandGroups(["lint", ["build", "e2e"], " ", null]), [["lint"], ["build", "e2e"]]);
  assert.deepEqual(commandGroups(["lint", ["build", "e2e"]], false), [["lint", "build", "e2e"]]);
  assert.deepEqual(commandGroups([]), []);
});

test("runCommands runs groups in parallel and stops a sequence at the first failure", async (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const started = Date.now();
  const r = await runCommands(root, [sleep(800), sleep(800), [`node -e "process.exit(2)"`, `node -e "console.log(1)"`]], { timeoutSec: 60 });
  const took = Date.now() - started;
  assert.ok(took < 1500, `parallel checks took ${took}ms`);
  assert.deepEqual(r.map((x) => x.exitCode), [0, 0, 2, null]);
  assert.equal(r[3].skipped, true);
  const seq = await runCommands(root, [sleep(500), sleep(500)], { timeoutSec: 60, parallel: false });
  assert.deepEqual(seq.map((x) => x.exitCode), [0, 0]);
});

test("pickLenses: small units get one verifier, larger or risky units three", () => {
  const unit = (fm) => ({ parsed: { frontmatter: { tier: "S", risk: "low", ...fm } } });
  const cfg = (lenses) => ({ verify: { lenses } });
  assert.deepEqual(pickLenses(unit(), cfg("auto")), ["full"]);
  assert.deepEqual(pickLenses(unit({ tier: "M" }), cfg("auto")), ["expectations", "failures", "rules"]);
  assert.deepEqual(pickLenses(unit({ risk: "high" }), cfg(undefined)), ["expectations", "failures", "rules"]);
  assert.deepEqual(pickLenses(unit({ tier: "XL" }), cfg("single")), ["full"]);
  assert.deepEqual(pickLenses(unit(), cfg("parallel")).length, 3);
  assert.deepEqual(pickLenses(unit(), cfg(["rules", "nope"])), ["rules"]);
});

test("mergeVerifierReports: any failure wins, pass beats unknown", () => {
  const m = mergeVerifierReports([
    { verdict: "pass", lens: "expectations", expectations: [{ id: "E1", result: "pass", evidence: "a" }, { id: "E2", result: "unknown" }], failures: [{ id: "F1", triggered: false }], constraints: [], notes: "n1" },
    { verdict: "fail", lens: "rules", expectations: [{ id: "e1", result: "fail", evidence: "b" }, { id: "E2", result: "pass" }], failures: [{ id: "F1", triggered: true, evidence: "boom" }], constraints: [{ id: "C1", violated: true }], outOfScope: ["x"], notes: "n2" },
  ]);
  assert.equal(m.verdict, "fail");
  assert.equal(m.expectations.find((e) => e.id === "E1").result, "fail");
  assert.equal(m.expectations.find((e) => e.id === "E1").evidence, "a | b");
  assert.equal(m.expectations.find((e) => e.id === "E2").result, "pass");
  assert.equal(m.failures[0].triggered, true);
  assert.equal(m.constraints[0].violated, true);
  assert.deepEqual(m.outOfScope, ["x"]);
  assert.equal(m.notes, "[expectations] n1\n[rules] n2");
  assert.equal(mergeVerifierReports([]), null);
});

test("resolveRunner: env, config, host detection, PATH, custom", () => {
  const none = () => false;
  assert.equal(resolveRunner({}, { env: { ICED_RUNNER: "claude" }, has: none }).name, "claude");
  assert.equal(resolveRunner({ verify: { runner: "codex" } }, { env: {}, has: none }).name, "codex");
  const inPi = resolveRunner({}, { env: {}, inPi: true, has: none });
  assert.equal(inPi.name, "pi");
  assert.equal(inPi.self, true);
  assert.equal(resolveRunner({}, { env: { CLAUDECODE: "1" }, has: none }).name, "claude");
  assert.equal(resolveRunner({}, { env: { CODEX_SANDBOX: "seatbelt" }, has: none }).name, "codex");
  assert.equal(resolveRunner({}, { env: {}, has: (c) => c === "cursor-agent" }).name, "cursor");
  assert.equal(resolveRunner({}, { env: {}, has: none }), null);
  assert.equal(resolveRunner({ verify: { runner: fakeRunner } }, { env: {}, has: none }).name, "custom");
  assert.throws(() => resolveRunner({ verify: { runner: "nope" } }, { env: {}, has: none }), /Unknown verify.runner/);
});

test("runnerArgs: placeholders, optional model, instruction fallback", () => {
  const base = { instruction: "Read p.md", prompt: "p.md", output: "/tmp/a.md" };
  assert.deepEqual(runnerArgs(RUNNERS.codex, { ...base, model: "gpt-5" }), ["exec", "--sandbox", "read-only", "-o", "/tmp/a.md", "-m", "gpt-5", "Read p.md"]);
  assert.deepEqual(runnerArgs(RUNNERS.codex, base), ["exec", "--sandbox", "read-only", "-o", "/tmp/a.md", "Read p.md"]);
  assert.ok(runnerArgs(RUNNERS.claude, base).includes("dontAsk"));
  assert.deepEqual(runnerArgs({ command: "x", args: ["--quiet"] }, base), ["--quiet", "Read p.md"]);
});

test("submitUnit: three verifiers run in parallel and a pass moves the unit to done", async (t) => {
  const root = repoWithUnit({ tier: "M" });
  const log = path.join(os.tmpdir(), `iced-fake-${process.pid}-${Date.now()}.log`);
  process.env.FAKE_LOG = log;
  t.after(() => { delete process.env.FAKE_LOG; fs.rmSync(log, { force: true }); cleanup(root); });
  const res = await submitUnit({ root, id: "001-dark-mode", summary: "done", evidence });
  assert.equal(res.outcome, "done");
  assert.equal(res.report.verdict, "pass");
  assert.equal(res.report.result.independent, true);
  assert.deepEqual(res.report.lenses.map((l) => [l.name, l.ok]), [["expectations", true], ["failures", true], ["rules", true]]);
  const runs = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
  assert.equal(runs.length, 3);
  assert.ok(Math.max(...runs.map((r) => r[0])) < Math.min(...runs.map((r) => r[1])), "verifier runs overlap");
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "done");
  const md = fs.readFileSync(core.unitPaths(root, "001-dark-mode").evidence, "utf8");
  assert.match(md, /Verifiers \(custom\): expectations \(answered/);
  assert.ok(!fs.existsSync(path.join(root, ".iced", "tmp")) || !fs.readdirSync(path.join(root, ".iced", "tmp")).length, "temp prompts cleaned up");
});

test("submitUnit: a failing verifier sends the unit back to building, then blocks it", async (t) => {
  const root = repoWithUnit({ tier: "S" }, { maxAttempts: 2 });
  process.env.FAKE_FAIL = "1";
  t.after(() => { delete process.env.FAKE_FAIL; cleanup(root); });
  const first = await submitUnit({ root, id: "001-dark-mode", evidence });
  assert.equal(first.outcome, "retry");
  assert.deepEqual(first.report.lenses.map((l) => l.name), ["full"]);
  assert.ok(first.report.result.problems.some((p) => p.startsWith("[E1] failed")));
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "building");
  const second = await submitUnit({ root, id: "001-dark-mode", evidence });
  assert.equal(second.outcome, "blocked");
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.attempts, 2);
});

test("submitUnit: missing evidence and wrong status", async (t) => {
  const root = repoWithUnit();
  t.after(() => cleanup(root));
  assert.deepEqual(await submitUnit({ root, id: "001-dark-mode", evidence: [evidence[0]] }), { outcome: "missing-evidence", missing: ["E2"] });
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "building");
  writeUnit(root, "002-other", unitText({ id: "002-other", status: "draft" }));
  await assert.rejects(submitUnit({ root, id: "002-other", evidence }), /only a building unit/);
});

test("split mode: prepare prompts for host subagents, then finish from answer files", async (t) => {
  const root = repoWithUnit({ tier: "M" }, { commands: [`node -e "process.exit(0)"`] });
  t.after(() => cleanup(root));
  const prep = await prepareSplit({ root, id: "001-dark-mode", summary: "s", evidence });
  assert.equal(prep.outcome, "prepared");
  assert.deepEqual(prep.prompts.map((p) => p.lens), ["expectations", "failures", "rules"]);
  assert.equal(prep.commandResults[0].exitCode, 0);
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "verifying");
  for (const p of prep.prompts) assert.match(fs.readFileSync(path.join(root, p.prompt), "utf8"), /## Your focus/);

  const pass = { verdict: "pass", expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "pass" }] };
  for (const p of prep.prompts.slice(0, 2)) fs.writeFileSync(path.join(root, p.answer), `ok\n\`\`\`json\n${JSON.stringify(pass)}\n\`\`\`\n`);
  const res = finishSplit({ root, id: "001-dark-mode" });
  assert.equal(res.outcome, "done");
  assert.equal(res.report.result.needsHuman, true, "a missing answer needs a human");
  assert.equal(res.report.runner, "host subagents");
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "done");
  assert.ok(!fs.existsSync(path.join(root, prep.prompts[0].prompt)), "prompt folder removed");
  assert.throws(() => finishSplit({ root, id: "001-dark-mode" }), /No prepared verification/);
});

test("split mode: no evidence, no prompts", async (t) => {
  const root = repoWithUnit();
  t.after(() => cleanup(root));
  assert.equal((await prepareSplit({ root, id: "001-dark-mode", evidence: [] })).outcome, "missing-evidence");
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "building");
});
