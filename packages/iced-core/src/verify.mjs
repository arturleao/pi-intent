// ICED verification: run checks, ask independent verifiers to try to break the work, decide the verdict,
// and write evidence.md + verify.json. Zero dependencies. The host passes in an `agent` function that starts
// verifier and test writer agents; this module never starts one itself.

import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  PACKAGE_ROOT, acceptUnit, ancestors, appendMetric, effectiveAutonomy, getActive, git, loadConfig, nowIso,
  normalizeDir, readUnit, setActive, splitEffort, transition, unitPaths, verifyEffort, verifyModels,
} from "./core.mjs";

const TAIL = 4000;
/** How much check output verifiers see: they may have no way to run commands, so this is their evidence. */
const PROMPT_OUTPUT = 30000;
const tail = (s, n = TAIL) => (s.length > n ? `...${s.slice(-n)}` : s);

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* gone */ }
  } else {
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  }
}

/** Spawn a process, capture output, enforce a timeout. Never rejects. */
export function runProcess(command, args, { cwd, env, timeoutSec = 900, signal, shell = false, input, verbatim = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd == null ? cwd : normalizeDir(cwd), env, shell, windowsHide: true, windowsVerbatimArguments: verbatim,
        stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ exitCode: -1, output: String(error?.message ?? error), stdout: "", durationMs: 0, timedOut: false });
      return;
    }
    let stdout = "";
    child.stdout.on("data", (d) => { const s = d.toString(); stdout += s; out += s; });
    child.stderr.on("data", (d) => { out += d.toString(); });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, Math.max(1, timeoutSec) * 1000);
    const onAbort = () => killTree(child);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("error", (error) => { out += `\n${error.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ exitCode: timedOut ? -1 : (code ?? -1), output: out, stdout, durationMs: Date.now() - started, timedOut });
    });
  });
}

/**
 * verify.commands entries run in parallel; an entry that is itself a list runs in order (for example build, then
 * e2e) and stops at the first failure. With parallel=false everything runs in order.
 */
export function commandGroups(commands, parallel = true) {
  const groups = (commands ?? [])
    .map((c) => (Array.isArray(c) ? c : [c]).map((x) => String(x ?? "").trim()).filter(Boolean))
    .filter((g) => g.length);
  return parallel ? groups : groups.length ? [groups.flat()] : [];
}

export async function runCommands(root, commands, { timeoutSec, signal, onProgress, parallel = true } = {}) {
  const runGroup = async (group) => {
    const results = [];
    let failed = false;
    for (const command of group) {
      if (failed) { results.push({ command, exitCode: null, skipped: true, durationMs: 0, timedOut: false, tail: "skipped: an earlier step in this group failed" }); continue; }
      onProgress?.(`Running ${command}`);
      const r = await runProcess(command, [], { cwd: root, shell: true, timeoutSec, signal });
      results.push({ command, exitCode: r.exitCode, durationMs: r.durationMs, timedOut: r.timedOut, tail: tail(r.output), output: tail(r.output, PROMPT_OUTPUT) });
      failed = r.exitCode !== 0;
    }
    return results;
  };
  return (await Promise.all(commandGroups(commands, parallel).map(runGroup))).flat();
}

/** ICED's own records (unit files, evidence, metrics, config, tmp): never a scope violation. */
export function isIcedOwnedPath(p) {
  const s = String(p ?? "").trim().replace(/^[`'"(\[]+|[`'",.;:)\]]+$/g, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  return s.startsWith(".iced/") || s === ".iced" || s.startsWith("intent/") || s === "intent";
}

/**
 * True when an out-of-scope entry from a verifier only names ICED-owned paths (for example
 * ".iced/metrics.jsonl (ICED bookkeeping, harmless)"). Entries naming no path at all are kept.
 */
export function isIcedBookkeeping(entry) {
  const paths = String(entry ?? "").split(/\s+/).filter((t) => /[\\/]/.test(t) && /[A-Za-z0-9]/.test(t));
  return paths.length > 0 && paths.every(isIcedOwnedPath);
}

export function changedFiles(root, baseRef) {
  const lines = [];
  const diff = baseRef ? git(root, ["diff", "--name-only", baseRef]) : git(root, ["diff", "--name-only", "HEAD"]);
  if (diff) lines.push(...diff.split(/\r?\n/));
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked) lines.push(...untracked.split(/\r?\n/));
  return [...new Set(lines.map((l) => l.trim()).filter((l) => l && !isIcedOwnedPath(l)))].sort();
}

/** Constraints and failure conditions of the unit and its ancestors, with qualified ids for ancestors. */
export function collectRules(unit, ancestorUnits = []) {
  const own = unit.parsed;
  const constraints = own.constraints.map((c) => ({ id: c.id, text: c.text, from: own.frontmatter.id }));
  const failures = own.failures.map((f) => ({ id: f.id, text: f.text, from: own.frontmatter.id }));
  for (const a of ancestorUnits) {
    const aid = a.parsed.frontmatter.id;
    for (const c of a.parsed.constraints) constraints.push({ id: `${aid}:${c.id}`, text: c.text, from: aid });
    for (const f of a.parsed.failures) failures.push({ id: `${aid}:${f.id}`, text: f.text, from: aid });
  }
  return { constraints, failures };
}

export function readRubric() {
  const candidates = [
    path.join(PACKAGE_ROOT, "spec", "rubric.md"),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, "utf8"); } catch { /* next */ }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Verifier lenses: parallel verifiers with different focus areas
// ---------------------------------------------------------------------------

export const LENSES = {
  expectations: "The expectations. For each [E#], check the referenced test or check against the code and the check results, and try to demonstrate it for real, including edge cases the builder may have skipped.",
  failures: "Breaking it. Actively try to trigger every failure condition (own and inherited) with inputs, states and paths the builder is unlikely to have tested.",
  rules: "Rules and scope. Check every constraint (own and inherited) against the changed files, look for security and data-handling problems, and list anything changed outside Scope.",
};

/** Which verifiers to run: one full verifier, or one per lens in parallel. */
export function pickLenses(unit, config) {
  const want = config?.verify?.lenses ?? "auto";
  if (Array.isArray(want)) {
    const picked = want.filter((x) => LENSES[x]);
    return picked.length ? picked : ["full"];
  }
  if (want === "single") return ["full"];
  if (want === "parallel") return Object.keys(LENSES);
  const fm = unit.parsed.frontmatter;
  return ["M", "L", "XL"].includes(fm.tier) || fm.risk === "high" ? Object.keys(LENSES) : ["full"];
}

/**
 * Model and effort for the index-th verifier. The model is verify.model (a list is rotated), else fallback.model.
 * Effort: the model's :level suffix, then verify.effort, then fallback.effort. `host` reads legacy per-host maps.
 */
export function lensSetting(config, index, host = null, fallback = {}) {
  const list = verifyModels(config, host);
  const s = list.length ? splitEffort(list[index % list.length]) : splitEffort(fallback.model);
  return { model: s.model, effort: s.effort ?? verifyEffort(config, host) ?? fallback.effort ?? null };
}

export function lensModel(config, index, host = null, fallback = null) {
  return lensSetting(config, index, host, { model: fallback }).model;
}

/** "model, effort high" for reports. */
export function settingLabel(l) {
  const effort = l.effort ? `effort ${l.effort}` : "";
  return [l.model, effort].filter(Boolean).join(", ");
}

export function buildVerifierPrompt({ unit, ancestorUnits = [], summary, evidence, commandResults, files, rubric, lens = "full" }) {
  const { constraints, failures } = collectRules(unit, ancestorUnits);
  const e = unit.parsed.expectations;
  const ev = (id) => evidence.filter((x) => String(x.expectation).toUpperCase() === id);
  const lines = [
    "You are the independent ICED verifier. Another agent built the change below and claims it is done.",
    "Your job is to try to prove that it is NOT done. Treat every claim as unverified until you have checked it yourself",
    "by reading the code, the tests and the check results below (run read-only commands only if your tools allow it).",
    "Do not modify, create or delete files.",
    "The check results were produced by the ICED tooling on this exact working tree, not by the builder: they are real",
    "command output and count as evidence. When you cannot run commands, use them: a named passing test demonstrates its",
    "expectation once you have read the test and confirmed it checks what the expectation says. Report a gap only when",
    "neither the output nor the code supports a claim; inability to re-run a command is not by itself a failure.",
    "Do not trust the builder's summary. An expectation passes only when you have concrete evidence.",
    "",
  ];
  if (LENSES[lens]) {
    lines.push(
      "## Your focus", "", LENSES[lens],
      "Other verifiers cover the other areas in parallel. Still report anything else you notice, and fill in every field",
      "of the answer; use \"unknown\" for expectations you did not check.", "",
    );
  }
  lines.push(
    `## Unit ${unit.parsed.frontmatter.id}: ${unit.parsed.title}`,
    "",
    "```markdown",
    unit.text.trim(),
    "```",
    "",
  );
  if (ancestorUnits.length) {
    lines.push("## Inherited rules from parent units (they apply to this unit too)");
    for (const r of constraints.filter((c) => c.from !== unit.parsed.frontmatter.id)) lines.push(`- constraint [${r.id}] ${r.text}`);
    for (const r of failures.filter((f) => f.from !== unit.parsed.frontmatter.id)) lines.push(`- failure condition [${r.id}] ${r.text}`);
    lines.push("");
  }
  lines.push("## Builder's claims (unverified)", "", summary ? `Summary: ${summary}` : "Summary: (none)", "");
  for (const x of e) {
    const claims = ev(x.id);
    lines.push(`- [${x.id}] ${claims.length ? claims.map((c) => `${c.kind}: ${c.ref}${c.note ? ` (${c.note})` : ""}`).join("; ") : "NO EVIDENCE SUBMITTED"}`);
  }
  lines.push("", "## Configured check commands (already run by the tooling)");
  if (!commandResults.length) lines.push("(none configured)");
  for (const r of commandResults) {
    lines.push(r.skipped ? `- \`${r.command}\` skipped (an earlier step failed)` : `- \`${r.command}\` exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n\n\`\`\`text\n${tail(r.output ?? r.tail ?? "", PROMPT_OUTPUT)}\n\`\`\``);
  }
  lines.push("", "## Files changed since approval", files.length ? files.map((f) => `- ${f}`).join("\n") : "(none detected, or no git)", "");
  lines.push(
    "Files under `intent/` and `.iced/` (unit files, evidence, verify results, `.iced/metrics.jsonl`, config, tmp) are",
    "ICED's own records, written by the tooling during this workflow. They are never out of scope: do not list them in",
    "`outOfScope` and do not fail the unit because of them.", "",
  );
  if (rubric) lines.push("## Rubric", "", rubric.trim(), "");
  lines.push(
    "## What to check",
    "1. Each expectation: is it actually met? Read the referenced test or check and its result below. Expectations of kind",
    "   `manual` may be `unknown` if they truly need a human; say what the human should check.",
    "2. Each failure condition (own and inherited): is it triggered? Look for it actively.",
    "3. Each constraint (own and inherited): is it violated? Also flag changes outside the unit's Scope.",
    "",
    "## Answer format",
    "End your answer with exactly one fenced json block:",
    "```json",
    JSON.stringify({
      verdict: "pass | fail",
      expectations: e.map((x) => ({ id: x.id, result: "pass | fail | unknown", evidence: "what you checked and saw" })),
      failures: failures.map((f) => ({ id: f.id, triggered: false, evidence: "..." })),
      constraints: constraints.map((c) => ({ id: c.id, violated: false, evidence: "..." })),
      outOfScope: ["path or change outside scope, if any"],
      notes: "anything the human should know",
    }, null, 2),
    "```",
  );
  return lines.join("\n");
}

export function parseVerifierOutput(text) {
  const src = String(text ?? "");
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of blocks.reverse()) {
    try {
      const v = JSON.parse(block);
      if (v && typeof v === "object" && "verdict" in v) return v;
    } catch { /* try next */ }
  }
  const start = src.lastIndexOf('{"verdict"');
  if (start >= 0) {
    try { return JSON.parse(src.slice(start, src.lastIndexOf("}") + 1)); } catch { /* fall through */ }
  }
  return null;
}

const booleanRank = (value) => value === true ? 2 : value === false ? 1 : 0;

const byId = (list, id, booleanField = null) => {
  const matches = Array.isArray(list) ? list.filter((x) => String(x?.id ?? "").toUpperCase() === id.toUpperCase()) : [];
  return booleanField ? matches.reduce((best, item) => !best || booleanRank(item[booleanField]) > booleanRank(best[booleanField]) ? item : best, undefined) : matches[0];
};

/** Merge answers from parallel verifiers: any fail, trigger or violation wins; pass beats unknown. */
export function mergeVerifierReports(reports) {
  const list = (reports ?? []).filter(Boolean);
  if (!list.length) return null;
  const RANK = { fail: 3, pass: 2, unknown: 1 };
  const joinEvidence = (a, b) => [a, b].filter((x) => typeof x === "string" && x.trim()).filter((x, i, all) => all.indexOf(x) === i).join(" | ");
  const merge = (key, worse) => {
    const map = new Map();
    for (const r of list) {
      for (const item of Array.isArray(r[key]) ? r[key] : []) {
        const id = String(item?.id ?? "").toUpperCase();
        if (!id) continue;
        const prev = map.get(id);
        if (!prev) { map.set(id, { ...item }); continue; }
        const next = worse(item, prev) ? { ...item, id: prev.id } : { ...prev };
        next.evidence = joinEvidence(prev.evidence, item.evidence);
        map.set(id, next);
      }
    }
    return [...map.values()];
  };
  return {
    verdict: list.some((r) => r.verdict === "fail") ? "fail" : "pass",
    expectations: merge("expectations", (a, b) => (RANK[a.result] ?? 0) > (RANK[b.result] ?? 0)),
    failures: merge("failures", (a, b) => booleanRank(a.triggered) > booleanRank(b.triggered)),
    constraints: merge("constraints", (a, b) => booleanRank(a.violated) > booleanRank(b.violated)),
    outOfScope: [...new Set(list.flatMap((r) => (Array.isArray(r.outOfScope) ? r.outOfScope : [])))],
    notes: list.map((r) => (r.notes ? `${r.lens ? `[${r.lens}] ` : ""}${r.notes}` : "")).filter(Boolean).join("\n"),
  };
}

/** Combine command results, the verifier's report and submitted evidence into one verdict. */
export function computeVerdict({ unit, ancestorUnits = [], evidence = [], commandResults = [], verifier = null, verifierError = null, independent = true }) {
  const problems = [];
  const { constraints, failures } = collectRules(unit, ancestorUnits);
  const commandsOk = commandResults.every((r) => r.exitCode === 0 || r.skipped);
  for (const r of commandResults) if (!r.skipped && r.exitCode !== 0) problems.push(`Check \`${r.command}\` failed (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}).`);
  const haveVerifier = Boolean(verifier) && independent;
  let needsHuman = !haveVerifier;
  if (independent && !verifier) problems.push(`Independent verifier unavailable${verifierError ? `: ${verifierError}` : ""}. Result needs human review.`);

  const expectations = unit.parsed.expectations.map((e) => {
    const claims = evidence.filter((x) => String(x.expectation).toUpperCase() === e.id);
    const base = { id: e.id, text: e.text, kind: e.verify?.kind ?? null, ref: e.verify?.ref ?? null, claims };
    if (!claims.length) {
      problems.push(`[${e.id}] has no submitted evidence.`);
      return { ...base, result: "fail", evidence: "No evidence submitted." };
    }
    if (!haveVerifier) return { ...base, result: "claimed", evidence: "Not independently verified." };
    const v = byId(verifier.expectations, e.id);
    const result = ["pass", "fail", "unknown"].includes(v?.result) ? v.result : "unknown";
    if (result === "fail") problems.push(`[${e.id}] failed: ${v?.evidence ?? "no detail"}`);
    if (result === "unknown") {
      if (e.verify?.kind === "manual") needsHuman = true;
      else problems.push(`[${e.id}] could not be demonstrated: ${v?.evidence ?? "verifier gave no result"}`);
    }
    return { ...base, result, evidence: v?.evidence ?? "" };
  });

  const uncheckedRules = [];
  const ruleChecked = (v, field, id, kind) => {
    const checked = typeof v?.[field] === "boolean";
    if (haveVerifier && !checked) {
      needsHuman = true;
      uncheckedRules.push(`${kind} [${id}] has no explicit boolean ${field} result; human review required.`);
    }
    return checked;
  };
  const failureResults = failures.map((f) => {
    const v = haveVerifier ? byId(verifier.failures, f.id, "triggered") : undefined;
    const triggered = v?.triggered === true;
    if (triggered) problems.push(`Failure condition [${f.id}] triggered: ${v?.evidence ?? ""}`);
    return { ...f, triggered, checked: ruleChecked(v, "triggered", f.id, "Failure condition"), evidence: v?.evidence ?? "" };
  });
  const constraintResults = constraints.map((c) => {
    const v = haveVerifier ? byId(verifier.constraints, c.id, "violated") : undefined;
    const violated = v?.violated === true;
    if (violated) problems.push(`Constraint [${c.id}] violated: ${v?.evidence ?? ""}`);
    return { ...c, violated, checked: ruleChecked(v, "violated", c.id, "Constraint"), evidence: v?.evidence ?? "" };
  });
  const flagged = haveVerifier && Array.isArray(verifier.outOfScope)
    ? verifier.outOfScope.filter((x) => typeof x === "string" && x.trim() && !/^path or change/i.test(x)) : [];
  const ignoredOutOfScope = flagged.filter(isIcedBookkeeping);
  const outOfScope = flagged.filter((x) => !isIcedBookkeeping(x));
  for (const x of outOfScope) problems.push(`Out of scope: ${x}`);
  // A bare "fail" with nothing concrete behind it still fails, unless the only thing flagged was ICED bookkeeping.
  if (haveVerifier && verifier.verdict === "fail" && !problems.length && !ignoredOutOfScope.length) problems.push(`Verifier failed the unit: ${verifier.notes ?? "no detail"}`);

  const verdict = problems.filter((p) => !p.startsWith("Independent verifier unavailable")).length ? "fail" : "pass";
  return {
    verdict, independent: haveVerifier, needsHuman, commandsOk, problems,
    expectations, failures: failureResults, constraints: constraintResults, outOfScope, ignoredOutOfScope,
    notes: [haveVerifier ? String(verifier.notes ?? "") : "", ...uncheckedRules].filter(Boolean).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Agents: the host starts them; ICED only describes the job
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AgentJob
 * @property {string} root        repository root (the agent's working directory)
 * @property {string} prompt      full instructions
 * @property {"verifier"|"test-writer"} role
 * @property {"read-only"|"write"} access  verifiers must not change files; the test writer may write tests
 * @property {string|null} model  model reference as configured, without the :effort suffix
 * @property {string|null} effort one of EFFORTS, or null for the host's default
 * @property {number} timeoutSec
 * @property {AbortSignal} [signal]
 *
 * @typedef {object} AgentResult
 * @property {boolean} ok         the agent finished normally
 * @property {string} text        its final answer
 * @property {string} [output]    full log for error messages
 * @property {number} [exitCode]
 * @property {boolean} [timedOut]
 *
 * @typedef {(job: AgentJob) => Promise<AgentResult>} Agent
 */

/** Ask one independent verifier (through the host's agent) and parse its verdict. */
export async function runVerifier({ root, prompt, config, signal, agent, model, effort, host = null }) {
  if (typeof agent !== "function") return { verifier: null, error: "no agent available to run the verifier", raw: "" };
  const set = model === undefined ? lensSetting(config, 0, host) : { model, effort: effort ?? null };
  let r;
  try {
    r = await agent({
      root, prompt, role: "verifier", access: "read-only", model: set.model ?? null, effort: set.effort ?? null,
      timeoutSec: config.verify?.timeoutSec ?? 900, signal,
    });
  } catch (error) {
    return { verifier: null, error: `verifier could not start: ${error?.message ?? error}`, raw: "" };
  }
  const oneLine = (s) => String(s).replace(/[\s\u2022\u26a0]+/g, " ").trim();
  if (!r?.ok) return { verifier: null, error: r?.timedOut ? "verifier timed out" : `verifier exited ${r?.exitCode ?? "?"}: ${oneLine(tail(String(r?.output ?? r?.text ?? ""), 400))}`, raw: r?.output ?? "" };
  const verifier = parseVerifierOutput(r.text);
  if (!verifier) return { verifier: null, error: "verifier answer had no JSON verdict block", raw: r.text };
  return { verifier, error: null, raw: r.text };
}

export function buildTestWriterPrompt({ unit, ancestorUnits = [] }) {
  const { constraints, failures } = collectRules(unit, ancestorUnits);
  return [
    "You are the ICED test writer. Write automated tests for the expectations below BEFORE the implementation exists.",
    "You see only the contract, not the implementation plan. Tests should fail now and pass once the intent is met.",
    "Only create or edit test files (follow the repo's existing test layout and framework). Do not change application code.",
    "Cover every expectation with kind `test`, and add negative tests for failure conditions where practical.",
    "",
    "```markdown", unit.text.trim(), "```",
    "",
    ancestorUnits.length ? `Inherited rules:\n${[...constraints, ...failures].filter((r) => r.from !== unit.parsed.frontmatter.id).map((r) => `- [${r.id}] ${r.text}`).join("\n")}` : "",
    "",
    "Finish with a short list of test files written and which expectation each covers.",
  ].join("\n");
}

/** Run the isolated test writer through the host's agent. Never rejects. */
export async function runTestWriter({ root, unit, ancestorUnits, config, signal, agent, defaultModel = null, defaultEffort = null }) {
  if (typeof agent !== "function") return { ok: false, text: "", output: "no agent available to run the test writer" };
  const s = splitEffort(config.build?.testWriterModel || defaultModel);
  try {
    const r = await agent({
      root, prompt: buildTestWriterPrompt({ unit, ancestorUnits }), role: "test-writer", access: "write", model: s.model,
      effort: s.effort ?? config.build?.testWriterEffort ?? defaultEffort ?? null, timeoutSec: config.verify?.timeoutSec ?? 900, signal,
    });
    return { ok: Boolean(r?.ok), text: String(r?.text ?? ""), output: String(r?.output ?? r?.text ?? "") };
  } catch (error) {
    return { ok: false, text: "", output: String(error?.message ?? error) };
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function renderEvidence({ id, title, attempt, result, summary, files, commandResults, ts, lenses = [], host = null }) {
  const L = [`# Evidence: ${id}`, "", `${title ?? ""}`.trim(), "",
    `Verdict: **${result.verdict.toUpperCase()}** (attempt ${attempt}, ${ts}, independent verifier: ${result.independent ? "yes" : "no"}${result.needsHuman ? ", needs human review" : ""})`, ""];
  if (lenses.length) {
    const secs = (ms) => (ms ? `, ${(ms / 1000).toFixed(0)}s` : "");
    L.push(`Verifiers${host ? ` (${host})` : ""}: ${lenses.map((l) => `${l.name}${settingLabel(l) ? ` [${settingLabel(l)}]` : ""} (${l.ok ? "answered" : `no answer: ${l.error}`}${secs(l.durationMs)})`).join(", ")}`, "");
  }
  if (summary) L.push("## Builder summary", "", summary, "");
  if (result.problems.length) L.push("## Problems", "", ...result.problems.map((p) => `- ${p}`), "");
  L.push("## Expectations", "");
  for (const e of result.expectations) {
    L.push(`### [${e.id}] ${e.text}`, "", `- Result: **${e.result}**`, `- Verify: ${e.kind ?? "?"}${e.ref ? ` | ${e.ref}` : ""}`);
    for (const c of e.claims) L.push(`- Builder evidence: ${c.kind}: ${c.ref}${c.note ? ` (${c.note})` : ""}`);
    if (e.evidence) L.push(`- Verifier: ${e.evidence}`);
    L.push("");
  }
  if (result.failures.length) {
    L.push("## Failure conditions", "");
    for (const f of result.failures) L.push(`- [${f.id}] ${f.triggered ? "**TRIGGERED**" : f.checked ? "not triggered" : "not checked"}${f.evidence ? `: ${f.evidence}` : ""}`);
    L.push("");
  }
  if (result.constraints.length) {
    L.push("## Constraints", "");
    for (const c of result.constraints) L.push(`- [${c.id}] ${c.violated ? "**VIOLATED**" : c.checked ? "respected" : "not checked"}${c.evidence ? `: ${c.evidence}` : ""}`);
    L.push("");
  }
  L.push("## Checks", "");
  if (!commandResults.length) L.push("(no verify.commands configured)");
  for (const r of commandResults) {
    L.push(r.skipped ? `- \`${r.command}\`: skipped (an earlier step failed)` : `- \`${r.command}\`: exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}, ${(r.durationMs / 1000).toFixed(1)}s`);
  }
  L.push("", "## Files changed since approval", "", files.length ? files.map((f) => `- ${f}`).join("\n") : "(none detected)", "");
  if (result.notes) L.push("## Verifier notes", "", result.notes, "");
  return L.join("\n");
}

export function writeReports(root, id, report) {
  const paths = unitPaths(root, id);
  fs.writeFileSync(paths.verify, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.evidence, renderEvidence(report), "utf8");
  return paths;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function missingEvidence(unit, evidence) {
  return unit.parsed.expectations.filter((e) => !(evidence ?? []).some((x) => String(x?.expectation ?? "").toUpperCase() === e.id)).map((e) => e.id);
}

/** Stage 1: run checks and build one prompt per verifier lens. */
export async function prepareVerification({ root, unit, ancestorUnits = [], config, summary = "", evidence = [], signal, onProgress, host = null, defaultModel = null, defaultEffort = null }) {
  const commandResults = await runCommands(root, config.verify?.commands ?? [], {
    timeoutSec: config.verify?.timeoutSec ?? 900, signal, onProgress, parallel: config.verify?.parallel !== false,
  });
  const files = changedFiles(root, unit.parsed.frontmatter.base_ref);
  const independent = config.verify?.independent !== false;
  const lenses = [];
  if (independent && !missingEvidence(unit, evidence).length) {
    const rubric = readRubric();
    pickLenses(unit, config).forEach((name, i) => {
      lenses.push({ name, ...lensSetting(config, i, host, { model: defaultModel, effort: defaultEffort }), prompt: buildVerifierPrompt({ unit, ancestorUnits, summary, evidence, commandResults, files, rubric, lens: name }) });
    });
  }
  return { commandResults, files, lenses, independent };
}

/** Stage 2: combine verifier answers into a verdict and write evidence.md + verify.json. */
export function finishVerification({ root, unit, ancestorUnits = [], summary = "", evidence = [], attempt = 1, commandResults, files, independent = true, lensResults = [], host = null }) {
  const answered = lensResults.filter((l) => l.verifier);
  const errors = lensResults.filter((l) => !l.verifier).map((l) => `${l.name}: ${l.error ?? "no answer"}`);
  const merged = mergeVerifierReports(answered.map((l) => ({ ...l.verifier, lens: l.name })));
  const verifierError = errors.length ? errors.join("; ") : null;
  const result = computeVerdict({ unit, ancestorUnits, evidence, commandResults, verifier: merged, verifierError, independent });
  if (merged && errors.length) {
    result.needsHuman = true;
    result.notes = [result.notes, `Some verifiers did not answer (${verifierError}); a human should review.`].filter(Boolean).join("\n");
  }
  const report = {
    id: unit.parsed.frontmatter.id, title: unit.parsed.title, attempt, ts: nowIso(), summary, evidence, files,
    commandResults: commandResults.map(({ output, ...r }) => r), // full output went to the verifiers; reports keep the tail
    host, lenses: lensResults.map((l) => ({ name: l.name, model: l.model ?? null, effort: l.effort ?? null, ok: Boolean(l.verifier), error: l.verifier ? null : (l.error ?? "no answer"), durationMs: l.durationMs ?? null })),
    result, verdict: result.verdict,
  };
  writeReports(root, report.id, report);
  return report;
}

/**
 * Full verification of a unit in `verifying`: checks, then verifiers in parallel through `agent`, then the verdict.
 * host: optional label for reports and legacy per-host config maps. defaultModel/defaultEffort: what verifiers use
 * when verify.model is not set (for example the host's session model). runVerifierImpl replaces runVerifier (tests).
 */
export async function verifyUnit({ root, unit, ancestorUnits = [], config, summary = "", evidence = [], attempt = 1, signal, onProgress, agent, host = null, runVerifierImpl = runVerifier, defaultModel = null, defaultEffort = null }) {
  const prep = await prepareVerification({ root, unit, ancestorUnits, config, summary, evidence, signal, onProgress, host, defaultModel, defaultEffort });
  let lensResults = [];
  if (prep.lenses.length) {
    if (typeof agent !== "function" && runVerifierImpl === runVerifier) {
      lensResults = prep.lenses.map((l) => ({ name: l.name, model: l.model, effort: l.effort, verifier: null, error: "no agent available to run the verifier" }));
    } else {
      onProgress?.(prep.lenses.length > 1
        ? `${prep.lenses.length} independent verifiers are checking the work in parallel (${prep.lenses.map((l) => l.name).join(", ")})`
        : "Independent verifier is checking the work");
      lensResults = await Promise.all(prep.lenses.map(async (l) => {
        const started = Date.now();
        const out = await runVerifierImpl({ root, prompt: l.prompt, config, signal, agent, host, model: l.model, effort: l.effort, lens: l.name });
        return { name: l.name, model: l.model, effort: l.effort, verifier: out?.verifier ?? null, error: out?.error ?? null, durationMs: Date.now() - started };
      }));
    }
  }
  return finishVerification({ root, unit, ancestorUnits, summary, evidence, attempt, ...prep, lensResults, host });
}

/** Move a verified unit on: done (maybe auto-accepted), back to building, or blocked. */
export function applyVerdict(root, id, report, config, attempt) {
  const fm = readUnit(root, id).parsed.frontmatter;
  const r = report.result;
  appendMetric(root, { id, event: "verify", result: r.verdict, attempt, independent: r.independent, risk: fm.risk, autonomy: fm.autonomy });
  if (r.verdict === "pass") {
    transition(root, id, "done", { attempts: attempt });
    const eff = effectiveAutonomy(fm, config);
    if (eff >= 2 && !r.needsHuman && acceptUnit(root, id, { auto: true }).ok) {
      if (getActive(root) === id) setActive(root, null);
      return { outcome: "accepted", attempt, autonomy: eff };
    }
    return { outcome: "done", attempt, autonomy: eff };
  }
  if (attempt >= config.verify.maxAttempts) {
    transition(root, id, "blocked", { attempts: attempt });
    appendMetric(root, { id, event: "escalation", kind: "stuck", risk: fm.risk, autonomy: fm.autonomy });
    return { outcome: "blocked", attempt };
  }
  transition(root, id, "building", { attempts: attempt });
  return { outcome: "retry", attempt };
}

/** Submit a building unit: verify it and apply the verdict. */
export async function submitUnit({ root, id, summary = "", evidence = [], signal, onProgress, agent, host = null, runVerifierImpl, defaultModel = null, defaultEffort = null }) {
  const unit = readUnit(root, id);
  const fm = unit.parsed.frontmatter;
  if (fm.status !== "building") throw new Error(`${id} is ${fm.status}; only a building unit can be submitted.`);
  const missing = missingEvidence(unit, evidence);
  if (missing.length) return { outcome: "missing-evidence", missing };
  const config = loadConfig(root);
  const attempt = (fm.attempts ?? 0) + 1;
  transition(root, id, "verifying");
  let report;
  try {
    report = await verifyUnit({
      root, unit: readUnit(root, id), ancestorUnits: ancestors(root, id), config, summary, evidence, attempt,
      signal, onProgress, agent, host, runVerifierImpl, defaultModel, defaultEffort,
    });
  } catch (error) {
    transition(root, id, "building");
    throw new Error(`Verification could not run: ${error?.message ?? error}. The unit is back in building.`);
  }
  return { ...applyVerdict(root, id, report, config, attempt), report };
}

