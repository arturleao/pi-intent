// Runs ICED's verifier and test writer agents as one-shot pi subprocesses.
// iced-core describes the job (prompt, role, access, model, effort); this module turns it into a pi command line.

import fs from "node:fs";
import path from "node:path";
import { runProcess } from "@arturleao/iced-core/verify";

export const SHELL_TOOL = process.platform === "win32" ? "powershell" : "bash";

/** pi tools per access level. Read-only agents also get the shell, which the extension's verifier role guards. */
export const TOOLS = {
  "read-only": ["read", "grep", "find", "ls", SHELL_TOOL],
  write: ["read", "grep", "find", "ls", "write", "edit", SHELL_TOOL],
};

const WIN_EXTS = [".exe", ".cmd", ".bat", ".ps1"];

export function findOnPath(name) {
  const dirs = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" && !path.extname(name) ? WIN_EXTS : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

const winQuote = (a) => (/^[\w@+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** How to spawn a command with arguments safely, including Windows .cmd and .ps1 shims. */
export function spawnSpec(command, args) {
  if (process.platform !== "win32") return { command, args, verbatim: false };
  const found = path.isAbsolute(command) ? command : (findOnPath(command) ?? command);
  const ext = path.extname(found).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[found, ...args].map(winQuote).join(" ")}"`], verbatim: true };
  }
  if (ext === ".ps1") return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", found, ...args], verbatim: false };
  return { command: found, args, verbatim: false };
}

/** How to start pi again from inside a running pi process (same binary and script), else `pi` from PATH. */
export function piInvocation(args) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/") && fs.existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  const exe = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(exe)) return { command: process.execPath, args };
  return { command: "pi", args };
}

/** pi arguments for one job: print mode, no session, the access level's tools, model, thinking, the prompt file. */
export function piArgs({ promptFile, access, model, effort }) {
  const tools = TOOLS[access] ?? TOOLS["read-only"];
  const args = ["-p", "--no-session", "--tools", tools.join(",")];
  if (model) args.push("--model", model);
  if (effort) args.push("--thinking", effort);
  args.push(`@${promptFile}`, "Follow the attached instructions exactly.");
  return args;
}

function tempDir(root, role) {
  const dir = path.join(root, ".iced", "tmp", `${role}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * An iced-core Agent that runs each job as a pi subprocess. The child gets ICED_ROLE so the extension, loaded again
 * in the child, enforces read-only verifiers.
 * @param {{ invocation?: (args: string[]) => { command: string, args: string[] } }} [opts]
 */
export function piAgent({ invocation = piInvocation } = {}) {
  return async function runPi({ root, prompt, role, access, model = null, effort = null, timeoutSec = 900, signal }) {
    const dir = tempDir(root, role);
    const promptFile = path.join(dir, "prompt.md");
    fs.writeFileSync(promptFile, prompt, "utf8");
    const inv = invocation(piArgs({ promptFile, access, model, effort }));
    const spec = spawnSpec(inv.command, inv.args);
    try {
      const r = await runProcess(spec.command, spec.args, {
        cwd: root, timeoutSec, signal, verbatim: spec.verbatim, env: { ...process.env, ICED_ROLE: role },
      });
      return { ok: r.exitCode === 0, text: r.stdout, output: r.output, exitCode: r.exitCode, timedOut: r.timedOut };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    }
  };
}
