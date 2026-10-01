#!/usr/bin/env node
// ICED CLI for humans, CI and agents without the pi extension.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import {
  acceptUnit, approveUnit, findRoot, lintIced, listUnits, readUnit, renderStats, renderStatus, resolveId,
  getActive, setActive, createUnit, normalizeDir, applyPromotion, loadConfig, transition, describeModels, setVerifyModels,
  setVerifyEffort, setTestWriterModel, setTestWriterEffort, markModelsAsked, EFFORTS, SPEC_VERSION,
} from "../lib/iced-core.mjs";

const HELP = `iced ${SPEC_VERSION} - Intent, Context, Expectations, Done

Usage: iced <command> [options]

  init [--targets a,b] [--force]   Set up .iced/, intent/ and agent discovery files
                                   targets: agents, claude, skills, cursor, copilot, gemini
  new <type> <title...>            Create a draft unit (type: feature|bug|project|review|chore)
        [--parent <id>] [--risk low|medium|high]
  list                             List units
  status [id]                      Show a unit (default: active)
  validate [--strict] [--json]     Lint every unit; exit 1 on errors (CI)
  approve <id> [--by name]         Human sign-off: freeze Intent + Expectations and start the build
        [--later]                  (--later: approve only; start later with: build <id>)
  build <id>                       Start (or resume) the build of an approved or blocked unit
  verify <id>                      Submit a building unit: run checks and independent verifiers in parallel,
        [--evidence file]          write evidence.md and move the status (done, building or blocked).
        [--runner name]            Evidence: intent/<id>/submission.json (default) as
                                   {"summary": "...", "evidence": [{"expectation": "E1", "kind": "test", "ref": "..."}]}
                                   Runner: auto, pi, claude, codex, cursor, gemini (default: verify.runner)
  verify <id> --prepare            Same checks, but write verifier prompts for your agent's own subagents
  verify <id> --finish             Combine the subagents' answer files into the verdict
  accept <id> [--by name]          Human acceptance of a done unit
  models                           Show the verifier and test writer models
  models set <model...>            Verifier model(s); several are rotated across the parallel verifiers
        [--runner name]            Only for one runner (pi, claude, codex, cursor, gemini); they name models differently
  models effort <level|clear>      Verifier effort: ${EFFORTS.join(", ")} (a model's :level suffix wins)
  models clear                     Use the agent's default model again
  models test-writer <model|clear> Model for the isolated test writer (runs in pi) [--effort level]
  models list [runner]             List the models a runner's CLI offers
  activate <id> | --clear          Set or clear the active unit
  stats [--apply]                  Metrics and autonomy promotion suggestions
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function requireRoot() {
  const root = findRoot(process.cwd());
  if (!root) {
    console.error("No .iced/ found. Run: iced init");
    process.exit(2);
  }
  return root;
}

function requireUnit(root, ref) {
  const id = resolveId(root, ref) ?? (ref ? null : getActive(root));
  if (!id) {
    console.error(ref ? `Unknown unit: ${ref}` : "No unit given and no active unit.");
    process.exit(2);
  }
  return id;
}

function readSubmission(root, id) {
  const file = typeof flags.evidence === "string" ? path.resolve(flags.evidence) : path.join(root, "intent", id, "submission.json");
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
    console.error(`Cannot read evidence from ${path.relative(root, file) || file}: ${error.message}\n`
      + 'Write it as {"summary": "what changed", "evidence": [{"expectation": "E1", "kind": "test", "ref": "test name or command", "note": "optional"}]}');
    process.exit(2);
  }
  const evidence = Array.isArray(data) ? data : data?.evidence;
  if (!Array.isArray(evidence)) { console.error(`${file}: "evidence" must be a list.`); process.exit(2); }
  return { summary: typeof flags.summary === "string" ? flags.summary : String(data?.summary ?? ""), evidence };
}

function printVerify(root, id, res, maxAttempts) {
  if (res.outcome === "missing-evidence") {
    console.error(`Evidence is missing for ${res.missing.join(", ")}. Meet those expectations and add evidence for every one.`);
    return 1;
  }
  const r = res.report.result;
  const next = {
    accepted: `auto-accepted (autonomy ${res.autonomy}).`,
    done: `done. The human reviews intent/${id}/evidence.md and runs: node .iced/bin/iced.mjs accept ${id}`,
    retry: `back to building (attempt ${res.attempt} of ${maxAttempts}). Fix the problems below, update the evidence and run verify again.`,
    blocked: `blocked after ${res.attempt} failed attempts. Stop and tell the human what is failing.`,
  }[res.outcome];
  console.log(`${id}: ${r.verdict.toUpperCase()}${r.independent ? "" : " (no independent verifier)"}${r.needsHuman && r.verdict === "pass" ? ", needs human review" : ""} -> ${next}`);
  for (const p of r.problems) console.log(`  - ${p}`);
  for (const l of res.report.lenses ?? []) if (!l.ok) console.log(`  verifier ${l.name}: ${l.error}`);
  console.log(`Evidence: ${path.relative(root, path.join(root, "intent", id, "evidence.md")).split(path.sep).join("/")}`);
  return res.outcome === "accepted" || res.outcome === "done" ? 0 : 1;
}

const MODEL_HINTS = {
  pi: "provider/model[:effort], as in pi --list-models",
  claude: "opus, sonnet, haiku or a full Claude model name",
  codex: "a model name from codex's /model list",
  cursor: "a name from cursor-agent models, e.g. gpt-5.3-codex-high",
  gemini: "a Gemini model name, e.g. gemini-2.5-pro",
};
const LIST_MODELS = { pi: ["pi", ["--list-models"]], cursor: ["cursor-agent", ["models"]] };

async function loadVerify() {
  try { return await import("../lib/iced-verify.mjs"); } catch { return null; }
}

function printModels(root, v, written = []) {
  console.log(describeModels(loadConfig(root)));
  for (const f of written) console.log(`  updated  ${f}`);
}

/** After init in a terminal: ask once for the verifier models of the runner that will be used. */
async function askModels(root) {
  const v = await loadVerify();
  const cfg = loadConfig(root);
  if (!v || cfg.verify.model != null) return;
  let runner = null;
  try { runner = v.resolveRunner(cfg); } catch { /* invalid runner: skip */ }
  if (!runner || runner.name === "custom") return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = await rl.question(`Verifier model(s) for ${runner.name} (${MODEL_HINTS[runner.name]}); comma-separated to rotate, Enter for the agent's default: `);
    const list = a.split(/[,\s]+/).filter(Boolean);
    if (!list.length) { markModelsAsked(root, runner.name); return; }
    setVerifyModels(root, list, runner.name);
    v.refreshVerifierAgents(root);
  } finally {
    rl.close();
  }
}

function printLint(lint) {
  for (const e of lint.errors) console.error(`  error   ${e.code}${e.line ? ` (line ${e.line})` : ""}: ${e.message}`);
  for (const w of lint.warnings) console.error(`  warning ${w.code}${w.line ? ` (line ${w.line})` : ""}: ${w.message}`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = positional;

switch (cmd) {
  case "init": {
    let initRepo;
    try { ({ initRepo } = await import("../lib/iced-init.mjs")); } catch {
      console.error("init needs the full pi-intent package (this is a vendored copy). Run it from the package: node <pi-intent>/bin/iced.mjs init");
      process.exit(2);
    }
    const targets = typeof flags.targets === "string" ? flags.targets.split(",").map((s) => s.trim()) : undefined;
    const r = initRepo(normalizeDir(process.cwd()), { targets, force: Boolean(flags.force) });
    console.log(`ICED initialized (targets: ${r.targets.join(", ")})`);
    for (const f of r.created) console.log(`  created  ${f}`);
    for (const f of r.updated) console.log(`  updated  ${f}`);
    if (process.stdin.isTTY && process.stdout.isTTY && !flags.yes) await askModels(normalizeDir(process.cwd()));
    console.log(describeModels(loadConfig(normalizeDir(process.cwd()))));
    console.log("Change with: node .iced/bin/iced.mjs models set <model...> [--runner name]");
    break;
  }
  case "models": {
    const root = requireRoot();
    const v = await loadVerify();
    const runnerName = typeof flags.runner === "string" ? flags.runner : null;
    const names = v ? v.RUNNER_ORDER : Object.keys(MODEL_HINTS);
    if (runnerName && !names.includes(runnerName)) { console.error(`Unknown runner "${runnerName}". Use: ${names.join(", ")}`); process.exit(2); }
    const [sub = "show", ...args] = rest;
    const values = args.flatMap((a) => a.split(",")).map((s) => s.trim()).filter(Boolean);
    try {
      switch (sub) {
        case "show": printModels(root, v); break;
        case "set":
          if (!values.length) { console.error("Usage: iced models set <model...> [--runner name]"); process.exit(2); }
          setVerifyModels(root, values, runnerName);
          if (!runnerName) console.error("Note: this applies to every runner. Agent CLIs name models differently; use --runner to set one.");
          printModels(root, v, v?.refreshVerifierAgents(root));
          break;
        case "effort":
          if (values.length !== 1) { console.error(`Usage: iced models effort <${EFFORTS.join("|")}|clear> [--runner name]`); process.exit(2); }
          setVerifyEffort(root, values[0] === "clear" ? null : values[0], runnerName);
          printModels(root, v, v?.refreshVerifierAgents(root));
          break;
        case "clear":
          setVerifyModels(root, [], runnerName);
          printModels(root, v, v?.refreshVerifierAgents(root));
          break;
        case "test-writer":
          if (values.length !== 1) { console.error("Usage: iced models test-writer <model|clear> [--effort level]"); process.exit(2); }
          setTestWriterModel(root, values[0] === "clear" ? null : values[0]);
          if (typeof flags.effort === "string") setTestWriterEffort(root, flags.effort === "clear" ? null : flags.effort);
          printModels(root, v);
          break;
        case "list": {
          const name = args[0] ?? runnerName ?? (v ? v.resolveRunner(loadConfig(root))?.name : null) ?? "pi";
          const cmd = LIST_MODELS[name];
          if (!cmd) { console.log(`${name} has no model list command here. Use ${MODEL_HINTS[name] ?? "the CLI's own model names"}.`); break; }
          const spec = v ? v.spawnSpec(cmd[0], cmd[1]) : { command: cmd[0], args: cmd[1], verbatim: false };
          const r = spawnSync(spec.command, spec.args, { stdio: "inherit", windowsVerbatimArguments: spec.verbatim, windowsHide: true });
          if (r.error) { console.error(`Could not run ${cmd[0]}: ${r.error.message}`); process.exitCode = 1; }
          else process.exitCode = r.status ?? 0;
          break;
        }
        default: console.error(`Unknown models command: ${sub}\n\n${HELP}`); process.exit(2);
      }
    } catch (error) {
      console.error(error?.message ?? String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "new": {
    const root = requireRoot();
    const [type, ...title] = rest;
    if (!type || !title.length) { console.error("Usage: iced new <type> <title...>"); process.exit(2); }
    const parent = flags.parent ? requireUnit(root, String(flags.parent)) : null;
    const { id, paths } = createUnit(root, { type, title: title.join(" "), parent, risk: flags.risk ?? "medium" });
    setActive(root, id);
    console.log(`Created ${path.relative(root, paths.iced)} (active)`);
    break;
  }
  case "list": console.log(renderStatus(requireRoot())); break;
  case "status": {
    const root = requireRoot();
    console.log(renderStatus(root, requireUnit(root, rest[0])));
    break;
  }
  case "validate": {
    const root = requireRoot();
    let errors = 0;
    let warnings = 0;
    const report = [];
    for (const u of listUnits(root)) {
      const unit = readUnit(root, u.id);
      const lint = lintIced(unit.parsed, "validate", unit.text);
      if (["done", "accepted"].includes(unit.parsed.frontmatter.status) && !fs.existsSync(unit.paths.evidence)) {
        lint.errors.push({ code: "evidence-missing", message: "No evidence.md for a done unit." });
      }
      errors += lint.errors.length;
      warnings += lint.warnings.length;
      report.push({ id: u.id, ...lint });
      if (!flags.json && (lint.errors.length || lint.warnings.length)) { console.error(u.id); printLint(lint); }
    }
    if (flags.json) console.log(JSON.stringify({ errors, warnings, units: report }, null, 2));
    else console.log(`${report.length} unit(s), ${errors} error(s), ${warnings} warning(s)`);
    process.exit(errors || (flags.strict && warnings) ? 1 : 0);
  }
  case "approve": {
    const root = requireRoot();
    const id = requireUnit(root, rest[0]);
    const startBuild = !flags.later;
    const r = approveUnit(root, id, { by: typeof flags.by === "string" ? flags.by : undefined, startBuild });
    if (!r.ok) { console.error(`Cannot approve ${id}:`); printLint(r.lint); process.exit(1); }
    printLint({ errors: [], warnings: r.lint.warnings });
    setActive(root, id);
    console.log(`Approved ${id}. Intent and Expectations are now frozen.${startBuild ? " Status building." : ` Start the build with: node .iced/bin/iced.mjs build ${id}`}`);
    break;
  }
  case "build": {
    const root = requireRoot();
    const id = requireUnit(root, rest[0]);
    const fm = readUnit(root, id).parsed.frontmatter;
    if (fm.status === "building") { setActive(root, id); console.log(`${id} is already building.`); break; }
    if (fm.status !== "approved" && fm.status !== "blocked") {
      console.error(`${id} is ${fm.status}; only approved or blocked units can be built.${fm.status === "draft" ? " The human signs it off first (approve)." : ""}`);
      process.exit(1);
    }
    transition(root, id, "building", fm.status === "blocked" ? { attempts: 0 } : {});
    setActive(root, id);
    console.log(`${id} is building.`);
    break;
  }
  case "verify": {
    const root = requireRoot();
    const id = requireUnit(root, rest[0]);
    let v;
    try { v = await import("../lib/iced-verify.mjs"); } catch {
      console.error("verify needs .iced/lib/iced-verify.mjs. Re-run init from the pi-intent package to update the vendored files.");
      process.exit(2);
    }
    const maxAttempts = loadConfig(root).verify.maxAttempts;
    const onProgress = (s) => console.error(`  ${s}`);
    try {
      if (flags.finish) { process.exitCode = printVerify(root, id, v.finishSplit({ root, id }), maxAttempts); break; }
      const sub = readSubmission(root, id);
      if (flags.prepare) {
        const res = await v.prepareSplit({ root, id, ...sub, onProgress });
        if (res.outcome !== "prepared") { process.exitCode = printVerify(root, id, res, maxAttempts); break; }
        const checks = res.commandResults.map((c) => `${c.command}: ${c.skipped ? "skipped" : `exit ${c.exitCode}`}`).join(", ") || "none configured";
        console.log(`Prepared ${res.prompts.length} verifier prompt(s) for ${id} (checks: ${checks}).`);
        console.log("Start one read-only iced-verifier subagent per prompt, all in parallel. Each reads its prompt file and writes its");
        console.log("complete answer, ending with the JSON block, to its answer file (if it cannot write, save its reply there unchanged):");
        for (const p of res.prompts) console.log(`  ${p.lens}: ${p.prompt} -> ${p.answer}${p.model || p.effort ? ` (${v.settingLabel(p)})` : ""}`);
        console.log(`Then run: node .iced/bin/iced.mjs verify ${id} --finish`);
        break;
      }
      const runner = v.resolveRunner(typeof flags.runner === "string" ? { verify: { runner: flags.runner } } : loadConfig(root));
      if (!runner) {
        console.error("No agent CLI found to run the independent verifiers (pi, claude, codex, cursor-agent or gemini).\n"
          + `Set verify.runner in .iced/config.json, pass --runner, or use your agent's subagents: verify ${id} --prepare`);
        process.exit(2);
      }
      console.error(`  Verifiers run with: ${runner.name}`);
      process.exitCode = printVerify(root, id, await v.submitUnit({ root, id, ...sub, onProgress, runner }), maxAttempts);
    } catch (error) {
      console.error(error?.message ?? String(error));
      process.exitCode = 1;
    }
    break;
  }
  case "accept": {
    const root = requireRoot();
    const id = requireUnit(root, rest[0]);
    const r = acceptUnit(root, id, { by: typeof flags.by === "string" ? flags.by : undefined });
    if (!r.ok) { console.error(`Cannot accept ${id}:`); printLint(r.lint); process.exit(1); }
    if (getActive(root) === id) setActive(root, null);
    console.log(`Accepted ${id}.`);
    break;
  }
  case "activate": {
    const root = requireRoot();
    if (flags.clear) { setActive(root, null); console.log("Active unit cleared."); break; }
    const id = requireUnit(root, rest[0]);
    setActive(root, id);
    console.log(`Active: ${id}`);
    break;
  }
  case "stats": {
    const root = requireRoot();
    const r = renderStats(root);
    console.log(r.text);
    if (flags.apply) for (const s of r.suggestions) { applyPromotion(root, s); console.log(`Applied: ${s.risk} -> autonomy ${s.to}`); }
    break;
  }
  case undefined: case "help": case "-h": case "--help": console.log(HELP); break;
  default: console.error(`Unknown command: ${cmd}\n\n${HELP}`); process.exit(2);
}
