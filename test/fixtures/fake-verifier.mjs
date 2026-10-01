// Stand-in for a headless agent CLI: reads an ICED verifier prompt and answers with a JSON verdict.
// FAKE_FAIL=1 fails the first expectation. FAKE_LOG=<file> records "start end" times to prove parallel runs.
import fs from "node:fs";

const started = Date.now();
const text = fs.readFileSync(process.argv[2], "utf8");
const ids = [...new Set([...text.matchAll(/^- \[(E\d+)\]/gm)].map((m) => m[1]))];
const fail = process.env.FAKE_FAIL === "1";
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS ?? 400)));
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${started} ${Date.now()}\n`);
const answer = {
  verdict: fail ? "fail" : "pass",
  expectations: ids.map((id, i) => ({ id, result: fail && i === 0 ? "fail" : "pass", evidence: `fake check of ${id}` })),
  failures: [],
  constraints: [],
  outOfScope: [],
  notes: "",
};
console.log(`Checked ${ids.length} expectation(s).\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\``);
