import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function tempDir(prefix = "iced-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Temp dir with .iced/ (config only) and optionally a git repo with one commit. */
export function tempRepo({ git = false, config } = {}) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, ".iced"), { recursive: true });
  if (config) fs.writeFileSync(path.join(root, ".iced", "config.json"), JSON.stringify(config));
  if (git) {
    const g = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    g("init", "-q");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  }
  return root;
}

export const FILLED_BODY = `
# Dark mode

## Intent

### Goal
Users can switch to a dark theme
from Settings and it persists.

### Constraints
- [C1] No new runtime dependencies.
- [C2] Light theme unchanged.

### Failure conditions
- [F1] Theme resets after reload.

### Scope
- In: settings toggle, persistence
- Out: marketing site, per-component theming

## Context
- [code] Tokens live in src/styles/tokens.css.
- [assumed] Persist in localStorage.

## Expectations
- [E1] Toggle switches theme without reload. {verify: test | tests/theme.spec.ts}
- [E2] Choice persists across reloads. {verify: check}

## Open questions
- [Q1] Follow OS preference by default? -> A: yes
`;

export function unitText(fm = {}, body = FILLED_BODY) {
  const data = {
    iced: "0.1", id: "001-dark-mode", title: "Dark mode", type: "feature", tier: "M", parent: null,
    status: "draft", autonomy: 1, risk: "low", attempts: 0, ...fm,
  };
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v === null ? "null" : v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/** Write a unit folder directly (bypassing templates). */
export function writeUnit(root, id, text) {
  const dir = path.join(root, "intent", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "iced.md"), text);
  return path.join(dir, "iced.md");
}
