# Evidence: 001-login-timeout

Users are logged out while working

Verdict: **PASS** (attempt 1, 2026-09-01T10:48:00Z, independent verifier: yes, needs human review)

## Builder summary

The auth middleware now extends the session expiry by 30 minutes on each authenticated request, capped at
login time + 12 hours. Storage format unchanged.

## Expectations

### [E1] A user making requests at least every 10 minutes stays signed in for 8 hours.

- Result: **pass**
- Verify: test | test/auth/session-sliding.test.ts
- Builder evidence: test: test/auth/session-sliding.test.ts
- Verifier: Ran the test with fake timers; 48 requests at 10 minute intervals all returned 200.

### [E2] A session idle for 31 minutes is rejected.

- Result: **pass**
- Verify: test | test/auth/session-idle.test.ts
- Builder evidence: test: test/auth/session-idle.test.ts
- Verifier: Test passes; also confirmed the test fails on the base revision's behavior inverted (15 minutes).

### [E3] No session lives longer than 12 hours, active or not.

- Result: **pass**
- Verify: test | test/auth/session-absolute.test.ts
- Builder evidence: test: test/auth/session-absolute.test.ts
- Verifier: Request at 12h01m with continuous activity returns 401.

### [E4] Sessions created before the deploy keep working.

- Result: **unknown**
- Verify: manual | sign in on staging before deploy, verify still signed in after
- Builder evidence: manual: steps listed in the PR description
- Verifier: Needs a human on staging. Code reads only existing fields, so old sessions should parse.

## Failure conditions

- [F1] not triggered: Covered by E1's test.
- [F2] not triggered: Covered by E2's test.

## Constraints

- [C1] respected: Idle limit remains 30 minutes (E2).
- [C2] respected: No migration and no change to the session type in src/auth/session.ts.

## Checks

- `npm test`: exit 0, 41.2s

## Files changed since approval

- src/middleware/auth.ts
- src/auth/session.ts
- test/auth/session-sliding.test.ts
- test/auth/session-idle.test.ts
- test/auth/session-absolute.test.ts
