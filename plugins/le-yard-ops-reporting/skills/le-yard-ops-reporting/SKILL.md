---
name: le-yard-ops-reporting
description: Build Le Yard manager and owner reports from scoped OS exports or supplied operating evidence. Use for daily or weekly briefs, KPI reviews, exception analysis, and report QA while preserving source, freshness, permissions, and demo-versus-connected boundaries.
---

# Le Yard Ops Reporting

Convert operating evidence into decisions without converting missing or synthetic data into restaurant performance claims.

## Evidence contract

1. Identify the organization, location, reporting period, timezone, currency, requestor role, source, export time, and source freshness before calculating.
2. Label every input `connected`, `synthetic/demo`, or `unknown`. Never blend these states in one KPI.
3. Preserve report-kind permissions. Le Yard OS report kinds are labor, attendance, overtime, tips, payroll readiness, sales/labor, receipts, expenses, inventory variance, COGS, waste, vendor pricing, shift performance, and guest activity.
4. Check row coverage, filters, units, duplicate keys, missing dates, and truncation. A truncated or failed export is not a complete report.
5. Distinguish zero, not applicable, unavailable, not connected, stale, and permission denied. Never render any of those states as another.
6. Reconcile only comparable grains. Do not treat reservations as sales, received inventory as same-day COGS, closeouts as provider checks, or tracked contribution as accounting profit.

## Analysis

Show the calculation behind each derived KPI. Compare against an explicit prior period, plan, par, or threshold; do not invent a benchmark. Rank exceptions by operational impact, urgency, confidence, and reversibility. Trace every recommendation to a source row or clearly identified assumption.

## Deliverable

Return:

- an as-of line and coverage statement;
- headline outcomes with confidence;
- a compact KPI table with source and freshness;
- material exceptions and likely drivers;
- actions with owner, due date, evidence needed, and approval gate;
- unavailable data and the decision it prevents.

## Action boundary

Reporting does not authorize payroll, tips, inventory adjustments, purchase approval, guest changes, staff actions, exports to a new destination, or provider configuration. Draft proposed actions and obtain explicit approval in the system that owns the change. Never describe demo evidence, a healthy HTTP response, or a generated report as proof of live operational readiness.
