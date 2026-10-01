// [E1] The core package knows no coding agent: no host imports, no agent names, no agent command lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

// Agent hosts and their command lines. "pi" is matched as a word; "@earendil-works" covers every pi package.
const AGENTS = /@earendil-works|\bpi\b|pi-intent|\b(claude|codex|copilot|gemini|opencode|aider|windsurf)\b|cursor-agent|AGENTS\.md|CLAUDE\.md/i;
const CURSOR = /\bCursor\b|(?<![\w$])\.cursor\b/; // case-sensitive: the editor, not a cursor position
const AGENT_FLAGS = /["'](--no-session|--thinking|--tools|--permission-mode|--sandbox)["']/;

test("core sources, spec, README and manifest name no agent host", () => {
  const scanned = [...files(path.join(PKG, "src")), ...files(path.join(PKG, "spec")), path.join(PKG, "README.md"), path.join(PKG, "package.json")];
  // Where the source is hosted (repository, homepage, bugs) is not a reference to an agent.
  const text = (f) => {
    const raw = fs.readFileSync(f, "utf8");
    if (path.basename(f) !== "package.json") return raw;
    const { repository, homepage, bugs, ...rest } = JSON.parse(raw);
    return JSON.stringify(rest, null, 2);
  };
  const hits = [];
  for (const f of scanned) {
    text(f).split(/\r?\n/).forEach((line, i) => {
      if (AGENTS.test(line) || CURSOR.test(line) || AGENT_FLAGS.test(line)) hits.push(`${path.relative(PKG, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("core has no dependencies and imports only Node built-ins and its own files", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  for (const f of files(path.join(PKG, "src"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/gm)) {
      const spec = m[1] ?? m[2];
      assert.ok(spec.startsWith("node:") || spec.startsWith("./"), `${path.basename(f)} imports ${spec}`);
    }
  }
});
