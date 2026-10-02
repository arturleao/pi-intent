// ICED gate for pi: decides whether a pi tool call (write, edit, bash, powershell) may run.
// The extension turns decisions into block / confirm / notify. Classification comes from the core guard.

import fs from "node:fs";
import { changedContractSections, contractHash, getActive, lintIced, parseIced, readUnit } from "@arturleao/iced-core";
import {
  CONFIG_INTEGRITY_KEYS, changedConfigIntegrityKeys, changedProtectedKeys, classifyPath, isMutatingShell,
  predictFileContent, shellMutatesOnlyOutside, shellWritesProtectedPath, writesProtectedShellTarget,
} from "@arturleao/iced-core/guard";

export { classifyPath, changedProtectedKeys, isMutatingShell, CONFIG_INTEGRITY_KEYS };

/** pi's file tools: the content a write/edit call would produce, or null when it cannot be predicted. */
export function predictContent(toolName, input, abs) {
  if (toolName === "write") return predictFileContent(abs, { content: String(input?.content ?? "") });
  if (toolName === "edit") return predictFileContent(abs, { edits: input?.edits ?? [] });
  return null;
}

export const SHELL_TOOLS = ["bash", "powershell"];

/** Tools a read-only verifier agent may use. Everything else (write, edit, any shell, extension tools) is blocked. */
export const VERIFIER_TOOLS = ["read", "grep", "find", "ls"];

/** Tool rule for verifier agents (ICED_ROLE=verifier): read tools only. */
export function verifierToolDecision(toolName) {
  if (VERIFIER_TOOLS.includes(toolName)) return { action: "allow" };
  return { action: "block", reason: `The ICED verifier is read-only and may use only ${VERIFIER_TOOLS.join(", ")}. Next step: continue with read-only commands (${VERIFIER_TOOLS.join(", ")}) and the check results in the prompt, then answer with your verdict.` };
}

/** A short, bounded rendering of a list for a block reason: the first few items and a count of the rest. */
function brief(items, max = 3) {
  const list = items.map(String);
  return list.length <= max ? list.join(", ") : `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

const block = (reason) => ({ action: "block", reason });
/** A block that protects ICED's guarantees (owned files, protected keys, frozen contract, config integrity, read-only reviews). Gate mode `warn` must not downgrade it. */
const hard = (reason) => ({ action: "block", hard: true, reason });
const notify = (reason) => ({ action: "notify", reason });
const allow = { action: "allow" };

/** The human command or tool that moves a unit forward from `status`. */
function nextStep(id, status) {
  switch (status) {
    case "draft": return `Next step: finish the draft of intent/${id}/iced.md and call iced_request_signoff.`;
    case "approved": return `Next step: call iced_build when the human asks for the implementation, or ask them to run /iced build ${id}.`;
    case "verifying": return `Next step: wait for the verdict, then ask the human for /iced accept ${id} or /iced reject ${id}; notes go in intent/${id}/decisions.md.`;
    case "done": return `Next step: ask the human to run /iced accept ${id} (or /iced reject ${id} <reason>); record notes in intent/${id}/decisions.md.`;
    case "blocked": return `Next step: ask the human for /iced build ${id} (retry) or /iced reject ${id}; note what you would change in intent/${id}/decisions.md.`;
    default: return `Next step: record what you intended in intent/${id}/decisions.md and ask the human how to proceed.`;
  }
}

const START = "Next step: call iced_start with the request, draft the unit, then call iced_request_signoff.";

/**
 * Decide on a tool call. Code and shell changes are gated only while a unit is active, unless `always`
 * (config gate "always") also gates them when no unit is active. ICED's own files are protected either way.
 * At effective autonomy 2 or 3 the "code only while building" rule notifies instead of blocking.
 * Blocks that protect ICED's guarantees carry `hard: true`; hosts must not downgrade those in a warn mode.
 * @returns {{action: "allow"} | {action: "notify", reason: string} | {action: "block", reason: string, hard?: true} | {action: "confirm", title: string, message: string}}
 */
export function gateDecision({ root, cwd, toolName, input, autonomy = 1, always = false }) {
  if (!root) return allow;
  const activeId = getActive(root);
  let active = null;
  try { active = activeId ? readUnit(root, activeId) : null; } catch { active = null; }
  if (active && ["accepted", "rejected"].includes(active.parsed.frontmatter.status)) active = null;
  const status = active?.parsed.frontmatter.status ?? null;
  const type = active?.parsed.frontmatter.type ?? null;
  const building = status === "building";
  const trusted = autonomy >= 2;

  if (toolName === "write" || toolName === "edit") {
    const target = classifyPath(root, cwd, input?.path);
    switch (target.kind) {
      case "outside": case "memory": case "meta": case "decisions": case "aux": return allow;
      case "owned":
        return hard(`${target.rel} is written only by the ICED tooling. Next step: use iced_submit for evidence, iced_decision for decisions, or write notes to intent/<id>/decisions.md.`);
      case "config": {
        const next = predictContent(toolName, input, target.abs);
        if (next === null) return hard(`Cannot validate ${target.rel}; use unique, non-empty, non-overlapping original-text edits or write the complete file. Next step: read the file and retry with exact text, or ask the human to run /iced models.`);
        let current = "";
        try { current = fs.readFileSync(target.abs, "utf8"); } catch { current = ""; }
        const changed = changedConfigIntegrityKeys(current, next);
        if (changed === null) return hard(`${target.rel} must stay valid JSON. Next step: write the complete, valid config or use iced_decision to record what you need.`);
        if (changed.length) return hard(`Do not change ${brief(changed)} in ${target.rel}; those keys decide trust and verification and belong to the human. Next step: ask the human to run /iced autonomy, /iced gate or /iced models, and record the request in intent/<id>/decisions.md.`);
        return allow;
      }
      case "unit": {
        let unit = null;
        try { unit = readUnit(root, target.id); } catch { unit = null; }
        if (!unit) return hard(`Create units with /iced or the iced_start tool, not by writing ${target.rel} directly. ${START}`);
        const st = unit.parsed.frontmatter.status;
        if (["accepted", "rejected"].includes(st)) {
          return hard(`${target.id} is ${st} and closed. Next step: call iced_start for new work, or write notes to intent/${target.id}/decisions.md.`);
        }
        const next = predictContent(toolName, input, target.abs);
        if (next === null) return hard(`Cannot validate protected fields in ${target.rel}; use unique, non-empty, non-overlapping original-text edits or write the complete file. Next step: read the file and retry with exact text, or use iced_decision.`);
        const changed = changedProtectedKeys(unit.text, next);
        // A unit blocked before sign-off has no approved contract; only protected keys are frozen.
        const hash = st === "draft" ? undefined : unit.parsed.frontmatter.contract_hash;
        const sections = hash ? changedContractSections(unit.text, next) : [];
        if (changed.length) {
          const frozen = sections.length ? ` ${sections.join(" and ")} is frozen too: for that, call iced_escalate with kind "change-expectation".` : "";
          return hard(`Do not change ${brief(changed)} in ${target.rel}; those fields are owned by the human and the ICED tooling.${frozen} Next step: sign-off happens through iced_request_signoff; record anything else with iced_decision.`);
        }
        if (st === "draft") return allow;
        if (hash && (sections.length || hash !== contractHash(next))) {
          const what = sections.length ? sections.join(" and ") : "the contract";
          return hard(`${target.id} is ${st}: ${what} is frozen after sign-off; Context and Open questions may still be edited. Next step: call iced_escalate with kind "change-expectation" and a proposal, or write notes to intent/${target.id}/decisions.md.`);
        }
        const lint = lintIced(parseIced(next), "validate", next);
        if (lint.errors.length) {
          const more = lint.errors.length > 1 ? ` (and ${lint.errors.length - 1} more)` : "";
          return hard(`That edit would make ${target.rel} invalid: ${String(lint.errors[0].message).slice(0, 120)}${more} Next step: fix the edit, or record notes in intent/${target.id}/decisions.md.`);
        }
        return allow;
      }
      case "code":
      default: {
        if (!active) return always ? block(`No active ICED unit, and this repo gates every code change (gate: always). ${START}`) : allow;
        if (type === "review") return hard(`${activeId} is a review unit: read-only. Next step: write findings to intent/${activeId}/review.md and record decisions with iced_decision.`);
        if (!building) {
          const reason = `Active unit ${activeId} is ${status}; code changes are expected only while building. ${nextStep(activeId, status)}`;
          return trusted ? notify(`${reason} Allowed at autonomy ${autonomy}; verification will check the changes against the contract.`) : block(reason);
        }
        if (autonomy === 0) return { action: "confirm", title: `ICED (${activeId}, autonomy 0)`, message: `Allow ${toolName} to ${target.rel}?` };
        return allow;
      }
    }
  }

  if (SHELL_TOOLS.includes(toolName)) {
    const command = String(input?.command ?? "");
    // Writes to ICED-owned paths are hard-blocked, unless every mutation resolves outside this repository
    // (another checkout's intent/ folder is not ours). Paths are also resolved through `cd` (`cd .iced && ...`).
    if ((writesProtectedShellTarget(command) && !shellMutatesOnlyOutside(root, cwd, command)) || shellWritesProtectedPath(root, cwd, command)) {
      return hard("That command would write to ICED-owned files (iced.md, evidence.md, verify.json or .iced state); reading them is fine. Next step: edit notes in iced.md (Context, Open questions) or operational config keys with the edit tool, submit evidence with iced_submit, record anything else with iced_decision.");
    }
    const mutating = isMutatingShell(command);
    if (!mutating || (!active && !always)) return allow;
    if (building && type !== "review") {
      if (autonomy === 0) return { action: "confirm", title: `ICED (${activeId}, autonomy 0)`, message: `Allow ${toolName}: ${command.slice(0, 200)}?` };
      return allow;
    }
    if (shellMutatesOnlyOutside(root, cwd, command)) return allow;
    if (type === "review") return hard(`${activeId} is a review unit: read-only. Read-only commands are fine. Next step: write findings to intent/${activeId}/review.md and record decisions with iced_decision.`);
    if (!active) return block(`This command looks like it changes files or repository state, and there is no active ICED unit (gate: always). Read-only commands are fine. ${START}`);
    const reason = `This command looks like it changes files or repository state, and unit ${activeId} is ${status}. Read-only commands and changes outside this repository are fine. ${nextStep(activeId, status)}`;
    return trusted ? notify(`${reason} Allowed at autonomy ${autonomy}; verification will check the changes against the contract.`) : block(reason);
  }

  return allow;
}
