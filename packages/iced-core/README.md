# @arturleao/iced-core

**ICED** = **Intent, Context, Expectations, Done**: intent-driven development with a human-owned contract and
independent verification. This package is the host-neutral core: it reads and writes ICED units, hashes and lints
contracts, moves units through their lifecycle, runs checks, asks independent verifier agents to try to break the
work, and writes the evidence. It never starts an agent itself: the host passes in a function that does.

Zero dependencies, Node >= 20, ESM. The normative spec is [`spec/SPEC.md`](spec/SPEC.md); templates, rubric, JSON
schema and worked examples are in [`spec/`](spec).

## Install

```powershell
npm install @arturleao/iced-core
```

## Modules

| Import | Contents |
|---|---|
| `@arturleao/iced-core` | everything below |
| `@arturleao/iced-core/core` | units (`createUnit`, `readUnit`, `parseIced`, `lintIced`, `contractHash`), lifecycle (`transition`, `approveUnit`, `acceptUnit`), layers (`ancestors`, `children`), config (`loadConfig`, `verifyModels`, `setVerifyModels`...), decisions, proposals, metrics and stats |
| `@arturleao/iced-core/verify` | `runCommands`, verifier prompts and lenses, `computeVerdict`, `verifyUnit`, `submitUnit`, `runTestWriter`, evidence reports |
| `@arturleao/iced-core/init` | `initRepo`: `.iced/config.json`, memory, templates, `intent/README.md`, `.gitignore`/`.gitattributes` lines |
| `@arturleao/iced-core/guard` | `classifyPath`, `predictFileContent`, `changedProtectedKeys`, `isMutatingShell`: what a host needs to gate changes |

## Verification with your own agent

```js
import { submitUnit } from "@arturleao/iced-core";

/** @type {import("@arturleao/iced-core/verify").Agent} */
async function agent({ root, prompt, role, access, model, effort, timeoutSec, signal }) {
  // Start a fresh agent in `root` with `prompt`. access is "read-only" for verifiers (they must not change
  // files) and "write" for the test writer. Return its final answer.
  return { ok: true, text: "...final answer ending in a ```json verdict block```..." };
}

const res = await submitUnit({
  root, id: "004-add-dark-mode", summary: "Added a theme toggle",
  evidence: [{ expectation: "E1", kind: "test", ref: "tests/theme.spec.ts" }],
  agent, host: "my-host", defaultModel: "provider/model", defaultEffort: "high",
});
// res.outcome: "done" | "accepted" | "retry" | "blocked" | "missing-evidence"; res.report is also in evidence.md
```

- Verifiers run in parallel (three focus lenses for M/L/XL or high-risk units, one otherwise). Any failure fails
  the unit; three failed attempts block it.
- Models come from `verify.model` (one model or a list rotated across verifiers, `:level` suffix for effort), then
  `defaultModel`. `host` labels the report and picks the host's entry from older per-host config maps.
- Without an `agent`, verification still runs the checks, but the result is marked as not independently verified
  and needs a human.

## Guarding changes

A host that can intercept file writes and shell commands uses `guard` to keep agents inside the rules: no code
changes unless the active unit is `building`, the unit file editable only while `draft` and never its protected
fields, ICED-owned files (`evidence.md`, `verify.json`, `.iced/config.json`, `.iced/active`, `.iced/metrics.jsonl`)
written only by the tooling.

```js
import { classifyPath, changedProtectedKeys, isMutatingShell, predictFileContent } from "@arturleao/iced-core/guard";
classifyPath(root, cwd, "intent/004-x/iced.md"); // { kind: "unit", id: "004-x", ... }
isMutatingShell("rm -rf src");                    // true (a heuristic, not a sandbox)
```

## Development

```powershell
npm test
npm run validate:examples
```

## License

MIT
