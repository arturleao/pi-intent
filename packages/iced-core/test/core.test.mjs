import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as core from "../src/core.mjs";
import { FILLED_BODY, cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

const codes = (list) => list.map((i) => i.code).sort();

test("frontmatter: parse scalars and CRLF", () => {
  const { data, ok, body } = core.parseFrontmatter("---\r\na: 1\r\nb: true\r\nc: null\r\nd: \"x: y\"\r\ne: hello\r\n---\r\nbody\r\n");
  assert.equal(ok, true);
  assert.deepEqual(data, { a: 1, b: true, c: null, d: "x: y", e: "hello" });
  assert.equal(body, "body\n");
  assert.equal(core.parseFrontmatter("no frontmatter").ok, false);
});

test("frontmatter: setFrontmatter keeps order and body, quotes risky strings", () => {
  const src = "---\nid: 001-a\ntitle: A\nstatus: draft\n---\n# A\n";
  const out = core.setFrontmatter(src, { status: "approved", title: "Fix: the thing", extra: "#tag", n: "42" });
  assert.match(out, /^---\nid: 001-a\ntitle: "Fix: the thing"\nstatus: approved\nextra: "#tag"\nn: "42"\n---\n# A\n$/);
  const back = core.parseFrontmatter(out).data;
  assert.equal(back.title, "Fix: the thing");
  assert.equal(back.extra, "#tag");
  assert.equal(back.n, "42");
});

test("parseIced: sections, items, verify, answers, scope, context, line numbers", () => {
  const text = unitText();
  const p = core.parseIced(text);
  assert.equal(p.goal, "Users can switch to a dark theme from Settings and it persists.");
  assert.deepEqual(p.constraints.map((c) => c.id), ["C1", "C2"]);
  assert.deepEqual(p.failures.map((f) => f.id), ["F1"]);
  assert.deepEqual(p.scope, { in: ["settings toggle", "persistence"], out: ["marketing site", "per-component theming"] });
  assert.deepEqual(p.context.map((c) => c.tag), ["code", "assumed"]);
  assert.deepEqual(p.expectations[0].verify, { kind: "test", ref: "tests/theme.spec.ts" });
  assert.equal(p.expectations[0].text, "Toggle switches theme without reload.");
  assert.deepEqual(p.expectations[1].verify, { kind: "check", ref: "" });
  assert.equal(p.questions[0].answer, "yes");
  assert.equal(p.questions[0].text, "Follow OS preference by default?");
  const lines = text.split("\n");
  assert.equal(lines[p.constraints[0].line - 1], "- [C1] No new runtime dependencies.");
});

test("parseIced: template comments produce no items", () => {
  const tpl = fs.readFileSync(path.join(core.PACKAGE_ROOT, "spec", "templates", "feature.md"), "utf8");
  const p = core.parseIced(tpl);
  assert.equal(p.goal, "");
  assert.equal(p.constraints.length + p.failures.length + p.expectations.length + p.questions.length + p.context.length, 0);
});

test("contractHash: stable across formatting and frontmatter, sensitive to contract", () => {
  const a = unitText();
  const h = core.contractHash(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(core.contractHash(a.replace(/\n/g, "\r\n")), h);
  assert.equal(core.contractHash(a.replace("- [C1] No new runtime dependencies.", "- [C1] No new runtime dependencies.   \n\n")), h);
  assert.equal(core.contractHash(core.setFrontmatter(a, { status: "building", attempts: 2 })), h);
  assert.equal(core.contractHash(a.replace("[code] Tokens", "[code] Theme tokens")), h, "context is not in the contract");
  assert.equal(core.contractHash(a.replace("-> A: yes", "-> A: no")), h, "questions are not in the contract");
  assert.notEqual(core.contractHash(a.replace("it persists", "it sticks")), h);
  assert.notEqual(core.contractHash(a.replace("without reload", "after reload")), h);
});

test("lint: draft template passes draft stage, fails signoff with the right codes", () => {
  const tpl = unitText({}, "\n# X\n\n## Intent\n\n### Goal\n\n## Expectations\n");
  const p = core.parseIced(tpl);
  assert.deepEqual(core.lintIced(p, "draft", tpl).errors, []);
  assert.deepEqual(codes(core.lintIced(p, "signoff", tpl).errors), ["expectations-missing", "failures-missing", "goal-missing"]);
});

test("lint: signoff rules on a filled unit", () => {
  const ok = core.parseIced(unitText());
  const r = core.lintIced(ok, "signoff");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(codes(r.warnings), ["assumptions-present"]);

  const bad = unitText({}, FILLED_BODY
    .replace("{verify: check}", "")
    .replace("-> A: yes", "")
    .replace("Users can switch", "Use React to let users switch")
    .replace("- [C2] Light theme unchanged.", "- [C1] Duplicate id."));
  const rb = core.lintIced(core.parseIced(bad), "signoff");
  assert.deepEqual(codes(rb.errors), ["expectation-unverifiable", "ids-duplicate", "open-questions"]);
  assert.ok(codes(rb.warnings).includes("goal-has-solution"));
});

test("lint: review units need no failure conditions", () => {
  const t = unitText({ type: "review" }, FILLED_BODY.replace("- [F1] Theme resets after reload.", ""));
  assert.deepEqual(core.lintIced(core.parseIced(t), "signoff").errors, []);
  const f = unitText({ type: "feature" }, FILLED_BODY.replace("- [F1] Theme resets after reload.", ""));
  assert.deepEqual(codes(core.lintIced(core.parseIced(f), "signoff").errors), ["failures-missing"]);
});

test("lint: field validation", () => {
  const t = unitText({ type: "story", tier: "XXL", autonomy: 7, id: "bad id" });
  const errs = core.lintIced(core.parseIced(t), "draft").errors;
  assert.equal(errs.filter((e) => e.code === "field-invalid").length, 4);
  const missing = core.lintIced(core.parseIced("# nothing"), "draft").errors;
  assert.ok(codes(missing).includes("frontmatter-missing"));
});

test("lint: contract-changed after approval, evidence-missing at accept", () => {
  const base = unitText({ status: "building" });
  const approved = core.setFrontmatter(base, { contract_hash: core.contractHash(base) });
  assert.deepEqual(core.lintIced(core.parseIced(approved), "validate", approved).errors, []);
  const tampered = approved.replace("it persists", "it maybe persists");
  assert.deepEqual(codes(core.lintIced(core.parseIced(tampered), "validate", tampered).errors), ["contract-changed"]);
  const noHash = unitText({ status: "approved" });
  assert.deepEqual(codes(core.lintIced(core.parseIced(noHash), "validate", noHash).errors), ["contract-changed"]);
  const done = core.setFrontmatter(approved, { status: "done" });
  assert.deepEqual(codes(core.lintIced(core.parseIced(done), "accept", done, { evidenceExists: false }).errors), ["evidence-missing"]);
});

test("transitions", () => {
  for (const [from, tos] of Object.entries(core.TRANSITIONS)) for (const to of tos) assert.ok(core.canTransition(from, to), `${from}->${to}`);
  for (const [from, to] of [["draft", "building"], ["draft", "done"], ["building", "done"], ["accepted", "building"], ["rejected", "draft"], ["done", "verifying"]]) {
    assert.equal(core.canTransition(from, to), false, `${from}->${to}`);
  }
});

test("effectiveAutonomy caps", () => {
  const cfg = core.defaultConfig();
  assert.equal(core.effectiveAutonomy({ autonomy: 3, risk: "low" }, cfg), 3);
  assert.equal(core.effectiveAutonomy({ autonomy: 3, risk: "high" }, cfg), 1);
  assert.equal(core.effectiveAutonomy({ autonomy: 3, risk: "low" }, { ...cfg, maxAutonomy: 2 }), 2);
  assert.equal(core.effectiveAutonomy({ risk: "low" }, { ...cfg, autonomy: 2 }), 2);
});

test("repo ops: create, ids, resolve, transition, active, decisions", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  assert.equal(core.findRoot(path.join(root, "intent")), root);
  const a = core.createUnit(root, { title: "Fix login timeout!", type: "bug", request: "fix login timeout" });
  const b = core.createUnit(root, { title: "Dark mode", type: "feature" });
  assert.equal(a.id, "001-fix-login-timeout");
  assert.equal(b.id, "002-dark-mode");
  assert.equal(core.nextId(root, "Next"), "003-next");
  const ua = core.readUnit(root, a.id);
  assert.equal(ua.parsed.frontmatter.status, "draft");
  assert.equal(ua.parsed.frontmatter.tier, "S");
  assert.equal(ua.parsed.frontmatter.title, "Fix login timeout!");
  assert.ok(fs.existsSync(a.paths.decisions));
  assert.equal(core.resolveId(root, "2"), b.id);
  assert.equal(core.resolveId(root, "002"), b.id);
  assert.equal(core.resolveId(root, "login"), a.id);
  assert.equal(core.resolveId(root, "nope"), null);

  assert.throws(() => core.transition(root, a.id, "building"), /Cannot move/);
  core.transition(root, a.id, "approved");
  core.transition(root, a.id, "building");
  core.transition(root, a.id, "blocked");
  assert.equal(core.readUnit(root, a.id).parsed.frontmatter.blocked_from, "building");
  core.transition(root, a.id, "building");
  assert.equal(core.readUnit(root, a.id).parsed.frontmatter.blocked_from, null);

  assert.equal(core.getActive(root), null);
  core.setActive(root, a.id);
  assert.equal(core.getActive(root), a.id);
  core.setActive(root, null);
  assert.equal(core.getActive(root), null);

  core.appendDecision(root, a.id, { decision: "Use X", why: "Because", alternatives: ["Y", "Z"] });
  assert.match(fs.readFileSync(a.paths.decisions, "utf8"), /Decision: Use X\n- Why: Because\n- Alternatives: Y; Z/);
});

test("repo ops: approve and accept", (t) => {
  const root = tempRepo({ git: true });
  t.after(() => cleanup(root));
  const { id, paths } = core.createUnit(root, { title: "Dark mode", type: "feature" });
  assert.equal(core.approveUnit(root, id, {}).ok, false, "fresh template fails sign-off");
  const filled = core.setFrontmatter(unitText(), core.readUnit(root, id).parsed.frontmatter);
  fs.writeFileSync(paths.iced, filled);
  const r = core.approveUnit(root, id, { by: "Ana", startBuild: true });
  assert.equal(r.ok, true);
  const fm = core.readUnit(root, id).parsed.frontmatter;
  assert.equal(fm.status, "building");
  assert.equal(fm.approved_by, "Ana");
  assert.equal(fm.contract_hash, core.contractHash(filled));
  assert.match(String(fm.base_ref), /^[0-9a-f]{40}$/);
  core.transition(root, id, "verifying");
  core.transition(root, id, "done");
  const noEvidence = core.acceptUnit(root, id, {});
  assert.deepEqual(codes(noEvidence.lint.errors), ["evidence-missing"]);
  fs.writeFileSync(paths.evidence, "# Evidence\n");
  assert.equal(core.acceptUnit(root, id, { by: "Ana" }).ok, true);
  assert.equal(core.readUnit(root, id).parsed.frontmatter.status, "accepted");
  const events = core.readMetrics(root).map((e) => e.event);
  assert.deepEqual(events, ["signoff", "accept"]);
});

test("layers: ancestors, children, cycle safety", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  writeUnit(root, "001-program", unitText({ id: "001-program", type: "project", tier: "XL" }));
  writeUnit(root, "002-project", unitText({ id: "002-project", type: "project", tier: "L", parent: "001-program" }));
  writeUnit(root, "003-feature", unitText({ id: "003-feature", parent: "002-project" }));
  assert.deepEqual(core.ancestors(root, "003-feature").map((u) => u.id), ["002-project", "001-program"]);
  assert.deepEqual(core.children(root, "002-project"), ["003-feature"]);
  writeUnit(root, "004-a", unitText({ id: "004-a", parent: "005-b" }));
  writeUnit(root, "005-b", unitText({ id: "005-b", parent: "004-a" }));
  assert.deepEqual(core.ancestors(root, "004-a").map((u) => u.id), ["005-b"]);
});

test("appendToSection and nextItemId", () => {
  const text = unitText();
  const out = core.appendToSection(text, "Open questions", ["- [Q2] Another? -> A: no"]);
  const p = core.parseIced(out);
  assert.deepEqual(p.questions.map((q) => q.id), ["Q1", "Q2"]);
  assert.equal(core.nextItemId(p, "Q"), "Q3");
  assert.equal(core.nextItemId(p, "E"), "E3");
  const added = core.appendToSection("---\na: 1\n---\n# T\n", "Open questions", ["- [Q1] x -> A: y"]);
  assert.equal(core.parseIced(added).questions.length, 1);
});

test("metrics: stats and promotion suggestions", () => {
  const cfg = { ...core.defaultConfig(), promotion: { mode: "suggest", window: 3 } };
  const ev = [];
  let ts = 0;
  const add = (id, event, extra = {}) => ev.push({ ts: `2026-01-01T00:00:${String(ts++).padStart(2, "0")}Z`, id, event, risk: "low", autonomy: 1, ...extra });
  for (const id of ["a", "b", "c"]) {
    add(id, "questions", { count: 2 });
    add(id, "signoff", { result: "approved" });
    add(id, "verify", { result: id === "a" ? "fail" : "pass" });
    if (id === "a") add(id, "verify", { result: "pass" });
    add(id, "accept");
  }
  const s = core.computeStats(ev).overall;
  assert.equal(s.units, 3);
  assert.equal(s.questionsPerUnit, 2);
  assert.equal(s.verifyFirstPassRate, 66.7);
  assert.equal(s.humanRejectionRate, 0);
  assert.deepEqual(core.promotionSuggestions(ev, cfg).map((x) => [x.risk, x.from, x.to]), [["low", 1, 2]]);

  const withReject = [...ev, { ts: "2026-01-02T00:00:00Z", id: "b", event: "reject", risk: "low", autonomy: 1 }];
  assert.deepEqual(core.promotionSuggestions(withReject, cfg), []);
  const high = ev.map((e) => ({ ...e, risk: "high" }));
  assert.deepEqual(core.promotionSuggestions(high, cfg), [], "high risk is capped at 1");
});

test("metrics file round trip", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  core.appendMetric(root, { id: "x", event: "created" });
  fs.appendFileSync(path.join(root, ".iced", "metrics.jsonl"), "not json\n");
  core.appendMetric(root, { id: "x", event: "accept" });
  assert.deepEqual(core.readMetrics(root).map((e) => e.event), ["created", "accept"]);
});

test("spec examples pass validate and hashes match", () => {
  const dir = path.join(core.PACKAGE_ROOT, "spec", "examples");
  const ids = fs.readdirSync(dir);
  assert.ok(ids.length >= 3);
  for (const id of ids) {
    const text = fs.readFileSync(path.join(dir, id, "iced.md"), "utf8");
    const p = core.parseIced(text);
    assert.deepEqual(core.lintIced(p, "validate", text).errors, [], id);
    if (p.frontmatter.contract_hash) assert.equal(p.frontmatter.contract_hash, core.contractHash(text), id);
  }
});

test("templates exist for every type and create lint-clean drafts", (t) => {
  const root = tempRepo();
  t.after(() => cleanup(root));
  for (const type of core.TYPES) {
    const { id } = core.createUnit(root, { title: `A ${type}`, type });
    const u = core.readUnit(root, id);
    assert.deepEqual(core.lintIced(u.parsed, "draft", u.text).errors, [], type);
    assert.equal(u.parsed.frontmatter.type, type);
  }
});
