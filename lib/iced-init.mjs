// ICED init: set up a repository so any coding agent (pi, Claude Code, Codex, Cursor, Copilot, Gemini, ...)
// can find and follow ICED units. Idempotent: safe to run repeatedly.

import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT, SPEC_VERSION, defaultConfig, loadConfig, TYPES } from "./iced-core.mjs";
import { verifierAgentFiles } from "./iced-verify.mjs";

export const TARGETS = ["agents", "claude", "codex", "skills", "cursor", "copilot", "gemini"];
export const DEFAULT_TARGETS = ["agents", "claude", "codex", "skills"];

const BEGIN = "<!-- ICED:BEGIN -->";
const END = "<!-- ICED:END -->";

/** Short instructions injected into every agent context file. Same text everywhere. */
export const MANAGED_BODY = `## ICED (Intent, Context, Expectations, Done)

This repository plans and delivers work as ICED units. Humans own the intent and the definition of done;
agents own how it gets built.

- If you have tools named \`iced_*\` (pi with the pi-intent extension), use them for every ICED step
  (\`iced_start\`, \`iced_request_signoff\`, \`iced_build\`, \`iced_submit\`...) instead of the manual steps below.
- Units live in \`intent/<id>/iced.md\`. The active unit id is in \`.iced/active\`.
- ICED applies while a unit is active: read it before changing code, and change code only while it is
  \`building\` (after sign-off). With no active unit, work normally, unless \`.iced/config.json\` has
  \`"gate": "always"\`: then every code change needs an approved unit.
- To start new work from a one-line request, follow \`.iced/ICED.md\` (or the \`iced\` skill): draft the unit,
  ask at most a few high-risk questions, then stop for human sign-off.
- Never edit the Intent or Expectations sections after approval, and never set \`status: approved\` or
  \`status: accepted\` yourself. Only the human (or the ICED tooling) does that.
- Build autonomously once approved (\`status: building\`). Record significant choices in \`intent/<id>/decisions.md\`.
  Stop and ask only for: ambiguity, a constraint/expectation conflict, a needed expectation change,
  an irreversible action, or being stuck.
- Finish: write \`intent/<id>/submission.json\` as \`{"summary": "...", "evidence": [{"expectation": "E1", "kind": "test", "ref": "..."}]}\`
  (one entry per expectation), then run \`node .iced/bin/iced.mjs verify <id>\`. It runs the checks and independent
  verifier agents in parallel, writes \`evidence.md\` and sets the status. Never set \`status: done\` or edit
  \`evidence.md\`/\`verify.json\` yourself. With your own subagents (Claude Code and Codex have an \`iced-verifier\`
  agent), run \`verify <id> --prepare\`, start one \`iced-verifier\` per printed prompt in parallel, then \`verify <id> --finish\`.
- Parent units' constraints and failure conditions apply to their children (\`parent:\` in frontmatter).
- CLI (Node, no install): \`node .iced/bin/iced.mjs status|list|validate|build|verify|models\`. Humans run \`approve <id>\`
  and \`accept <id>\`; an agent may run them only right after the human explicitly says so. Only humans change the
  verifier models (\`models set|effort|clear|test-writer\`).

Full protocol: \`.iced/ICED.md\`. Product memory: \`.iced/memory/\`.`;

export function upsertManagedBlock(text, body, { begin = BEGIN, end = END } = {}) {
  const block = `${begin}\n${body.trim()}\n${end}`;
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  const b = src.indexOf(begin);
  const e = src.indexOf(end);
  if (b >= 0 && e > b) return `${src.slice(0, b)}${block}${src.slice(e + end.length)}`;
  if (!src.trim()) return `${block}\n`;
  return `${src.replace(/\n*$/, "\n\n")}${block}\n`;
}

export function detectTargets(root) {
  const found = new Set(DEFAULT_TARGETS);
  const exists = (p) => fs.existsSync(path.join(root, p));
  if (exists(".cursor") || exists(".cursorrules")) found.add("cursor");
  if (exists(".github/copilot-instructions.md")) found.add("copilot");
  if (exists("GEMINI.md") || exists(".gemini")) found.add("gemini");
  return TARGETS.filter((t) => found.has(t));
}

function copyDir(src, dest, result, root) {
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, result, root);
    else writeFile(d, fs.readFileSync(s, "utf8"), { overwrite: true }, result, root);
  }
}

function writeFile(file, content, { overwrite }, result, root) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const existed = fs.existsSync(file);
  if (existed && !overwrite) { result.skipped.push(rel); return; }
  if (existed && fs.readFileSync(file, "utf8") === content) { result.skipped.push(rel); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  (existed ? result.updated : result.created).push(rel);
}

function upsertFile(file, body, result, root, opts) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  writeFile(file, upsertManagedBlock(current, body, opts), { overwrite: true }, result, root);
}

function ensureLine(file, line, result, root) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n") : "";
  if (current.split("\n").some((l) => l.trim() === line)) { result.skipped.push(path.relative(root, file).replace(/\\/g, "/")); return; }
  writeFile(file, `${current.replace(/\n*$/, current ? "\n" : "")}${line}\n`, { overwrite: true }, result, root);
}

const ONE_LINER_COMMAND = `---
description: Start or continue ICED work from one line (Intent, Context, Expectations, Done)
argument-hint: <what you want> | status | build | accept
---

Follow the ICED protocol in \`.iced/ICED.md\` for this request:

$ARGUMENTS

If the request is empty or "status", summarize units in \`intent/\` and the active unit in \`.iced/active\`.
Otherwise draft a new unit (or continue the active one), ask at most a few high-risk questions, and stop
for human sign-off before changing any code.
`;

const INTENT_README = `# intent/

Each folder is one ICED unit of work: \`<id>/iced.md\` (the human-owned contract), \`decisions.md\`
(agent decision log), \`evidence.md\` and \`verify.json\` (verification results).

Start work from one line with \`/iced <what you want>\` in pi, Claude Code or Cursor, or ask any agent to
"follow .iced/ICED.md for: <what you want>". See \`.iced/ICED.md\` for the full protocol.
`;

const PRODUCT_MEMORY = `# Product memory

<!-- What this product is, who uses it, and how it must behave. Agents read this as [product] context.
     Keep it short and factual; update it when a unit changes product behavior. -->

## Purpose

## Users

## Key behaviors and rules

## Non-functional expectations
`;

const KNOWLEDGE_MEMORY = `# Knowledge base

<!-- Org and team standards agents read as [knowledge] context: conventions, patterns, security and
     compliance rules. For enterprise use, list shared knowledge files in .iced/config.json memory.knowledge. -->

## Engineering standards

## Security and compliance

## Patterns to prefer / avoid
`;

const CURSOR_RULE = (body) => `---
description: ICED workflow (Intent, Context, Expectations, Done)
alwaysApply: true
---

${body}
`;

/** Test command to put in verify.commands for a new config, when one is obvious. */
export function detectVerifyCommands(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const test = pkg?.scripts?.test;
    if (typeof test === "string" && test.trim() && !/no test specified/.test(test)) return ["npm test"];
  } catch { /* not a node project */ }
  const has = (p) => fs.existsSync(path.join(root, p));
  if (has("Cargo.toml")) return ["cargo test"];
  if (has("go.mod")) return ["go test ./..."];
  if (has("pyproject.toml") || has("pytest.ini")) return ["python -m pytest -q"];
  return [];
}

export function initRepo(root, { targets, force = false, packageRoot = PACKAGE_ROOT } = {}) {
  const result = { created: [], updated: [], skipped: [] };
  const chosen = (targets && targets.length ? targets : detectTargets(root)).filter((t) => TARGETS.includes(t));
  const iced = path.join(root, ".iced");

  const base = defaultConfig();
  const config = { ...base, verify: { ...base.verify, commands: detectVerifyCommands(root) }, targets: chosen };
  writeFile(path.join(iced, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { overwrite: force }, result, root);

  const protocol = path.join(packageRoot, "skills", "iced", "references", "protocol.md");
  const protocolText = fs.existsSync(protocol) ? fs.readFileSync(protocol, "utf8") : `# ICED protocol ${SPEC_VERSION}\n\n${MANAGED_BODY}\n`;
  writeFile(path.join(iced, "ICED.md"), protocolText, { overwrite: true }, result, root);

  writeFile(path.join(iced, "memory", "product.md"), PRODUCT_MEMORY, { overwrite: false }, result, root);
  writeFile(path.join(iced, "memory", "knowledge.md"), KNOWLEDGE_MEMORY, { overwrite: false }, result, root);
  for (const type of TYPES) {
    const src = path.join(packageRoot, "spec", "templates", `${type}.md`);
    if (fs.existsSync(src)) writeFile(path.join(iced, "templates", `${type}.md`), fs.readFileSync(src, "utf8"), { overwrite: true }, result, root);
  }
  writeFile(path.join(root, "intent", "README.md"), INTENT_README, { overwrite: false }, result, root);
  for (const [from, to] of [
    ["bin/iced.mjs", "bin/iced.mjs"], ["lib/iced-core.mjs", "lib/iced-core.mjs"], ["lib/iced-verify.mjs", "lib/iced-verify.mjs"],
    ["skills/iced/references/rubric.md", "rubric.md"],
  ]) {
    const src = path.join(packageRoot, from);
    if (fs.existsSync(src)) writeFile(path.join(iced, to), fs.readFileSync(src, "utf8"), { overwrite: true }, result, root);
  }
  ensureLine(path.join(root, ".gitattributes"), "intent/**/*.md text eol=lf", result, root);
  ensureLine(path.join(root, ".gitignore"), ".iced/active", result, root);
  ensureLine(path.join(root, ".gitignore"), ".iced/tmp/", result, root);

  const agents = verifierAgentFiles(loadConfig(root));
  const skillSrc = path.join(packageRoot, "skills", "iced");
  if (chosen.includes("agents")) upsertFile(path.join(root, "AGENTS.md"), MANAGED_BODY, result, root);
  if (chosen.includes("claude")) {
    upsertFile(path.join(root, "CLAUDE.md"), MANAGED_BODY, result, root);
    writeFile(path.join(root, ".claude", "commands", "iced.md"), ONE_LINER_COMMAND, { overwrite: true }, result, root);
    writeFile(path.join(root, ".claude", "agents", "iced-verifier.md"), agents[".claude/agents/iced-verifier.md"], { overwrite: true }, result, root);
  }
  if (chosen.includes("codex")) {
    writeFile(path.join(root, ".codex", "agents", "iced-verifier.toml"), agents[".codex/agents/iced-verifier.toml"], { overwrite: true }, result, root);
  }
  if (chosen.includes("skills")) {
    copyDir(skillSrc, path.join(root, ".agents", "skills", "iced"), result, root);
    copyDir(skillSrc, path.join(root, ".claude", "skills", "iced"), result, root);
  }
  if (chosen.includes("cursor")) {
    writeFile(path.join(root, ".cursor", "rules", "iced.mdc"), CURSOR_RULE(MANAGED_BODY), { overwrite: true }, result, root);
    writeFile(path.join(root, ".cursor", "commands", "iced.md"), ONE_LINER_COMMAND.replace(/^---[\s\S]*?---\n\n/, "").replace("$ARGUMENTS", "the text after /iced"), { overwrite: true }, result, root);
  }
  if (chosen.includes("copilot")) upsertFile(path.join(root, ".github", "copilot-instructions.md"), MANAGED_BODY, result, root);
  if (chosen.includes("gemini")) upsertFile(path.join(root, "GEMINI.md"), MANAGED_BODY, result, root);
  return { ...result, targets: chosen };
}
