# Decisions: 001-login-timeout

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-09-01T09:40:00Z (agent)
- Decision: Slide the expiry in the auth middleware on each authenticated request, keeping the stored session shape.
- Why: Every request already passes through src/middleware/auth.ts, and C2 forbids changing the storage format.
- Alternatives: Refresh tokens (changes storage, violates C2); client-side keep-alive pings (counts idle tabs as activity, risks F2).

## 2026-09-01T09:52:00Z (agent)
- Decision: Store the absolute limit as login time + 12h, computed from the existing created_at field.
- Why: E3 needs an absolute cap and created_at already exists on every session, including old ones (E4).
- Alternatives: New absolute_expiry field (violates C2).
