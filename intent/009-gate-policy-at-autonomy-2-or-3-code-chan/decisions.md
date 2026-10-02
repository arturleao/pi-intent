# Decisions: 009-gate-policy-at-autonomy-2-or-3-code-chan

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-10-02T11:35:48Z (agent)
- Decision: Added a fourth decision kind, notify: gateDecision returns it for the not-building freeze when autonomy >= 2; the extension shows an info notice and lets the call run. Owned files, protected keys, frozen contract and review units still return block regardless of autonomy. The system-prompt rules text now states the policy per effective autonomy.
- Why: Keeps the block/allow/confirm contract unchanged for existing callers and makes the policy a pure function of the effective autonomy, which already encodes risk caps and maxAutonomy.
- Alternatives: Reuse gate mode warn (downgrades owned-file blocks too); Make the freeze a config flag independent of autonomy (another knob, duplicates what autonomy means)

## 2026-10-02T12:13:02Z (agent)
- Decision: Protected-directory paths (intent/<id>, intent/, .iced/) are kept when masking quoted strings, so `rm -rf "intent/001-dark-mode"` and `Remove-Item -Recurse 'intent/...'` are hard blocks like their unquoted forms; the writesProtectedShellTarget precheck and quotedPathOrCode now share one PROTECTED_ANY pattern. Quoted-directory cases added to 007 E2 and 009 E2.
- Why: Verifier showed a quoted protected directory was masked away before the destructive-command check, letting the trusted notify path delete a frozen contract.
- Alternatives: Never masking quoted strings in writesProtectedShellTarget (brings back the grep-pattern and commit-message false positives)
