// ICED verification: run checks, ask independent verifiers to try to break the work, decide the verdict,
// and write evidence.md + verify.json. Zero dependencies; shared by the pi extension and the CLI.

import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  PACKAGE_ROOT, acceptUnit, ancestors, appendMetric, effectiveAutonomy, getActive, git, loadConfig, nowIso,
  normalizeDir, readUnit, setActive, splitEffort, transition, unitPaths, verifyEffort, verifyModels,
} from "./iced-core.mjs";

const TAIL = 4000;
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
      results.push({ command, exitCode: r.exitCode, durationMs: r.durationMs, timedOut: r.timedOut, tail: tail(r.output) });
      failed = r.exitCode !== 0;
    }
    return results;
  };
  return (await Promise.all(commandGroups(commands, parallel).map(runGroup))).flat();
}

export function changedFiles(root, baseRef) {
  const lines = [];
  const diff = baseRef ? git(root, ["diff", "--name-only", baseRef]) : git(root, ["diff", "--name-only", "HEAD"]);
  if (diff) lines.push(...diff.split(/\r?\n/));
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked) lines.push(...untracked.split(/\r?\n/));
  return [...new Set(lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("intent/") && !l.startsWith(".iced/")))].sort();
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
    path.join(PACKAGE_ROOT, "skills", "iced", "references", "rubric.md"),
    path.join(PACKAGE_ROOT, "rubric.md"),
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
  expectations: "The expectations. For each [E#], run the referenced test or check yourself and try to demonstrate it for real, including edge cases the builder may have skipped.",
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
 * Model and effort for the index-th verifier. The model is verify.model for this runner (a list is rotated), else
 * fallback.model. Effort: the model's :level suffix, then verify.effort for this runner, then fallback.effort.
 */
export function lensSetting(config, index, runnerName = null, fallback = {}) {
  const list = verifyModels(config, runnerName);
  const s = list.length ? splitEffort(list[index % list.length]) : splitEffort(fallback.model);
  return { model: s.model, effort: s.effort ?? verifyEffort(config, runnerName) ?? fallback.effort ?? null };
}

export function lensModel(config, index, runnerName = null, fallback = null) {
  return lensSetting(config, index, runnerName, { model: fallback }).model;
}

/** "model, effort high" for reports; notes when the runner cannot set effort. */
export function settingLabel(l) {
  const effort = l.effort ? `effort ${l.effort}${l.effortIgnored ? " (not supported by this runner)" : ""}` : "";
  return [l.model, effort].filter(Boolean).join(", ");
}

export function buildVerifierPrompt({ unit, ancestorUnits = [], summary, evidence, commandResults, files, rubric, lens = "full" }) {
  const { constraints, failures } = collectRules(unit, ancestorUnits);
  const e = unit.parsed.expectations;
  const ev = (id) => evidence.filter((x) => String(x.expectation).toUpperCase() === id);
  const lines = [
    "You are the independent ICED verifier. Another agent built the change below and claims it is done.",
    "Your job is to try to prove that it is NOT done. Treat every claim as unverified until you have checked it yourself",
    "by reading code and running read-only commands (tests, linters, builds). Do not modify, create or delete files.",
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
    lines.push(r.skipped ? `- \`${r.command}\` skipped (an earlier step failed)` : `- \`${r.command}\` exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n\n\`\`\`text\n${tail(r.tail, 1500)}\n\`\`\``);
  }
  lines.push("", "## Files changed since approval", files.length ? files.map((f) => `- ${f}`).join("\n") : "(none detected, or no git)", "");
  if (rubric) lines.push("## Rubric", "", rubric.trim(), "");
  lines.push(
    "## What to check",
    "1. Each expectation: is it actually met? Run the referenced test or check when possible. Expectations of kind",
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

const byId = (list, id) => (Array.isArray(list) ? list.find((x) => String(x?.id ?? "").toUpperCase() === id.toUpperCase()) : undefined);

/** Merge answers from parallel verifiers: any fail, trigger or violation wins; pass beats unknown. */
export function mergeVerifierReports(reports) {
  const list = (reports ?? []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
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
    failures: merge("failures", (a, b) => a.triggered === true && b.triggered !== true),
    constraints: merge("constraints", (a, b) => a.violated === true && b.violated !== true),
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

  const failureResults = failures.map((f) => {
    const v = haveVerifier ? byId(verifier.failures, f.id) : undefined;
    const triggered = v?.triggered === true;
    if (triggered) problems.push(`Failure condition [${f.id}] triggered: ${v?.evidence ?? ""}`);
    return { ...f, triggered, checked: Boolean(v), evidence: v?.evidence ?? "" };
  });
  const constraintResults = constraints.map((c) => {
    const v = haveVerifier ? byId(verifier.constraints, c.id) : undefined;
    const violated = v?.violated === true;
    if (violated) problems.push(`Constraint [${c.id}] violated: ${v?.evidence ?? ""}`);
    return { ...c, violated, checked: Boolean(v), evidence: v?.evidence ?? "" };
  });
  const outOfScope = haveVerifier && Array.isArray(verifier.outOfScope)
    ? verifier.outOfScope.filter((x) => typeof x === "string" && x.trim() && !/^path or change/i.test(x)) : [];
  for (const x of outOfScope) problems.push(`Out of scope: ${x}`);
  if (haveVerifier && verifier.verdict === "fail" && !problems.length) problems.push(`Verifier failed the unit: ${verifier.notes ?? "no detail"}`);

  const verdict = problems.filter((p) => !p.startsWith("Independent verifier unavailable")).length ? "fail" : "pass";
  return {
    verdict, independent: haveVerifier, needsHuman, commandsOk, problems,
    expectations, failures: failureResults, constraints: constraintResults, outOfScope,
    notes: haveVerifier ? String(verifier.notes ?? "") : "",
  };
}

// ---------------------------------------------------------------------------
// Agent runners: which coding-agent CLI runs a verifier (or test writer)
// ---------------------------------------------------------------------------

export const SHELL_TOOL = process.platform === "win32" ? "powershell" : "bash";

/**
 * Headless presets. Placeholders: {instruction} (a short "read this prompt file" message), {prompt} (prompt file,
 * relative to the repo root), {output} (file for the final answer), {model}, {effort}; {modelArgs} and {effortArgs}
 * expand only when a model or effort is set. effortMap translates ICED levels to the CLI's own names. Runners
 * without effortArgs ignore effort (cursor-agent puts it in the model name, e.g. gpt-5.3-codex-high). pi is handled
 * separately so it can attach the prompt and restrict tools.
 */
export const RUNNERS = {
  pi: { command: "pi" },
  claude: {
    command: "claude",
    args: ["-p", "{instruction}", "--permission-mode", "dontAsk", "--allowedTools", "Read,Grep,Glob,Bash", "--disallowedTools", "Edit,Write,NotebookEdit", "{modelArgs}", "{effortArgs}"],
    modelArgs: ["--model", "{model}"],
    effortArgs: ["--effort", "{effort}"],
    effortMap: { off: "low", minimal: "low" },
  },
  codex: {
    command: "codex",
    args: ["exec", "--sandbox", "read-only", "-o", "{output}", "{modelArgs}", "{effortArgs}", "{instruction}"],
    modelArgs: ["-m", "{model}"],
    effortArgs: ["-c", "model_reasoning_effort={effort}"],
    effortMap: { off: "minimal", max: "xhigh" },
  },
  cursor: { command: "cursor-agent", args: ["-p", "--trust", "--output-format", "text", "--mode", "plan", "{modelArgs}", "{instruction}"], modelArgs: ["--model", "{model}"] },
  gemini: { command: "gemini", args: ["{modelArgs}", "-p", "{instruction}"], modelArgs: ["-m", "{model}"] },
};
export const RUNNER_ORDER = ["pi", "claude", "codex", "cursor", "gemini"];

const WIN_EXTS = [".exe", ".cmd", ".bat", ".ps1"];

export function findOnPath(name) {
  const dirs = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" && !path.extname(name) ? WIN_EXTS : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

const winQuote = (a) => (/^[\w@+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** How to spawn a command with arguments safely, including Windows .cmd and .ps1 shims. */
export function spawnSpec(command, args) {
  if (process.platform !== "win32") return { command, args, verbatim: false };
  const found = path.isAbsolute(command) ? command : (findOnPath(command) ?? command);
  const ext = path.extname(found).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[found, ...args].map(winQuote).join(" ")}"`], verbatim: true };
  }
  if (ext === ".ps1") return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", found, ...args], verbatim: false };
  return { command: found, args, verbatim: false };
}

/**
 * Pick the agent CLI for verifiers: ICED_RUNNER env, then verify.runner, then (for "auto") the host we run in,
 * then the first CLI found on PATH. Returns null when none is available.
 */
export function resolveRunner(config, { env = process.env, inPi = false, has = (c) => Boolean(findOnPath(c)) } = {}) {
  const want = env.ICED_RUNNER || config?.verify?.runner || "auto";
  if (want && typeof want === "object") return { name: "custom", ...want };
  const make = (name) => ({ name, ...RUNNERS[name], self: name === "pi" && inPi });
  if (want !== "auto") {
    if (!RUNNERS[want]) throw new Error(`Unknown verify.runner "${want}". Use auto, ${RUNNER_ORDER.join(", ")}, or {"command": ..., "args": [...]}.`);
    return make(want);
  }
  if (inPi) return make("pi");
  if (env.CLAUDECODE) return make("claude");
  if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return make("codex");
  for (const name of RUNNER_ORDER) if (has(RUNNERS[name].command)) return make(name);
  return null;
}

/** The runner's name for an effort level, or null when the runner cannot set effort (pi takes every level). */
export function runnerEffort(runner, effort) {
  if (!effort) return null;
  if (!runner || runner.name === "pi") return effort;
  if (!runner.effortArgs && !(runner.args ?? []).some((a) => a.includes("{effort}"))) return null;
  return runner.effortMap?.[effort] ?? effort;
}

export function runnerArgs(runner, { instruction, prompt, output, model, effort }) {
  const vars = { instruction, prompt, output, model: model ?? "", effort: effort ?? "" };
  const sub = (s) => String(s).replace(/\{(instruction|prompt|output|model|effort)\}/g, (_, k) => vars[k] ?? "");
  const args = [];
  for (const a of runner.args ?? []) {
    if (a === "{modelArgs}") { if (model) args.push(...(runner.modelArgs ?? []).map(sub)); continue; }
    if (a === "{effortArgs}") { if (effort) args.push(...(runner.effortArgs ?? []).map(sub)); continue; }
    args.push(sub(a));
  }
  if (!(runner.args ?? []).some((a) => /\{(instruction|prompt)\}/.test(a))) args.push(instruction);
  return args;
}

/** How to start pi again from inside a running pi process. */
export function piInvocation(args) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/") && fs.existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  const exe = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(exe)) return { command: process.execPath, args };
  return { command: "pi", args };
}

function tempDir(root, role) {
  const dir = path.join(root, ".iced", "tmp", `${role}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const relPath = (root, p) => path.relative(root, p).split(path.sep).join("/");

/** Run a one-shot child agent on a prompt. The prompt lives in .iced/tmp so any agent can read it. */
export async function runAgent({ root, prompt, role, runner, model, effort = null, tools, timeoutSec, signal, invocation = piInvocation }) {
  const dir = tempDir(root, role);
  const promptFile = path.join(dir, "prompt.md");
  const output = path.join(dir, "answer.md");
  fs.writeFileSync(promptFile, prompt, "utf8");
  const rel = relPath(root, promptFile);
  const readOnly = role === "verifier" ? " Do not modify, create or delete any files." : "";
  const instruction = `Read the file ${rel} (relative to the repository root) and follow its instructions exactly.${readOnly}`;
  let inv;
  if (!runner || runner.name === "pi") {
    const args = ["-p", "--no-session", "--tools", tools.join(",")];
    if (model) args.push("--model", model);
    if (effort) args.push("--thinking", effort);
    args.push(`@${promptFile}`, "Follow the attached instructions exactly.");
    inv = !runner || runner.self ? invocation(args) : { command: "pi", args };
  } else {
    inv = { command: runner.command, args: runnerArgs(runner, { instruction, prompt: rel, output, model, effort: runnerEffort(runner, effort) }) };
  }
  const spec = spawnSpec(inv.command, inv.args);
  try {
    const r = await runProcess(spec.command, spec.args, {
      cwd: root, timeoutSec, signal, verbatim: spec.verbatim, env: { ...process.env, ICED_ROLE: role },
    });
    let text = r.stdout;
    try { const o = fs.readFileSync(output, "utf8"); if (o.trim()) text = o; } catch { /* runner prints to stdout */ }
    return { ok: r.exitCode === 0, text, output: r.output, exitCode: r.exitCode, timedOut: r.timedOut };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

/** Backwards-compatible pi-only child. */
export function runChildPi(opts) {
  return runAgent({ ...opts, runner: null });
}

export async function runVerifier({ root, prompt, config, signal, invocation, runner, model, effort }) {
  const set = model === undefined ? lensSetting(config, 0, runner?.name ?? null) : { model, effort: effort ?? null };
  const r = await runAgent({
    root, prompt, role: "verifier", runner, tools: ["read", "grep", "find", "ls", SHELL_TOOL],
    model: set.model, effort: set.effort, timeoutSec: config.verify?.timeoutSec ?? 900, signal, invocation,
  });
  const oneLine = (s) => String(s).replace(/[\s\u2022\u26a0]+/g, " ").trim();
  if (!r.ok) return { verifier: null, error: r.timedOut ? "verifier timed out" : `verifier exited ${r.exitCode}: ${oneLine(tail(r.output, 400))}`, raw: r.output };
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

export async function runTestWriter({ root, unit, ancestorUnits, config, signal, invocation, defaultModel = null, defaultEffort = null }) {
  const s = splitEffort(config.build?.testWriterModel || defaultModel);
  return runChildPi({
    root, prompt: buildTestWriterPrompt({ unit, ancestorUnits }), role: "test-writer",
    tools: ["read", "grep", "find", "ls", "write", "edit", SHELL_TOOL], model: s.model,
    effort: s.effort ?? config.build?.testWriterEffort ?? defaultEffort ?? null,
    timeoutSec: config.verify?.timeoutSec ?? 900, signal, invocation,
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function renderEvidence({ id, title, attempt, result, summary, files, commandResults, ts, lenses = [], runner = null }) {
  const L = [`# Evidence: ${id}`, "", `${title ?? ""}`.trim(), "",
    `Verdict: **${result.verdict.toUpperCase()}** (attempt ${attempt}, ${ts}, independent verifier: ${result.independent ? "yes" : "no"}${result.needsHuman ? ", needs human review" : ""})`, ""];
  if (lenses.length) {
    const secs = (ms) => (ms ? `, ${(ms / 1000).toFixed(0)}s` : "");
    L.push(`Verifiers${runner ? ` (${runner})` : ""}: ${lenses.map((l) => `${l.name}${settingLabel(l) ? ` [${settingLabel(l)}]` : ""} (${l.ok ? "answered" : `no answer: ${l.error}`}${secs(l.durationMs)})`).join(", ")}`, "");
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
export async function prepareVerification({ root, unit, ancestorUnits = [], config, summary = "", evidence = [], signal, onProgress, runnerName = null, defaultModel = null, defaultEffort = null }) {
  const commandResults = await runCommands(root, config.verify?.commands ?? [], {
    timeoutSec: config.verify?.timeoutSec ?? 900, signal, onProgress, parallel: config.verify?.parallel !== false,
  });
  const files = changedFiles(root, unit.parsed.frontmatter.base_ref);
  const independent = config.verify?.independent !== false;
  const lenses = [];
  if (independent && !missingEvidence(unit, evidence).length) {
    const rubric = readRubric();
    pickLenses(unit, config).forEach((name, i) => {
      lenses.push({ name, ...lensSetting(config, i, runnerName, { model: defaultModel, effort: defaultEffort }), prompt: buildVerifierPrompt({ unit, ancestorUnits, summary, evidence, commandResults, files, rubric, lens: name }) });
    });
  }
  return { commandResults, files, lenses, independent };
}

/** Stage 2: combine verifier answers into a verdict and write evidence.md + verify.json. */
export function finishVerification({ root, unit, ancestorUnits = [], summary = "", evidence = [], attempt = 1, commandResults, files, independent = true, lensResults = [], runner = null }) {
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
    id: unit.parsed.frontmatter.id, title: unit.parsed.title, attempt, ts: nowIso(), summary, evidence, files, commandResults,
    runner, lenses: lensResults.map((l) => ({ name: l.name, model: l.model ?? null, effort: l.effort ?? null, effortIgnored: Boolean(l.effortIgnored), ok: Boolean(l.verifier), error: l.verifier ? null : (l.error ?? "no answer"), durationMs: l.durationMs ?? null })),
    result, verdict: result.verdict,
  };
  writeReports(root, report.id, report);
  return report;
}

/** Full verification of a unit in `verifying`: checks, then verifiers in parallel, then the verdict. */
export async function verifyUnit({ root, unit, ancestorUnits = [], config, summary = "", evidence = [], attempt = 1, signal, onProgress, invocation, runner, runVerifierImpl = runVerifier, defaultModel = null, defaultEffort = null }) {
  const r = config.verify?.independent === false ? null : runner === undefined ? resolveRunner(config) : runner;
  const runnerName = r?.name ?? null;
  const isPi = runnerName === "pi";
  const prep = await prepareVerification({
    root, unit, ancestorUnits, config, summary, evidence, signal, onProgress, runnerName,
    defaultModel: isPi ? defaultModel : null, defaultEffort: isPi ? defaultEffort : null,
  });
  for (const l of prep.lenses) if (l.effort && r && !runnerEffort(r, l.effort)) l.effortIgnored = true;
  let lensResults = [];
  if (prep.lenses.length) {
    if (!r && runVerifierImpl === runVerifier) {
      lensResults = prep.lenses.map((l) => ({ name: l.name, model: l.model, effort: l.effort, verifier: null, error: "no agent CLI found to run the verifier (set verify.runner)" }));
    } else {
      onProgress?.(prep.lenses.length > 1
        ? `${prep.lenses.length} independent verifiers are checking the work in parallel (${prep.lenses.map((l) => l.name).join(", ")})`
        : "Independent verifier is checking the work");
      lensResults = await Promise.all(prep.lenses.map(async (l) => {
        const started = Date.now();
        const out = await runVerifierImpl({ root, prompt: l.prompt, config, signal, invocation, runner: r, model: l.model, effort: l.effort, lens: l.name });
        return { name: l.name, model: l.model, effort: l.effort, effortIgnored: l.effortIgnored, verifier: out?.verifier ?? null, error: out?.error ?? null, durationMs: Date.now() - started };
      }));
    }
  }
  return finishVerification({ root, unit, ancestorUnits, summary, evidence, attempt, ...prep, lensResults, runner: runnerName });
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

/** Submit a building unit: verify it and apply the verdict. Shared by iced_submit and `iced verify`. */
export async function submitUnit({ root, id, summary = "", evidence = [], signal, onProgress, invocation, runner, runVerifierImpl, defaultModel = null, defaultEffort = null }) {
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
      signal, onProgress, invocation, runner, runVerifierImpl, defaultModel, defaultEffort,
    });
  } catch (error) {
    transition(root, id, "building");
    throw new Error(`Verification could not run: ${error?.message ?? error}. The unit is back in building.`);
  }
  return { ...applyVerdict(root, id, report, config, attempt), report };
}

// ---------------------------------------------------------------------------
// Split mode for hosts with their own subagents (Claude Code, Codex)
// ---------------------------------------------------------------------------

export function splitDir(root, id) { return path.join(root, ".iced", "tmp", `verify-${id}`); }

/** The agent hosting split mode (for its per-runner model settings): Claude Code, Codex, or verify.runner. */
function hostRunnerName(config, env = process.env) {
  if (env.CLAUDECODE) return "claude";
  if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return "codex";
  const want = config?.verify?.runner;
  return typeof want === "string" && RUNNERS[want] ? want : null;
}

// ---------------------------------------------------------------------------
// Verifier subagent definitions for hosts that run their own subagents
// ---------------------------------------------------------------------------

const VERIFIER_ROLE = `You are an independent ICED verifier. You did not build this change and you do not trust the agent that did.

You are given a prompt file and an answer file (paths from \`node .iced/bin/iced.mjs verify <id> --prepare\`).

1. Read the prompt file and follow it exactly: try to prove the work is NOT done.
2. Check claims yourself: read the code, and run read-only commands such as the tests, linters, builds and git diff.
3. Never modify, create or delete any file other than the answer file.
4. Write your complete answer, ending with the fenced json block the prompt asks for, to the answer file.
   If you cannot write files, return that complete answer as your final message instead.
5. Reply with one line: the verdict and the answer file path.`;

const tomlString = (s) => `"""\n${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"""')}\n"""`;
const tomlQuote = (s) => JSON.stringify(String(s));

/**
 * Subagent files for Claude Code and Codex, with the first verifier model and the effort configured for that runner.
 * Returns { ".claude/agents/iced-verifier.md": text, ".codex/agents/iced-verifier.toml": text }.
 */
export function verifierAgentFiles(config) {
  const pick = (name) => {
    const s = lensSetting(config, 0, name);
    return { model: s.model, effort: runnerEffort({ name, ...RUNNERS[name] }, s.effort) };
  };
  const claude = pick("claude");
  const codex = pick("codex");
  return {
    ".claude/agents/iced-verifier.md": [
      "---",
      "name: iced-verifier",
      "description: Independent ICED verifier that tries to prove a building unit is NOT done. Use one per prompt printed by `node .iced/bin/iced.mjs verify <id> --prepare`, all in parallel, passing the prompt and answer paths. Never edits code.",
      "tools: Read, Grep, Glob, Bash, Write",
      ...(claude.model ? [`model: ${claude.model}`] : []),
      ...(claude.effort ? [`effort: ${claude.effort}`] : []),
      "---",
      "",
      VERIFIER_ROLE,
      "",
    ].join("\n"),
    ".codex/agents/iced-verifier.toml": [
      'name = "iced-verifier"',
      `description = "Independent ICED verifier: tries to prove a building unit is NOT done. One per prompt from 'node .iced/bin/iced.mjs verify <id> --prepare', run in parallel. Read-only."`,
      'sandbox_mode = "read-only"',
      ...(codex.model ? [`model = ${tomlQuote(codex.model)}`] : []),
      ...(codex.effort ? [`model_reasoning_effort = ${tomlQuote(codex.effort)}`] : []),
      `developer_instructions = ${tomlString(VERIFIER_ROLE)}`,
      "",
    ].join("\n"),
  };
}

/** Rewrite the subagent files that already exist (after the models change). Returns the files written. */
export function refreshVerifierAgents(root, config = loadConfig(root)) {
  const written = [];
  for (const [rel, text] of Object.entries(verifierAgentFiles(config))) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") === text) continue;
    fs.writeFileSync(file, text, "utf8");
    written.push(rel);
  }
  return written;
}

/**
 * Run checks and write one verifier prompt per lens to .iced/tmp/verify-<id>/. The host agent runs a read-only
 * iced-verifier subagent per prompt, saves each answer next to it, then calls finishSplit.
 */
export async function prepareSplit({ root, id, summary = "", evidence = [], signal, onProgress }) {
  const unit = readUnit(root, id);
  const fm = unit.parsed.frontmatter;
  if (!["building", "verifying"].includes(fm.status)) throw new Error(`${id} is ${fm.status}; only a building unit can be verified.`);
  const missing = missingEvidence(unit, evidence);
  if (missing.length) return { outcome: "missing-evidence", missing };
  const config = loadConfig(root);
  const attempt = (fm.attempts ?? 0) + 1;
  if (fm.status === "building") transition(root, id, "verifying");
  const ancestorUnits = ancestors(root, id);
  const host = hostRunnerName(config);
  const prep = await prepareVerification({ root, unit, ancestorUnits, config, summary, evidence, signal, onProgress, runnerName: host });
  if (!prep.lenses.length) {
    const report = finishVerification({ root, unit, ancestorUnits, summary, evidence, attempt, ...prep, lensResults: [] });
    return { ...applyVerdict(root, id, report, config, attempt), report };
  }
  const dir = splitDir(root, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const prompts = prep.lenses.map((l) => {
    const file = path.join(dir, `${l.name}.md`);
    fs.writeFileSync(file, l.prompt, "utf8");
    return { lens: l.name, model: l.model, effort: l.effort, prompt: relPath(root, file), answer: relPath(root, path.join(dir, `${l.name}.answer.md`)) };
  });
  const state = { id, attempt, host, summary, evidence, commandResults: prep.commandResults, files: prep.files, prompts };
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { outcome: "prepared", attempt, prompts, commandResults: prep.commandResults };
}

export function finishSplit({ root, id }) {
  const dir = splitDir(root, id);
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch {
    throw new Error(`No prepared verification for ${id}. Run: node .iced/bin/iced.mjs verify ${id} --prepare`);
  }
  const unit = readUnit(root, id);
  if (unit.parsed.frontmatter.status !== "verifying") throw new Error(`${id} is ${unit.parsed.frontmatter.status}, not verifying.`);
  const lensResults = state.prompts.map((p) => {
    let text = null;
    try { text = fs.readFileSync(path.join(root, p.answer), "utf8"); } catch { /* missing */ }
    const verifier = text == null ? null : parseVerifierOutput(text);
    return { name: p.lens, model: p.model, effort: p.effort, verifier, error: text == null ? `no answer file ${p.answer}` : verifier ? null : "answer had no JSON verdict block" };
  });
  const config = loadConfig(root);
  const report = finishVerification({
    root, unit, ancestorUnits: ancestors(root, id), summary: state.summary, evidence: state.evidence, attempt: state.attempt,
    commandResults: state.commandResults, files: state.files, independent: true, lensResults, runner: "host subagents",
  });
  const applied = applyVerdict(root, id, report, config, state.attempt);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...applied, report };
}
