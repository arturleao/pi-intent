// State for the ICED model picker in pi: choose models, cycle each one's effort, pick several for rotation.
// UI-free so it can be tested; extensions/iced/index.ts maps keys to these actions and renders the rows.

import { EFFORTS, splitEffort } from "@arturleao/iced-core/core";

/** null means "default": verify.effort, else the session's thinking level, else the model's own default. */
export const EFFORT_CYCLE = [null, ...EFFORTS];

const refOf = (model, effort) => `${model}${effort ? `:${effort}` : ""}`;

export function cycleEffort(current, dir, reasoning = true) {
  const levels = reasoning === false ? [null, "off"] : EFFORT_CYCLE;
  const i = Math.max(0, levels.indexOf(current ?? null));
  return levels[(i + dir + levels.length) % levels.length];
}

/**
 * rows: { kind: "model", ref, note?, reasoning? } (ref may carry a :level suffix),
 *       { kind: "group", label, refs: [...] } (a ready-made rotation),
 *       { kind: "action", id, label, effortable? , effort? }.
 * multi: how many models Space may pick for rotation (0 = single choice).
 */
export function createPicker({ rows, multi = 0, picked = [] }) {
  const state = {
    multi,
    filter: "",
    cursor: 0,
    message: "",
    rows: rows.map((r) => {
      if (r.kind === "model") return { ...r, ...split(r.ref) };
      if (r.kind === "group") return { ...r, members: r.refs.map(split) };
      return { effortable: false, effort: null, ...r };
    }),
    picked: [],
  };
  for (const ref of picked) {
    const i = state.rows.findIndex((r) => r.kind === "model" && r.model === split(ref).model);
    if (i >= 0 && state.picked.length < multi) state.picked.push(i);
  }
  return state;
}

function split(ref) {
  const s = splitEffort(ref);
  return { model: s.model, effort: s.effort };
}

/** Indexes of the rows shown for the current filter (actions and rotations always stay visible). */
export function visibleRows(state) {
  const f = state.filter.toLowerCase();
  return state.rows.map((_, i) => i).filter((i) => {
    const r = state.rows[i];
    if (!f || r.kind !== "model") return true;
    return `${r.model} ${r.note ?? ""}`.toLowerCase().includes(f);
  });
}

export const currentRow = (state) => state.rows[visibleRows(state)[state.cursor]] ?? null;
const currentIndex = (state) => visibleRows(state)[state.cursor] ?? -1;

function clampCursor(state) {
  const n = visibleRows(state).length;
  state.cursor = n ? Math.min(Math.max(0, state.cursor), n - 1) : 0;
}

export function move(state, dir) {
  const n = visibleRows(state).length;
  if (n) state.cursor = (state.cursor + dir + n) % n;
  state.message = "";
}

export function cycle(state, dir) {
  const r = currentRow(state);
  state.message = "";
  if (!r) return;
  if (r.kind === "model") {
    r.effort = cycleEffort(r.effort, dir, r.reasoning);
    if (r.reasoning === false) state.message = `${r.model} has no thinking levels (only off).`;
  } else if (r.kind === "group") {
    const next = cycleEffort(r.members[0]?.effort ?? null, dir);
    for (const m of r.members) m.effort = next;
  } else if (r.effortable) {
    r.effort = cycleEffort(r.effort, dir);
  } else {
    state.message = "Effort applies to models.";
  }
}

/** Space: add or remove the highlighted model from the rotation. */
export function toggle(state) {
  const i = currentIndex(state);
  const r = state.rows[i];
  state.message = "";
  if (!state.multi) { state.message = "Choose one model."; return; }
  if (!r || r.kind !== "model") { state.message = "Space adds a model to the rotation."; return; }
  const at = state.picked.indexOf(i);
  if (at >= 0) state.picked.splice(at, 1);
  else if (state.picked.length >= state.multi) state.message = `At most ${state.multi} models; Space on a picked one removes it.`;
  else state.picked.push(i);
}

export function typeChar(state, ch) {
  state.filter += ch;
  state.cursor = 0;
  state.message = "";
  clampCursor(state);
}

export function clearFilter(state) {
  state.filter = "";
  state.message = "";
  clampCursor(state);
}

export function backspace(state) {
  state.filter = state.filter.slice(0, -1);
  state.message = "";
  clampCursor(state);
}

/**
 * Enter. Returns { refs: [...] } for models (with :level suffixes), { action: id, effort } for an action row,
 * or null when nothing can be chosen.
 */
export function choose(state) {
  if (state.picked.length) return { refs: state.picked.map((i) => refOf(state.rows[i].model, state.rows[i].effort)) };
  const r = currentRow(state);
  if (!r) return null;
  if (r.kind === "model") return { refs: [refOf(r.model, r.effort)] };
  if (r.kind === "group") return { refs: r.members.map((m) => refOf(m.model, m.effort)) };
  return { action: r.id, effort: r.effort ?? null };
}

/** Where a row sits in the rotation (1-based), or 0. */
export function pickedPosition(state, rowIndex) {
  return state.picked.indexOf(rowIndex) + 1;
}

/** Add typed models (already picked) at the top of the model rows. */
export function addModels(state, refs) {
  let insertAt = state.rows.findIndex((r) => r.kind === "model");
  if (insertAt < 0) insertAt = state.rows.findIndex((r) => r.kind === "action");
  if (insertAt < 0) insertAt = state.rows.length;
  const chosen = [];
  for (const ref of refs) {
    const s = split(ref);
    if (!s.model) continue;
    let row = state.rows.find((r) => r.kind === "model" && r.model === s.model);
    if (row) { if (s.effort) row.effort = s.effort; }
    else { row = { kind: "model", ref, note: "typed", ...s }; state.rows.splice(insertAt++, 0, row); }
    if (!chosen.includes(row)) chosen.push(row);
  }
  state.picked = state.multi ? chosen.slice(0, state.multi).map((row) => state.rows.indexOf(row)) : [];
  state.filter = "";
  state.cursor = chosen.length ? Math.max(0, visibleRows(state).indexOf(state.rows.indexOf(chosen[0]))) : 0;
  state.message = "";
}

export const effortLabel = (effort, fallback) => effort ?? `default${fallback ? ` (${fallback})` : ""}`;
