import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/core.mjs";
import { commandGroups, mergeVerifierReports, pickLenses, runCommands, runProcess, submitUnit } from "../src/verify.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-verifier.mjs");

/** An injected agent that runs the fake verifier as a separate process, like a host would run a real agent. */
const jobs = [];
const fakeAgent = async (job) => {
  jobs.push({ role: job.role, access: job.access });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iced-job-"));
  try {
    const file = path.join(dir, "prompt.md");
    fs.writeFileSync(file, job.prompt);
    const r = await runProcess(process.execPath, [FAKE, file], { cwd: job.root, timeoutSec: job.timeoutSec, signal: job.signal });
    return { ok: r.exitCode === 0, text: r.stdout, output: r.output, exitCode: r.exitCode, timedOut: r.timedOut };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const evidence = [{ expectation: "E1", kind: "test", ref: "t1" }, { expectation: "E2", kind: "check", ref: "c" }];
const sleep = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;

function repoWithUnit(fm = {}, verify = {}) {
  const root = tempRepo({ git: true, config: { verify: { commands: [], ...verify } } });
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

test("mergeVerifierReports: explicit rule checks outrank malformed checks, violations win", () => {
  const reports = [
    { verdict: "pass", constraints: [{ id: "C1", violated: "false" }], failures: [{ id: "F1" }] },
    { verdict: "pass", constraints: [{ id: "C1", violated: false }], failures: [{ id: "F1", triggered: false }] },
  ];
  for (const list of [reports, [...reports].reverse()]) {
    const merged = mergeVerifierReports(list);
    assert.equal(merged.constraints[0].violated, false);
    assert.equal(merged.failures[0].triggered, false);
  }
  const violation = { verdict: "fail", constraints: [{ id: "C1", violated: true }], failures: [{ id: "F1", triggered: true }] };
  const singleton = { verdict: "pass", constraints: reports.flatMap((r) => r.constraints).concat(violation.constraints), failures: reports.flatMap((r) => r.failures).concat(violation.failures) };
  for (const list of [[violation, ...reports], [...reports, violation], [singleton]]) {
    const merged = mergeVerifierReports(list);
    assert.equal(merged.constraints[0].violated, true);
    assert.equal(merged.failures[0].triggered, true);
  }
});

test("submitUnit: incomplete rule coverage cannot auto-accept, complete coverage can", async (t) => {
  for (const complete of [false, true]) {
    const root = repoWithUnit({ autonomy: 2, risk: "low" }, { lenses: "single" });
    t.after(() => cleanup(root));
    const u = core.readUnit(root, "001-dark-mode");
    core.updateFrontmatter(root, u.id, { contract_hash: core.contractHash(u.text) });
    const report = { verdict: "pass", expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "pass" }],
      ...(complete ? { constraints: [{ id: "C1", violated: false }, { id: "C2", violated: false }], failures: [{ id: "F1", triggered: false }] } : {}) };
    const res = await submitUnit({ root, id: u.id, evidence, agent: async () => ({ ok: true, text: `\`\`\`json\n${JSON.stringify(report)}\n\`\`\`` }) });
    assert.equal(res.outcome, complete ? "accepted" : "done");
    assert.equal(res.report.result.needsHuman, !complete);
  }
});

test("submitUnit: three verifiers run in parallel and a pass moves the unit to done", async (t) => {
  const root = repoWithUnit({ tier: "M" });
  const log = path.join(os.tmpdir(), `iced-fake-${process.pid}-${Date.now()}.log`);
  process.env.FAKE_LOG = log;
  t.after(() => { delete process.env.FAKE_LOG; fs.rmSync(log, { force: true }); cleanup(root); });
  const res = await submitUnit({ root, id: "001-dark-mode", summary: "done", evidence, agent: fakeAgent, host: "test-host" });
  assert.equal(res.outcome, "done");
  assert.equal(res.report.verdict, "pass");
  assert.equal(res.report.result.independent, true);
  assert.deepEqual(res.report.lenses.map((l) => [l.name, l.ok]), [["expectations", true], ["failures", true], ["rules", true]]);
  const runs = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
  assert.equal(runs.length, 3);
  assert.ok(Math.max(...runs.map((r) => r[0])) < Math.min(...runs.map((r) => r[1])), "verifier runs overlap");
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "done");
  const md = fs.readFileSync(core.unitPaths(root, "001-dark-mode").evidence, "utf8");
  assert.match(md, /Verifiers \(test-host\): expectations \(answered/);
  assert.ok(jobs.every((j) => j.role === "verifier" && j.access === "read-only"), "verifiers are always read-only jobs");
  assert.ok(!fs.existsSync(path.join(root, ".iced", "tmp")) || !fs.readdirSync(path.join(root, ".iced", "tmp")).length, "temp prompts cleaned up");
});

test("submitUnit: a failing verifier sends the unit back to building, then blocks it", async (t) => {
  const root = repoWithUnit({ tier: "S" }, { maxAttempts: 2 });
  process.env.FAKE_FAIL = "1";
  t.after(() => { delete process.env.FAKE_FAIL; cleanup(root); });
  const first = await submitUnit({ root, id: "001-dark-mode", evidence, agent: fakeAgent });
  assert.equal(first.outcome, "retry");
  assert.deepEqual(first.report.lenses.map((l) => l.name), ["full"]);
  assert.ok(first.report.result.problems.some((p) => p.startsWith("[E1] failed")));
  assert.equal(core.readUnit(root, "001-dark-mode").parsed.frontmatter.status, "building");
  const second = await submitUnit({ root, id: "001-dark-mode", evidence, agent: fakeAgent });
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

test("submitUnit without an agent: no independent verification, a human must review", async (t) => {
  const root = repoWithUnit({ tier: "S" });
  t.after(() => cleanup(root));
  const res = await submitUnit({ root, id: "001-dark-mode", evidence });
  assert.equal(res.outcome, "done");
  assert.equal(res.report.result.independent, false);
  assert.equal(res.report.result.needsHuman, true);
  assert.match(res.report.lenses[0].error, /no agent available/);
});

test("submitUnit: an agent that throws or exits non-zero is reported, not fatal", async (t) => {
  const root = repoWithUnit({ tier: "S" });
  t.after(() => cleanup(root));
  const res = await submitUnit({ root, id: "001-dark-mode", evidence, agent: async () => { throw new Error("boom"); } });
  assert.match(res.report.lenses[0].error, /could not start: boom/);
  assert.equal(res.report.result.needsHuman, true);
  core.transition(root, "001-dark-mode", "building");
  const res2 = await submitUnit({ root, id: "001-dark-mode", evidence, agent: async () => ({ ok: false, exitCode: 3, output: "bad" }) });
  assert.match(res2.report.lenses[0].error, /verifier exited 3: bad/);
});