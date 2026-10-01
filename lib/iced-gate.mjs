// ICED gate: pure decisions about whether an agent tool call may run.
// The pi extension turns decisions into block / confirm / notify.

import fs from "node:fs";
import path from "node:path";
import { PROTECTED_KEYS, getActive, parseFrontmatter, readUnit } from "./iced-core.mjs";

const OWNED_ICED_FILES = new Set(["config.json", "active", "metrics.jsonl", "rubric.md"]);
const OWNED_UNIT_FILES = new Set(["evidence.md", "verify.json"]);

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Classify a file path relative to the ICED root. */
export function classifyPath(root, cwd, rawPath) {
  const p = String(rawPath ?? "").replace(/^@/, "");
  const abs = path.resolve(cwd, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { kind: "outside", abs };
  const parts = rel.split(/[\\/]/);
  const [top, second, third] = parts.map(norm);
  if (top === ".iced") {
    if (parts.length === 2 && OWNED_ICED_FILES.has(second)) return { kind: "owned", abs, rel };
    if (second === "bin" || second === "lib") return { kind: "owned", abs, rel };
    if (second === "memory") return { kind: "memory", abs, rel };
    return { kind: "meta", abs, rel };
  }
  if (top === "intent") {
    if (parts.length === 2) return { kind: "meta", abs, rel };
    const id = parts[1];
    if (parts.length === 3 && third === "iced.md") return { kind: "unit", id, abs, rel };
    if (parts.length === 3 && third === "decisions.md") return { kind: "decisions", id, abs, rel };
    if (parts.length === 3 && OWNED_UNIT_FILES.has(third)) return { kind: "owned", id, abs, rel };
    return { kind: "aux", id, abs, rel };
  }
  return { kind: "code", abs, rel };
}

/** Content a write/edit call would produce, or null when it cannot be predicted. */
export function predictContent(toolName, input, abs) {
  if (toolName === "write") return String(input?.content ?? "");
  if (toolName !== "edit") return null;
  let current;
  try { current = fs.readFileSync(abs, "utf8"); } catch { return null; }
  let next = current;
  for (const e of input?.edits ?? []) {
    if (typeof e?.oldText !== "string") return null;
    const idx = next.indexOf(e.oldText);
    if (idx < 0) return null;
    next = next.slice(0, idx) + String(e.newText ?? "") + next.slice(idx + e.oldText.length);
  }
  return next;
}

export function changedProtectedKeys(beforeText, afterText) {
  const a = parseFrontmatter(beforeText).data;
  const b = parseFrontmatter(afterText).data;
  return PROTECTED_KEYS.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

// Recording work (git add/commit/push/tag) leaves the working tree alone, so it is allowed in any unit state.
const REDIRECT = /(^|[^<>=&|])>>?(?!&)\s*[^\s&|]/; // redirection to a file (not 2>&1)
const MUTATING_SHELL = [
  /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content)\b/i,
  /(^|[\s;&|(])(rm|mv|cp|del|erase|rd|rmdir|mkdir|touch|truncate|tee|chmod|chown|ln)\s/i,
  /\bsed\s+(-[a-z]*i|--in-place)/i,
  /\bperl\s+-[a-z]*i/i,
  /\bgit\s+(reset|checkout|switch|merge|rebase|restore|clean|stash|apply|am|cherry-pick|revert|rm|mv|pull)\b/i,
  /\bgit\s+push\b[^;&|\n]*\s(-f|--force(-with-lease)?|--delete|-d)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|update|upgrade|ci|link)\b/i,
  /\b(pip|pip3|uv|poetry|cargo|go|dotnet|gem|composer)\s+(install|add|remove|uninstall|get|update)\b/i,
  /\bWriteAllText|WriteAllLines|AppendAllText\b/,
  /\bnode\s+-e\b.*\b(writeFile|appendFile|rmSync|unlink|rename)/i,
  /\bpython3?\s+-c\b.*\b(open\(.*['"]w|remove|rmtree|rename)/i,
];

const PROTECTED_SHELL_TARGETS = /(intent[\\/][^\s"']+[\\/](iced\.md|evidence\.md|verify\.json)|\.iced[\\/](config\.json|active|metrics\.jsonl|rubric\.md|bin|lib))/i;
const SELF_APPROVAL = /\b(iced(\.mjs)?|pi-intent)\s+(approve|accept)\b/i;
const CLI_VERIFY = /\b(iced(\.mjs)?|pi-intent)\s+verify\b/i;
const CLI_MODELS_CHANGE = /\b(iced(\.mjs)?|pi-intent)\s+models\s+(set|effort|clear|test-writer)\b/i;

/** The command without heredoc/here-string bodies and quoted strings, which can hold `>` without redirecting. */
function withoutLiterals(command) {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "")
    .replace(/"(?:[^"\\`]|[\\`].)*"|'[^']*'/g, "''");
}

export function isMutatingShell(command) {
  const c = String(command ?? "");
  return REDIRECT.test(withoutLiterals(c)) || MUTATING_SHELL.some((re) => re.test(c));
}

/**
 * Decide on a tool call. Code and shell changes are gated only while a unit is active, unless `always`
 * (config gate "always") also gates them when no unit is active. ICED's own files are protected either way.
 * @returns {{action: "allow"} | {action: "block", reason: string} | {action: "confirm", title: string, message: string}}
 */
export function gateDecision({ root, cwd, toolName, input, autonomy = 1, always = false }) {
  const allow = { action: "allow" };
  if (!root) return allow;
  const activeId = getActive(root);
  let active = null;
  try { active = activeId ? readUnit(root, activeId) : null; } catch { active = null; }
  if (active && ["accepted", "rejected"].includes(active.parsed.frontmatter.status)) active = null;
  const status = active?.parsed.frontmatter.status ?? null;
  const type = active?.parsed.frontmatter.type ?? null;
  const building = status === "building";
  const start = "Start with /iced <request> (or the iced_start tool), draft the unit, then get sign-off with iced_request_signoff.";

  if (toolName === "write" || toolName === "edit") {
    const target = classifyPath(root, cwd, input?.path);
    switch (target.kind) {
      case "outside": case "memory": case "meta": case "decisions": return allow;
      case "owned":
        return { action: "block", reason: `${target.rel} is written only by the ICED tooling. Use iced_submit / iced_decision / the /iced commands instead.` };
      case "aux": return allow;
      case "unit": {
        let unit = null;
        try { unit = readUnit(root, target.id); } catch { unit = null; }
        if (!unit) {
          return { action: "block", reason: `Create units with /iced or the iced_start tool, not by writing ${target.rel} directly.` };
        }
        const st = unit.parsed.frontmatter.status;
        if (st !== "draft") {
          return { action: "block", reason: `${target.id} is ${st}: Intent and Expectations are frozen after sign-off. If an expectation must change, call iced_escalate with kind "change-expectation".` };
        }
        const next = predictContent(toolName, input, target.abs);
        if (next === null) return allow;
        const changed = changedProtectedKeys(unit.text, next);
        if (changed.length) {
          return { action: "block", reason: `Do not change ${changed.join(", ")} in ${target.rel}; those fields are owned by the human and the ICED tooling. Sign-off happens through iced_request_signoff.` };
        }
        return allow;
      }
      case "code":
      default: {
        if (!active) return always ? { action: "block", reason: `No active ICED unit, and this repo gates every code change (gate: always). ${start}` } : allow;
        if (!building) {
          const hint = status === "draft" ? "Finish the draft and call iced_request_signoff."
            : status === "approved" ? "Start the build with iced_build when the human asks you to implement it (or they run /iced build)."
            : status === "blocked" ? "The unit is blocked waiting for the human."
            : `Code is frozen while the unit is ${status}.`;
          return { action: "block", reason: `Active unit ${activeId} is ${status}; code changes are allowed only while building. ${hint}` };
        }
        if (type === "review") {
          return { action: "block", reason: `${activeId} is a review unit: read-only. Write findings to intent/${activeId}/review.md.` };
        }
        if (autonomy === 0) return { action: "confirm", title: `ICED (${activeId}, autonomy 0)`, message: `Allow ${toolName} to ${target.rel}?` };
        return allow;
      }
    }
  }

  if (toolName === "bash" || toolName === "powershell") {
    const command = String(input?.command ?? "");
    if (SELF_APPROVAL.test(command)) {
      return { action: "block", reason: "Agents cannot approve or accept ICED units. Ask the human (iced_request_signoff, or they run /iced accept)." };
    }
    if (CLI_MODELS_CHANGE.test(command)) {
      return { action: "block", reason: "Only the human picks the models that verify the work. Ask them to run /iced models." };
    }
    if (CLI_VERIFY.test(command)) {
      return { action: "block", reason: "In pi, submit the unit with iced_submit; it runs the same checks and independent verifiers." };
    }
    const mutating = isMutatingShell(command);
    if (mutating && PROTECTED_SHELL_TARGETS.test(command)) {
      return { action: "block", reason: "That command would modify ICED-owned files (iced.md after approval, evidence, verify.json or .iced state). Use the iced_* tools." };
    }
    if (!mutating || (!active && !always)) return allow;
    if (building && type !== "review") {
      if (autonomy === 0) return { action: "confirm", title: `ICED (${activeId}, autonomy 0)`, message: `Allow ${toolName}: ${command.slice(0, 200)}?` };
      return allow;
    }
    const why = active ? `active unit ${activeId} is ${status}${type === "review" ? " (review, read-only)" : ""}` : "there is no active ICED unit (gate: always)";
    return { action: "block", reason: `This command looks like it changes files or repository state, and ${why}. Read-only commands are fine. ${active ? "" : start}`.trim() };
  }

  return allow;
}
