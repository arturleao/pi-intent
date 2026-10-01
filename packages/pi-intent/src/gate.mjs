// ICED gate for pi: decides whether a pi tool call (write, edit, bash, powershell) may run.
// The extension turns decisions into block / confirm / notify. Classification comes from the core guard.

import { getActive, readUnit } from "@arturleao/iced-core";
import { PROTECTED_SHELL_TARGETS, changedProtectedKeys, classifyPath, isMutatingShell, predictFileContent } from "@arturleao/iced-core/guard";

export { classifyPath, changedProtectedKeys, isMutatingShell };

/** pi's file tools: the content a write/edit call would produce, or null when it cannot be predicted. */
export function predictContent(toolName, input, abs) {
  if (toolName === "write") return predictFileContent(abs, { content: String(input?.content ?? "") });
  if (toolName === "edit") return predictFileContent(abs, { edits: input?.edits ?? [] });
  return null;
}

export const SHELL_TOOLS = ["bash", "powershell"];

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

  if (SHELL_TOOLS.includes(toolName)) {
    const command = String(input?.command ?? "");
    const mutating = isMutatingShell(command);
    if (mutating && PROTECTED_SHELL_TARGETS.test(command)) {
      return { action: "block", reason: "That command would modify ICED-owned files (iced.md, evidence, verify.json or .iced state). Use the iced_* tools." };
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
