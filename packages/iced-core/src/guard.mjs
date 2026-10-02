// ICED guard: host-neutral classification a host uses to protect ICED files and gate changes.
// Which paths belong to ICED, what a file write would produce, whether a shell command changes files,
// and where it changes them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROTECTED_KEYS, parseFrontmatter } from "./core.mjs";

const OWNED_ICED_FILES = new Set(["active", "metrics.jsonl"]);
const OWNED_UNIT_FILES = new Set(["evidence.md", "verify.json"]);

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Is `abs` inside `root` (or equal to it)? */
function isInside(root, abs) {
  const rel = path.relative(norm(path.resolve(root)), norm(path.resolve(abs)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Classify a file path relative to the ICED root.
 * kinds: outside | owned (written only by ICED) | config (.iced/config.json) | memory | meta | unit (iced.md) | decisions | aux | code
 */
export function classifyPath(root, cwd, rawPath) {
  const p = String(rawPath ?? "").replace(/^@/, "");
  const abs = path.resolve(cwd, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { kind: "outside", abs };
  const parts = rel.split(/[\\/]/);
  const [top, second, third] = parts.map(norm);
  if (top === ".iced") {
    if (parts.length === 2 && second === "config.json") return { kind: "config", abs, rel };
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
  let original;
  try { original = fs.readFileSync(abs, "utf8"); } catch { return null; }
  const matches = [];
  for (const e of change.edits) {
    if (typeof e?.oldText !== "string" || !e.oldText || typeof e.newText !== "string") return null;
    const start = original.indexOf(e.oldText);
    if (start < 0 || original.indexOf(e.oldText, start + 1) >= 0) return null;
    matches.push({ start, end: start + e.oldText.length, text: e.newText });
  }
  matches.sort((a, b) => a.start - b.start);
  for (let i = 1; i < matches.length; i++) if (matches[i].start < matches[i - 1].end) return null;
  let next = original;
  for (const m of matches.reverse()) next = next.slice(0, m.start) + m.text + next.slice(m.end);
  return next;
}

/** Protected frontmatter keys (status, hashes, approvals...) that differ between two versions of a unit. */
export function changedProtectedKeys(beforeText, afterText) {
  const a = parseFrontmatter(beforeText).data;
  const b = parseFrontmatter(afterText).data;
  return PROTECTED_KEYS.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

// ---------------------------------------------------------------------------
// Config: operational keys may be edited by agents; integrity keys decide trust and verification.
// ---------------------------------------------------------------------------

/** Dotted paths in .iced/config.json that only the human may change. */
export const CONFIG_INTEGRITY_KEYS = [
  "gate", "autonomy", "maxAutonomy", "autonomyByRisk",
  "verify.model", "verify.independent", "verify.lenses", "verify.maxAttempts",
  "build.testWriterModel",
];

function getPath(obj, dotted) {
  let cur = obj;
  for (const k of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function stableJson(v) {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
}

/**
 * Integrity keys whose value differs between the current config text and a predicted one.
 * Returns null when the predicted text is not valid JSON (the change cannot be validated).
 */
export function changedConfigIntegrityKeys(beforeText, afterText) {
  let before = {};
  try { before = JSON.parse(beforeText); } catch { before = {}; }
  let after;
  try { after = JSON.parse(afterText); } catch { return null; }
  if (after === null || typeof after !== "object" || Array.isArray(after)) return null;
  return CONFIG_INTEGRITY_KEYS.filter((k) => stableJson(getPath(before, k)) !== stableJson(getPath(after, k)));
}

// ---------------------------------------------------------------------------
// Shell heuristics (not a sandbox)
// ---------------------------------------------------------------------------

// Recording work (git add/commit/push/tag) leaves the working tree alone, so it is not "mutating".
const REDIRECT = /(^|[^<>=&|])>>?(?!&)\s*[^\s&|]/; // redirection to a file (not 2>&1)
// Redirect targets that never change the repository: discard devices and temp locations.
// Discard devices must end the token (`> NUL.txt` is a repository file); temp prefixes may continue into a path.
const BENIGN_TARGET = String.raw`(?:&\d|(?:\$null|/dev/null|NUL)(?=$|[\s&|;)"'])|(?:\$env:TE?MP|%TE?MP%|\$\{?TMPDIR\}?|\$\{?TMP\}?|\$\{?TEMP\}?|/tmp/|/private/tmp/|/var/tmp/)[^\s&|;)]*)`;
const QUOTED = String.raw`"[^"]*"|'[^']*'`;
const STDERR_REDIRECT = new RegExp(String.raw`(^|[^<>=&|\w])2>>?\s*(?:${QUOTED}|[^\s&|;)"']+)`, "g");
const BENIGN_REDIRECT = new RegExp(String.raw`(^|[^<>=&|])[\d*]?>>?\s*(?:"${BENIGN_TARGET}[^"]*"|'${BENIGN_TARGET}[^']*'|${BENIGN_TARGET})`, "gi");
// Command patterns are tested with quoted strings masked (`git commit -m "rm -rf x"` is a message, not a command);
// inline-script patterns need the quoted code and are tested on the raw text.
const MUTATING_SHELL = [
  // Cmdlets count in command position only (`grep Set-Content file` searches for the word).
  /(^|[;&|({])\s*(?:\$[\w:]+\s*=\s*)?(?:&\s*)?(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|Set-Item|Clear-Item|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Expand-Archive|Compress-Archive|Export-Csv|Export-Clixml|Tee-Object)\b/im,
  /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm|curl|wget)\b[^;&|\n]*\s(-OutFile|-o|-O|--output)\b/i,
  /(^|[\s;&|(])(rm|mv|cp|del|erase|rd|rmdir|mkdir|touch|truncate|tee|chmod|chown|ln)\s/i,
  /\bsed\s+(-[a-z]*i|--in-place)/i,
  /\bperl\s+-[a-z]*i/i,
  /\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(reset|checkout|switch|merge|rebase|restore|clean|stash|apply|am|cherry-pick|revert|rm|mv|pull)\b/i,
  /\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?push\b[^;&|\n]*\s(-f|--force(-with-lease)?|--delete|-d)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|update|upgrade|ci|link)\b/i,
  /\b(pip|pip3|uv|poetry|cargo|go|dotnet|gem|composer)\s+(install|add|remove|uninstall|get|update)\b/i,
  /\b(Write|Append)All(Text|Lines|Bytes)\b|\[IO\.(File|Directory)\]::(Create|Delete|Move|Copy|Replace|Open)|\bStreamWriter\b/i,
];
const MUTATING_INLINE = [
  // Inline scripts that touch the file system: node/bun/deno, python, ruby, perl.
  /\b(node|bun|deno)\b[^;&|\n]*\s(-e|--eval|-p|--print)\b.*\b(writeFile|appendFile|createWriteStream|rmSync|rmdirSync|unlink|rename|copyFile|mkdir|truncate|cpSync|symlink|chmod)/i,
  /\bpython3?\b[^;&|\n]*\s-c\b.*(open\([^)]*,\s*(mode\s*=\s*)?['"][^'"]*[wax+]|\b(remove|unlink|rmtree|rename|replace|makedirs|mkdir|write_text|write_bytes|copy|move)\b)/i,
  /\b(ruby|perl)\b[^;&|\n]*\s-e\b.*\b(File\.(write|open|delete|rename)|unlink|rename|open\s*\(?\s*[\w$]+\s*,\s*['"][>+])/i,
];

/** Shell text that names files only ICED may change. */
export const PROTECTED_SHELL_TARGETS = /(intent[\\/][^\s"']+[\\/](iced\.md|evidence\.md|verify\.json)|\.iced[\\/](config\.json|active|metrics\.jsonl))/i;
// A unit folder, the intent/ folder or .iced/ as a whole: deleting or moving these destroys owned files.
const PROTECTED_DIR = String.raw`(?:intent(?:[\\/][^\s"'\\/&|;)]+)?|\.iced)[\\/]?(?=$|[\s"'&|;)])`;

// Commands and APIs that write to the path they are given, checked per command segment.
// Command names are anchored at the start of the segment (after an optional assignment or `&`), so a command
// name used as an argument (`grep Set-Content file`) does not count. A protected path may carry a prefix
// (`./`, an absolute directory); a copy destination ends the segment apart from trailing redirects.
const PROTECTED_TARGET = PROTECTED_SHELL_TARGETS.source;
const PFX = String.raw`["']?[^\s"'&|;<>]*?`;
const END = String.raw`["']?\s*(?:[\d*]?>>?[^\n]*)?$`;
const CMD = String.raw`^\s*(?:[\w$:.{}-]+\s*=\s*)?(?:&\s*)?(?:sudo\s+)?`;
const DESTRUCTIVE = String.raw`(?:${PROTECTED_TARGET}|(?<=^|[\s"'=])${PFX}${PROTECTED_DIR})`;
const PROTECTED_ANY = new RegExp(DESTRUCTIVE, "i");
// A redirect into a protected path writes it whatever the command is (including `git diff > ...`).
const PROTECTED_REDIRECT = new RegExp(String.raw`(^|[^<>=&|\w])[\d*]?>>?\s*${PFX}${PROTECTED_TARGET}`, "i");
const PROTECTED_WRITERS = [
  PROTECTED_REDIRECT,
  new RegExp(String.raw`${CMD}(Set-Content|Add-Content|Out-File|Clear-Content|New-Item|Set-Item|Clear-Item|Set-ItemProperty|Tee-Object|Export-Csv|Export-Clixml)\b[^\n]*${PROTECTED_TARGET}`, "i"),
  new RegExp(String.raw`${CMD}(Remove-Item|Move-Item|Rename-Item|rm|rmdir|rd|del|erase|mv)\s[^\n]*${DESTRUCTIVE}`, "i"),
  new RegExp(String.raw`${CMD}Copy-Item\b(?:[^\n]*?\s-Destination\s+${PFX}${PROTECTED_TARGET}|[^\n]*?${PFX}${PROTECTED_TARGET}${END})`, "i"),
  new RegExp(String.raw`${CMD}(touch|truncate|tee|ln)\s[^\n]*${PROTECTED_TARGET}`, "i"),
  new RegExp(String.raw`${CMD}cp\s[^\n]*?${PFX}${PROTECTED_TARGET}${END}`, "i"),
  new RegExp(String.raw`${CMD}(sed\s+(-[a-z]*i|--in-place)|perl\s+-[a-z]*i)[^\n]*${PROTECTED_TARGET}`, "i"),
  new RegExp(String.raw`\b((Write|Append)All(Text|Lines|Bytes)|\[IO\.(File|Directory)\]::(Create|Delete|Move|Copy|Replace|Open)|StreamWriter)\b[^\n]*${PROTECTED_TARGET}`, "i"),
  new RegExp(String.raw`\b(writeFile|appendFile|createWriteStream|rmSync|rmdirSync|unlink|rename|copyFile|truncate|cpSync|symlink|write_text|write_bytes|remove|rmtree|replace)\w*\s*\([^)]*${PROTECTED_TARGET}`, "i"),
  new RegExp(String.raw`\bopen\(\s*["']${PFX}${PROTECTED_TARGET}["']\s*,\s*(mode\s*=\s*)?["'][^"']*[wax+]`, "i"),
];
// In a git segment only these subcommands write to the working tree; `git commit -m "..."` never does.
const GIT_WRITER = new RegExp(String.raw`^\s*git\s+(?:-C\s+\S+\s+)?(?:(rm|mv)\s[^\n]*${DESTRUCTIVE}|(checkout|restore|reset)\b[^\n]*${PROTECTED_TARGET})`, "i");

/**
 * The command without heredoc/here-string bodies and quoted strings, which can hold `>` or command names
 * without meaning them. Quoted strings for which `keep(inner)` is true are left in place.
 */
function maskLiterals(command, keep = () => false) {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "")
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "")
    .replace(/"(?:[^"\\`]|[\\`].)*"|'[^']*'/g, (m) => (keep(m.slice(1, -1)) ? m : "''"));
}

const withoutLiterals = (command) => maskLiterals(command);

/** The command without redirects that cannot change the repository: stderr-only, discard devices, temp locations. */
function withoutBenignRedirects(command) {
  return command.replace(STDERR_REDIRECT, "$1").replace(BENIGN_REDIRECT, "$1");
}

/** Heuristic: does this shell command look like it changes files or repository state? Not a sandbox. */
export function isMutatingShell(command) {
  const c = String(command ?? "");
  const masked = withoutLiterals(c);
  return REDIRECT.test(withoutLiterals(withoutBenignRedirects(c))) || MUTATING_SHELL.some((re) => re.test(masked)) || MUTATING_INLINE.some((re) => re.test(c));
}

/**
 * A quoted string that is a path (no whitespace) or inline code (contains a call) keeps its meaning; a quoted
 * message or search pattern (`grep 'Set-Content intent/x/iced.md'`, `git commit -m "..."`) does not.
 */
function quotedPathOrCode(inner) {
  return PROTECTED_ANY.test(inner) && (!/\s/.test(inner) || /\(/.test(inner));
}

/**
 * Heuristic: does this shell command write to a file only ICED may change? Reading such a file does not count,
 * nor do command names or paths quoted inside messages and search patterns.
 */
export function writesProtectedShellTarget(command) {
  const c = String(command ?? "");
  if (!PROTECTED_ANY.test(c)) return false;
  const masked = maskLiterals(c, quotedPathOrCode);
  return masked.split(SEGMENT_SPLIT).some((raw) => {
    // Discard/temp redirects are dropped so `cp a <protected> > /dev/null` still ends with its destination;
    // a stderr redirect into a protected path is a write and stays.
    const seg = raw.replace(/^\(+\s*/, "").replace(/\s*\)+$/, "").replace(BENIGN_REDIRECT, "$1");
    if (!PROTECTED_ANY.test(seg)) return false;
    if (/^\s*git\b/i.test(seg)) return GIT_WRITER.test(seg) || PROTECTED_REDIRECT.test(seg);
    return PROTECTED_WRITERS.some((re) => re.test(seg));
  });
}

// ---------------------------------------------------------------------------
// Where a shell command operates
// ---------------------------------------------------------------------------

const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\||\r?\n)\s*/;
const CD_WORDS = new Set(["cd", "chdir", "sl", "set-location", "pushd", "push-location"]);
const PUSHD_WORDS = new Set(["pushd", "push-location"]);
const POPD_WORDS = new Set(["popd", "pop-location"]);
// Commands whose operands are the files they change, so they may run from inside the root against outside paths.
// Anything else (package managers, sed -i, git without -C, redirects) works in its working directory.
const FILE_CMDS = new Set(["rm", "rmdir", "rd", "del", "erase", "mv", "cp", "mkdir", "md", "touch", "truncate", "ln", "chmod", "chown", "sed", "perl",
  "remove-item", "move-item", "copy-item", "new-item", "rename-item", "clear-content", "set-content", "add-content", "out-file"]);
// Segments that only end the shell when a preceding `cd` failed (`cd dir || exit 1`).
const EXITS = /^(exit|return|throw|die)\b/i;
const UNRESOLVABLE = /[$%]/;

/** The file operands of an in-place sed or perl edit: flags and the script expression are not paths. */
function scriptFiles(operands) {
  const files = [];
  let script = false;
  for (let i = 0; i < operands.length; i++) {
    const t = operands[i];
    if (/^-(e|f|E|--expression|--file)$/.test(t)) { i++; script = true; continue; }
    if (/^--(expression|file)=/.test(t)) { script = true; continue; }
    if (t.startsWith("-")) { if (/^-[a-z]*e$/i.test(t)) { i++; script = true; } continue; }
    if (!script) { script = true; continue; }
    files.push(t);
  }
  return files;
}

/** Whitespace-separated tokens with surrounding quotes removed; quoted tokens may contain spaces. */
function tokens(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Resolve a path token against `cwd`; null when it contains anything we cannot resolve (variables, globs). */
function resolveToken(cwd, raw) {
  let p = raw.replace(/^["']|["']$/g, "");
  p = p
    .replace(/^\$env:(?:TEMP|TMP)\b|^%(?:TEMP|TMP)%|^\$\{?TMPDIR\}?/i, os.tmpdir())
    .replace(/^\$env:USERPROFILE\b|^%USERPROFILE%|^\$\{?HOME\}?|^~(?=[\\/]|$)/i, os.homedir());
  if (process.platform === "win32") p = p.replace(/^\/mnt\/([a-z])(?=\/|$)/i, (_m, d) => `${d}:`);
  if (UNRESOLVABLE.test(p) || /[*?]/.test(p)) return null;
  if (!cwd) return null;
  return path.resolve(cwd, p);
}

/**
 * Does every mutation in this command happen outside `root`? True only when the command is mutating and, for
 * every mutating segment, the effective working directory and every operand (absolute, relative or bare;
 * anything after the command word that is not a flag) resolve outside the root. Variables, globs and directories
 * we cannot follow count as inside, as does changing directory back into the root.
 */
export function shellMutatesOnlyOutside(root, cwd, command) {
  const c = String(command ?? "");
  if (!isMutatingShell(c)) return false;
  let sawMutation = false;
  for (const m of mutatingSegments(cwd ?? root, c)) {
    sawMutation = true;
    if (m.unresolvable) return false;
    if (isInside(root, m.segDir) && !(FILE_CMDS.has(m.word) && m.paths.length)) return false;
    for (const t of m.paths) {
      const abs = resolveToken(m.segDir, t);
      if (abs === null || isInside(root, abs)) return false;
    }
  }
  return sawMutation;
}

const REDIRECT_TARGETS = /(?:^|[^<>=&|\w])[\d*]?>>?\s*("[^"]*"|'[^']*'|[^\s&|;)]+)/g;
const PROTECTED_REL_FILE = /^(?:intent\/[^/]+\/(?:iced\.md|evidence\.md|verify\.json)|\.iced\/(?:config\.json|active|metrics\.jsonl))$/i;
const PROTECTED_REL_DIR = /^(?:intent|intent\/[^/]+|\.iced)$/i;
const DESTRUCTIVE_CMDS = new Set(["rm", "rmdir", "rd", "del", "erase", "mv", "remove-item", "move-item", "rename-item"]);
const COPY_CMDS = new Set(["cp", "copy-item"]);

/**
 * Does this command write to an ICED-owned file once paths are resolved against the directories it moves
 * through (`cd .iced && echo '{}' > config.json`)? Complements writesProtectedShellTarget, which matches the
 * literal text. Copies count only their destination; git counts only its tree-writing subcommands.
 */
export function shellWritesProtectedPath(root, cwd, command) {
  const c = String(command ?? "");
  if (!isMutatingShell(c)) return false;
  const rel = (abs) => {
    const r = path.relative(root, abs).replace(/\\/g, "/");
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : null;
  };
  for (const m of mutatingSegments(cwd ?? root, c)) {
    if (m.unresolvable) continue;
    // Operands are targets only for commands that write to their operands; `grep rm <file>` reads it.
    let targets = FILE_CMDS.has(m.word) || m.word === "git" ? m.paths : [];
    if (m.word === "git") {
      if (!/^\s*git\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(rm|mv|checkout|restore|reset)\b/i.test(m.seg)) continue;
      targets = targets.filter((t) => !/^(rm|mv|checkout|restore|reset)$/.test(t));
    }
    if (COPY_CMDS.has(m.word)) {
      const i = m.operands.findIndex((t) => /^-Destination$/i.test(t));
      targets = i >= 0 && m.operands[i + 1] ? [m.operands[i + 1]] : targets.slice(-1);
    }
    for (const r of m.seg.matchAll(REDIRECT_TARGETS)) targets = [...targets, r[1]];
    const destructive = DESTRUCTIVE_CMDS.has(m.word) || (m.word === "git" && /\b(rm|mv)\b/.test(m.seg));
    for (const t of targets) {
      const abs = resolveToken(m.segDir, t);
      if (abs === null) continue;
      const r = rel(abs);
      if (r === null) continue;
      if (PROTECTED_REL_FILE.test(r) || (destructive && PROTECTED_REL_DIR.test(r))) return true;
    }
  }
  return false;
}

/**
 * The mutating segments of a command with the directory each one runs in, following cd/pushd/popd, subshells,
 * `cd X || ...` and `git -C`. Yields `{ unresolvable: true }` for a mutation whose directory cannot be followed.
 */
function* mutatingSegments(cwd, c) {
  let dir = path.resolve(cwd);
  const stack = [];
  const subshells = [];
  // After `cd X || ...` the next segment runs only when the cd failed, in the directory before it.
  let failedCdDir;
  const parts = c.split(/\s*(&&|\|\||;|\||\r?\n)\s*/);
  for (let p = 0; p < parts.length; p += 2) {
    let seg = parts[p].trim();
    const sepBefore = (parts[p - 1] ?? "").trim();
    const sepAfter = (parts[p + 1] ?? "").trim();
    if (!seg) continue;
    // `( ... )` runs in a subshell: a `cd` inside it does not outlive the closing parenthesis.
    const opens = /^\(+/.exec(seg)?.[0].length ?? 0;
    const closes = /\)+$/.exec(seg)?.[0].length ?? 0;
    seg = seg.slice(opens, seg.length - closes).trim();
    for (let i = 0; i < opens; i++) subshells.push(dir);
    const restore = () => { for (let i = 0; i < closes; i++) dir = subshells.length ? subshells.pop() : null; };
    const toks = tokens(seg);
    if (!toks.length) { restore(); continue; }
    const word = toks[0].toLowerCase();
    // The directory this segment runs in: the pre-cd directory on the failure branch of `cd X || ...`.
    let runDir = dir;
    let ambiguousAfter = false;
    if (failedCdDir !== undefined) {
      if (EXITS.test(seg)) { failedCdDir = undefined; restore(); continue; } // `cd X || exit 1`: later segments run in X
      runDir = failedCdDir;
      failedCdDir = undefined;
      ambiguousAfter = true; // was the cd taken or not? later segments cannot be placed
    }
    if (CD_WORDS.has(word)) {
      // A `cd` in a pipeline runs in its own process and changes nothing for the other segments.
      if (sepBefore === "|" || sepAfter === "|") { restore(); continue; }
      const args = toks.slice(1).filter((t) => !/^-(Path|LiteralPath)$/i.test(t));
      // A bare `cd` goes somewhere shell-specific (home, or nowhere in cmd): we cannot follow it.
      const next = runDir !== null && args[0] !== undefined ? resolveToken(runDir, args[0]) : null;
      if (PUSHD_WORDS.has(word)) stack.push(runDir);
      if (sepAfter === "||") failedCdDir = runDir;
      dir = ambiguousAfter ? null : next;
      restore();
      continue;
    }
    if (POPD_WORDS.has(word)) { dir = stack.length ? stack.pop() : null; restore(); continue; }
    if (ambiguousAfter) dir = null;
    if (!isMutatingShell(seg)) { restore(); continue; }
    if (runDir === null) { yield { unresolvable: true }; return; }
    // `git -C <dir> ...` runs in <dir>: pathspecs resolve there.
    let segDir = runDir;
    let operands = toks.slice(1);
    if (word === "git" && operands[0] === "-C" && operands[1] !== undefined) {
      segDir = resolveToken(runDir, operands[1]);
      if (segDir === null) { yield { unresolvable: true }; return; }
      operands = operands.slice(2);
    }
    const fileOperands = word === "sed" || word === "perl" ? scriptFiles(operands) : operands;
    // Operands are paths; so is the value of a `--flag=value` (`cp --target-directory=. a b`).
    const paths = fileOperands.flatMap((t) => (!t ? [] : t.startsWith("-") ? (t.includes("=") ? [t.slice(t.indexOf("=") + 1)] : []) : [t])).filter(Boolean);
    yield { seg, word, segDir, operands, paths };
    restore();
  }
}
