---
iced: 0.1
id: 002-billing-portal
title: Customers manage their own billing
type: project
tier: L
parent: null
status: approved
autonomy: 1
risk: high
attempts: 0
created: 2026-09-10T08:00:00Z
approved_at: 2026-09-10T10:20:00Z
approved_by: Artur Leao
contract_hash: 7735258b8e2f34570ceaf6c1cbe8530273d5078e0763585cf67f79eda65107fe
base_ref: 9d81e0c
accepted_at: null
accepted_by: null
---

# Customers manage their own billing

<!-- Request: project: self-service billing portal so finance stops handling invoice and card requests -->

## Intent

### Goal
Customers can see invoices, update payment details and change plans themselves, so the finance team no
longer handles routine billing requests.

### Constraints
- [C1] Card data never touches our servers; the payment provider holds it.
- [C2] Only users with the account's billing role can see or change billing information.
- [C3] Every billing change is recorded in the audit log with who, what and when.
- [C4] Works on the browsers in the supported browser list.

### Failure conditions
- [F1] A user without the billing role can view an invoice or payment method.
- [F2] A customer is charged an amount they did not see before confirming.
- [F3] A billing change is missing from the audit log.

### Scope
- In: invoices, payment methods, plan changes, billing contacts
- Out: refunds, tax configuration, reseller accounts

## Context
- [code] Plans and prices live in the billing service; the web app calls it through src/api/billing.ts.
- [code] Roles are checked with requireRole() in src/auth/roles.ts; a billing role already exists.
- [product] Finance handles about 400 billing emails a month; 70% are invoice copies and card updates.
- [knowledge] PCI scope must not grow; card entry uses the provider's hosted fields.
- [knowledge] Audit log events follow the schema in docs/audit-events.md.

## Expectations
- [E1] Finance billing requests drop by at least half within two months of launch. {verify: metric | finance ticket count, monthly}
- [E2] Every child feature under this project is accepted. {verify: check | /iced list shows every child accepted}
- [E3] An end-to-end run covers view invoice, update card and change plan as a billing user, and each is refused for a non-billing user. {verify: test | e2e/billing-portal.spec.ts}

## Children
- 003-invoice-download

## Open questions
- [Q1] Can customers downgrade mid-cycle, or only at renewal? -> A: At renewal only, for now.
