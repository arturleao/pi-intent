// ICED init: set up a repository's ICED files (.iced/ and intent/). Idempotent: safe to run repeatedly.
// Writes only ICED's own files; hosts add whatever they need on top.

import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT, defaultConfig, TYPES } from "./core.mjs";

export const INTENT_README = `# intent/

Each folder is one ICED unit of work: \`<id>/iced.md\` (the human-owned contract), \`decisions.md\`
(agent decision log), \`evidence.md\` and \`verify.json\` (verification results).

Units are created, signed off, verified and accepted through the ICED tooling, not by hand.
`;

export const PRODUCT_MEMORY = `# Product memory

<!-- What this product is, who uses it, and how it must behave. Agents read this as [product] context.
     Keep it short and factual; update it when a unit changes product behavior. -->

## Purpose

## Users

## Key behaviors and rules

## Non-functional expectations
`;

export const KNOWLEDGE_MEMORY = `# Knowledge base

<!-- Org and team standards agents read as [knowledge] context: conventions, patterns, security and
     compliance rules. For enterprise use, list shared knowledge files in .iced/config.json memory.knowledge. -->

## Engineering standards

## Security and compliance

## Patterns to prefer / avoid
`;

function writeFile(file, content, { overwrite }, result, root) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const existed = fs.existsSync(file);
  if (existed && !overwrite) { result.skipped.push(rel); return; }
  if (existed && fs.readFileSync(file, "utf8") === content) { result.skipped.push(rel); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  (existed ? result.updated : result.created).push(rel);
}

function ensureLines(file, lines, result, root) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n") : "";
  const have = new Set(current.split("\n").map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (!missing.length) { result.skipped.push(path.relative(root, file).replace(/\\/g, "/")); return; }
  writeFile(file, `${current.replace(/\n*$/, current ? "\n" : "")}${missing.join("\n")}\n`, { overwrite: true }, result, root);
}

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

/**
 * Create or refresh ICED's files in `root`:
 * .iced/config.json (kept unless force), .iced/memory/ (kept), .iced/templates/ (refreshed), intent/README.md (kept),
 * and the .gitattributes / .gitignore lines ICED needs. Never deletes anything.
 * @returns {{ created: string[], updated: string[], skipped: string[] }}
 */
export function initRepo(root, { force = false, packageRoot = PACKAGE_ROOT } = {}) {
  const result = { created: [], updated: [], skipped: [] };
  const iced = path.join(root, ".iced");

  const base = defaultConfig();
  const config = { ...base, verify: { ...base.verify, commands: detectVerifyCommands(root) } };
  writeFile(path.join(iced, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { overwrite: force }, result, root);

  writeFile(path.join(iced, "memory", "product.md"), PRODUCT_MEMORY, { overwrite: false }, result, root);
  writeFile(path.join(iced, "memory", "knowledge.md"), KNOWLEDGE_MEMORY, { overwrite: false }, result, root);
  for (const type of TYPES) {
    const src = path.join(packageRoot, "spec", "templates", `${type}.md`);
    if (fs.existsSync(src)) writeFile(path.join(iced, "templates", `${type}.md`), fs.readFileSync(src, "utf8"), { overwrite: true }, result, root);
  }
  writeFile(path.join(root, "intent", "README.md"), INTENT_README, { overwrite: false }, result, root);
  ensureLines(path.join(root, ".gitattributes"), ["intent/**/*.md text eol=lf"], result, root);
  ensureLines(path.join(root, ".gitignore"), [".iced/active", ".iced/tmp/"], result, root);
  return result;
}
