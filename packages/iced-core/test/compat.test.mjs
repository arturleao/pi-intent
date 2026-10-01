// [E5] Units approved by earlier versions stay valid: same contract hash, clean lint, old config keys tolerated.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as core from "../src/core.mjs";
import { cleanup, tempRepo, unitText, writeUnit } from "./helpers.mjs";

// Computed with the pre-split implementation (commit 4d53c01, lib/iced-core.mjs) for helpers.unitText().
const GOLDEN_HASH = "55fd9aa0d633adbd832b81ec23fbb947698ec3a7bdf71439495a721078a7f5a1";

test("contract hash is unchanged from the previous release", () => {
  assert.equal(core.contractHash(unitText()), GOLDEN_HASH);
});

test("a unit approved by the previous release lints clean at validate and accept", (t) => {
  const root = tempRepo({ git: true });
  t.after(() => cleanup(root));
  const text = unitText({
    status: "done", approved_at: "2026-09-01T09:31:00Z", approved_by: "Someone", contract_hash: GOLDEN_HASH, base_ref: "abc1234", attempts: 1,
  });
  writeUnit(root, "001-dark-mode", text);
  fs.writeFileSync(path.join(root, "intent", "001-dark-mode", "evidence.md"), "# Evidence\n");
  const unit = core.readUnit(root, "001-dark-mode");
  assert.deepEqual(core.lintIced(unit.parsed, "validate", unit.text).errors, []);
  assert.equal(core.acceptUnit(root, "001-dark-mode", { by: "Someone" }).ok, true);
});

test("old config keys (targets, the agent runner, per-host model maps) load without errors", (t) => {
  const root = tempRepo({ config: { targets: ["agents"], verify: { runner: "auto", model: { "host-a": ["a/b"] }, effort: { default: "low" } } } });
  t.after(() => cleanup(root));
  const cfg = core.loadConfig(root);
  assert.equal(cfg.gate, "strict");
  assert.deepEqual(core.verifyModels(cfg, "host-a"), ["a/b"]);
  assert.equal(core.verifyEffort(cfg, "host-a"), "low");
  assert.equal(cfg.verify.maxAttempts, 3);
});
