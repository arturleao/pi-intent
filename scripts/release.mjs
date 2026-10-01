#!/usr/bin/env node
// Lockstep release for the workspace: bumps @arturleao/iced-core and @arturleao/pi-intent to one version,
// points pi-intent at the new iced-core, refreshes package-lock.json, runs the tests, then creates the
// release commit `chore(release): vX.Y.Z` and the annotated tag `vX.Y.Z`.
//
// `auto` derives the bump from the Conventional Commits since the last tag (rules in CONTRIBUTING.md) and exits 0
// without changes when nothing is releasable. .github/workflows/publish.yml runs `auto` on every push to main,
// then pushes, publishes and creates the GitHub release.
//
// Usage: node scripts/release.mjs <auto|major|minor|patch|X.Y.Z> [--dry-run] [--no-test]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "packages/iced-core/package.json";
const PI = "packages/pi-intent/package.json";
const CORE_NAME = "@arturleao/iced-core";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noTest = args.includes("--no-test");
const bump = args.find((a) => !a.startsWith("--"));

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && cmd === "npm" });
const die = (msg) => { console.error(`release: ${msg}`); process.exit(1); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function next(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [maj, min, pat] = current.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  return die(`unknown bump "${kind}"; use major, minor, patch or X.Y.Z`);
}

// Rewrite only the fields we own so the manifests keep their hand formatting.
function setVersion(text, version) {
  const out = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (out === text && !text.includes(`"version": "${version}"`)) die("could not set version");
  return out;
}

/** Write key=value to $GITHUB_OUTPUT when running in Actions. */
function output(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/**
 * Bump from commits since the last v* tag. feat/fix/perf/revert release; breaking (`!` or BREAKING CHANGE footer)
 * bumps MAJOR, or MINOR before 1.0.0, where features and fixes bump PATCH. Returns null when nothing is releasable.
 */
function autoBump(current) {
  let range = "HEAD";
  try { range = `${sh("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]).trim()}..HEAD`; } catch { /* no tag yet */ }
  const log = sh("git", ["log", range, "--format=%s%x1f%b%x1e"]);
  let level = 0; // 1 patch, 2 minor, 3 major
  for (const entry of log.split("\x1e")) {
    const [subject = "", body = ""] = entry.trim().split("\x1f");
    const m = /^(\w+)(\([^)]*\))?(!)?:\s/.exec(subject.trim());
    if (!m) continue;
    const type = m[1].toLowerCase();
    if (m[3] || /^BREAKING[ -]CHANGE:/m.test(body)) level = Math.max(level, 3);
    else if (type === "feat") level = Math.max(level, 2);
    else if (["fix", "perf", "revert"].includes(type)) level = Math.max(level, 1);
  }
  if (!level) return null;
  const preOne = current.startsWith("0.");
  if (level === 3) return preOne ? "minor" : "major";
  if (level === 2) return preOne ? "patch" : "minor";
  return "patch";
}

if (!bump) die("usage: node scripts/release.mjs <auto|major|minor|patch|X.Y.Z> [--dry-run] [--no-test]");

const coreVersion = JSON.parse(read(CORE)).version;
const piVersion = JSON.parse(read(PI)).version;
if (coreVersion !== piVersion) die(`packages are out of lockstep (iced-core ${coreVersion}, pi-intent ${piVersion})`);

const kind = bump === "auto" ? autoBump(coreVersion) : bump;
if (!kind) {
  console.log("release: no feat, fix, perf, revert or breaking commits since the last tag; nothing to release");
  output("released", "false");
  process.exit(0);
}
const version = next(coreVersion, kind);
const tag = `v${version}`;
if (version === coreVersion) die(`already at ${version}`);

if (sh("git", ["status", "--porcelain"]).trim()) die("working tree is not clean");
const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
if (branch !== "main") die(`releases are cut from main, not ${branch}`);
if (sh("git", ["tag", "--list", tag]).trim()) die(`tag ${tag} already exists`);

console.log(`release: ${coreVersion} -> ${version}`);
if (dryRun) process.exit(0);

fs.writeFileSync(path.join(ROOT, CORE), setVersion(read(CORE), version));
const piText = setVersion(read(PI), version).replace(new RegExp(`("${CORE_NAME}"\\s*:\\s*")[^"]+(")`), `$1^${version}$2`);
fs.writeFileSync(path.join(ROOT, PI), piText);

sh("npm", ["install", "--package-lock-only", "--ignore-scripts"], { inherit: true });
if (!noTest) sh("npm", ["test"], { inherit: true });

sh("git", ["add", CORE, PI, "package-lock.json"]);
sh("git", ["commit", "-m", `chore(release): ${tag}`]);
sh("git", ["tag", "-a", tag, "-m", tag]);
output("released", "true");
output("tag", tag);
console.log(`release: created ${tag}. Push with: git push --follow-tags`);
