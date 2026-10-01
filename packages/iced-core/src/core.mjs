// ICED core: parse, lint, hash, status machine, repo operations, metrics.
// Zero dependencies (Node >= 20 built-ins only). Knows nothing about any coding agent; hosts build on it.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SPEC_VERSION = "0.1";
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TYPES = ["project", "feature", "bug", "review", "chore"];
export const TIERS = ["S", "M", "L", "XL"];
export const RISKS = ["low", "medium", "high"];
export const STATUSES = ["draft", "approved", "building", "verifying", "done", "accepted", "blocked", "rejected"];
export const VERIFY_KINDS = ["test", "check", "metric", "manual"];
export const CONTEXT_TAGS = ["code", "product", "knowledge", "assumed", "parent"];
export const DEFAULT_TIER = { project: "L", feature: "M", bug: "S", review: "S", chore: "S" };

/** Frontmatter keys only the human or the tooling may change. Agents must never edit them. */
export const PROTECTED_KEYS = [
  "iced", "id", "status", "autonomy", "attempts", "approved_at", "approved_by", "contract_hash",
  "base_ref", "accepted_at", "accepted_by", "blocked_from",
];

export const TRANSITIONS = {
  draft: ["approved", "rejected"],
  approved: ["building", "rejected"],
  building: ["verifying", "blocked"],
  verifying: ["done", "building", "blocked"],
  done: ["accepted", "building"],
  blocked: ["draft", "approved", "building", "rejected"],
  accepted: [],
  rejected: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Frontmatter (restricted YAML: one `key: scalar` per line)
// ---------------------------------------------------------------------------

const lf = (text) => String(text ?? "").replace(/\r\n?/g, "\n");

function splitFrontmatter(text) {
  const t = lf(text);
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 3);
  if (end < 0) return null;
  const after = t.indexOf("\n", end + 4);
  const closeLineEnd = after < 0 ? t.length : after + 1;
  const closing = t.slice(end + 1, after < 0 ? t.length : after).trim();
  if (closing !== "---") return null;
  return { head: t.slice(4, end + 1), body: t.slice(closeLineEnd), bodyLine: t.slice(0, closeLineEnd).split("\n").length };
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const s = String(value);
  const needsQuotes = s === "" || /^\s|\s$/.test(s) || /[:#]\s|^["'\[\]{}>|*&!%@`#,?]|^-(\s|$)|\s#/.test(s) || s.includes("\n")
    || /^(null|true|false|~|-?\d+)$/.test(s);
  return needsQuotes ? JSON.stringify(s) : s;
}

export function parseFrontmatter(text) {
  const parts = splitFrontmatter(text);
  if (!parts) return { data: {}, body: lf(text), ok: false, bodyLine: 1 };
  const data = {};
  let ok = true;
  for (const line of parts.head.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) { ok = false; continue; }
    data[m[1]] = parseScalar(m[2]);
  }
  return { data, body: parts.body, ok, bodyLine: parts.bodyLine };
}

/** Update or append frontmatter keys, keeping key order, comments and the body untouched. */
export function setFrontmatter(text, patch) {
  const t = lf(text);
  const parts = splitFrontmatter(t);
  const lines = parts ? parts.head.replace(/\n$/, "").split("\n") : [];
  const pending = new Map(Object.entries(patch));
  const out = lines.map((line) => {
    const m = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}: ${formatScalar(v)}`;
    }
    return line;
  });
  for (const [k, v] of pending) out.push(`${k}: ${formatScalar(v)}`);
  return `---\n${out.join("\n")}\n---\n${parts ? parts.body : t}`;
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

/** Replace HTML comments with blank lines so line numbers stay stable. */
function blankComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ""));
}

const H2 = { intent: "intent", context: "context", expectations: "expectations", "open questions": "questions" };
const H3 = { goal: "goal", constraints: "constraints", "failure conditions": "failures", scope: "scope" };
const ITEM_RE = /^\s*[-*]\s+\[([A-Za-z]+\d+)\]\s*(.*)$/;
const TAG_RE = /^\s*[-*]\s+\[([A-Za-z]+)\]\s*(.*)$/;
const VERIFY_RE = /\{\s*verify\s*:\s*([A-Za-z]+)\s*(?:\|\s*([^}]*?))?\s*\}\s*$/;

export function parseIced(text) {
  const fm = parseFrontmatter(text);
  const lines = blankComments(fm.body).split("\n");
  const parsed = {
    frontmatter: fm.data, frontmatterOk: fm.ok, title: fm.data.title ?? null, goal: "",
    constraints: [], failures: [], scope: { in: [], out: [] }, context: [], expectations: [], questions: [],
    sections: [], ok: fm.ok, errors: [],
  };
  let h2 = null;
  let h3 = null;
  let last = null;
  const goalLines = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const lineNo = fm.bodyLine + i;
    let m;
    if (last && line.trim() && !/^#{1,6}\s/.test(line) && !isListItem(line)) { last.text = `${last.text} ${line.trim()}`; return; }
    last = null;
    if ((m = /^#\s+(.+)$/.exec(line))) { if (!parsed.title) parsed.title = m[1].trim(); return; }
    if ((m = /^##\s+(.+)$/.exec(line))) {
      h2 = H2[m[1].trim().toLowerCase()] ?? `other:${m[1].trim()}`; h3 = null; parsed.sections.push(m[1].trim()); return;
    }
    if ((m = /^###\s+(.+)$/.exec(line))) { h3 = h2 === "intent" ? (H3[m[1].trim().toLowerCase()] ?? null) : null; return; }
    if (!line.trim()) return;
    if (h2 === "intent" && h3 === "goal") { goalLines.push(line.trim()); return; }
    if (h2 === "intent" && h3 === "scope") {
      if ((m = /^\s*[-*]\s+(In|Out)\s*:\s*(.*)$/i.exec(line))) {
        const list = m[2].split(",").map((s) => s.trim()).filter(Boolean);
        parsed.scope[m[1].toLowerCase() === "in" ? "in" : "out"].push(...list);
      }
      return;
    }
    if (h2 === "context") {
      if ((m = TAG_RE.exec(line))) parsed.context.push({ tag: m[1].toLowerCase(), text: m[2].trim(), line: lineNo });
      return;
    }
    const target = h2 === "intent" && (h3 === "constraints" || h3 === "failures") ? h3
      : h2 === "expectations" || h2 === "questions" ? h2 : null;
    if (!target || !(m = ITEM_RE.exec(line))) return;
    last = { id: m[1].toUpperCase(), text: m[2].trim(), line: lineNo };
    parsed[target].push(last);
  });
  for (const item of parsed.expectations) {
    const v = VERIFY_RE.exec(item.text);
    if (v) { item.verify = { kind: v[1].toLowerCase(), ref: (v[2] ?? "").trim() }; item.text = item.text.slice(0, v.index).trim(); }
  }
  for (const item of parsed.questions) {
    const idx = item.text.indexOf("-> A:");
    if (idx >= 0) { item.answer = item.text.slice(idx + 5).trim(); item.text = item.text.slice(0, idx).trim(); }
  }
  parsed.goal = goalLines.join(" ").trim();
  return parsed;
}

/** A Markdown list item line (bullet or numbered); anything else non-blank right after an item continues it. */
function isListItem(line) {
  return /^\s*([-*+]|\d+[.)])\s/.test(line);
}

/** Lines from `at` that belong to the item starting there: wrapped lines up to a blank line, heading or new list item. */
function itemLineCount(masked, at, end = masked.length) {
  let n = 1;
  while (at + n < end && masked[at + n].trim() && !/^#{1,6}\s/.test(masked[at + n]) && !isListItem(masked[at + n])) n++;
  return n;
}

/** Text of each `## ` section by lower-cased heading (comments removed). */
function h2Sections(text) {
  const body = blankComments(parseFrontmatter(text).body);
  const out = {};
  let current = null;
  for (const line of body.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) { current = m[1].toLowerCase(); out[current] = []; continue; }
    if (current) out[current].push(line);
  }
  return out;
}

function normalizeBlock(lines) {
  return (lines ?? []).map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0).join("\n");
}

/** sha256 over the normalized Intent and Expectations sections: the human-approved contract. */
export function contractHash(text) {
  const s = h2Sections(text);
  const material = `## intent\n${normalizeBlock(s.intent)}\n## expectations\n${normalizeBlock(s.expectations)}`;
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

const SOLUTION_WORDS = [
  "react", "vue", "angular", "svelte", "next.js", "kubernetes", "k8s", "docker", "postgres", "postgresql", "mysql",
  "mongodb", "redis", "kafka", "rabbitmq", "lambda", "graphql", "grpc", "microservice", "microservices", "django",
  "rails", "spring", "express", "typescript", "python", "java", "golang", "rust", "terraform", "aws", "azure", "gcp",
  "sql", "orm", "prisma", "tailwind", "websocket", "cron", "regex",
];
const REQUIRED = ["iced", "id", "title", "type", "tier", "status", "autonomy", "risk"];
const PAST_APPROVAL = ["approved", "building", "verifying", "done", "accepted"];

export function lintIced(parsed, stage = "validate", text, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (code, message, line) => errors.push({ code, message, ...(line ? { line } : {}) });
  const warn = (code, message, line) => warnings.push({ code, message, ...(line ? { line } : {}) });
  const fm = parsed.frontmatter ?? {};

  if (!parsed.frontmatterOk || Object.keys(fm).length === 0) err("frontmatter-missing", "Frontmatter is missing or unparsable.");
  for (const key of REQUIRED) {
    if (fm[key] === undefined || fm[key] === null || fm[key] === "") err("field-invalid", `Missing required field \`${key}\`.`);
  }
  const enums = { type: TYPES, tier: TIERS, status: STATUSES, risk: RISKS };
  for (const [key, allowed] of Object.entries(enums)) {
    if (fm[key] != null && !allowed.includes(fm[key])) err("field-invalid", `\`${key}\` must be one of ${allowed.join(", ")} (got "${fm[key]}").`);
  }
  if (fm.autonomy != null && !(Number.isInteger(fm.autonomy) && fm.autonomy >= 0 && fm.autonomy <= 3)) {
    err("field-invalid", "`autonomy` must be an integer 0-3.");
  }
  if (fm.id != null && !/^\d{3,}-[a-z0-9-]+$/.test(String(fm.id))) err("field-invalid", "`id` must look like `042-short-slug`.");

  const seenSections = new Set();
  for (const heading of parsed.sections ?? []) {
    const name = heading.trim().toLowerCase();
    if (!Object.hasOwn(H2, name)) continue;
    if (seenSections.has(name)) err("section-duplicate", `Canonical section \`${heading}\` appears more than once.`);
    seenSections.add(name);
  }

  const seen = new Map();
  for (const item of [...parsed.constraints, ...parsed.failures, ...parsed.expectations, ...parsed.questions]) {
    if (seen.has(item.id)) err("ids-duplicate", `Item id [${item.id}] is used more than once.`, item.line);
    seen.set(item.id, true);
  }
  for (const c of parsed.context) {
    if (!CONTEXT_TAGS.includes(c.tag)) warn("context-tag", `Unknown context tag [${c.tag}]; use ${CONTEXT_TAGS.join(", ")}.`, c.line);
  }

  const status = fm.status;
  const signoffRules = stage === "signoff" || stage === "accept"
    || (stage === "validate" && status && !["draft", "rejected", "blocked"].includes(status));
  if (signoffRules) {
    if (!parsed.goal) err("goal-missing", "Intent > Goal is empty.");
    else {
      const lower = ` ${parsed.goal.toLowerCase()} `;
      const hit = SOLUTION_WORDS.find((w) => new RegExp(`[^a-z0-9.]${w.replace(/\./g, "\\.")}[^a-z0-9]`).test(lower));
      if (hit) warn("goal-has-solution", `Goal mentions "${hit}". State the outcome, not the solution; move technology choices to Context.`);
    }
    if (fm.type !== "review" && parsed.failures.length === 0) err("failures-missing", "No failure conditions ([F1] ...). Say what would count as failing the intent.");
    if (parsed.expectations.length === 0) err("expectations-missing", "No expectations ([E1] ...).");
    for (const e of parsed.expectations) {
      if (!e.verify) err("expectation-unverifiable", `[${e.id}] has no {verify: kind | ref}.`, e.line);
      else if (!VERIFY_KINDS.includes(e.verify.kind)) err("expectation-unverifiable", `[${e.id}] verify kind must be ${VERIFY_KINDS.join("|")}.`, e.line);
    }
    for (const q of parsed.questions) if (!q.answer) err("open-questions", `[${q.id}] is unanswered.`, q.line);
    for (const c of parsed.context) if (c.tag === "assumed") warn("assumptions-present", `Assumption: ${c.text}`, c.line);
  }

  if ((stage === "accept" || stage === "validate") && PAST_APPROVAL.includes(status) && text != null) {
    if (!fm.contract_hash) err("contract-changed", "Unit is past approval but has no contract_hash.");
    else if (fm.contract_hash !== contractHash(text)) err("contract-changed", "Intent or Expectations changed after approval (contract_hash mismatch).");
  }
  if (stage === "accept" && ["done", "accepted"].includes(status) && opts.evidenceExists === false) {
    err("evidence-missing", "No evidence.md for a done unit.");
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Config and autonomy
// ---------------------------------------------------------------------------

export function defaultConfig() {
  return {
    iced: SPEC_VERSION,
    gate: "strict",
    autonomy: 1,
    maxAutonomy: 3,
    autonomyByRisk: { low: null, medium: null, high: null },
    questions: { max: 5 },
    verify: {
      commands: [], parallel: true, maxAttempts: 3, independent: true, lenses: "auto", model: null, effort: null, timeoutSec: 900,
    },
    build: { testWriter: false, testWriterModel: null, testWriterEffort: null },
    memory: { product: ".iced/memory/product.md", knowledge: [".iced/memory/knowledge.md"] },
    promotion: { mode: "suggest", window: 10 },
  };
}

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function deepMerge(base, over) {
  if (!isPlainObject(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function configPath(root) { return path.join(root, ".iced", "config.json"); }

export function loadConfig(root) {
  const base = defaultConfig();
  if (!root) return base;
  try { return deepMerge(base, JSON.parse(fs.readFileSync(configPath(root), "utf8"))); } catch { return base; }
}

export function saveConfigPatch(root, patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(configPath(root), "utf8")); } catch { /* new file */ }
  writeText(configPath(root), `${JSON.stringify(deepMerge(current, patch), null, 2)}\n`);
}

/** Edit the raw config file in place (unlike saveConfigPatch, fn may delete keys). */
export function updateConfig(root, fn) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(configPath(root), "utf8")); } catch { /* new file */ }
  fn(current);
  writeText(configPath(root), `${JSON.stringify(current, null, 2)}\n`);
  return current;
}

/** Reasoning effort levels. Hosts map them to their own settings. */
export const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** "provider/model:high" -> { model: "provider/model", effort: "high" }. */
export function splitEffort(ref) {
  const s = String(ref ?? "").trim();
  const m = /^(.+):([a-z]+)$/.exec(s);
  if (m && EFFORTS.includes(m[2])) return { model: m[1], effort: m[2] };
  return { model: s || null, effort: null };
}

/**
 * A setting that is one value, or a legacy map keyed by host name ({"<host>": ..., "default": ...}) written by older
 * versions. With a map, the host's entry wins, then "default".
 */
const forHost = (value, host) => (isPlainObject(value) ? (host ? value[host] : undefined) ?? value.default ?? null : value ?? null);

/**
 * Verifier models: verify.model is one model or a list rotated across the parallel verifiers ("provider/model[:effort]").
 * `host` picks the entry from a legacy per-host map.
 */
export function verifyModels(config, host = null) {
  const m = forHost(config?.verify?.model, host);
  return (Array.isArray(m) ? m : [m]).filter((x) => typeof x === "string")
    .flatMap((x) => x.split(/,(?![^[]*\])/)).map((x) => x.trim()).filter(Boolean);
}

/** Verifier effort (verify.effort), used when a model has no :level suffix. */
export function verifyEffort(config, host = null) {
  const e = forHost(config?.verify?.effort, host);
  return EFFORTS.includes(e) ? e : null;
}

function setSetting(root, section, key, value) {
  updateConfig(root, (c) => {
    c[section] = isPlainObject(c[section]) ? c[section] : {};
    c[section][key] = value;
  });
}

function checkEffort(level) {
  if (level == null || level === "") return null;
  if (!EFFORTS.includes(level)) throw new Error(`Unknown effort "${level}". Use: ${EFFORTS.join(", ")}.`);
  return level;
}

/** Set the verifier models (an empty list clears them). Replaces any legacy per-host map. */
export function setVerifyModels(root, models) {
  const list = (models ?? []).map((x) => String(x).trim()).filter(Boolean);
  setSetting(root, "verify", "model", list.length === 0 ? null : list.length === 1 ? list[0] : list);
}

/** Record "asked, not pinned" as an empty list, so setup does not ask again; it resolves like no model. */
export function markModelsAsked(root) {
  updateConfig(root, (c) => {
    c.verify = isPlainObject(c.verify) ? c.verify : {};
    if (c.verify.model == null) c.verify.model = [];
  });
}

export function setVerifyEffort(root, level) {
  setSetting(root, "verify", "effort", checkEffort(level));
}

export function setTestWriterModel(root, model) {
  updateConfig(root, (c) => {
    c.build = isPlainObject(c.build) ? c.build : {};
    c.build.testWriterModel = typeof model === "string" && model.trim() ? model.trim() : null;
  });
}

export function setTestWriterEffort(root, level) {
  const value = checkEffort(level);
  updateConfig(root, (c) => {
    c.build = isPlainObject(c.build) ? c.build : {};
    c.build.testWriterEffort = value;
  });
}

/**
 * Human-readable model and effort settings. sessionModel/sessionEffort: what the host falls back to when nothing is
 * pinned; host picks entries from legacy per-host maps.
 */
export function describeModels(config, { host = null, sessionModel = null, sessionEffort = null } = {}) {
  const withEffort = (ref, effort) => {
    const s = splitEffort(ref);
    const e = s.effort ?? effort;
    return `${s.model}${e ? ` (effort ${e})` : ""}`;
  };
  const fallback = (effort) => {
    const e = effort ?? sessionEffort;
    return sessionModel ? `not set (uses the session model, now ${sessionModel}${e ? `, effort ${e}` : ""})` : `not set (the session model${effort ? `, effort ${effort}` : ""})`;
  };
  const effort = verifyEffort(config, host);
  const list = verifyModels(config, host);
  const shown = list.map((r) => withEffort(r, effort));
  const L = [`Verifier models (verify.model, verify.effort): ${!shown.length ? fallback(effort) : shown.length > 1 ? `${shown.join(", ")}, rotated across verifiers` : shown[0]}`];
  const tw = config?.build?.testWriterModel;
  const twEffort = checkEffortSafe(config?.build?.testWriterEffort);
  L.push(`Test writer (build.testWriterModel): ${tw ? withEffort(tw, twEffort) : fallback(twEffort)}${config?.build?.testWriter ? "" : "; the test writer is off (build.testWriter)"}`);
  return L.join("\n");
}

const checkEffortSafe = (level) => (EFFORTS.includes(level) ? level : null);

/** Autonomy a new unit starts with for a risk level. */
export function defaultAutonomyFor(risk, config) {
  const byRisk = config.autonomyByRisk?.[risk];
  return Number.isInteger(byRisk) ? byRisk : config.autonomy;
}

export function effectiveAutonomy(frontmatter, config) {
  const own = Number.isInteger(frontmatter.autonomy) ? frontmatter.autonomy : config.autonomy;
  let a = Math.max(0, Math.min(own, config.maxAutonomy ?? 3));
  if (frontmatter.risk === "high") a = Math.min(a, 1);
  return a;
}

// ---------------------------------------------------------------------------
// Repository operations
// ---------------------------------------------------------------------------

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

/** Absolute dir with an uppercase Windows drive letter: tools like Vitest crash when started from "d:\". */
export function normalizeDir(dir) {
  const abs = path.resolve(dir);
  return /^[a-z]:/.test(abs) ? abs[0].toUpperCase() + abs.slice(1) : abs;
}

export function findRoot(cwd) {
  let dir = normalizeDir(cwd);
  for (;;) {
    try { if (fs.statSync(path.join(dir, ".iced")).isDirectory()) return dir; } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function slugify(title) {
  const s = String(title ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s || "unit";
}

export function intentDir(root) { return path.join(root, "intent"); }

export function nextId(root, title) {
  let max = 0;
  try {
    for (const name of fs.readdirSync(intentDir(root))) {
      const m = /^(\d{3,})-/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch { /* no intent dir yet */ }
  return `${String(max + 1).padStart(3, "0")}-${slugify(title)}`;
}

export function unitPaths(root, id) {
  const dir = path.join(intentDir(root), id);
  return {
    dir, iced: path.join(dir, "iced.md"), decisions: path.join(dir, "decisions.md"),
    evidence: path.join(dir, "evidence.md"), verify: path.join(dir, "verify.json"),
  };
}

export function listUnits(root) {
  let names = [];
  try { names = fs.readdirSync(intentDir(root)); } catch { return []; }
  return names.sort().flatMap((id) => {
    const file = unitPaths(root, id).iced;
    if (!fs.existsSync(file)) return [];
    return [{ id, dir: path.dirname(file), file, frontmatter: parseFrontmatter(fs.readFileSync(file, "utf8")).data }];
  });
}

/** Resolve a unit id from an exact id, a numeric prefix ("42" / "042") or a unique substring. */
export function resolveId(root, ref) {
  if (!ref) return null;
  const units = listUnits(root).map((u) => u.id);
  if (units.includes(ref)) return ref;
  if (/^\d+$/.test(ref)) {
    const n = Number(ref);
    const hit = units.find((id) => Number(id.split("-")[0]) === n);
    if (hit) return hit;
  }
  const matches = units.filter((id) => id.includes(ref));
  return matches.length === 1 ? matches[0] : null;
}

export function readUnit(root, id) {
  const paths = unitPaths(root, id);
  if (!fs.existsSync(paths.iced)) throw new Error(`ICED unit not found: ${id}`);
  const text = lf(fs.readFileSync(paths.iced, "utf8"));
  return { id, text, parsed: parseIced(text), paths };
}

export function writeUnitText(root, id, text) {
  writeText(unitPaths(root, id).iced, lf(text));
}

function templateFor(type, templateDir, root) {
  const dirs = [templateDir, root && path.join(root, ".iced", "templates"), path.join(PACKAGE_ROOT, "spec", "templates")].filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, `${type}.md`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  throw new Error(`No ICED template for type "${type}".`);
}

export function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

export function createUnit(root, { title, type = "feature", tier, parent = null, autonomy, risk = "medium", request = "", templateDir } = {}) {
  if (!TYPES.includes(type)) throw new Error(`Unknown type "${type}".`);
  const config = loadConfig(root);
  const cleanTitle = String(title ?? request ?? "").trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled";
  const id = nextId(root, cleanTitle);
  const paths = unitPaths(root, id);
  const values = {
    id, title: cleanTitle, type, tier: tier ?? DEFAULT_TIER[type], parent: parent ?? null,
    autonomy: Number.isInteger(autonomy) ? autonomy : defaultAutonomyFor(risk, config), risk,
    created: nowIso(), request: String(request || cleanTitle).trim(),
  };
  let text = lf(templateFor(type, templateDir, root)).replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? String(values[k] ?? "") : ""));
  text = setFrontmatter(text, {
    iced: SPEC_VERSION, id, title: cleanTitle, type, tier: values.tier, parent: values.parent, status: "draft",
    autonomy: values.autonomy, risk, attempts: 0, created: values.created,
  });
  writeText(paths.iced, text);
  if (!fs.existsSync(paths.decisions)) {
    writeText(paths.decisions, `# Decisions: ${id}\n\nAgent-owned, append-only log of significant choices. Audited, not approved.\n`);
  }
  return { id, paths };
}

export function updateFrontmatter(root, id, patch) {
  const { text } = readUnit(root, id);
  const next = setFrontmatter(text, patch);
  writeUnitText(root, id, next);
  return parseFrontmatter(next).data;
}

export function transition(root, id, to, patch = {}) {
  const { parsed } = readUnit(root, id);
  const from = parsed.frontmatter.status;
  if (!canTransition(from, to)) throw new Error(`Cannot move ${id} from "${from}" to "${to}".`);
  const extra = { status: to, ...patch };
  if (to === "blocked") extra.blocked_from = from;
  else if (from === "blocked") extra.blocked_from = null;
  return updateFrontmatter(root, id, extra);
}

export function ancestors(root, id) {
  const chain = [];
  const seen = new Set([id]);
  let current = safeRead(root, id);
  while (current?.parsed.frontmatter.parent) {
    const pid = String(current.parsed.frontmatter.parent);
    if (seen.has(pid)) break;
    seen.add(pid);
    current = safeRead(root, pid);
    if (current) chain.push(current);
  }
  return chain;
}

function safeRead(root, id) { try { return readUnit(root, id); } catch { return null; } }

export function children(root, id) {
  return listUnits(root).filter((u) => String(u.frontmatter.parent ?? "") === id).map((u) => u.id);
}

function activeFile(root) { return path.join(root, ".iced", "active"); }

export function getActive(root) {
  try {
    const id = fs.readFileSync(activeFile(root), "utf8").trim();
    return id && fs.existsSync(unitPaths(root, id).iced) ? id : null;
  } catch { return null; }
}

export function setActive(root, id) {
  if (!id) { try { fs.unlinkSync(activeFile(root)); } catch { /* already clear */ } return; }
  writeText(activeFile(root), `${id}\n`);
}

export function appendDecision(root, id, { decision, why, alternatives, author = "agent" }) {
  const file = unitPaths(root, id).decisions;
  const lines = [`\n## ${nowIso()} (${author})`, `- Decision: ${decision}`];
  if (why) lines.push(`- Why: ${why}`);
  if (alternatives) lines.push(`- Alternatives: ${Array.isArray(alternatives) ? alternatives.join("; ") : alternatives}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

/** Add lines to a `## heading` section, creating the section at the end when missing. */
export function appendToSection(text, heading, newLines) {
  const t = lf(text).replace(/\n*$/, "\n");
  const lines = t.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return `${t}\n## ${heading}\n${newLines.join("\n")}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  let insert = end;
  while (insert > start + 1 && lines[insert - 1].trim() === "") insert--;
  lines.splice(insert, 0, ...newLines);
  return lines.join("\n");
}

const REMOVE_RE = /^\(?remove(d)?\)?\.?$/i;

/** Contract items in an agent proposal: "- [E4] new text {verify: ...}" lines (C, F or E; "- [E5] (remove)" drops one). */
export function proposalItems(proposal) {
  const items = new Map();
  let last = null;
  for (const line of lf(String(proposal ?? "")).split("\n")) {
    const m = ITEM_RE.exec(line);
    if (m && /^[CFE]\d+$/i.test(m[1])) { last = m[1].toUpperCase(); items.set(last, m[2].trim()); continue; }
    if (last && line.trim() && !/^#{1,6}\s/.test(line) && !isListItem(line)) items.set(last, `${items.get(last)} ${line.trim()}`);
    else last = null;
  }
  return [...items].map(([id, text]) => ({ id, text }));
}

/** Remove "<!-- Agent proposal ... -->" comments left by the contract editor. */
export function stripProposalComments(text) {
  return lf(text).replace(/\n*[ \t]*<!--\s*Agent proposal[\s\S]*?-->[ \t]*(?=\n|$)/g, "");
}

function itemSection(masked, id) {
  const find = (re, from = 0, to = masked.length) => { for (let i = from; i < to; i++) if (re.test(masked[i])) return i; return -1; };
  const nextH2 = (from) => { const i = find(/^##(?!#)\s/, from); return i < 0 ? masked.length : i; };
  if (id[0] === "E") {
    const h = find(/^##\s+expectations\s*$/i);
    return h < 0 ? null : { start: h, end: nextH2(h + 1) };
  }
  const intent = find(/^##\s+intent\s*$/i);
  if (intent < 0) return null;
  const intentEnd = nextH2(intent + 1);
  const h = find(id[0] === "C" ? /^###\s+constraints\s*$/i : /^###\s+failure conditions\s*$/i, intent + 1, intentEnd);
  if (h < 0) return null;
  const next = find(/^###?\s/, h + 1, intentEnd);
  return { start: h, end: next < 0 ? intentEnd : next };
}

/**
 * Apply proposal items to a unit's text: the same id replaces the item, a new id is added at the end of its section,
 * "(remove)" deletes it. Also strips agent proposal comments. Returns { text, changes, errors }.
 */
export function applyProposal(text, items) {
  let cur = stripProposalComments(text);
  const changes = [];
  const errors = [];
  const sectionName = { C: "Constraints", F: "Failure conditions", E: "Expectations" };
  for (const { id, text: after } of items) {
    const lines = cur.split("\n");
    const masked = blankComments(cur).split("\n");
    const sec = itemSection(masked, id);
    if (!sec) { errors.push(`The contract has no ${sectionName[id[0]]} section for ${id}.`); continue; }
    let at = -1;
    for (let i = sec.start + 1; i < sec.end; i++) if (ITEM_RE.exec(masked[i])?.[1].toUpperCase() === id) { at = i; break; }
    const remove = REMOVE_RE.test(after);
    if (at >= 0) {
      const n = itemLineCount(masked, at, sec.end);
      const before = [ITEM_RE.exec(lines[at])[2], ...lines.slice(at + 1, at + n)].map((s) => s.trim()).join(" ");
      if (remove) { lines.splice(at, n); changes.push({ id, action: "remove", before }); }
      else if (before !== after) { lines.splice(at, n, `${/^\s*/.exec(lines[at])[0]}- [${id}] ${after}`); changes.push({ id, action: "replace", before, after }); }
    } else if (remove) {
      errors.push(`${id} is not in the contract, so it cannot be removed.`);
      continue;
    } else {
      let insert = sec.end;
      while (insert > sec.start + 1 && !masked[insert - 1].trim()) insert--;
      lines.splice(insert, 0, `- [${id}] ${after}`);
      changes.push({ id, action: "add", after });
    }
    cur = lines.join("\n");
  }
  return { text: cur, changes, errors };
}

/** One line per change, for the human to read before applying. */
export function describeChanges(changes) {
  return changes.map((c) => c.action === "remove" ? `${c.id} removed: ${c.before}`
    : c.action === "add" ? `${c.id} added:   ${c.after}`
    : `${c.id} was:     ${c.before}\n${c.id} becomes: ${c.after}`).join("\n");
}

export function nextItemId(parsed, prefix) {
  const all = [...parsed.constraints, ...parsed.failures, ...parsed.expectations, ...parsed.questions];
  const nums = all.filter((i) => i.id.startsWith(prefix)).map((i) => Number(i.id.slice(prefix.length)) || 0);
  return `${prefix}${Math.max(0, ...nums) + 1}`;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch { return null; }
}

export function headRef(root) { return git(root, ["rev-parse", "HEAD"]); }

export function whoAmI(root) {
  return git(root, ["config", "user.name"]) || process.env.USER || process.env.USERNAME || os.userInfo().username || "human";
}

// ---------------------------------------------------------------------------
// Approval / acceptance (shared by extension and CLI)
// ---------------------------------------------------------------------------

export function approveUnit(root, id, { by, auto = false, startBuild = false } = {}) {
  const unit = readUnit(root, id);
  const lint = lintIced(unit.parsed, "signoff", unit.text);
  if (lint.errors.length) return { ok: false, lint };
  transition(root, id, "approved", {
    approved_at: nowIso(), approved_by: by ?? (auto ? "auto" : whoAmI(root)),
    contract_hash: contractHash(unit.text), base_ref: headRef(root),
  });
  if (startBuild) transition(root, id, "building");
  appendMetric(root, { id, event: "signoff", result: "approved", auto, risk: unit.parsed.frontmatter.risk, autonomy: unit.parsed.frontmatter.autonomy });
  return { ok: true, lint };
}

export function acceptUnit(root, id, { by, auto = false } = {}) {
  const unit = readUnit(root, id);
  const lint = lintIced(unit.parsed, "accept", unit.text, { evidenceExists: fs.existsSync(unit.paths.evidence) });
  if (lint.errors.length) return { ok: false, lint };
  transition(root, id, "accepted", { accepted_at: nowIso(), accepted_by: by ?? (auto ? "auto" : whoAmI(root)) });
  const fm = unit.parsed.frontmatter;
  appendMetric(root, { id, event: "accept", auto, risk: fm.risk, autonomy: fm.autonomy, type: fm.type });
  return { ok: true, lint };
}

/** Re-approve after a human-approved contract change (hash refresh, status unchanged). */
export function rehashContract(root, id, by) {
  const { text } = readUnit(root, id);
  return updateFrontmatter(root, id, { contract_hash: contractHash(text), approved_at: nowIso(), approved_by: by ?? whoAmI(root) });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function metricsFile(root) { return path.join(root, ".iced", "metrics.jsonl"); }

export function appendMetric(root, event) {
  const file = metricsFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ts: nowIso(), ...event })}\n`, "utf8");
}

export function readMetrics(root) {
  let raw = "";
  try { raw = fs.readFileSync(metricsFile(root), "utf8"); } catch { return []; }
  return raw.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const rate = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

export function computeStats(events) {
  const units = new Map();
  const unit = (id) => {
    if (!units.has(id)) units.set(id, { questions: 0, signoffs: [], verifies: [], escalations: 0, accepts: 0, rejects: 0, risk: null, autonomy: null });
    return units.get(id);
  };
  for (const e of [...events].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
    if (!e.id) continue;
    const u = unit(e.id);
    if (e.risk) u.risk = e.risk;
    if (Number.isInteger(e.autonomy)) u.autonomy = e.autonomy;
    if (e.event === "questions") u.questions += Number(e.count) || 0;
    else if (e.event === "signoff") u.signoffs.push(e.result);
    else if (e.event === "verify") u.verifies.push(e.result);
    else if (e.event === "escalation") u.escalations += 1;
    else if (e.event === "accept") u.accepts += 1;
    else if (e.event === "reject") u.rejects += 1;
  }
  const all = [...units.values()];
  const summarize = (list) => {
    const signed = list.filter((u) => u.signoffs.length);
    const verified = list.filter((u) => u.verifies.length);
    const decided = list.filter((u) => u.accepts || u.rejects);
    return {
      units: list.length,
      questionsPerUnit: list.length ? Math.round((list.reduce((s, u) => s + u.questions, 0) / list.length) * 100) / 100 : 0,
      signoffFirstApprovalRate: rate(signed.filter((u) => u.signoffs[0] === "approved").length, signed.length),
      verifyFirstPassRate: rate(verified.filter((u) => u.verifies[0] === "pass").length, verified.length),
      humanRejectionRate: rate(decided.filter((u) => u.rejects > 0).length, decided.length),
      escalationsPerUnit: list.length ? Math.round((list.reduce((s, u) => s + u.escalations, 0) / list.length) * 100) / 100 : 0,
      accepted: list.filter((u) => u.accepts > 0).length,
    };
  };
  const group = (key) => {
    const out = {};
    for (const u of all) {
      const k = String(u[key] ?? "unknown");
      (out[k] ??= []).push(u);
    }
    return Object.fromEntries(Object.entries(out).map(([k, list]) => [k, summarize(list)]));
  };
  return { overall: summarize(all), byRisk: group("risk"), byAutonomy: group("autonomy") };
}

/**
 * Suggest raising the default autonomy for a risk level when the most recent `window` accepted units
 * at that level had no human rejections and no escalations.
 */
export function promotionSuggestions(events, config) {
  const window = config.promotion?.window ?? 10;
  const perUnit = new Map();
  for (const e of events) {
    if (!e.id) continue;
    const u = perUnit.get(e.id) ?? { id: e.id, risk: null, autonomy: null, acceptedAt: null, clean: true };
    if (e.risk) u.risk = e.risk;
    if (Number.isInteger(e.autonomy)) u.autonomy = e.autonomy;
    if (e.event === "reject" || e.event === "escalation") u.clean = false;
    if (e.event === "accept") u.acceptedAt = e.ts;
    perUnit.set(e.id, u);
  }
  const suggestions = [];
  for (const risk of RISKS) {
    const current = defaultAutonomyFor(risk, config);
    const cap = risk === "high" ? 1 : config.maxAutonomy ?? 3;
    if (current >= cap) continue;
    const recent = [...perUnit.values()]
      .filter((u) => u.risk === risk && u.acceptedAt && u.autonomy === current)
      .sort((a, b) => String(b.acceptedAt).localeCompare(String(a.acceptedAt)))
      .slice(0, window);
    if (recent.length >= window && recent.every((u) => u.clean)) {
      suggestions.push({ risk, from: current, to: current + 1, reason: `Last ${window} ${risk}-risk units at autonomy ${current} were accepted with no rejections or escalations.` });
    }
  }
  return suggestions;
}

export function applyPromotion(root, suggestion) {
  saveConfigPatch(root, { autonomyByRisk: { [suggestion.risk]: suggestion.to } });
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

export function summarizeUnit(parsed, { includeAssumptions = true } = {}) {
  const fm = parsed.frontmatter;
  const lines = [`${fm.id}: ${parsed.title ?? fm.title}  [${fm.type}/${fm.tier}, risk ${fm.risk}, autonomy ${fm.autonomy}, ${fm.status}]`];
  if (parsed.goal) lines.push(`Goal: ${parsed.goal}`);
  const list = (label, items, fmt = (i) => `  [${i.id}] ${i.text}`) => {
    if (items.length) lines.push(`${label}:`, ...items.map(fmt));
  };
  list("Constraints", parsed.constraints);
  list("Failure conditions", parsed.failures);
  if (parsed.scope.out.length) lines.push(`Out of scope: ${parsed.scope.out.join(", ")}`);
  list("Expectations", parsed.expectations, (e) => `  [${e.id}] ${e.text}${e.verify ? `  (${e.verify.kind}${e.verify.ref ? `: ${e.verify.ref}` : ""})` : "  (UNVERIFIABLE)"}`);
  if (includeAssumptions) {
    const assumed = parsed.context.filter((c) => c.tag === "assumed");
    if (assumed.length) lines.push("Assumptions (correct these if wrong):", ...assumed.map((c) => `  - ${c.text}`));
  }
  const answered = parsed.questions.filter((q) => q.answer);
  if (answered.length) lines.push("Answered questions:", ...answered.map((q) => `  [${q.id}] ${q.text} -> ${q.answer}`));
  return lines.join("\n");
}

export function renderStatus(root, id) {
  if (id) {
    const unit = readUnit(root, id);
    const lint = lintIced(unit.parsed, "validate", unit.text);
    const parts = [summarizeUnit(unit.parsed)];
    const kids = children(root, id);
    if (kids.length) parts.push(`Children: ${kids.join(", ")}`);
    if (fs.existsSync(unit.paths.verify)) {
      try {
        const v = JSON.parse(fs.readFileSync(unit.paths.verify, "utf8"));
        parts.push(`Last verification: ${v.verdict} (attempt ${v.attempt ?? "?"}, ${v.ts ?? ""})`);
      } catch { /* ignore unreadable verdict */ }
    }
    if (lint.errors.length) parts.push(`Lint errors:\n${lint.errors.map((e) => `  ${e.code}: ${e.message}`).join("\n")}`);
    return parts.join("\n");
  }
  const units = listUnits(root);
  if (!units.length) return "No ICED units yet. Start one with: /iced <what you want>";
  const active = getActive(root);
  return units.map((u) => {
    const fm = u.frontmatter;
    const mark = u.id === active ? "*" : " ";
    const parent = fm.parent ? `  <- ${fm.parent}` : "";
    return `${mark} ${u.id.padEnd(36)} ${String(fm.status).padEnd(10)} ${String(fm.type).padEnd(8)} ${fm.tier}  risk:${fm.risk}  a${fm.autonomy}${parent}`;
  }).join("\n");
}

export function renderStats(root) {
  const events = readMetrics(root);
  const stats = computeStats(events);
  const config = loadConfig(root);
  const fmt = (s) => [
    `units ${s.units}, accepted ${s.accepted}`,
    `questions/unit ${s.questionsPerUnit}`,
    `sign-off first-time approval ${s.signoffFirstApprovalRate ?? "-"}%`,
    `verify first-pass ${s.verifyFirstPassRate ?? "-"}%`,
    `human rejection ${s.humanRejectionRate ?? "-"}%`,
    `escalations/unit ${s.escalationsPerUnit}`,
  ].join(" | ");
  const lines = [`Overall: ${fmt(stats.overall)}`];
  for (const [k, s] of Object.entries(stats.byRisk)) lines.push(`Risk ${k}: ${fmt(s)}`);
  for (const [k, s] of Object.entries(stats.byAutonomy)) lines.push(`Autonomy ${k}: ${fmt(s)}`);
  const suggestions = promotionSuggestions(events, config);
  for (const s of suggestions) lines.push(`Suggestion: raise ${s.risk}-risk default autonomy ${s.from} -> ${s.to}. ${s.reason}`);
  return { text: lines.join("\n"), stats, suggestions };
}
