// Lint the worked examples in spec/examples. With --fix, write the real contract_hash first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contractHash, lintIced, parseIced, setFrontmatter } from "../lib/iced-core.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "spec", "examples");
const fix = process.argv.includes("--fix");
let failed = 0;
for (const id of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, id, "iced.md");
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, "utf8");
  if (fix) {
    const status = parseIced(text).frontmatter.status;
    if (!["draft", "rejected"].includes(status)) {
      text = setFrontmatter(text, { contract_hash: contractHash(text) });
      fs.writeFileSync(file, text, "utf8");
    }
  }
  const parsed = parseIced(text);
  const lint = lintIced(parsed, "validate", text);
  const done = ["done", "accepted"].includes(parsed.frontmatter.status);
  if (done && !fs.existsSync(path.join(dir, id, "evidence.md"))) lint.errors.push({ code: "evidence-missing", message: "no evidence.md" });
  const hashOk = parsed.frontmatter.contract_hash ? parsed.frontmatter.contract_hash === contractHash(text) : null;
  console.log(`${id}: ${lint.errors.length} error(s), ${lint.warnings.length} warning(s), hash ${hashOk === null ? "n/a" : hashOk ? "ok" : "MISMATCH"}`);
  for (const e of lint.errors) console.log(`  error ${e.code}: ${e.message}`);
  if (lint.errors.length || hashOk === false) failed++;
}
process.exit(failed ? 1 : 0);
