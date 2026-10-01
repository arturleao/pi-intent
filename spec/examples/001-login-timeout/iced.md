---
iced: 0.1
id: 001-login-timeout
title: Users are logged out while working
type: bug
tier: S
parent: null
status: accepted
autonomy: 1
risk: medium
attempts: 1
created: 2026-09-01T09:12:00Z
approved_at: 2026-09-01T09:31:00Z
approved_by: Artur Leao
contract_hash: 4b546e60f599228e7a4ab90d2454807b211671d9da3a38d574f3154a53e3ccfb
base_ref: 4f2c1ab
accepted_at: 2026-09-01T11:05:00Z
accepted_by: Artur Leao
---

# Users are logged out while working

<!-- Request: fix users getting logged out after 15 minutes even when active -->

## Intent

### Goal
People who are actively using the app stay signed in for their whole working session.

### Constraints
- [C1] Idle sessions still expire after 30 minutes without activity.
- [C2] No change to how sessions are stored, so existing sessions survive the deploy.

### Failure conditions
- [F1] A user who made a request in the last 15 minutes is logged out.
- [F2] An idle user stays signed in for more than 30 minutes.

### Scope
- In: session expiry rules, the refresh on activity
- Out: remember-me, single sign-on, the login page

## Context
- [code] src/auth/session.ts sets a fixed 15 minute expiry at login and never extends it.
- [code] Every API call passes through src/middleware/auth.ts, which reads the session.
- [product] Support tickets: 38 reports of "kicked out while typing" in August.
- [knowledge] Security standard: idle timeout at most 30 minutes, absolute maximum 12 hours.
- [assumed] "Activity" means any authenticated API request, not mouse movement.

## Expectations
- [E1] A user making requests at least every 10 minutes stays signed in for 8 hours. {verify: test | test/auth/session-sliding.test.ts}
- [E2] A session idle for 31 minutes is rejected. {verify: test | test/auth/session-idle.test.ts}
- [E3] No session lives longer than 12 hours, active or not. {verify: test | test/auth/session-absolute.test.ts}
- [E4] Sessions created before the deploy keep working. {verify: manual | sign in on staging before deploy, verify still signed in after}

## Open questions
- [Q1] Should the absolute limit be 12 hours (security standard) or 8 hours (a working day)? -> A: 12 hours, per the standard.
