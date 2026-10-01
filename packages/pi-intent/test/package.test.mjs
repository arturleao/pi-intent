// [E7] Both packages are publish-ready: right files in the tarball, complete metadata, correct dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST_PACKAGES = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

function packed(dir) {
  const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: path.join(REPO, dir), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // npm <= 11 prints an array; npm 12 prints an object keyed by package name.
  const json = JSON.parse(out);
  const [info] = Array.isArray(json) ? json : Object.values(json);
  return { name: info.name, version: info.version, files: info.files.map((f) => f.path.replace(/\\/g, "/")).sort() };
}
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(REPO, dir, "package.json"), "utf8"));
const NEVER = /(^|\/)(test|tests|intent|node_modules)\/|(^|\/)\.iced\/|\.test\.mjs$|^\.npmrc$|package-lock\.json$/;

function checkMetadata(pkg) {
  for (const k of ["name", "version", "description", "license", "author", "repository", "homepage", "bugs", "keywords", "engines", "files"]) {
    assert.ok(pkg[k], `${pkg.name}: ${k}`);
  }
  assert.equal(pkg.type, "module");
  assert.equal(pkg.publishConfig?.access, "public");
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin, undefined);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
}

test("iced-core tarball: sources, spec, templates and rubric; no tests or repo data", () => {
  const p = packed("packages/iced-core");
  assert.equal(p.name, "@arturleao/iced-core");
  for (const f of ["src/index.mjs", "src/core.mjs", "src/verify.mjs", "src/init.mjs", "src/guard.mjs", "spec/SPEC.md", "spec/rubric.md", "spec/iced.schema.json",
    ...["bug", "chore", "feature", "project", "review"].map((t) => `spec/templates/${t}.md`), "README.md", "LICENSE", "package.json"]) {
    assert.ok(p.files.includes(f), `missing ${f}`);
  }
  assert.deepEqual(p.files.filter((f) => NEVER.test(f)), []);
  const pkg = manifest("packages/iced-core");
  checkMetadata(pkg);
  assert.equal(pkg.dependencies, undefined);
  for (const target of Object.values(pkg.exports).filter((t) => !t.includes("*"))) {
    assert.ok(fs.existsSync(path.join(REPO, "packages/iced-core", target)), `export ${target}`);
  }
});

test("pi-intent tarball: extension and its modules; pi manifest; depends on iced-core; pi packages are peers", () => {
  const p = packed("packages/pi-intent");
  assert.equal(p.name, "@arturleao/pi-intent");
  for (const f of ["extensions/iced/index.ts", "src/gate.mjs", "src/runner.mjs", "src/picker.mjs", "README.md", "LICENSE", "package.json"]) {
    assert.ok(p.files.includes(f), `missing ${f}`);
  }
  assert.deepEqual(p.files.filter((f) => NEVER.test(f)), []);
  const pkg = manifest("packages/pi-intent");
  checkMetadata(pkg);
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi, { extensions: ["./extensions/iced/index.ts"] });
  const core = manifest("packages/iced-core");
  assert.equal(pkg.dependencies[core.name], `^${core.version}`);
  for (const h of HOST_PACKAGES) {
    assert.equal(pkg.peerDependencies?.[h], "*", `${h} as peer "*"`);
    assert.equal(pkg.dependencies?.[h], undefined, `${h} must not be a dependency`);
  }
});

test("every module the extension imports is in the tarball or a declared dependency", () => {
  const pkg = manifest("packages/pi-intent");
  const files = packed("packages/pi-intent").files;
  const sources = ["extensions/iced/index.ts", "src/gate.mjs", "src/runner.mjs", "src/picker.mjs"];
  for (const src of sources) {
    const text = fs.readFileSync(path.join(REPO, "packages/pi-intent", src), "utf8");
    for (const m of text.matchAll(/^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(src), spec));
        assert.ok(files.includes(rel), `${src} imports ${spec}, not packed`);
        continue;
      }
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      assert.ok(pkg.dependencies?.[name] || pkg.peerDependencies?.[name], `${src} imports ${name}, not declared`);
    }
  }
});

test("workspace root is private, not publishable, and points pi at the extension", () => {
  const root = manifest("");
  assert.equal(root.private, true);
  assert.deepEqual(root.pi, { extensions: ["./packages/pi-intent/extensions/iced/index.ts"] });
  assert.ok(fs.existsSync(path.join(REPO, root.pi.extensions[0])));
});
