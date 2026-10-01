#!/usr/bin/env node
// Lockstep release for the workspace: bumps @arturleao/iced-core and @arturleao/pi-intent to one version,
// points pi-intent at the new iced-core, refreshes package-lock.json, runs the tests, then creates the
// release commit `chore(release): vX.Y.Z` and the annotated tag `vX.Y.Z`. Push with `git push --follow-tags`;
// the tag triggers .github/workflows/publish.yml.
//
// Usage: node scripts/release.mjs <major|minor|patch|X.Y.Z> [--dry-run]
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

if (!bump) die("usage: node scripts/release.mjs <major|minor|patch|X.Y.Z> [--dry-run]");

const coreVersion = JSON.parse(read(CORE)).version;
const piVersion = JSON.parse(read(PI)).version;
if (coreVersion !== piVersion) die(`packages are out of lockstep (iced-core ${coreVersion}, pi-intent ${piVersion})`);

const version = next(coreVersion, bump);
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
sh("npm", ["test"], { inherit: true });

sh("git", ["add", CORE, PI, "package-lock.json"]);
sh("git", ["commit", "-m", `chore(release): ${tag}`]);
sh("git", ["tag", "-a", tag, "-m", tag]);
console.log(`release: created ${tag}. Push with: git push --follow-tags`);
