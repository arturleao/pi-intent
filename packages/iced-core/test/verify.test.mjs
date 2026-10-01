import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as core from "../src/core.mjs";
import {
  buildVerifierPrompt, collectRules, computeVerdict, parseVerifierOutput, runCommands, verifyUnit,
} from "../src/verify.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const unitOf = (fm = {}) => { const text = unitText(fm); return { id: "001-dark-mode", text, parsed: core.parseIced(text) }; };
const parent = () => {
  const text = unitText({ id: "000-program", type: "project" }, "\n# P\n\n## Intent\n\n### Goal\nG\n\n### Constraints\n- [C1] Audit every change.\n\n### Failure conditions\n- [F1] Data leaks.\n\n## Expectations\n- [E1] x {verify: check | y}\n");
  return { id: "000-program", text, parsed: core.parseIced(text) };
};
const evidence = [{ expectation: "E1", kind: "test", ref: "t1" }, { expectation: "e2", kind: "check", ref: "c" }];
const passing = {
  verdict: "pass",
  expectations: [{ id: "E1", result: "pass", evidence: "ran" }, { id: "E2", result: "pass", evidence: "ran" }],
  failures: [{ id: "F1", triggered: false }], constraints: [{ id: "C1", violated: false }, { id: "C2", violated: false }],
  outOfScope: [], notes: "",
};

test("collectRules qualifies inherited ids", () => {
  const r = collectRules(unitOf(), [parent()]);
  assert.deepEqual(r.constraints.map((c) => c.id), ["C1", "C2", "000-program:C1"]);
  assert.deepEqual(r.failures.map((f) => f.id), ["F1", "000-program:F1"]);
});

test("verdict: pass with independent verifier", () => {
  const v = computeVerdict({ unit: unitOf(), evidence, commandResults: [{ command: "t", exitCode: 0 }], verifier: passing });
  assert.equal(v.verdict, "pass");
  assert.equal(v.independent, true);
  assert.equal(v.needsHuman, false);
  assert.deepEqual(v.problems, []);
});

test("verdict: missing or malformed own and inherited rule checks require human review", () => {
  for (const value of [undefined, null, "false", 0, {}]) {
    const v = computeVerdict({ unit: unitOf(), ancestorUnits: [parent()], evidence, verifier: {
      ...passing,
      failures: [{ id: "F1", triggered: value }],
      constraints: [{ id: "C1", violated: value }, { id: "C2", violated: false }],
    } });
    assert.equal(v.verdict, "pass");
    assert.equal(v.needsHuman, true);
    assert.equal(v.failures[0].checked, false);
    assert.equal(v.constraints[0].checked, false);
    assert.equal(v.constraints[1].checked, true);
    for (const id of ["F1", "C1", "000-program:F1", "000-program:C1"]) assert.ok(v.notes.includes(`[${id}]`));
  }
  const omitted = computeVerdict({ unit: unitOf(), evidence, verifier: { verdict: "pass", expectations: passing.expectations } });
  assert.equal(omitted.needsHuman, true);
  assert.ok(omitted.constraints.every((c) => !c.checked));
});

test("verdict: duplicate own and inherited rule entries cannot hide violations", () => {
  const rules = collectRules(unitOf(), [parent()]);
  const verifier = { ...passing,
    constraints: rules.constraints.flatMap((c) => [{ id: c.id, violated: false }, { id: c.id }, { id: c.id.toLowerCase(), violated: true }]),
    failures: rules.failures.flatMap((f) => [{ id: f.id, triggered: false }, { id: f.id, triggered: "false" }, { id: f.id, triggered: true }]),
  };
  const v = computeVerdict({ unit: unitOf(), ancestorUnits: [parent()], evidence, verifier });
  assert.equal(v.verdict, "fail");
  assert.ok(v.constraints.every((c) => c.violated));
  assert.ok(v.failures.every((f) => f.triggered));
});

test("verdict: failures of every kind", () => {
  const base = { unit: unitOf(), evidence, commandResults: [], verifier: passing };
  assert.equal(computeVerdict({ ...base, commandResults: [{ command: "npm test", exitCode: 1 }] }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, evidence: [evidence[0]] }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, expectations: [{ id: "E1", result: "fail" }, { id: "E2", result: "pass" }] } }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, expectations: [{ id: "E1", result: "pass" }] } }).verdict, "fail", "missing verifier result is not a pass");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, failures: [{ id: "F1", triggered: true }] } }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, constraints: [{ id: "C2", violated: true }] } }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, outOfScope: ["edited the marketing site"] } }).verdict, "fail");
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, verdict: "fail", notes: "broken" } }).verdict, "fail");
});

test("verdict: ICED's own files flagged out of scope do not fail the unit", () => {
  const base = { unit: unitOf(), evidence, commandResults: [], verifier: passing };
  const own = [".iced/metrics.jsonl", "`.iced/metrics.jsonl` (ICED bookkeeping, harmless)", "intent\\001-dark-mode\\evidence.md", "./intent/001-dark-mode/verify.json"];
  const v = computeVerdict({ ...base, verifier: { ...passing, outOfScope: own } });
  assert.equal(v.verdict, "pass");
  assert.deepEqual(v.outOfScope, []);
  assert.deepEqual(v.ignoredOutOfScope, own);
  // verifiers often set verdict "fail" only because of the bookkeeping file
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, verdict: "fail", outOfScope: [".iced/metrics.jsonl"] } }).verdict, "pass");
  // real files still count, also when mixed with ICED paths in one entry
  for (const x of ["src/app.ts", ".iced/metrics.jsonl and src/app.ts", "edited the marketing site", "metrics.jsonl"]) {
    assert.equal(computeVerdict({ ...base, verifier: { ...passing, outOfScope: [x] } }).verdict, "fail", x);
  }
  assert.equal(computeVerdict({ ...base, verifier: { ...passing, outOfScope: [".iced-other/x"] } }).verdict, "fail");
});

test("verifier prompt says ICED's own files are never out of scope", () => {
  const p = buildVerifierPrompt({ unit: unitOf(), summary: "s", evidence, commandResults: [], files: [], rubric: "" });
  assert.match(p, /`\.iced\/metrics\.jsonl`/);
  assert.match(p, /never out of scope/);
});

test("verdict: inherited constraint violation fails the child", () => {
  const verifier = { ...passing, constraints: [...passing.constraints, { id: "000-program:C1", violated: true, evidence: "no audit" }] };
  const v = computeVerdict({ unit: unitOf(), ancestorUnits: [parent()], evidence, verifier });
  assert.equal(v.verdict, "fail");
  assert.ok(v.problems.some((p) => p.includes("000-program:C1")));
});

test("verdict: manual unknown needs a human; no verifier needs a human", () => {
  const text = unitText({}, unitText().split("---\n").slice(2).join("---\n").replace("{verify: check}", "{verify: manual | look at it}"));
  const unit = { text, parsed: core.parseIced(text) };
  const v = computeVerdict({ unit, evidence, verifier: { ...passing, expectations: [{ id: "E1", result: "pass" }, { id: "E2", result: "unknown" }] } });
  assert.equal(v.verdict, "pass");
  assert.equal(v.needsHuman, true);
  const none = computeVerdict({ unit: unitOf(), evidence, verifier: null, verifierError: "timed out" });
  assert.equal(none.verdict, "pass");
  assert.equal(none.independent, false);
  assert.equal(none.needsHuman, true);
  assert.equal(none.expectations[0].result, "claimed");
});

test("parseVerifierOutput takes the last JSON verdict block", () => {
  const out = "thinking...\n```json\n{\"x\":1}\n```\nfinal:\n```json\n{\"verdict\":\"fail\",\"notes\":\"n\"}\n```\n";
  assert.deepEqual(parseVerifierOutput(out), { verdict: "fail", notes: "n" });
  assert.equal(parseVerifierOutput("no json here"), null);
  assert.deepEqual(parseVerifierOutput('text {"verdict":"pass"}'), { verdict: "pass" });
});

test("verifier prompt carries contract, claims, inherited rules and answer format", () => {
  const p = buildVerifierPrompt({ unit: unitOf(), ancestorUnits: [parent()], summary: "did it", evidence: [evidence[0]], commandResults: [], files: ["src/a.ts"], rubric: "RUBRIC" });
  for (const s of ["try to prove that it is NOT done", "[E2] NO EVIDENCE SUBMITTED", "000-program:C1", "src/a.ts", "RUBRIC", '"verdict"']) assert.ok(p.includes(s), s);
});

test("runCommands captures exit codes", async (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  const r = await runCommands(root, ['node -e "process.exit(0)"', 'node -e "console.log(42); process.exit(3)"'], { timeoutSec: 60 });
  assert.deepEqual(r.map((x) => x.exitCode), [0, 3]);
  assert.match(r[1].tail, /42/);
});

test("verifyUnit writes evidence.md and verify.json", async (t) => {
  const root = tempRepo({ git: true });
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "verifying" }));
  let seen = "";
  const report = await verifyUnit({
    root, unit: core.readUnit(root, "001-dark-mode"), config: core.loadConfig(root), summary: "s", evidence, attempt: 2,
    runVerifierImpl: async ({ prompt }) => { seen = prompt; return { verifier: passing, error: null }; },
  });
  assert.equal(report.verdict, "pass");
  assert.ok(seen.includes("001-dark-mode"));
  const paths = core.unitPaths(root, "001-dark-mode");
  assert.equal(JSON.parse(fs.readFileSync(paths.verify, "utf8")).attempt, 2);
  assert.match(fs.readFileSync(paths.evidence, "utf8"), /Verdict: \*\*PASS\*\*[\s\S]*\[E1\][\s\S]*Result: \*\*pass\*\*/);
});

test("verifyUnit skips the verifier when evidence is missing", async (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  writeUnit(root, "001-dark-mode", unitText({ status: "verifying" }));
  let called = false;
  const report = await verifyUnit({
    root, unit: core.readUnit(root, "001-dark-mode"), config: core.loadConfig(root), evidence: [evidence[0]],
    runVerifierImpl: async () => { called = true; return { verifier: passing, error: null }; },
  });
  assert.equal(called, false);
  assert.equal(report.verdict, "fail");
});

test("verifiers see the full check output and are told it is evidence; reports keep only the tail", async (t) => {
  const root = tempRepo({ git: true });
  t.after(() => cleanup(root));
  const cmd = `node -e "for (let i = 0; i < 400; i++) console.log('ok test-number-' + i)"`;
  const [r] = await runCommands(root, [cmd]);
  assert.ok(r.output.includes("test-number-0") && r.output.includes("test-number-399"), "full output kept for the prompt");
  assert.ok(!r.tail.includes("test-number-0"), "report tail is short");
  writeUnit(root, "001-dark-mode", unitText({ status: "verifying" }));
  let prompt = "";
  const report = await verifyUnit({
    root, unit: core.readUnit(root, "001-dark-mode"), config: { ...core.loadConfig(root), verify: { ...core.loadConfig(root).verify, commands: [cmd] } },
    evidence, runVerifierImpl: async (o) => { prompt = o.prompt; return { verifier: passing, error: null }; },
  });
  assert.ok(prompt.includes("test-number-0") && prompt.includes("test-number-399"));
  assert.match(prompt, /produced by the ICED tooling on this exact working tree/);
  assert.match(prompt, /inability to re-run a command is not by itself a failure/);
  assert.equal(report.commandResults[0].output, undefined);
  assert.ok(!fs.readFileSync(core.unitPaths(root, "001-dark-mode").verify, "utf8").includes("test-number-0"));
});
