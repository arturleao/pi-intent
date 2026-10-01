/**
 * ICED for pi: one-line intent -> few questions -> sign-off -> autonomous build -> independent verification.
 * Commands: /iced ...   Tools: iced_start, iced_questions, iced_request_signoff, iced_build, iced_decision,
 * iced_escalate, iced_submit, iced_status.
 */

import fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as core from "../../lib/iced-core.mjs";
import { initRepo, TARGETS } from "../../lib/iced-init.mjs";
import * as picker from "../../lib/iced-picker.mjs";
import { gateDecision, isMutatingShell } from "../../lib/iced-gate.mjs";
import { refreshVerifierAgents, resolveRunner, runTestWriter, submitUnit } from "../../lib/iced-verify.mjs";

const ESCALATION_KINDS = ["ambiguity", "conflict", "change-expectation", "irreversible", "stuck"] as const;
const TYPE_WORDS: Record<string, string> = {
  bug: "bug", fix: "bug", bugfix: "bug", hotfix: "bug",
  feature: "feature", feat: "feature",
  project: "project", epic: "project", program: "project",
  review: "review", audit: "review",
  chore: "chore", refactor: "chore", cleanup: "chore",
};
const SUBCOMMANDS = [
  "init", "child", "list", "status", "use", "approve", "build", "accept", "reject", "abandon", "review",
  "memory", "stats", "autonomy", "models", "gate", "help",
];
const HELP = `ICED: Intent, Context, Expectations, Done

/iced <what you want>          start a unit from one line (bug:/feature:/project:/review:/chore: prefix optional)
/iced child <parent> <line>    start a child unit under a project
/iced list | status [id]       show units
/iced use <id | none>          make a unit active, or none (work outside ICED)
/iced approve [id]             sign off the draft (same as the agent's sign-off prompt)
/iced build [id]               start or resume building an approved/blocked/done unit
/iced accept [id]              accept a verified unit
/iced reject [id] <reason>     send a done unit back to building
/iced abandon [id]             mark a unit rejected
/iced review <id | what>       read-only review of a unit, or a new review unit
/iced memory                   let the agent draft .iced/memory from the repo
/iced stats [apply]            metrics and autonomy promotion suggestions
/iced autonomy <0-3> [id]      set default (or unit) autonomy
/iced models [show]            choose the verifier and test writer models and effort (from your scoped models)
/iced models effort <level|clear> [test-writer]   effort when a model has none: ${core.EFFORTS.join(", ")}
/iced gate <strict|always|warn|off>   gate mode for this session (strict: only while a unit is active)
/iced init [targets...]        set up .iced/, intent/ and agent files (${TARGETS.join(", ")})`;

type Unit = { id: string; text: string; parsed: any; paths: any };

const EXTENSION_NOTE = "ICED runs through the pi-intent extension in this session: use the iced_* tools and /iced commands for every ICED step (they enforce the gates). You do not need the iced skill, the manual steps in .iced/ICED.md, or node .iced/bin/iced.mjs.";

const GUIDELINES = [
  "ICED (intent-driven development) is provided by the pi-intent extension: when the user asks for ICED, an intent, sign-off or expectations, drive it with the iced_* tools and /iced commands, not the iced skill or the .iced/bin CLI.",
  "Start ICED work with iced_start and the user's request (it offers to set up ICED when the repo has none); check progress with iced_status.",
];

const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/;
const MAX_LISTED = 40;

function modelRef(model: any, thinking?: string): string {
  return `${model.provider}/${model.id}${thinking && thinking !== "off" ? `:${thinking}` : ""}`;
}

function sessionModel(ctx: ExtensionContext): string | null {
  return ctx.model ? modelRef(ctx.model) : null;
}

function sessionEffort(ctx: ExtensionContext): string | null {
  const t = ctx.thinkingLevel as string | undefined;
  return t && t !== "off" ? t : null;
}

function describe(root: string, ctx: ExtensionContext): string {
  return core.describeModels(core.loadConfig(root), { sessionModel: sessionModel(ctx), sessionEffort: sessionEffort(ctx) });
}

function saved(root: string): string {
  const written = refreshVerifierAgents(root);
  return written.length ? `\nUpdated ${written.join(", ")}.` : "";
}

const sameModel = (a: string | null, b: string | null) => Boolean(a && b) && a!.replace(THINKING_SUFFIX, "") === b!.replace(THINKING_SUFFIX, "");

/** Scoped models (as in /scoped-models) with their thinking levels, else every model with credentials. */
function modelChoices(ctx: ExtensionContext): { refs: string[]; scoped: boolean; reasoning: Map<string, boolean> } {
  const reasoning = new Map<string, boolean>();
  const note = (m: any) => { if (m && typeof m.reasoning === "boolean") reasoning.set(modelRef(m), m.reasoning); };
  const scopedList: any[] = [...(ctx.scopedModels ?? [])];
  scopedList.forEach((s) => note(s.model));
  let refs = scopedList.map((s) => modelRef(s.model, s.thinkingLevel));
  if (!refs.length) {
    try {
      const all = ctx.modelRegistry.getAvailable();
      all.forEach(note);
      refs = all.map((m: any) => modelRef(m));
    } catch { refs = []; }
  }
  note(ctx.model);
  return { refs: [...new Set(refs)], scoped: scopedList.length > 0, reasoning };
}

type PickResult = { refs: string[] } | { action: string; effort: string | null } | null;
type VerifierChoice = { models: string[]; effort?: string | null } | null;
type TestWriterChoice = { model: string | null; effort?: string | null } | undefined;

const PICKER_WINDOW = 12;

/**
 * Keyboard model picker (terminal only): up/down move, left/right or shift+tab (pi's thinking key) cycle the
 * highlighted model's effort, space adds it to the rotation, typing filters. Returns undefined when custom UI
 * is unavailable (RPC mode), so callers fall back to plain dialogs.
 */
async function runPicker(ctx: ExtensionContext, state: any, opts: { title: string; subtitle?: string; fallbackEffort: string }): Promise<PickResult | undefined> {
  if (ctx.mode !== "tui") return undefined;
  return ctx.ui.custom<PickResult>((tui, theme, _kb, done) => {
    let cache: string[] | undefined;
    const refresh = () => { cache = undefined; tui.requestRender(); };

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) picker.move(state, -1);
      else if (matchesKey(data, Key.down)) picker.move(state, 1);
      else if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.tab) || matchesKey(data, Key.right)) picker.cycle(state, 1);
      else if (matchesKey(data, Key.left)) picker.cycle(state, -1);
      else if (matchesKey(data, Key.space)) picker.toggle(state);
      else if (matchesKey(data, Key.backspace)) picker.backspace(state);
      else if (matchesKey(data, Key.enter)) {
        const r = picker.choose(state);
        if (r) { done(r); return; }
      } else if (matchesKey(data, Key.escape)) {
        if (!state.filter) { done(null); return; }
        picker.clearFilter(state);
      } else if (data.length === 1 && data >= "!" && data <= "~") picker.typeChar(state, data);
      else return;
      refresh();
    }

    const badge = (effort: string | null, reasoning?: boolean) => reasoning === false && !effort
      ? theme.fg("dim", "no thinking")
      : `${theme.fg("muted", "effort ")}${theme.fg(effort ? "accent" : "dim", picker.effortLabel(effort, opts.fallbackEffort))}`;

    function render(width: number): string[] {
      if (cache) return cache;
      const w = Math.max(20, width);
      const line = (s: string) => truncateToWidth(s, w);
      const wrap = (s: string) => wrapTextWithAnsi(s, w - 1).map((x: string) => ` ${x}`);
      const L: string[] = [theme.fg("accent", "─".repeat(w)), line(` ${theme.bold(opts.title)}`)];
      if (opts.subtitle) L.push(...wrap(theme.fg("muted", opts.subtitle)));
      L.push(line(state.filter ? ` ${theme.fg("muted", "Filter:")} ${state.filter}` : ""));
      const vis: number[] = picker.visibleRows(state);
      const start = Math.max(0, Math.min(state.cursor - Math.floor(PICKER_WINDOW / 2), vis.length - PICKER_WINDOW));
      const end = Math.min(vis.length, start + PICKER_WINDOW);
      L.push(theme.fg("dim", start > 0 ? `   ↑ ${start} more` : ""));
      for (let k = start; k < end; k++) {
        const i = vis[k];
        const r = state.rows[i];
        const sel = k === state.cursor;
        const pos = picker.pickedPosition(state, i);
        const mark = !state.multi ? "" : r.kind === "model" ? (pos ? theme.fg("success", `[${pos}] `) : theme.fg("dim", "[ ] ")) : "    ";
        let text: string;
        let extra = "";
        if (r.kind === "model") {
          text = `${r.model}${r.note ? theme.fg("dim", ` (${r.note})`) : ""}`;
          extra = badge(r.effort, r.reasoning);
        } else if (r.kind === "group") {
          text = `${r.label}: ${r.members.map((m: any) => `${m.model}${m.effort ? `:${m.effort}` : ""}`).join(", ")}`;
        } else {
          text = r.label;
          if (r.effortable) extra = badge(r.effort);
        }
        const label = sel ? theme.fg("accent", text) : text;
        L.push(line(`${sel ? theme.fg("accent", "> ") : "  "}${mark}${label}${extra ? `   ${extra}` : ""}`));
      }
      if (!vis.length) L.push(line(`   ${theme.fg("warning", `No model matches "${state.filter}".`)}`));
      L.push(theme.fg("dim", end < vis.length ? `   ↓ ${vis.length - end} more` : ""));
      if (state.message) L.push(line(` ${theme.fg("warning", state.message)}`));
      const keys = [
        "↑↓ move", "←→ or shift+tab: effort",
        ...(state.multi ? [`space: add to rotation (up to ${state.multi})`] : []),
        "type to filter", "enter choose", "esc cancel",
      ];
      L.push(...wrap(theme.fg("dim", keys.join(" • "))));
      L.push(theme.fg("accent", "─".repeat(w)));
      cache = L;
      return L;
    }

    return { render, invalidate: () => { cache = undefined; }, handleInput };
  });
}

/** Dialog fallback: ask the effort for already-chosen models. Returns the refs with :level suffixes. */
async function selectEffort(ctx: ExtensionContext, refs: string[], fallbackEffort: string): Promise<string[]> {
  const bare = refs.map((r) => r.replace(THINKING_SUFFIX, ""));
  const asListed = `As listed (${refs.map((r) => core.splitEffort(r).effort ?? "default").join(", ")})`;
  const def = `default (${fallbackEffort})`;
  const choice = await ctx.ui.select(`Effort for ${bare.join(", ")}`, [asListed, def, ...core.EFFORTS]);
  if (choice === undefined || choice === asListed) return refs;
  const level = choice === def ? null : choice;
  return bare.map((m) => `${m}${level ? `:${level}` : ""}`);
}

async function selectEffortLevel(ctx: ExtensionContext, title: string, current: string | null, fallbackEffort: string): Promise<string | null | undefined> {
  const def = `default (${fallbackEffort})`;
  const keep = current ? `Keep ${current}` : null;
  const choice = await ctx.ui.select(title, [...(keep ? [keep] : []), def, ...core.EFFORTS]);
  if (choice === undefined || choice === keep) return current ?? undefined;
  return choice === def ? null : choice;
}

async function typeModels(ctx: ExtensionContext, title: string): Promise<string[] | null> {
  const v = await ctx.ui.input(title, "provider/model[:thinking], comma-separated for several");
  const list = (v ?? "").split(/[,\s]+/).filter(Boolean);
  return list.length ? list : null;
}

async function chooseSeveral(ctx: ExtensionContext, refs: string[]): Promise<string[] | null> {
  const picked: string[] = [];
  while (picked.length < 3) {
    const done = picked.length ? `Done (${picked.join(", ")})` : null;
    const left = refs.filter((r) => !picked.includes(r)).slice(0, MAX_LISTED);
    const c = await ctx.ui.select(`Verifier model ${picked.length + 1} of up to 3`, [...(done ? [done] : []), ...left]);
    if (c === undefined) return picked.length ? picked : null;
    if (c === done) break;
    picked.push(c);
  }
  return picked;
}

/** Chosen verifier models ([] = don't pin; effort then sets verify.effort for pi), or null to keep the setting. */
async function pickVerifierModels(ctx: ExtensionContext, root: string): Promise<VerifierChoice> {
  const cfg = core.loadConfig(root);
  const current = core.verifyModels(cfg, "pi");
  const pinnedEffort = core.verifyEffort(cfg, "pi");
  const fallbackEffort = pinnedEffort ?? sessionEffort(ctx) ?? "model default";
  const { refs, scoped, reasoning } = modelChoices(ctx);
  const session = ctx.model ? modelRef(ctx.model, sessionEffort(ctx) ?? undefined) : null;
  const ordered = session ? [session, ...refs.filter((r) => !sameModel(r, session))] : refs;
  const rotate = [...refs.filter((r) => !sameModel(r, session)), ...refs.filter((r) => sameModel(r, session))].slice(0, 3);
  const from = scoped ? "your scoped models" : "models with credentials";
  const title = "ICED verifier models";
  const subtitle = `From ${from}. Independent verifiers check the build; different models catch different mistakes, so pick up to 3 to rotate across the parallel verifiers.`;

  const rows: any[] = [];
  if (current.length) rows.push({ kind: "action", id: "keep", label: `Keep ${current.join(", ")}` });
  if (rotate.length >= 2) rows.push({ kind: "group", label: "Rotate (recommended)", refs: rotate });
  for (const r of ordered.slice(0, MAX_LISTED)) {
    rows.push({ kind: "model", ref: r, note: sameModel(r, session) ? "session" : undefined, reasoning: reasoning.get(r.replace(THINKING_SUFFIX, "")) });
  }
  rows.push({ kind: "action", id: "type", label: "Type a model..." });
  rows.push({ kind: "action", id: "unpinned", label: "Don't pin: verifiers use the session model", effortable: true, effort: pinnedEffort });
  const state = picker.createPicker({ rows, multi: 3 });
  for (;;) {
    const res = await runPicker(ctx, state, { title, subtitle, fallbackEffort });
    if (res === undefined) break;
    if (res === null) return null;
    if ("refs" in res) return { models: res.refs };
    if (res.action === "keep") return null;
    if (res.action === "unpinned") return { models: [], effort: res.effort };
    const typed = await typeModels(ctx, "Verifier model(s)");
    if (typed) picker.addModels(state, typed);
  }

  const opts: Array<[string, () => Promise<string[] | null> | string[] | null]> = [];
  if (current.length) opts.push([`Keep ${current.join(", ")}`, () => null]);
  if (rotate.length >= 2) opts.push([`Rotate ${rotate.join(", ")} (recommended)`, () => rotate]);
  if (session) opts.push([`Session model: ${session}`, () => [session]]);
  for (const r of refs.slice(0, MAX_LISTED)) if (r !== session) opts.push([r, () => [r]]);
  if (refs.length >= 2) opts.push(["Choose several...", () => chooseSeveral(ctx, refs)]);
  opts.push(["Type a model...", () => typeModels(ctx, "Verifier model(s)")]);
  opts.push(["Don't pin (use the session model when verifying)", () => []]);
  const choice = await ctx.ui.select(`${title} (${from}). Different models catch different mistakes.`, opts.map((o) => o[0]));
  if (choice === undefined) return null;
  const picked = await opts.find((o) => o[0] === choice)![1]();
  if (picked === null) return null;
  if (!picked.length) {
    const effort = await selectEffortLevel(ctx, "Verifier effort with the session model", pinnedEffort, sessionEffort(ctx) ?? "model default");
    return effort === undefined ? { models: [] } : { models: [], effort };
  }
  return { models: await selectEffort(ctx, picked, fallbackEffort) };
}

/** Chosen test writer model (null = the session model when it runs), or undefined to keep the setting. */
async function pickTestWriterModel(ctx: ExtensionContext, root: string): Promise<TestWriterChoice> {
  const cfg = core.loadConfig(root);
  const current: string | null = cfg.build?.testWriterModel ?? null;
  const currentEffort: string | null = core.EFFORTS.includes(cfg.build?.testWriterEffort) ? cfg.build.testWriterEffort : null;
  const fallbackEffort = currentEffort ?? sessionEffort(ctx) ?? "model default";
  const { refs, reasoning } = modelChoices(ctx);
  const session = sessionModel(ctx);
  const title = "ICED test writer model";
  const subtitle = "Writes tests from the expectations before the build starts.";

  const rows: any[] = [];
  if (current) rows.push({ kind: "action", id: "keep", label: `Keep ${current}` });
  rows.push({ kind: "action", id: "session", label: `Session model when it runs${session ? ` (now ${session})` : ""}`, effortable: true, effort: currentEffort });
  for (const r of refs.slice(0, MAX_LISTED)) rows.push({ kind: "model", ref: r, reasoning: reasoning.get(r.replace(THINKING_SUFFIX, "")) });
  rows.push({ kind: "action", id: "type", label: "Type a model..." });
  const state = picker.createPicker({ rows });
  for (;;) {
    const res = await runPicker(ctx, state, { title, subtitle, fallbackEffort });
    if (res === undefined) break;
    if (res === null) return undefined;
    if ("refs" in res) return { model: res.refs[0] };
    if (res.action === "keep") return undefined;
    if (res.action === "session") return { model: null, effort: res.effort };
    const typed = await typeModels(ctx, "Test writer model");
    if (typed) picker.addModels(state, typed.slice(0, 1));
  }

  const opts: Array<[string, () => Promise<string | null | undefined> | string | null | undefined]> = [];
  if (current) opts.push([`Keep ${current}`, () => undefined]);
  opts.push([`Session model when it runs${session ? ` (now ${session})` : ""}`, () => null]);
  for (const r of refs.slice(0, MAX_LISTED)) opts.push([r, () => r]);
  opts.push(["Type a model...", async () => (await typeModels(ctx, "Test writer model"))?.[0] ?? undefined]);
  const choice = await ctx.ui.select(`${title} (${subtitle.toLowerCase().replace(/\.$/, "")})`, opts.map((o) => o[0]));
  if (choice === undefined) return undefined;
  const model = await opts.find((o) => o[0] === choice)![1]();
  if (model === undefined) return undefined;
  if (model === null) {
    const effort = await selectEffortLevel(ctx, "Test writer effort with the session model", currentEffort, sessionEffort(ctx) ?? "model default");
    return effort === undefined ? { model: null } : { model: null, effort };
  }
  return { model: (await selectEffort(ctx, [model], fallbackEffort))[0] };
}

function applyVerifierChoice(root: string, choice: NonNullable<VerifierChoice>) {
  core.setVerifyModels(root, choice.models, "pi");
  if ("effort" in choice) core.setVerifyEffort(root, choice.effort ?? null, "pi");
}

function applyTestWriterChoice(root: string, choice: NonNullable<TestWriterChoice>) {
  core.setTestWriterModel(root, choice.model);
  if ("effort" in choice) core.setTestWriterEffort(root, choice.effort ?? null);
}

/** After init: ask for verifier models once (prefill the session model without a UI). */
async function setupModels(ctx: ExtensionContext, root: string): Promise<string> {
  const cfg = core.loadConfig(root);
  if (cfg.verify?.model != null) return "";
  const session = ctx.model ? modelRef(ctx.model, sessionEffort(ctx) ?? undefined) : null;
  const picked = ctx.hasUI ? await pickVerifierModels(ctx, root) : null;
  applyVerifierChoice(root, picked ?? { models: session ? [session] : [] });
  if (core.loadConfig(root).verify?.model == null) core.markModelsAsked(root, "pi");
  if (ctx.hasUI && cfg.build?.testWriter) {
    const tw = await pickTestWriterModel(ctx, root);
    if (tw !== undefined) applyTestWriterChoice(root, tw);
  }
  return `${describe(root, ctx)}${saved(root)}\nChange later with /iced models.`;
}

function textResult(text: string, details?: unknown) {
  return { content: [{ type: "text" as const, text }], details: details ?? undefined };
}

function activeUnit(root: string): Unit | null {
  const id = core.getActive(root);
  if (!id) return null;
  try { return core.readUnit(root, id); } catch { return null; }
}

function resolveUnit(root: string, ref?: string | null): Unit {
  const id = ref ? core.resolveId(root, String(ref)) : core.getActive(root);
  if (!id) throw new Error(ref ? `Unknown ICED unit "${ref}".` : "No active ICED unit. Pass an id or run /iced list.");
  return core.readUnit(root, id);
}

function inferType(line: string): { type: string; request: string } {
  const m = /^\s*([A-Za-z]+)\s*[:\-]?\s+(.*)$/s.exec(line);
  if (!m) return { type: "feature", request: line.trim() };
  const type = TYPE_WORDS[m[1].toLowerCase()];
  if (!type) return { type: "feature", request: line.trim() };
  const isLabel = core.TYPES.includes(m[1].toLowerCase()) || /[:\-]/.test(line.slice(m[1].length, m[1].length + 2));
  return { type, request: isLabel ? m[2].trim() : line.trim() };
}

function titleFrom(request: string): string {
  const first = request.split(/(?<=[.!?])\s/)[0] ?? request;
  const t = first.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77).replace(/\s+\S*$/, "")}...` : t;
}

function draftingInstructions(root: string, unit: Unit, request: string): string {
  const fm = unit.parsed.frontmatter;
  const cfg = core.loadConfig(root);
  const rel = `intent/${unit.id}/iced.md`;
  const knowledge = [cfg.memory.product, ...(cfg.memory.knowledge ?? [])].filter(Boolean).join(", ");
  const parent = fm.parent ? ` Parent unit: intent/${fm.parent}/iced.md (its constraints and failure conditions apply here; cite them as [parent]).` : "";
  const review = fm.type === "review"
    ? "\nThis is a review unit: Expectations describe the review deliverable (findings in intent/" + unit.id + "/review.md, by severity with file:line evidence). No code changes."
    : "";
  return [
    `ICED: new ${fm.type} unit ${unit.id} from the request:`,
    "",
    `> ${request}`,
    "",
    `Draft ${rel} in place (it is a template; keep the frontmatter keys you do not own).${parent}${review}`,
    "1. Context first: search the code, then " + knowledge + ". Tag each fact [code] [product] [knowledge] [parent] or [assumed].",
    "2. Set title, tier and risk (high when it touches money, auth, personal data, production data, or is hard to undo).",
    "3. Write Goal (outcome only, no technology), Constraints [C#], Failure conditions [F#], Scope In/Out.",
    "4. Derive Expectations [E#], each with {verify: test|check|metric|manual | ref}.",
    `5. Only for high-risk gaps that context cannot answer, call iced_questions once (max ${cfg.questions.max}), with options and your recommendation first. Everything else becomes an [assumed] line.`,
    "6. Call iced_request_signoff. Do not change code before approval.",
  ].join("\n");
}

function buildInstructions(unit: Unit, reason?: string): string {
  const fm = unit.parsed.frontmatter;
  return [
    `ICED: build unit ${unit.id} (${unit.parsed.title}).${reason ? ` ${reason}` : ""}`,
    "You own the how: plan, decide, implement and test without asking for approval.",
    `Read intent/${unit.id}/iced.md${fm.parent ? " and its parent units" : ""} first. Log significant decisions with iced_decision.`,
    "Escalate only with iced_escalate (ambiguity, conflict, change-expectation, irreversible, stuck).",
    "When every expectation is met, call iced_submit with evidence for each [E#].",
  ].join("\n");
}

function rulesSummary(root: string, unit: Unit): string {
  const cfg = core.loadConfig(root);
  const fm = unit.parsed.frontmatter;
  const eff = core.effectiveAutonomy(fm, cfg);
  const L: string[] = [];
  L.push(`Active ICED unit: ${unit.id} (intent/${unit.id}/iced.md), status ${fm.status}, effective autonomy ${eff}.`);
  switch (fm.status) {
    case "draft":
      L.push("Drafting: gather context (code first), fill Intent and Expectations, ask only high-risk questions with iced_questions, then call iced_request_signoff. No code changes yet.");
      break;
    case "approved":
      L.push("Approved, build not started. When the human asks you to implement or build it, call iced_build. Do not change code before that.");
      break;
    case "building": {
      const max = cfg.verify.maxAttempts;
      L.push(
        `Building (attempt ${(fm.attempts ?? 0) + 1} of ${max}). You own the how: plan, decide and implement autonomously.`,
        "Stay inside Scope and every constraint, including inherited ones. Log significant decisions with iced_decision.",
        "Escalate only with iced_escalate for: ambiguity, conflict, change-expectation, irreversible, stuck.",
        "Intent and Expectations are frozen. Finish with iced_submit and evidence for every expectation.",
      );
      if (fm.type === "review") L.push(`Review unit: read-only. Write findings to intent/${unit.id}/review.md.`);
      try {
        const v = JSON.parse(fs.readFileSync(unit.paths.verify, "utf8"));
        if (v?.verdict === "fail" && v.result?.problems?.length) L.push(`Last verification failed:\n${v.result.problems.map((p: string) => `- ${p}`).join("\n")}`);
      } catch { /* no previous verdict */ }
      break;
    }
    case "verifying": L.push("Verification is running. Wait."); break;
    case "done": L.push("Verified; waiting for human acceptance (/iced accept). Do not change code unless the human rejects."); break;
    case "blocked": L.push("Blocked waiting for the human. Do not change code."); break;
    default: L.push("This unit is closed. Start new work with iced_start.");
  }
  L.push("", core.summarizeUnit(unit.parsed));
  const anc = core.ancestors(root, unit.id);
  for (const a of anc) {
    const rules = [...a.parsed.constraints.map((c: any) => `  [${a.id}:${c.id}] constraint: ${c.text}`), ...a.parsed.failures.map((f: any) => `  [${a.id}:${f.id}] failure: ${f.text}`)];
    if (rules.length) L.push(`Inherited from ${a.id}:`, ...rules);
  }
  return L.join("\n");
}

function idleSummary(root: string, always: boolean): string {
  const open = core.listUnits(root).filter((u: any) => !["accepted", "rejected"].includes(u.frontmatter.status)).slice(0, 10);
  const L = always ? [
    "This repository uses ICED (Intent, Context, Expectations, Done) for every change (gate: always). Code changes need an approved unit.",
    "When the user asks for a change to code or docs, call iced_start with their request, draft the unit, and get sign-off.",
    "Questions, explanations and read-only exploration need no unit. Protocol: .iced/ICED.md.",
  ] : [
    "This repository has ICED (Intent, Context, Expectations, Done) set up, but no unit is active, so work normally.",
    "Use ICED only when the user asks for it (/iced, \"use ICED\", an intent or sign-off): then call iced_start with their request.",
  ];
  if (open.length) L.push("Open units (switch with /iced use <id>):", ...open.map((u: any) => `- ${u.id} [${u.frontmatter.status}]`));
  return L.join("\n");
}

export default function iced(pi: ExtensionAPI) {
  const role = process.env.ICED_ROLE;
  if (role === "verifier") {
    pi.on("tool_call", async (event) => {
      const input: any = event.input;
      if (event.toolName === "write" || event.toolName === "edit") return { block: true, reason: "The ICED verifier is read-only." };
      if ((event.toolName === "bash" || event.toolName === "powershell") && isMutatingShell(input?.command)) {
        return { block: true, reason: "The ICED verifier is read-only; run only commands that do not change files." };
      }
      return undefined;
    });
    return;
  }
  if (role) return;

  let gateOverride: string | null = null;
  let workedThisRun = false;
  const nudges = new Map<string, number>();

  const cwdOf = (ctx: ExtensionContext) => core.normalizeDir(ctx.cwd) as string;
  const rootOf = (ctx: ExtensionContext) => core.findRoot(cwdOf(ctx)) as string | null;

  function refreshStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const root = rootOf(ctx);
    if (!root) { ctx.ui.setStatus("iced", undefined); return; }
    const u = activeUnit(root);
    ctx.ui.setStatus("iced", u ? `ICED ${u.id} ${u.parsed.frontmatter.status}` : "ICED");
  }

  function show(ctx: ExtensionContext, text: string) {
    if (ctx.hasUI) pi.appendEntry("iced-output", { text });
    else console.log(text);
  }

  function send(ctx: ExtensionContext, message: string) {
    if (ctx.isIdle()) pi.sendUserMessage(message);
    else pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  pi.registerEntryRenderer<{ text: string }>("iced-output", (entry, _opts, theme) => {
    const box = new Box(1, 0, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(`${theme.fg("accent", "[iced]")} ${entry.data?.text ?? ""}`, 0, 0));
    return box;
  });

  async function ensureRoot(ctx: ExtensionContext): Promise<string | null> {
    const existing = rootOf(ctx);
    if (existing) return existing;
    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm("ICED is not set up here", `Initialize ICED in ${cwdOf(ctx)}? (creates .iced/, intent/ and agent files)`);
      if (!ok) return null;
    }
    const r = initRepo(cwdOf(ctx), {});
    const models = await setupModels(ctx, cwdOf(ctx));
    show(ctx, `ICED initialized (targets: ${r.targets.join(", ")}). Created ${r.created.length} file(s). The ICED tools work now; the iced skill and AGENTS.md load on the next /reload.${models ? `\n${models}` : ""}`);
    return cwdOf(ctx);
  }

  function startUnit(root: string, line: string, opts: { type?: string; parent?: string | null } = {}) {
    const inferred = inferType(line);
    const type = opts.type ?? inferred.type;
    const request = opts.type ? line.trim() : inferred.request;
    const { id } = core.createUnit(root, { title: titleFrom(request), type, parent: opts.parent ?? null, request, risk: "medium" });
    core.setActive(root, id);
    const unit = core.readUnit(root, id);
    core.appendMetric(root, { id, event: "created", type, tier: unit.parsed.frontmatter.tier, risk: "medium", autonomy: unit.parsed.frontmatter.autonomy });
    nudges.delete(id);
    return { unit, instructions: draftingInstructions(root, unit, request) };
  }

  function startBuild(root: string, unit: Unit) {
    const st = unit.parsed.frontmatter.status;
    if (st !== "building") core.transition(root, unit.id, "building");
    core.setActive(root, unit.id);
    nudges.delete(unit.id);
  }

  async function maybeRunTestWriter(root: string, id: string, signal: AbortSignal | undefined, progress: (s: string) => void, defaultModel: string | null = null, defaultEffort: string | null = null): Promise<string> {
    const cfg = core.loadConfig(root);
    if (!cfg.build?.testWriter) return "";
    progress("Isolated test writer is writing tests from the expectations");
    const unit = core.readUnit(root, id);
    const r = await runTestWriter({ root, unit, ancestorUnits: core.ancestors(root, id), config: cfg, signal, defaultModel, defaultEffort });
    core.appendDecision(root, id, { decision: "Tests written first by the isolated ICED test writer.", why: r.ok ? r.text.trim().slice(0, 1500) : `Test writer failed: ${r.output.slice(-400)}`, author: "test-writer" });
    return r.ok ? `\nAn isolated test writer already wrote tests from the expectations (see decisions.md). Make them pass; do not weaken them.` : "\nThe isolated test writer failed; write the tests yourself.";
  }

  /** Human sign-off. Returns a message for the agent. */
  async function signoff(ctx: ExtensionContext, root: string, unit: Unit, signal?: AbortSignal, progress: (s: string) => void = () => {}): Promise<string> {
    const fm = unit.parsed.frontmatter;
    if (fm.status !== "draft") return `${unit.id} is ${fm.status}, not draft; nothing to sign off.`;
    const lint = core.lintIced(unit.parsed, "signoff", unit.text);
    if (lint.errors.length) {
      return `Not ready for sign-off. Fix these in intent/${unit.id}/iced.md, then call iced_request_signoff again:\n${lint.errors.map((e: any) => `- ${e.code}: ${e.message}`).join("\n")}`;
    }
    const cfg = core.loadConfig(root);
    const eff = core.effectiveAutonomy(fm, cfg);
    if (eff >= 3 && fm.risk === "low") {
      core.approveUnit(root, unit.id, { auto: true, startBuild: true });
      core.setActive(root, unit.id);
      if (ctx.hasUI) ctx.ui.notify(`ICED auto-approved ${unit.id} (autonomy 3, low risk). Building.`, "info");
      refreshStatus(ctx);
      const tw = await maybeRunTestWriter(root, unit.id, signal, progress, sessionModel(ctx), sessionEffort(ctx));
      return `Auto-approved under autonomy 3 (low risk). Status building. Build it now.${tw}`;
    }
    if (!ctx.hasUI) {
      return `No human is available to sign off. Stop here and tell the user to run "/iced approve ${unit.id}" or "node .iced/bin/iced.mjs approve ${unit.id}".`;
    }
    const warn = lint.warnings.filter((w: any) => w.code !== "assumptions-present").map((w: any) => `! ${w.message}`);
    const summary = [core.summarizeUnit(unit.parsed), ...(warn.length ? ["", ...warn] : [])].join("\n");
    const choice = await ctx.ui.select(`ICED sign-off: ${unit.id}\n\n${summary}\n`, [
      "Approve and build", "Approve, build later", "Request changes", "Reject",
    ]);
    if (choice === "Approve and build" || choice === "Approve, build later") {
      const build = choice === "Approve and build";
      const r = core.approveUnit(root, unit.id, { startBuild: build });
      if (!r.ok) return `Approval failed: ${r.lint.errors.map((e: any) => e.message).join("; ")}`;
      core.setActive(root, unit.id);
      nudges.delete(unit.id);
      refreshStatus(ctx);
      if (!build) return `Approved. The human will start the build with /iced build. Stop now.`;
      const tw = await maybeRunTestWriter(root, unit.id, signal, progress, sessionModel(ctx), sessionEffort(ctx));
      return `Approved by the human. Status building. Intent and Expectations are frozen. Build it now, autonomously.${tw}`;
    }
    if (choice === "Request changes") {
      const feedback = await ctx.ui.input("What should change?", "e.g. E2 should also cover mobile");
      core.appendMetric(root, { id: unit.id, event: "signoff", result: "changes", auto: false, risk: fm.risk, autonomy: fm.autonomy });
      return `The human requested changes: ${feedback?.trim() || "(no detail given)"}\nUpdate the draft and call iced_request_signoff again.`;
    }
    if (choice === "Reject") {
      core.transition(root, unit.id, "rejected");
      core.setActive(root, null);
      core.appendMetric(root, { id: unit.id, event: "signoff", result: "rejected", auto: false, risk: fm.risk, autonomy: fm.autonomy });
      refreshStatus(ctx);
      return "The human rejected this unit. Stop.";
    }
    return "Sign-off was dismissed; the unit stays in draft. Stop and wait for the human.";
  }

  // ---------------------------------------------------------------- tools

  pi.registerTool({
    name: "iced_start",
    label: "ICED start",
    description: "Start a new ICED unit from the user's request (creates intent/<id>/iced.md from a template and makes it active). Use when the user asks to use ICED (or for an intent or sign-off), or for any code change when the ICED section says the repo gates every change. Sets up ICED first (after asking the human) when the repo has none.",
    promptSnippet: "Start an ICED unit from a one-line request",
    promptGuidelines: GUIDELINES,
    parameters: Type.Object({
      request: Type.String({ description: "The user's request, verbatim" }),
      type: Type.Optional(Type.Union(core.TYPES.map((t: string) => Type.Literal(t)), { description: "Unit type; inferred when omitted" })),
      parent: Type.Optional(Type.String({ description: "Parent unit id for layered work" })),
    }),
    executionMode: "sequential",
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx) ?? (await ensureRoot(ctx));
      if (!root) throw new Error("ICED is not initialized here and the human declined.");
      const parent = params.parent ? core.resolveId(root, params.parent) : null;
      if (params.parent && !parent) throw new Error(`Unknown parent unit "${params.parent}".`);
      const { unit, instructions } = startUnit(root, params.request, { type: params.type, parent });
      refreshStatus(ctx);
      return textResult(instructions, { id: unit.id });
    },
  });

  pi.registerTool({
    name: "iced_questions",
    label: "ICED questions",
    description: "Ask the human a small batch of high-risk questions about a draft ICED unit that context could not answer. Answers are recorded in the unit's Open questions.",
    parameters: Type.Object({
      id: Type.Optional(Type.String()),
      questions: Type.Array(Type.Object({
        question: Type.String(),
        options: Type.Optional(Type.Array(Type.String(), { description: "Concrete choices, recommended first" })),
      }), { minItems: 1 }),
    }),
    executionMode: "sequential",
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ here.");
      const unit = resolveUnit(root, params.id);
      if (unit.parsed.frontmatter.status !== "draft") throw new Error(`${unit.id} is ${unit.parsed.frontmatter.status}; questions are for drafts. During a build use iced_escalate.`);
      const cfg = core.loadConfig(root);
      const room = Math.max(0, cfg.questions.max - unit.parsed.questions.length);
      const batch = params.questions.slice(0, room);
      const dropped = params.questions.length - batch.length;
      if (!batch.length) return textResult(`Question budget (${cfg.questions.max}) is used up. Record remaining gaps as [assumed] context lines.`);
      if (!ctx.hasUI) return textResult("No human is available. Record these gaps as [assumed] context lines and continue to sign-off.");
      const lines: string[] = [];
      const answers: string[] = [];
      let next = Number(core.nextItemId(unit.parsed, "Q").slice(1));
      for (const q of batch) {
        let answer: string | undefined;
        const opts: string[] = q.options ?? [];
        if (opts.length) {
          const other = "Other (type an answer)";
          const picked = await ctx.ui.select(`${unit.id}: ${q.question}`, [...opts, other]);
          answer = picked === other ? await ctx.ui.input(q.question) : picked;
        } else {
          answer = await ctx.ui.input(`${unit.id}: ${q.question}`);
        }
        if (!answer?.trim()) { answers.push(`- ${q.question}: (skipped; decide yourself and mark it [assumed])`); continue; }
        const clean = answer.replace(/\s+/g, " ").trim();
        lines.push(`- [Q${next++}] ${q.question.replace(/\s+/g, " ").trim()} -> A: ${clean}`);
        answers.push(`- ${q.question}: ${clean}`);
      }
      if (lines.length) {
        const fresh = core.readUnit(root, unit.id);
        core.writeUnitText(root, unit.id, core.appendToSection(fresh.text, "Open questions", lines));
      }
      core.appendMetric(root, { id: unit.id, event: "questions", count: lines.length });
      return textResult(`Answers (recorded in Open questions):\n${answers.join("\n")}${dropped ? `\n${dropped} question(s) over budget were not asked; treat them as [assumed].` : ""}\nUpdate Intent, Context and Expectations accordingly, then call iced_request_signoff.`);
    },
  });

  pi.registerTool({
    name: "iced_request_signoff",
    label: "ICED sign-off",
    description: "Ask the human to approve a drafted ICED unit (Intent + Expectations). Lints the unit first. On approval the contract is frozen and the build starts.",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }),
    executionMode: "sequential",
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ here.");
      const unit = resolveUnit(root, params.id);
      const progress = (s: string) => onUpdate?.({ content: [{ type: "text", text: s }], details: undefined } as any);
      return textResult(await signoff(ctx, root, unit, signal, progress), { id: unit.id });
    },
  });

  pi.registerTool({
    name: "iced_decision",
    label: "ICED decision",
    description: "Record a significant design or implementation decision for the active ICED unit (decision, why, rejected alternatives). Audited by the human, not approved.",
    parameters: Type.Object({
      id: Type.Optional(Type.String()),
      decision: Type.String(),
      why: Type.String(),
      alternatives: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ here.");
      const unit = resolveUnit(root, params.id);
      const eff = core.effectiveAutonomy(unit.parsed.frontmatter, core.loadConfig(root));
      if (eff === 0 && ctx.hasUI) {
        const ok = await ctx.ui.confirm(`ICED decision (${unit.id})`, `${params.decision}\n\nWhy: ${params.why}`);
        if (!ok) return textResult("The human did not agree with this decision. Ask what they prefer or choose differently.");
      }
      core.appendDecision(root, unit.id, params);
      return textResult(`Recorded in intent/${unit.id}/decisions.md.`);
    },
  });

  pi.registerTool({
    name: "iced_escalate",
    label: "ICED escalate",
    description: "Stop and ask the human, only for: ambiguity (intent has two different readings), conflict (a constraint and an expectation cannot both hold), change-expectation (an expectation is wrong or impossible), irreversible (an action cannot be undone), stuck (repeated failure with no new approach).",
    parameters: Type.Object({
      id: Type.Optional(Type.String()),
      kind: Type.Union(ESCALATION_KINDS.map((k) => Type.Literal(k))),
      message: Type.String({ description: "The question or problem, with the facts the human needs" }),
      proposal: Type.Optional(Type.String({ description: "Your recommended resolution. For change-expectation or conflict: the contract lines exactly as they should read, one per line, e.g. '- [E4] New text. {verify: test | path}'. The same id replaces that item, a new id adds one, '- [E5] (remove)' drops one (C, F and E items). The human sees the change and applies it with one choice; don't ask them to edit or paste." })),
    }),
    executionMode: "sequential",
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ here.");
      const unit = resolveUnit(root, params.id);
      const fm = unit.parsed.frontmatter;
      const wasBuilding = fm.status === "building";
      if (wasBuilding) core.transition(root, unit.id, "blocked");
      core.appendMetric(root, { id: unit.id, event: "escalation", kind: params.kind, risk: fm.risk, autonomy: fm.autonomy });
      refreshStatus(ctx);
      const resume = () => { if (wasBuilding) core.transition(root, unit.id, "building"); refreshStatus(ctx); };
      if (!ctx.hasUI) return textResult(`No human is available. ${unit.id} is blocked. Stop and report: ${params.message}`);
      const header = `ICED ${params.kind} (${unit.id})\n\n${params.message}${params.proposal ? `\n\nProposal: ${params.proposal}` : ""}\n`;

      if (params.kind === "change-expectation" || params.kind === "conflict") {
        const current = core.readUnit(root, unit.id);
        const clean = core.stripProposalComments(current.text);
        const plan = core.applyProposal(current.text, core.proposalItems(params.proposal));
        const ready = plan.changes.length > 0 && plan.errors.length === 0;
        const planLint = ready ? core.lintIced(core.parseIced(plan.text), "signoff").errors : [];
        const commit = (text: string, how: string) => {
          const keep: Record<string, unknown> = {};
          for (const k of core.PROTECTED_KEYS) keep[k] = current.parsed.frontmatter[k] ?? null;
          core.writeUnitText(root, unit.id, core.setFrontmatter(core.stripProposalComments(text), keep));
          const lint = core.lintIced(core.readUnit(root, unit.id).parsed, "signoff");
          core.rehashContract(root, unit.id);
          core.appendDecision(root, unit.id, { decision: `Contract changed by the human after ${params.kind} escalation (${how}).`, why: params.message, author: "human" });
          resume();
          const warn = lint.errors.length ? `\nNote: the contract now has lint issues: ${lint.errors.map((e: any) => e.message).join("; ")}` : "";
          return textResult(`The human updated the contract and re-approved it. Re-read intent/${unit.id}/iced.md and continue building.${warn}`);
        };
        const title = ready
          ? `ICED ${params.kind} (${unit.id})\n\n${params.message}\n\nThe change:\n${core.describeChanges(plan.changes)}${planLint.length ? `\n\n! ${planLint.map((e: any) => e.message).join("\n! ")}` : ""}\n`
          : header;
        const apply = "Apply this change";
        const editFirst = "Edit it first";
        const editNow = "Edit the contract now";
        const options = ready
          ? [apply, editFirst, "Keep the contract, give guidance", "Abandon the unit"]
          : [editNow, "Keep the contract, give guidance", "Abandon the unit"];
        let choice: string | undefined;
        for (;;) {
          choice = await ctx.ui.select(title, options);
          if (choice === apply) return commit(plan.text, "applied the agent's proposal");
          if (choice !== editFirst && choice !== editNow) break;
          const prefill = choice === editFirst ? plan.text
            : params.proposal ? `${clean.trimEnd()}\n\n<!-- Agent proposal (ICED removes this comment when you save):\n${params.proposal}\n-->\n` : clean;
          const edited = await ctx.ui.editor(`Edit ${unit.id}: change Intent/Expectations, then save`, prefill);
          if (edited === undefined) continue;
          if (core.stripProposalComments(edited).trim() !== clean.trim()) return commit(edited, "edited by the human");
          resume();
          return textResult("The human opened the contract but made no change. Keep the current contract and continue.");
        }
        if (choice === "Abandon the unit") {
          core.transition(root, unit.id, "rejected");
          core.setActive(root, null);
          refreshStatus(ctx);
          return textResult("The human abandoned this unit. Stop.");
        }
        const guidance = await ctx.ui.input("Guidance for the agent");
        resume();
        return textResult(`Contract unchanged. Human guidance: ${guidance?.trim() || "(none)"}. Continue within the current contract.`);
      }

      if (params.kind === "irreversible") {
        const ok = await ctx.ui.confirm(`ICED irreversible action (${unit.id})`, `${params.message}${params.proposal ? `\n\n${params.proposal}` : ""}`);
        core.appendDecision(root, unit.id, { decision: `Irreversible action ${ok ? "allowed" : "refused"} by the human.`, why: params.message, author: "human" });
        resume();
        return textResult(ok ? "The human allowed the irreversible action. Proceed exactly as described." : "The human refused the irreversible action. Find another way or escalate as stuck.");
      }

      const answer = await ctx.ui.input(header, params.proposal ?? "");
      resume();
      return textResult(`Human answer: ${answer?.trim() || "(no answer; use your proposal if safe, otherwise stop)"}`);
    },
  });

  pi.registerTool({
    name: "iced_submit",
    label: "ICED submit",
    description: "Submit the active ICED unit as done, with evidence for every expectation. Runs the configured checks in parallel, then independent verifiers (in parallel for larger or risky units) that try to prove the work fails. Pass -> done; fail -> back to building with findings.",
    parameters: Type.Object({
      id: Type.Optional(Type.String()),
      summary: Type.String({ description: "What changed and why, briefly" }),
      evidence: Type.Array(Type.Object({
        expectation: Type.String({ description: "Expectation id, e.g. E1" }),
        kind: Type.String({ description: "test | check | metric | manual" }),
        ref: Type.String({ description: "Test name/path, command, measurement or manual steps" }),
        note: Type.Optional(Type.String()),
      })),
    }),
    executionMode: "sequential",
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ here.");
      const unit = resolveUnit(root, params.id);
      const cfg = core.loadConfig(root);
      nudges.delete(unit.id);
      const progress = (s: string) => {
        refreshStatus(ctx);
        onUpdate?.({ content: [{ type: "text", text: s }], details: undefined } as any);
      };
      let res: any;
      try {
        res = await submitUnit({
          root, id: unit.id, summary: params.summary, evidence: params.evidence, signal, onProgress: progress,
          runner: resolveRunner(cfg, { inPi: true }), defaultModel: sessionModel(ctx), defaultEffort: sessionEffort(ctx),
        });
      } finally {
        refreshStatus(ctx);
      }
      if (res.outcome === "missing-evidence") {
        return textResult(`Evidence is missing for ${res.missing.join(", ")}. Meet those expectations and submit evidence for every one.`);
      }
      const report = res.report;
      const r = report.result;
      const findings = r.problems.map((p: string) => `- ${p}`).join("\n");
      if (res.outcome === "accepted") {
        if (ctx.hasUI) ctx.ui.notify(`ICED ${unit.id} verified and auto-accepted (autonomy ${res.autonomy}).`, "info");
        return textResult(`Verified independently and auto-accepted (autonomy ${res.autonomy}). Evidence: intent/${unit.id}/evidence.md. Report the result to the user briefly.`, report);
      }
      if (res.outcome === "done") {
        if (ctx.hasUI) ctx.ui.notify(`ICED ${unit.id} verified. Review intent/${unit.id}/evidence.md, then /iced accept or /iced reject <reason>.`, "info");
        const why = !r.independent ? " (no independent verifier ran, so a human must review)" : r.needsHuman ? " (a human must review: manual expectations, or a verifier did not answer)" : "";
        return textResult(`Verification passed${why}. Status done. Summarize the result for the user and stop; the human accepts with /iced accept.`, report);
      }
      if (res.outcome === "blocked") {
        if (ctx.hasUI) ctx.ui.notify(`ICED ${unit.id} failed verification ${res.attempt} times and is blocked.`, "warning");
        return textResult(`Verification failed (attempt ${res.attempt} of ${cfg.verify.maxAttempts}); the unit is now blocked for the human.\n${findings}\nStop and summarize what is failing.`, report);
      }
      return textResult(`Verification failed (attempt ${res.attempt} of ${cfg.verify.maxAttempts}). Fix these, then call iced_submit again:\n${findings}`, report);
    },
  });

  pi.registerTool({
    name: "iced_build",
    label: "ICED build",
    description: "Start (or resume) the build of a unit the human already signed off (status approved or building). Call it only when the human asks you to implement or build it. Returns the build instructions.",
    promptSnippet: "Start building a signed-off ICED unit when the human asks",
    parameters: Type.Object({ id: Type.Optional(Type.String({ description: "Unit id; defaults to the active unit" })) }),
    executionMode: "sequential",
    async execute(_id, params: any, signal, onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) throw new Error("No .iced/ in this repository.");
      const unit = resolveUnit(root, params.id ?? null);
      const st = unit.parsed.frontmatter.status;
      if (st === "draft") return textResult(`${unit.id} is a draft. Finish it and call iced_request_signoff; the human must approve before building.`);
      if (st !== "approved" && st !== "building") return textResult(`${unit.id} is ${st}; iced_build only starts approved units.${st === "blocked" ? " The human resumes blocked units with /iced build." : ""}`);
      startBuild(root, unit);
      refreshStatus(ctx);
      const progress = (s: string) => onUpdate?.({ content: [{ type: "text", text: s }], details: undefined });
      const tw = st === "approved" ? await maybeRunTestWriter(root, unit.id, signal, progress, sessionModel(ctx), sessionEffort(ctx)) : "";
      return textResult(buildInstructions(core.readUnit(root, unit.id), tw.trim() || undefined), { id: unit.id });
    },
  });

  pi.registerTool({
    name: "iced_status",
    label: "ICED status",
    description: "Show ICED units, or one unit's summary, status and last verification.",
    promptSnippet: "Show ICED units and the active unit's status",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }),
    async execute(_id, params: any, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      if (!root) return textResult("No .iced/ in this repository. The user can run /iced init.");
      const id = params.id ? core.resolveId(root, params.id) : null;
      return textResult(core.renderStatus(root, id ?? undefined));
    },
  });

  // ---------------------------------------------------------------- gate, prompt, build loop

  pi.on("tool_call", async (event, ctx) => {
    const root = rootOf(ctx);
    if (!root) return undefined;
    const input: any = event.input;
    if (event.toolName === "write" || event.toolName === "edit") workedThisRun = true;
    if ((event.toolName === "bash" || event.toolName === "powershell") && isMutatingShell(input?.command)) workedThisRun = true;
    const cfg = core.loadConfig(root);
    const mode = gateOverride ?? cfg.gate;
    if (mode === "off") return undefined;
    const active = activeUnit(root);
    const autonomy = active ? core.effectiveAutonomy(active.parsed.frontmatter, cfg) : 1;
    const d: any = gateDecision({ root, cwd: cwdOf(ctx), toolName: event.toolName, input, autonomy, always: mode === "always" });
    if (d.action === "allow") return undefined;
    if (d.action === "confirm") {
      if (!ctx.hasUI) return { block: true, reason: "ICED autonomy 0 needs a human to confirm each change, and no UI is available." };
      return (await ctx.ui.confirm(d.title, d.message)) ? undefined : { block: true, reason: "The human declined this change." };
    }
    if (mode === "warn") {
      if (ctx.hasUI) ctx.ui.notify(`ICED (warn): ${d.reason}`, "warning");
      return undefined;
    }
    return { block: true, reason: `ICED gate: ${d.reason}` };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const root = rootOf(ctx);
    if (!root) return;
    const unit = activeUnit(root);
    const status = unit?.parsed.frontmatter.status;
    const section = unit && !["accepted", "rejected"].includes(status) ? rulesSummary(root, unit) : idleSummary(root, (gateOverride ?? core.loadConfig(root).gate) === "always");
    event.systemPromptOptions.sections.iced = `${EXTENSION_NOTE}\n\n${section}`;
  });

  pi.on("agent_start", async () => { workedThisRun = false; });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed" || event.continue || !event.context?.canContinue) return;
    const root = rootOf(ctx);
    if (!root || !workedThisRun) return;
    const unit = activeUnit(root);
    if (!unit || unit.parsed.frontmatter.status !== "building") return;
    const n = nudges.get(unit.id) ?? 0;
    if (n >= 2) return;
    nudges.set(unit.id, n + 1);
    return {
      continue: true,
      entries: [{
        type: "custom_message", customType: "iced-nudge", display: true,
        content: `ICED: ${unit.id} is still building. If every expectation is met, call iced_submit with evidence for each [E#]. If you are blocked, call iced_escalate. Otherwise keep working.`,
      }],
    };
  });

  pi.on("session_start", async (_event, ctx) => refreshStatus(ctx));

  // ---------------------------------------------------------------- command

  pi.registerCommand("iced", {
    description: "ICED: start work from one line, or manage units (/iced help)",
    getArgumentCompletions: (prefix: string) => {
      if (/\s/.test(prefix)) return null;
      const hits = SUBCOMMANDS.filter((s) => s.startsWith(prefix.toLowerCase()));
      return hits.length ? hits.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const raw = args.trim();
      const head = (raw.split(/\s+/)[0] ?? "").toLowerCase();
      const rest = raw.slice(head.length).trim();
      const need = async () => {
        const r = await ensureRoot(ctx);
        if (!r) throw new Error("ICED is not initialized.");
        return r;
      };
      try {
        switch (head) {
          case "": case "help": show(ctx, HELP); return;
          case "init": {
            const targets = rest ? rest.split(/[\s,]+/).filter(Boolean) : undefined;
            const bad = (targets ?? []).filter((t) => !TARGETS.includes(t));
            if (bad.length) { show(ctx, `Unknown target(s): ${bad.join(", ")}. Use: ${TARGETS.join(", ")}`); return; }
            const r = initRepo(cwdOf(ctx), { targets });
            const changed = r.created.length + r.updated.length > 0;
            const models = await setupModels(ctx, cwdOf(ctx));
            show(ctx, [`ICED initialized (targets: ${r.targets.join(", ")})`, ...r.created.map((f: string) => `  created ${f}`), ...r.updated.map((f: string) => `  updated ${f}`), ...(models ? [models] : []), ...(changed ? ["Reloading so the iced skill and agent files load."] : [])].join("\n"));
            refreshStatus(ctx);
            if (changed) await ctx.reload();
            return;
          }
          case "list": case "status": {
            const root = rootOf(ctx);
            if (!root) { show(ctx, "ICED is not set up here. Run /iced init or /iced <what you want>."); return; }
            if (head === "list" && !rest) { show(ctx, core.renderStatus(root)); return; }
            const id = rest ? core.resolveId(root, rest) : core.getActive(root);
            if (rest && !id && head === "status" && rest.split(/\s+/).length > 2) break;
            show(ctx, id ? core.renderStatus(root, id) : core.renderStatus(root));
            return;
          }
          case "use": {
            const root = await need();
            if (/^(none|off|--clear)$/i.test(rest)) {
              core.setActive(root, null);
              refreshStatus(ctx);
              show(ctx, "No active unit. The agent works outside ICED until you start or /iced use a unit.");
              return;
            }
            const unit = resolveUnit(root, rest);
            core.setActive(root, unit.id);
            refreshStatus(ctx);
            show(ctx, `Active: ${unit.id} (${unit.parsed.frontmatter.status})`);
            return;
          }
          case "child": {
            const root = await need();
            const [pref, ...line] = rest.split(/\s+/);
            const parent = core.resolveId(root, pref ?? "");
            if (!parent || !line.length) { show(ctx, "Usage: /iced child <parent-id> <what you want>"); return; }
            const { unit, instructions } = startUnit(root, line.join(" "), { parent });
            refreshStatus(ctx);
            show(ctx, `Created ${unit.id} under ${parent}. Drafting...`);
            send(ctx, instructions);
            return;
          }
          case "approve": {
            const root = await need();
            const unit = resolveUnit(root, rest || null);
            const msg = await signoff(ctx, root, unit);
            show(ctx, msg);
            if (/^Approved by the human|^Auto-approved/.test(msg)) send(ctx, buildInstructions(core.readUnit(root, unit.id)));
            return;
          }
          case "build": {
            const root = await need();
            const unit = resolveUnit(root, rest || null);
            const st = unit.parsed.frontmatter.status;
            if (st === "draft") { show(ctx, `${unit.id} is a draft. Sign it off first (/iced approve).`); return; }
            if (!["approved", "blocked", "done", "building"].includes(st)) { show(ctx, `${unit.id} is ${st}; it cannot be built.`); return; }
            if (st === "blocked" && (unit.parsed.frontmatter.attempts ?? 0) >= core.loadConfig(root).verify.maxAttempts) {
              core.updateFrontmatter(root, unit.id, { attempts: 0 });
            }
            startBuild(root, core.readUnit(root, unit.id));
            refreshStatus(ctx);
            const tw = st === "approved" ? await maybeRunTestWriter(root, unit.id, undefined, (s) => { if (ctx.hasUI) ctx.ui.notify(s, "info"); }, sessionModel(ctx), sessionEffort(ctx)) : "";
            send(ctx, buildInstructions(core.readUnit(root, unit.id), tw.trim() || undefined));
            return;
          }
          case "accept": {
            const root = await need();
            const unit = resolveUnit(root, rest || null);
            if (unit.parsed.frontmatter.status !== "done") { show(ctx, `${unit.id} is ${unit.parsed.frontmatter.status}; only done units can be accepted.`); return; }
            const r = core.acceptUnit(root, unit.id, {});
            if (!r.ok) { show(ctx, `Cannot accept ${unit.id}:\n${r.lint.errors.map((e: any) => `  ${e.code}: ${e.message}`).join("\n")}`); return; }
            if (core.getActive(root) === unit.id) core.setActive(root, null);
            refreshStatus(ctx);
            show(ctx, `Accepted ${unit.id}.`);
            return;
          }
          case "reject": {
            const root = await need();
            const [maybeId, ...words] = rest.split(/\s+/);
            const id = maybeId ? core.resolveId(root, maybeId) : null;
            const unit = resolveUnit(root, id);
            const reason = (id ? words.join(" ") : rest).trim();
            if (unit.parsed.frontmatter.status !== "done") { show(ctx, `${unit.id} is ${unit.parsed.frontmatter.status}; reject applies to done units. Use /iced abandon to drop it.`); return; }
            if (!reason) { show(ctx, "Usage: /iced reject [id] <reason>"); return; }
            core.transition(root, unit.id, "building");
            core.setActive(root, unit.id);
            core.appendMetric(root, { id: unit.id, event: "reject", reason, risk: unit.parsed.frontmatter.risk, autonomy: unit.parsed.frontmatter.autonomy });
            core.appendDecision(root, unit.id, { decision: "Human rejected the verified result.", why: reason, author: "human" });
            nudges.delete(unit.id);
            refreshStatus(ctx);
            send(ctx, buildInstructions(core.readUnit(root, unit.id), `The human rejected the result: ${reason}`));
            return;
          }
          case "abandon": {
            const root = await need();
            const unit = resolveUnit(root, rest || null);
            const st = unit.parsed.frontmatter.status;
            if (["accepted", "rejected"].includes(st)) { show(ctx, `${unit.id} is already ${st}.`); return; }
            core.updateFrontmatter(root, unit.id, { status: "rejected", blocked_from: null });
            core.appendMetric(root, { id: unit.id, event: "abandon", risk: unit.parsed.frontmatter.risk, autonomy: unit.parsed.frontmatter.autonomy });
            if (core.getActive(root) === unit.id) core.setActive(root, null);
            refreshStatus(ctx);
            show(ctx, `Abandoned ${unit.id}.`);
            return;
          }
          case "review": {
            const root = await need();
            const target = rest ? core.resolveId(root, rest) : core.getActive(root);
            if (target) {
              send(ctx, `ICED review of unit ${target} (read-only). Read intent/${target}/iced.md, its decisions.md and evidence.md, the changed code, and .iced/ICED.md's rubric (the iced skill has references/rubric.md). Report findings by severity with file:line evidence, grouped by rubric check (MUST first). Do not change any files.`);
              return;
            }
            if (!rest) { show(ctx, "Usage: /iced review <unit id | what to review>"); return; }
            const { unit, instructions } = startUnit(root, rest, { type: "review" });
            refreshStatus(ctx);
            show(ctx, `Created review unit ${unit.id}. Drafting...`);
            send(ctx, instructions);
            return;
          }
          case "memory": {
            const root = await need();
            const cfg = core.loadConfig(root);
            send(ctx, `ICED memory: read the repository (README, docs, package manifests, main entry points, tests) and update ${cfg.memory.product} (purpose, users, key behaviors and rules, non-functional expectations) and ${cfg.memory.knowledge?.[0] ?? ".iced/memory/knowledge.md"} (engineering standards, security and compliance, patterns) with short factual bullets. Keep existing human-written content; mark anything inferred with (inferred). Change nothing else.`);
            return;
          }
          case "stats": {
            const root = await need();
            const r = core.renderStats(root);
            if (rest === "apply") for (const s of r.suggestions) core.applyPromotion(root, s);
            show(ctx, r.text + (rest === "apply" && r.suggestions.length ? "\nApplied the suggestions above." : r.suggestions.length ? "\nRun /iced stats apply to apply suggestions." : ""));
            return;
          }
          case "autonomy": {
            const root = await need();
            const [lvl, ref] = rest.split(/\s+/);
            const n = Number(lvl);
            if (!Number.isInteger(n) || n < 0 || n > 3) { show(ctx, "Usage: /iced autonomy <0-3> [id]"); return; }
            if (ref) {
              const unit = resolveUnit(root, ref);
              core.updateFrontmatter(root, unit.id, { autonomy: n });
              show(ctx, `${unit.id} autonomy set to ${n} (effective ${core.effectiveAutonomy({ ...unit.parsed.frontmatter, autonomy: n }, core.loadConfig(root))}).`);
            } else {
              core.saveConfigPatch(root, { autonomy: n });
              show(ctx, `Default autonomy for new units set to ${n}.`);
            }
            return;
          }
          case "models": {
            const root = await need();
            const [sub, level, target] = rest.split(/\s+/).filter(Boolean);
            if (sub === "effort") {
              if (!level || (level !== "clear" && !core.EFFORTS.includes(level)) || (target && target !== "test-writer")) {
                show(ctx, `Usage: /iced models effort <${core.EFFORTS.join("|")}|clear> [test-writer]`);
                return;
              }
              const value = level === "clear" ? null : level;
              if (target) core.setTestWriterEffort(root, value);
              else core.setVerifyEffort(root, value, "pi");
              show(ctx, `Saved to .iced/config.json. A model's own :level still wins.${saved(root)}\n${describe(root, ctx)}`);
              return;
            }
            if (sub === "show" || !ctx.hasUI) { show(ctx, `${describe(root, ctx)}\nChange with /iced models, /iced models effort <level>, or: node .iced/bin/iced.mjs models set <model...> [--runner name]`); return; }
            if (sub) { show(ctx, "Usage: /iced models [show] | /iced models effort <level|clear> [test-writer]"); return; }
            show(ctx, describe(root, ctx));
            const what = await ctx.ui.select("Which ICED models do you want to change?", ["Verifier models", "Test writer model", "Nothing"]);
            if (what === "Verifier models") {
              const picked = await pickVerifierModels(ctx, root);
              if (picked === null) return;
              applyVerifierChoice(root, picked);
            } else if (what === "Test writer model") {
              const tw = await pickTestWriterModel(ctx, root);
              if (tw === undefined) return;
              applyTestWriterChoice(root, tw);
            } else return;
            show(ctx, `Saved to .iced/config.json.${saved(root)}\n${describe(root, ctx)}`);
            return;
          }
          case "gate": {
            if (!["strict", "always", "warn", "off"].includes(rest)) { show(ctx, `Gate is ${gateOverride ?? core.loadConfig(rootOf(ctx)).gate}. Usage: /iced gate <strict|always|warn|off> (strict gates only while a unit is active; always also gates work outside ICED)`); return; }
            gateOverride = rest;
            show(ctx, `ICED gate set to ${rest} for this session.`);
            return;
          }
          default: break;
        }
        const root = await need();
        const { unit, instructions } = startUnit(root, raw);
        refreshStatus(ctx);
        show(ctx, `Created ${unit.id} (${unit.parsed.frontmatter.type}). Drafting...`);
        send(ctx, instructions);
      } catch (error: any) {
        show(ctx, `ICED: ${error?.message ?? error}`);
      }
    },
  });
}
