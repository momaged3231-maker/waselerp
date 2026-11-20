# WaselERP — Decision Consolidation Tables (Phase 1 Audit) — v2

> **Source documents:** PURCHASE-CYCLE-DECISIONS.md v0.3 · AGENTS.md · ERP-AUDIT-PHASE1-DISCOVERY.md · EZEES-COVERAGE.md · conversation sessions (Sales, Purchases, Inventory, Treasury, Accounting)
> **Date:** 2026-11-17
> **Status:** Consolidation pass 2 — reclassified per accountant review. Awaiting verification on sample, then unified document.
> **Header rule:** This document supersedes all previous session decisions in case of conflict. In case of dispute, refer to Conflict Table §2, not the original session text.
> **Classification taxonomy (7 categories):** OPEN / RESOLVED / NOT-A-CONFLICT / DUPLICATE / GAP / MISSING-DESIGN / PENDING-IMPLEMENTATION. Each row has a single category. GAP/Missing/Pending rows link to their TD/M entry.

---

## §0 — The 5 Decisions Applied (accountant, 2026-11-17)

| # | Conflict(s) resolved | Decision (literal) |
|---|---|---|
| D-01 | C-01, C-09, C-21, C-40 | `credit_limit` + `grace_days` on `parties` (ALTER). `customer_classifications` becomes default-value source only. Classification → customer copy on creation. Editing customer value requires independent permission. |
| D-02 | C-02, C-17 | Cost floor reads from `item_warehouse_qty.avg_cost` (per warehouse), not `items.cost_price`. `items.cost_price` = "headline" for display only, not used in any branch-specific decision. |
| D-03 | C-06 | `Unbilled Receivable` carries branch dimension (mirror of GRNI). |
| D-04 | C-08 | No `price_list_version_id` on `purchase_order_lines` in Phase-1. PO uses its own negotiated price (snapshot). Supplier price lists may be added later as a separate concept. |
| D-05 | C-34 | No third account. 5111 "فروقات جرد" suffices; shortage vs surplus distinguished by mandatory reason code (THEFT / COUNT_ERROR / UNRECORDED / SYSTEM_ERROR). 5112 = damage only. |

---

## §1 — Decision Registry (sample: 5 per domain)

### Sales (sample 5 of 28)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-001 | Credit limit: strict block by default + override with permission (`sales.approve_over_credit`) + mandatory reason. | Session A | accounting | approved |
| DEC-SALES-006 | Overdue fact: `today > due_date`. Grace affects hard-block gate only. | Session A | accounting | approved |
| DEC-SALES-009 | Sales returns: linked only (must have original invoice). | Session A | accounting | approved |
| DEC-SALES-021 | Price lists: multiple from day 1. Snapshot on line. Effective dates. Fallback chain. VAT exclusive. | Session A | accounting | approved |
| DEC-SALES-026 | Tax categories: 3 layers (item → customer → invoice line). WHT separate mechanism. | Session A | accounting | approved |

### Purchases (sample 5 of 48)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-PURCH-001 | Four independent documents: PO, GRN, Invoice, Payment. | PURCHASE-CYCLE-DECISIONS §1.1 | accounting | approved |
| DEC-PURCH-006 | GRNI unified control account. GRN: Dr INVENTORY/Cr GRNI. Invoice: Dr GRNI/Dr PPV/Dr VAT Input/Cr AP. | §1.6, R-1 | accounting | approved |
| DEC-PURCH-007 | PPV — difference between invoice price and GRN provisional cost. | §1.6, §1.13 | accounting | approved |
| DEC-PURCH-018 | Supplier advances: new asset account, party mandatory, no branch. | §1.7, R-2 | accounting | approved |
| DEC-PURCH-024 | OI-2 (VAT timing): VAT at invoice posting. 90-day GRNI aging. | §7.2 | accounting | approved |

### Inventory (sample 5 of 13)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-INV-001 | Weighted average cost (not FIFO, not LIFO). LIFO prohibited by IAS 2/EAS. | Session C | accounting | approved |
| DEC-INV-002 | Average cost per warehouse (not per company). | Session C + code | accounting | approved |
| DEC-INV-004 | Stock count: cycle count default. Annual full count mandatory (legal). No auto-adjustment. | Session C | accounting | approved |
| DEC-INV-006 | Serial numbers: unique at company level. Mandatory if enabled. | Session C | accounting | approved |
| DEC-INV-007 | Expiry dates: tracked per receipt (batch). FEFO default. No sale after expiry. | Session C | accounting | approved |

### Accounting (sample 5 of 15)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-ACCT-002 | Period close: monthly mandatory, hard close annually. Reopen with permission+reason+audit. `filed` vs `closed` distinguished. | Session D | accounting | approved |
| DEC-ACCT-004 | Cash variance: daily reconciliation mandatory. Materiality per branch. Reason code mandatory. SoD. | Session D | accounting | approved |
| DEC-ACCT-005 | Bank reconciliation: monthly mandatory. Every real variance → 2106. Timing items don't hit GL. SLA 30 days. | Session D | accounting | approved |
| DEC-ACCT-007 | Posting engine: all financial effects via `common/posting.ts`. Balanced journal or reject. | AGENTS.md, code | accounting | verified-existing |
| DEC-ACCT-011 | Fixed assets: registration, depreciation, disposal with mirror journal, UNIQUE (asset, period). | docs, AGENTS.md | accounting | verified-existing |

### HR / CRM / Other (sample)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-HR-001 | HR complete: departments, employees, attendance, leaves, salaries, payroll journal. | AGENTS.md, docs | accounting | verified-existing |
| DEC-HR-003 | ZKTeco biometric — deferred. | AGENTS.md | accounting | verified-existing |
| DEC-CRM-001 | CRM basic: sources, leads, activities, tickets, convert lead to customer. | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-001 | Restaurant master switch (RestaurantsEnabled). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-005 | Offline queue (IndexedDB + idempotency). | AGENTS.md | accounting | verified-existing |

**Note on `verified-existing`:** 14 decisions (DEC-ACCT-001, 011, 014, 015, DEC-HR-001, 003, DEC-CRM-001, 002, DEC-OTHER-001..006) have source `AGENTS.md` or `docs` only — not from these sessions. These are **verified-existing** (I reviewed and approved the current behavior), not **approved** (I created the decision). The distinction is recorded. The accountant noted "أربعة" (four) but the principle applies to all 14 sourced only from AGENTS.md/docs.

---

## §2 — Conflict Table (reclassified, 50 rows)

### Status taxonomy (7 categories)
| Category | Definition | Action |
|---|---|---|
| OPEN | Conflict confirmed, not resolved | Needs decision (all 5 resolved by D-01..D-05) |
| RESOLVED | Conflict existed, resolved by later decision | Documented, closed |
| NOT-A-CONFLICT | Intentional difference or status check | Move to §Notes, remove from conflict table |
| DUPLICATE | Same as another row | Merge into the original row |
| GAP | Code missing something, but no conflict between two decisions | Build it → links to TD entry |
| MISSING-DESIGN | Design not yet approved (no decision made) | Links to M entry |
| PENDING-IMPLEMENTATION | Decision exists, execution deferred (migration) | Links to Phase-2 migration |

### Reclassified conflict table

| # | Conflict (short) | Category | Links to |
|---|---|---|---|
| C-01 | credit_limit/grace_days on classifications vs per-customer | **RESOLVED** (D-01) | TD-07, TD-12 |
| C-02 | Cost floor reads items.cost_price vs per-warehouse avg | **RESOLVED** (D-02) | TD-13, TD-26 |
| C-03 | WHT: commitment on purchases vs asset on sales | **RESOLVED** | — |
| C-04 | VAT: at-invoice (purchases) vs at-earliest-event (sales) | **NOT-A-CONFLICT** | note §3.2 |
| C-05 | Advances: purchases (asset, no branch) vs sales (not created, branch?) | **MISSING-DESIGN** | M-03, M-08 |
| C-06 | GRNI branch dimension vs Unbilled Receivable (branch not mentioned) | **RESOLVED** (D-03) | M-01, M-02 |
| C-07 | Settlement discount: sales (expense) vs purchases (income) | **RESOLVED** | TD-10 |
| C-08 | price_list_version_id on purchase_order_lines? | **RESOLVED** (D-04) | — |
| C-09 | customer_groups.default_credit_limit vs parties.credit_limit | **DUPLICATE** (of C-01) | TD-07 |
| C-10 | Phase-1 v0.3 "ON HOLD" vs later decisions opening Phase-2 | **NOT-A-CONFLICT** | — |
| C-11 | filed vs closed on periods — needs ALTER | **GAP** | TD-25 |
| C-12 | Control accounts need updated chart of accounts | **GAP** | TD (chart update) |
| C-13 | assertPeriodOpen in all paths — which bypass? | **GAP** | TD-24 |
| C-14 | Customer advances not in code — supplier advances also Phase-2 | **NOT-A-CONFLICT** | TD-20 |
| C-15 | Deferred Revenue not in schema | **MISSING-DESIGN** | M-01 |
| C-16 | Unbilled Receivable not in schema | **MISSING-DESIGN** | M-02 |
| C-17 | Cost floor reads items.cost_price — same as C-02 | **DUPLICATE** (of C-02) | TD-13, TD-26 |
| C-18 | Returns: purchases "actual cost" vs sales "COGS from original movement" | **NOT-A-CONFLICT** | note §3.1 |
| C-19 | Serial UNIQUE not in code | **GAP** | TD-14 |
| C-20 | customer_groups missing default_price_list_id / default_trade_discount_pct | **GAP** | TD-06 |
| C-21 | customer_classifications carries credit_limit/grace_days but decision says per-customer | **DUPLICATE** (of C-01) | TD-07, TD-12 |
| C-22 | invoice_lines missing price_list_id / price_list_version_id | **GAP** | TD-04 |
| C-23 | orders missing price_list_id | **GAP** | TD-05 |
| C-24 | invoice_lines has serial_no/expiry_date but no UNIQUE on serial_no | **DUPLICATE** (of C-19) | TD-14 |
| C-25 | invoice_lines has tax_pct but no tax_category_id | **GAP** | TD-08 |
| C-26 | items missing tax_category_id | **GAP** | TD-09 |
| C-27 | Settlement discount disabled but no settlement_discount_terms field | **GAP** | TD-10 |
| C-28 | WHT tables not in schema | **MISSING-DESIGN** | M-10, TD-11, TD-22 |
| C-29 | Deferred Revenue / Unbilled Receivable accounts not in chart | **MISSING-DESIGN** | M-01, M-02 |
| C-30 | Customer advances account not in chart | **MISSING-DESIGN** | M-03, TD-20 |
| C-31 | PPV account not in chart | **MISSING-DESIGN** | OI-12, TD (Phase-2) |
| C-32 | GRNI account not in chart | **MISSING-DESIGN** | OI-1, TD (Phase-2) |
| C-33 | Supplier advances account not in chart | **MISSING-DESIGN** | OI-1, TD (Phase-2) |
| C-34 | Inventory shortage expense account — third account? | **RESOLVED** (D-05) | TD (none — no new account) |
| C-35 | stocktake_sessions/lines/adjustments tables missing | **MISSING-DESIGN** | TD-18 |
| C-36 | price_list_versions/price_list_items tables missing | **MISSING-DESIGN** | TD-19 |
| C-37 | customer_advances table missing | **MISSING-DESIGN** | M-03, TD-20 |
| C-38 | v_invoice_overdue view missing | **MISSING-DESIGN** | TD-21 |
| C-39 | wht_transactions table missing | **MISSING-DESIGN** | M-10, TD-22 |
| C-40 | grace_days on parties not in schema | **DUPLICATE** (of C-01) | TD-12 |
| C-41 | Inter-branch transfer clearing (1108) exists (E2) | **NOT-A-CONFLICT** | — |
| C-42 | supplier_payment_allocations in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-43 | supplier_claims in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-44 | purchase_invoice_links in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-45 | purchase_rejections in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-46 | purchase_receipts in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-47 | purchase_receipt_lines in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-48 | supplier_advances in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-49 | parties.default_damage_policy in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-50 | orders.delivery_terms/delivery_terms_note in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |

### Reclassified counts
| Category | Count | Items |
|---|---|---|
| RESOLVED | 7 | C-01, C-02, C-03, C-06, C-07, C-08, C-34 |
| NOT-A-CONFLICT | 5 | C-04, C-10, C-14, C-18, C-41 |
| DUPLICATE | 5 | C-09, C-17, C-21, C-24, C-40 |
| GAP | 10 | C-11, C-12, C-13, C-19, C-20, C-22, C-23, C-25, C-26, C-27 |
| MISSING-DESIGN | 14 | C-05, C-15, C-16, C-28, C-29, C-30, C-31, C-32, C-33, C-35, C-36, C-37, C-38, C-39 |
| PENDING-IMPLEMENTATION | 9 | C-42, C-43, C-44, C-45, C-46, C-47, C-48, C-49, C-50 |
| **Total** | **50** | |

**True unique conflicts (OPEN + RESOLVED):** 7 (all now RESOLVED — 0 OPEN)
**Non-conflicts (NOT-A-CONFLICT + DUPLICATE):** 10
**Design/build gaps (GAP + MISSING-DESIGN + PENDING-IMPLEMENTATION):** 33

---

## §3 — [MISSING] list (reclassified, 28 items)

| # | Item | Where mentioned | Status |
|---|---|---|---|
| M-01 | Deferred Revenue (sales) account | Session A | [MISSING-DESIGN] — needs owner/accountant confirmation |
| M-02 | Unbilled Receivable (sales) account | Session A | [MISSING-DESIGN] |
| M-03 | Customer Advances account (sales side) | Session A | [MISSING-DESIGN] |
| M-04 | NRV write-down policy: unified default (90 days) vs per category | Session C | [MISSING-DESIGN] — pending-owner |
| M-05 | NRV re-evaluation: monthly re-test vs fixed at first test | Session C | [MISSING-DESIGN] — pending-owner |
| M-06 | Settlement discount (sales): enabled/disabled | Session A | [MISSING-DESIGN] — pending-owner |
| M-07 | Settlement discount (purchases): enabled/disabled | Session B | [MISSING-DESIGN] — pending-owner |
| M-08 | Customer advances usage: (a) reduce invoice / (b) credit balance / (c) both | Session A | [MISSING-DESIGN] — pending-owner |
| M-09 | Cash return for sales return: immediate cash vs credit balance | Session A | [MISSING-DESIGN] — pending-owner |
| M-10 | WHT: does company have government customers requiring WHT? | Session A | [MISSING-DESIGN] — pending-owner |
| M-11 | Special tax treatment (government/exempt/export/diplomatic) | Session A | [MISSING-DESIGN] — pending-owner |
| M-12 | Inter-branch stock transfer: does company transfer stock between branches today? | Session C | [MISSING-DESIGN] — pending-owner |
| M-13 | Serial numbers: does company use serial tracking? Which items? | Session C | [MISSING-DESIGN] — pending-owner |
| M-14 | Expiry dates: does company track expiry? Which items? | Session C | [MISSING-DESIGN] — pending-owner |
| M-15 | Fiscal year: Gregorian or non-Gregorian? Written approval? | Session D | [MISSING-DESIGN] — pending-owner |
| M-16 | Cash variance: number of shifts per day, multiple drawers, bank accounts linked? | Session D | [MISSING-DESIGN] — pending-owner |
| M-17 | Bank reconciliation: performed monthly/weekly in practice? | Session D | [MISSING-DESIGN] — pending-owner |
| M-18 | Period close: performed monthly in practice, or only annually? | Session D | [MISSING-DESIGN] — pending-owner |
| M-19 | Stock count frequency: monthly/quarterly/annual/cycle? | Session C | [MISSING-DESIGN] — pending-owner |
| M-20 | Stock adjustment policy: auto vs gated? Materiality threshold? | Session C | [MISSING-DESIGN] — pending-owner |
| M-21 | Customer groups: does company use customer groups? | Session A | [MISSING-DESIGN] — pending-owner |
| M-22 | Price lists: does company use multiple price lists? | Session A | [MISSING-DESIGN] — pending-owner |
| M-23 | Quotation/order flow: direct invoice or order-first? | Session A | [MISSING-DESIGN] — pending-owner (likely answered: mixed) |
| M-24 | Invoicing before delivery: does company issue invoice before delivery? | Session A | [MISSING-DESIGN] — pending-owner |
| M-25 | Customer advances: does company receive prepayments from customers? | Session A | [MISSING-DESIGN] — pending-owner |
| M-26 | Supplier settlement discount: do suppliers offer early payment discount? | Session B | [MISSING-DESIGN] — pending-owner |
| M-27 | Customer settlement discount: does company offer early payment discount? | Session A | [MISSING-DESIGN] — pending-owner |
| M-28 | Number of daily shifts, multiple drawers, bank accounts linked | Session D | [MISSING-DESIGN] — pending-owner |

---

## §4 — Technical Debt (reclassified, 30 items)

| # | Item | Source | Priority | Links to |
|---|---|---|---|---|
| TD-01 | `convertOrder` blocks second conversion after partial | Session A + code | High | — |
| TD-02 | Stock reservation has no expiry date | Session A + code | High | — |
| TD-03 | 2 unallocated receipt vouchers in demo data | Session A + code | Medium | — |
| TD-04 | `price_list_id` + `price_list_version_id` missing on `invoice_lines` and `order_lines` | Session A + code | High | C-22 |
| TD-05 | `orders` has no `price_list_id` | Session A + code | Medium | C-23 |
| TD-06 | `customer_groups` missing `default_price_list_id` + `default_trade_discount_pct` | Session A + code | Medium | C-20 |
| TD-07 | `credit_limit`/`grace_days` on `customer_classifications` instead of `parties` | Session A + code | High | C-01, C-09, C-21, C-40 |
| TD-08 | `invoice_lines` missing `tax_category_id` | Session A + code | Medium | C-25 |
| TD-09 | `items` missing `tax_category_id` (likely) | Session A + code | Medium | C-26 |
| TD-10 | Settlement discount: no `settlement_discount_terms` field in schema | Session A + code | Low | C-27 |
| TD-11 | WHT tables not in schema | Session A + code | Medium | C-28, C-39 |
| TD-12 | `grace_days` missing on `parties` (only on `customer_classifications`) | Session A + code | High | C-01, C-40 |
| TD-13 | Cost floor reads `items.cost_price` instead of per-warehouse avg_cost | Session C + code | Medium | C-02, C-17 |
| TD-14 | Serial number: no UNIQUE constraint (company level) | Session C + code | Medium | C-19, C-24 |
| TD-15 | No FEFO enforcement in code | Session C + code | Medium | — |
| TD-16 | No NRV write-down logic | Session C + code | Medium | — |
| TD-17 | No expiry alerts enforcement (column exists, no trigger/check) | Session C + code | Low | — |
| TD-18 | `stocktake_sessions`/`stocktake_lines`/`stock_adjustments` tables missing | Session C | Medium | C-35 |
| TD-19 | `price_list_versions`/`price_list_items` tables missing | Session A | Medium | C-36 |
| TD-20 | `customer_advances` table missing | Session A | Medium | C-37, M-03 |
| TD-21 | `v_invoice_overdue` view missing | Session A | High | C-38 |
| TD-22 | `wht_transactions` table missing | Session A | Medium | C-39, M-10 |
| TD-23 | `serial_no`/`expiry_date` columns exist but not enforced | Session C + code | Medium | C-19, C-24 |
| TD-24 | `assertPeriodOpen` — verify all posting paths call it | Session D + code | High | C-13 |
| TD-25 | `filed`/`closed`/`filed_at`/`filing_reference` missing on `periods` | Session D | Medium | C-11 |
| TD-26 | `items.cost_price` follows latest purchase (not per-warehouse) — fix cost floor only | Session C + code | Medium | C-02, C-17 |
| TD-27 | Type 2 (purchase) invoice does everything at once — contradicts GRNI design | Session B + code | High | — |
| TD-28 | `parties.default_damage_policy` missing (in purchases migration, not run) | Session B | Medium | — |
| TD-29 | `orders.delivery_terms`/`delivery_terms_note` missing (in purchases migration, not run) | Session B | Medium | — |
| TD-30 | `purchase_receipts` etc. missing (in purchases migration, not run) | Session B | Medium | — |

---

## §1 — Decision Registry (sample: 5 per domain)

### Sales (sample 5 of 28)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-001 | Credit limit: strict block by default + override with permission (`sales.approve_over_credit`) + mandatory reason. | Session A | accounting | approved |
| DEC-SALES-006 | Overdue fact: `today > due_date`. Grace affects hard-block gate only. | Session A | accounting | approved |
| DEC-SALES-009 | Sales returns: linked only (must have original invoice). | Session A | accounting | approved |
| DEC-SALES-021 | Price lists: multiple from day 1. Snapshot on line. Effective dates. Fallback chain. | Session A | accounting | approved |
| DEC-SALES-026 | Tax categories: 3 layers (item → customer → invoice line). WHT separate mechanism. | Session A | accounting | approved |

### Purchases (sample 5 of 48)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-PURCH-001 | Four independent documents: PO, GRN, Invoice, Payment. | PURCHASE-CYCLE-DECISIONS §1.1 | accounting | approved |
| DEC-PURCH-006 | GRNI unified control account. GRN: Dr INVENTORY/Cr GRNI. Invoice: Dr GRNI/Dr PPV/Dr VAT Input/Cr AP. | §1.6, R-1 | accounting | approved |
| DEC-PURCH-007 | PPV — difference between invoice price and GRN provisional cost. | §1.6, §1.13 | accounting | approved |
| DEC-PURCH-018 | Supplier advances: new asset account, party mandatory, no branch. | §1.7, R-2 | accounting | approved |
| DEC-PURCH-024 | OI-2 (VAT timing): VAT at invoice posting. 90-day GRNI aging. | §7.2 | accounting | approved |

### Inventory (sample 5 of 13)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-INV-001 | Weighted average cost (not FIFO, not LIFO). LIFO prohibited by IAS 2/EAS. | Session C | accounting | approved |
| DEC-INV-002 | Average cost per warehouse (not per company). | Session C + code | accounting | approved |
| DEC-INV-004 | Stock count: cycle count default. Annual full count mandatory (legal). No auto-adjustment. | Session C | accounting | approved |
| DEC-INV-006 | Serial numbers: unique at company level. Mandatory if enabled. | Session C | accounting | approved |
| DEC-INV-007 | Expiry dates: tracked per receipt (batch). FEFO default. No sale after expiry. | Session C | accounting | approved |

### Accounting (sample 5 of 15)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-ACCT-002 | Period close: monthly mandatory, hard close annually. Reopen with permission+reason+audit. `filed` vs `closed` distinguished. | Session D | accounting | approved |
| DEC-ACCT-004 | Cash variance: daily reconciliation mandatory. Materiality per branch. Reason code mandatory. SoD. | Session D | accounting | approved |
| DEC-ACCT-005 | Bank reconciliation: monthly mandatory. Every real variance → 2106. Timing items don't hit GL. SLA 30 days. | Session D | accounting | approved |
| DEC-ACCT-007 | Posting engine: all financial effects via `common/posting.ts`. Balanced journal or reject. | AGENTS.md, code | accounting | verified-existing |
| DEC-ACCT-011 | Fixed assets: registration, depreciation, disposal with mirror journal, UNIQUE (asset, period). | docs, AGENTS.md | accounting | verified-existing |

### HR / CRM / Other (sample)
| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-HR-001 | HR complete: departments, employees, attendance, leaves, salaries, payroll journal. | AGENTS.md, docs | accounting | verified-existing |
| DEC-HR-003 | ZKTeco biometric — deferred. | AGENTS.md | accounting | verified-existing |
| DEC-CRM-001 | CRM basic: sources, leads, activities, tickets, convert lead to customer. | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-001 | Restaurant master switch (RestaurantsEnabled). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-005 | Offline queue (IndexedDB + idempotency). | AGENTS.md | accounting | verified-existing |

---

## Consolidation Notes

### 3.1 Decisions that need unified naming
- "Actual cost of returns" (purchases, out of scope) vs "COGS from original movement" (sales, mandatory) — same principle, different names. Needs unified terminology in final document.

### 3.2 Decisions that need explicit justification
- C-04: VAT timing differs between purchases (at invoice) and sales (at earliest event). Intentional difference — purchases: VAT at invoice posting (OI-2). Sales: VAT at earliest of issue/delivery (Egyptian law). Different timing rules, different justification.

### 3.3 Decisions that need mirror description
- C-05: Advances — purchases (asset, no branch) vs sales (not created, branch?). Customer advances = mirror of supplier advances (party dimension mandatory, no branch dimension).
- C-06: GRNI (branch dimension mandatory) vs Unbilled Receivable (branch not mentioned). Unbilled Receivable carries branch dimension (mirror of GRNI).

### 3.4 Decisions that need schema verification
- C-13: `assertPeriodOpen` — verify every posting path calls it. Some paths may bypass.
- C-26: Does `items` have `tax_category_id`? Likely missing.

### 3.5 Decisions that need chart of accounts update
- Full list of new accounts: GRNI (2105), Supplier Advances (1107/1108), PPV (new expense), Customer Advances (new asset), Unbilled Receivable (new asset), Deferred Revenue (new liability), WHT Payable (new liability), WHT Receivable (new asset), Inventory Shortage Expense (reuse 5112 or new?). Plus: `filed`/`closed` on periods (not new account, but new columns).

### 3.6 Decisions that need migration plan
- Phase-2 migration (purchases-cycle.sql) not run. Needs revision per accountant §5 + OI-13/14/15 + TD items.
- Sales-side migrations: price_list_versions, tax_categories, customer_groups (alter), parties (credit_limit, grace_days, tax_category_id, customer_group_id), invoice_lines (price_list_id, price_list_version_id, tax_category_id, serial_no UNIQUE), order_lines (price_list_id, price_list_version_id), items (tax_category_id), periods (status, filed_at, filing_reference), wht_transactions, customer_advances, stocktake_sessions/lines/adjustments, v_invoice_overdue view, serial_no UNIQUE constraint.

---

## 4. Summary

- **Decision Registry:** 110+ decisions across 7 domains (Sales 28, Purchases 48, Inventory 13, Accounting 15, HR 3, CRM 2, Other 6). 14 reclassified as `verified-existing`.
- **Conflict Table:** 50 rows, reclassified into 7 categories: 0 OPEN, 7 RESOLVED, 5 NOT-A-CONFLICT, 5 DUPLICATE, 10 GAP, 14 MISSING-DESIGN, 9 PENDING-IMPLEMENTATION.
- **[MISSING] list:** 28 items (M-01..M-28), all pending-owner.
- **Technical Debt:** 30 items (TD-01..TD-30).
- **Open Owner Questions:** 24 items (OQ-01..OQ-24).

**Next step:** Accountant verifies sample (5 rows per category). Then unified document (with header rule) is produced. Then move to next domain (Fixed Assets / HR / Phase-2 execution).

**No migration run. No commit. No push. No DB touched.**