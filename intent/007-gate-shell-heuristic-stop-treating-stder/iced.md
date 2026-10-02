---
iced: 0.1
id: 007-gate-shell-heuristic-stop-treating-stder
title: Read-only shell commands pass the gate
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: low
attempts: 1
created: 2026-10-02T10:38:17Z
approved_at: 2026-10-02T11:35:00Z
approved_by: Artur Leao
contract_hash: c80c3e7d4d5e924688479f564795333e5e39d8119698774eb469c145613fc31e
base_ref: 1a82fe0e52bc79b0f98a4e6e640b7bb8d7959e4c
blocked_from: null
accepted_at: 2026-10-02T13:03:08Z
accepted_by: Artur Leao
---

# Read-only shell commands pass the gate

<!-- Request: Gate shell heuristic: stop treating stderr-only and temp-dir redirects as file writes, and block protected ICED targets only when a command actually writes to them -->

## Intent

### Goal
Shell commands that only read, or only discard or capture output outside the repository, are never blocked by the gate; commands that merely read an ICED-owned file are not treated as writing to it.

### Constraints
- [C1] Commands that really write files inside the repository, or really write to iced.md, evidence.md, verify.json or .iced state, stay classified as mutating and protected as today.
- [C2] The heuristic stays host-neutral in iced-core guard; no sandboxing or command execution to classify.
- [C3] `git add|commit|push|tag` and other non-mutating git commands remain allowed as today.
- [C4] Implementations of the other approved gate units 008-012 in the same files are allowed batch artifacts, not out-of-scope violations; this unit remains responsible only for the shell heuristic.

### Failure conditions
- [F1] A command whose only redirect is stderr-only (`2>/dev/null`, `2>$null`, `2>file`) or `2>&1` is classified as mutating.
- [F2] A command whose only redirect targets a temp location (`$env:TEMP`, `$TMPDIR`, `/tmp`, `%TEMP%`) is classified as mutating.
- [F3] A command that only reads an ICED-owned file (Get-Content, cat, Select-String, grep, rg, type, git stash/diff/show naming the path) is blocked as modifying ICED-owned files.
- [F4] A command that writes to an ICED-owned file (redirect into it, Set-Content, sed -i, [IO.File]::WriteAllText, cp/mv onto it) stops being blocked.

### Scope
- In: `isMutatingShell`, `REDIRECT`, `PROTECTED_SHELL_TARGETS` and their use in the pi gate; regression tests; README gate wording if it changes.
- Out: freeze scope by target path (unit 008), autonomy-based policy (unit 009), block message wording (unit 012).

## Context
- [code] `REDIRECT` in packages/iced-core/src/guard.mjs matches any `>`/`>>` not preceded by `<>=&|` and not followed by `&`; `2>/dev/null` and `2>$null` match, so pure diagnostics like `ls x 2>/dev/null` are mutating.
- [code] `PROTECTED_SHELL_TARGETS` is a path regex; the gate blocks when `isMutatingShell(command) && PROTECTED_SHELL_TARGETS.test(command)`, so any mutating-looking command that mentions iced.md anywhere (even inside `Get-Content`) is blocked as modifying ICED-owned files.
- [code] Reproduced in this repository: `git stash push .iced/metrics.jsonl` and `git status; Get-Content intent/<id>/iced.md | Select-String status; rg ... 2>$null` were both blocked as modifying ICED-owned files; `pwd; git worktree list; ls x 2>/dev/null` and `grep -rn x dir 2>/dev/null | head` were classified mutating.
- [code] Session logs of a downstream project show about ten such blocks on read-only commands over two days.
- [knowledge] CONTRIBUTING.md: npm test runs on Windows and Linux; keep host-specific paths out of the repository.
- [assumed] Temp-dir detection by well-known prefixes (`$env:TEMP`, `$env:TMP`, `%TEMP%`, `$TMPDIR`, `/tmp/`, `/private/tmp/`, `/dev/null`, `$null`) is enough; resolving arbitrary variables is out of scope.
- [assumed] Protected-target detection should consider the path as written: it counts as a write when the protected path is the redirect target, or an argument to a known file-writing command/API, or the destination of cp/mv/Copy-Item/Move-Item.

## Expectations
- [E1] Commands whose only redirects are stderr-only, `2>&1`, `$null`/`/dev/null`, or temp-dir targets are not mutating; redirects to other repository paths still are. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E2] Commands that only read an ICED-owned path (Get-Content, cat, type, grep, rg, Select-String, git diff/show/stash naming the path) are allowed; commands that write to such a path (redirect, Set-Content/Add-Content/Out-File, sed -i, WriteAllText, cp/mv/Copy-Item/Move-Item destination) are still blocked. {verify: test | packages/pi-intent/test/gate.test.mjs}
- [E3] Existing mutating-command cases keep their classification and the full suite passes. {verify: check | npm test}

## Open questions
