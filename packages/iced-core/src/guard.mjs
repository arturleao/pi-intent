// ICED guard: host-neutral classification a host uses to protect ICED files and gate changes.
// Which paths belong to ICED, what a file write would produce, and whether a shell command changes files.

import fs from "node:fs";
import path from "node:path";
import { PROTECTED_KEYS, parseFrontmatter } from "./core.mjs";

const OWNED_ICED_FILES = new Set(["config.json", "active", "metrics.jsonl"]);
const OWNED_UNIT_FILES = new Set(["evidence.md", "verify.json"]);

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Classify a file path relative to the ICED root.
 * kinds: outside | owned (written only by ICED) | memory | meta | unit (iced.md) | decisions | aux | code
 */
export function classifyPath(root, cwd, rawPath) {
  const p = String(rawPath ?? "").replace(/^@/, "");
  const abs = path.resolve(cwd, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { kind: "outside", abs };
  const parts = rel.split(/[\\/]/);
  const [top, second, third] = parts.map(norm);
  if (top === ".iced") {
    if (parts.length === 2 && OWNED_ICED_FILES.has(second)) return { kind: "owned", abs, rel };
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

/**
 * Content a file change would produce, or null when it cannot be predicted.
 * change: { content } for a full write, or { edits: [{ oldText, newText }] } for exact replacements.
 */
export function predictFileContent(abs, change) {
  if (typeof change?.content === "string") return change.content;
  if (!Array.isArray(change?.edits)) return null;
  let next;
  try { next = fs.readFileSync(abs, "utf8"); } catch { return null; }
  for (const e of change.edits) {
    if (typeof e?.oldText !== "string") return null;
    const idx = next.indexOf(e.oldText);
    if (idx < 0) return null;
    next = next.slice(0, idx) + String(e.newText ?? "") + next.slice(idx + e.oldText.length);
  }
  return next;
}

/** Protected frontmatter keys (status, hashes, approvals...) that differ between two versions of a unit. */
export function changedProtectedKeys(beforeText, afterText) {
  const a = parseFrontmatter(beforeText).data;
  const b = parseFrontmatter(afterText).data;
  return PROTECTED_KEYS.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

// Recording work (git add/commit/push/tag) leaves the working tree alone, so it is not "mutating".
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

/** Shell text that names files only ICED may change. */
export const PROTECTED_SHELL_TARGETS = /(intent[\\/][^\s"']+[\\/](iced\.md|evidence\.md|verify\.json)|\.iced[\\/](config\.json|active|metrics\.jsonl))/i;

/** The command without heredoc/here-string bodies and quoted strings, which can hold `>` without redirecting. */
function withoutLiterals(command) {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "")
    .replace(/"(?:[^"\\`]|[\\`].)*"|'[^']*'/g, "''");
}

/** Heuristic: does this shell command look like it changes files or repository state? Not a sandbox. */
export function isMutatingShell(command) {
  const c = String(command ?? "");
  return REDIRECT.test(withoutLiterals(c)) || MUTATING_SHELL.some((re) => re.test(c));
}
