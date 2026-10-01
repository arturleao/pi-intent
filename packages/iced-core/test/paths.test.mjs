import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as core from "../src/core.mjs";
import { runCommands, runProcess } from "../src/verify.mjs";
import { cleanup, tempDir } from "./helpers.mjs";

const win = process.platform === "win32";
const lowerDrive = (p) => p[0].toLowerCase() + p.slice(1);

test("normalizeDir uppercases a Windows drive letter and resolves the path", () => {
  assert.equal(core.normalizeDir("d:\\git\\repo"), win ? "D:\\git\\repo" : path.resolve("d:\\git\\repo"));
  const here = path.resolve(".");
  assert.equal(core.normalizeDir("."), win ? here[0].toUpperCase() + here.slice(1) : here);
});

test("findRoot returns an uppercase drive even from a lowercase cwd", { skip: !win }, () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, ".iced"));
    fs.mkdirSync(path.join(dir, "src"));
    const root = core.findRoot(lowerDrive(path.join(dir, "src")));
    assert.match(root, /^[A-Z]:/);
    assert.equal(root.toLowerCase(), dir.toLowerCase());
  } finally { cleanup(dir); }
});

test("check commands and agents start with an uppercase drive (Vitest crashes from d:\\)", { skip: !win }, async () => {
  const dir = tempDir();
  try {
    const cwd = lowerDrive(dir);
    const r = await runProcess(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd });
    assert.match(r.stdout, /^[A-Z]:/);
    const [check] = await runCommands(cwd, [`node -e "process.stdout.write(process.cwd())"`]);
    assert.equal(check.exitCode, 0);
    assert.match(check.tail, /^[A-Z]:\\/);
  } finally { cleanup(dir); }
});

test("markModelsAsked records 'not pinned' so setup does not ask again, and it resolves like no model", () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, ".iced"));
    fs.writeFileSync(core.configPath(dir), JSON.stringify({ verify: { model: null } }));
    core.markModelsAsked(dir);
    const cfg = core.loadConfig(dir);
    assert.deepEqual(cfg.verify.model, []);
    assert.notEqual(cfg.verify.model, null, "setup checks verify.model != null");
    assert.deepEqual(core.verifyModels(cfg), []);
    assert.match(core.describeModels(cfg, { sessionModel: "a/b" }), /not set \(uses the session model, now a\/b\)/);
    core.setVerifyModels(dir, ["x/y"]);
    core.markModelsAsked(dir);
    assert.equal(core.loadConfig(dir).verify.model, "x/y", "never overwrites a real pin");
  } finally { cleanup(dir); }
});

test("verifyModels splits a comma-joined string but not commas inside [params]", () => {
  const cfg = (model) => ({ verify: { model } });
  assert.deepEqual(core.verifyModels(cfg("vendor/a, vendor/b,vendor/c")), ["vendor/a", "vendor/b", "vendor/c"]);
  assert.deepEqual(core.verifyModels(cfg(["x/y,z/w"])), ["x/y", "z/w"]);
  assert.deepEqual(core.verifyModels(cfg("model-4-8[context=1m,effort=high], other-5")),
    ["model-4-8[context=1m,effort=high]", "other-5"]);
  assert.deepEqual(core.verifyModels(cfg(" , ")), []);
});