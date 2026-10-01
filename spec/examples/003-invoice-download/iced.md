---
iced: 0.1
id: 003-invoice-download
title: Download past invoices as PDF
type: feature
tier: M
parent: 002-billing-portal
status: building
autonomy: 1
risk: medium
attempts: 0
created: 2026-09-11T09:00:00Z
approved_at: 2026-09-11T09:45:00Z
approved_by: Artur Leao
contract_hash: 99e250e2850d90b4bb3e3bd4900ccb8e99583893622638ccabf48d132686dea0
base_ref: a17be42
accepted_at: null
accepted_by: null
---

# Download past invoices as PDF

<!-- Request: customers can download their past invoices -->

## Intent

### Goal
A billing user can find any past invoice for their account and download it, without contacting finance.

### Constraints
- [C1] The downloaded document matches the invoice finance sent (same number, lines and totals).
- [C2] Invoice list loads in under 2 seconds for accounts with 5 years of monthly invoices.

### Failure conditions
- [F1] A user can download an invoice that belongs to another account.
- [F2] A downloaded invoice differs from the finance system's record.

### Scope
- In: invoice list, filter by year, PDF download
- Out: emailing invoices, editing billing contacts, credit notes

## Context
- [code] The billing service exposes GET /invoices?account= and GET /invoices/:id/pdf.
- [code] The pdf endpoint does not check the account; it trusts the caller.
- [parent] 002-billing-portal C2 (billing role only) and C3 (audit log) apply.
- [assumed] Downloads count as billing access and are audit-logged (parent C3).

## Expectations
- [E1] A billing user sees all invoices for their account, newest first, filterable by year. {verify: test | e2e/invoices-list.spec.ts}
- [E2] Downloading an invoice returns the finance system's PDF for that invoice. {verify: test | test/billing/invoice-pdf.test.ts}
- [E3] Requesting another account's invoice, or any invoice without the billing role, is refused. {verify: test | test/billing/invoice-access.test.ts}
- [E4] The list renders in under 2 seconds with 60 invoices. {verify: check | npm run perf:invoices}

## Open questions
