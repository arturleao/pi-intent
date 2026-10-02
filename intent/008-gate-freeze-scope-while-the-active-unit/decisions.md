# Decisions: 008-gate-freeze-scope-while-the-active-unit

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:35:44Z (agent)
- Decision: shellMutatesOnlyOutside walks command segments, tracks cd/Set-Location/pushd/popd and git -C, resolves absolute and separator-containing tokens against the effective directory, and returns true only when every mutating segment resolves outside the root; variables and globs are unresolvable and count as inside.
- Why: Fail-closed by default keeps the freeze intact for anything ambiguous, while the common worktree case (cd <sibling> && npm ci, rm -rf /abs/outside) is unambiguous.
- Alternatives: Trust only the leading cd (misses absolute targets in later segments); Allow when any target is outside (mixed commands would bypass the freeze)

## 2026-10-02T12:12:57Z (agent)
- Decision: After the attempt-3 failure: sed/perl in-place edits are file commands whose script expression is skipped and whose file operands must resolve outside (so `sed -i s/a/b/ ../sibling/f` from the root is allowed); `cd X || <cmd>` runs <cmd> in the pre-cd directory and makes later placement ambiguous (fail closed) unless the fallback is exit/return/die; a `cd` adjacent to a pipe changes nothing; subshell `cd` is scoped to its parentheses; `--flag=value` values are paths. Regression cases cover each.
- Why: Verifier traced `cd ../missing || rm src/a.ts` and `cd ../sibling | rm src/a.ts` to inside mutations classified as outside-only, and `sed -i` on sibling files blocked from the root.
- Alternatives: Treating any || or | after cd as unresolvable (would block `cd X || exit 1; npm ci`, the common safe form); Dropping sed/perl from outside handling entirely (keeps the downstream sed -i false positives)
