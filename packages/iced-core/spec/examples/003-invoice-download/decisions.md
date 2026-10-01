# Decisions: 003-invoice-download

Agent-owned, append-only log of significant choices. Audited, not approved.

## 2026-09-11T10:02:00Z (agent)
- Decision: Proxy PDF downloads through the web app's API instead of linking to the billing service directly.
- Why: The billing pdf endpoint trusts the caller (context), so the account and role check (E3, parent C2) must happen in our API, where requireRole() and the audit logger already exist (parent C3).
- Alternatives: Signed short-lived URLs from the billing service (needs a change in another team's service; out of scope).

## 2026-09-11T10:20:00Z (agent)
- Decision: Paginate the list by year on the server.
- Why: C2 and E4 set a 2 second budget; fetching five years of invoices at once measured 3.4s locally.
- Alternatives: Client-side filtering of the full list (misses the budget).
