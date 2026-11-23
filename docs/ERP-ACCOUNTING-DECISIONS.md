# WaselERP — Unified Accounting & Commercial Decisions

> **This document supersedes all previous session decisions in case of conflict. In case of dispute, refer to §2 of this document, not the original session text.**
>
> **Sources:** PURCHASE-CYCLE-DECISIONS.md v0.3 · AGENTS.md · ERP-AUDIT-PHASE1-DISCOVERY.md · EZEES-COVERAGE.md · conversation sessions (Sales, Purchases, Inventory, Treasury, Accounting)
> **Date:** 2026-11-17
> **Status:** Unified document — produced after consolidation pass 2. Awaiting accountant review and Statement of Consistency.
> **Owner:** WaselERP owner + accounting approval required where marked

---

## §0. Header Rule

This document supersedes all previous session decisions in case of conflict. In case of dispute, refer to §2 (Conflict Table) of this document, not the original session text.

---

## §1. Decisions Grouped by Meaning

Decisions are grouped by topic, not by session. Each decision carries its DEC-ID, source, owner, and status.

### 1.1 VAT (ضريبة القيمة المض-added)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-PURCH-006 | GRNI unified control account. Invoice: Dr GRNI/Dr VAT Input/Cr AP. VAT at invoice posting. | §1.6, R-1 | accounting | approved |
| DEC-PURCH-024 | OI-2: VAT at invoice posting (not at GRN). 90-day GRNI aging report. Tax consultant confirmation before first real invoice. | §7.2 | accounting | approved |
| DEC-SALES-023 | Invoice before delivery: VAT at earliest event (issue or delivery) per Egyptian law (VAT Law 67/2016). Tax consultant confirmation before first invoice of pattern. | Session A | accounting | approved |
| DEC-SALES-026 | Tax categories: 3 layers (item → customer → invoice line). Fallback: line → item → customer → standard (15%). WHT is separate mechanism. | Session A | accounting | approved |
| DEC-SALES-027 | Special tax treatment (government/exempt/export/diplomatic): open item for owner. Tax categories built regardless. | Session A | owner | pending-owner |
| DEC-SALES-028 | WHT: build table now, logic disabled by default. | Session A | accounting | approved |

**Justification (C-04):** VAT timing differs between purchases (at invoice) and sales (at earliest event). This is intentional — purchases: VAT at invoice posting (OI-2 accountant position). Sales: VAT at earliest of issue/delivery (Egyptian VAT Law 67/2016). Different timing rules, different justification. Not a contradiction.

### 1.2 Returns (المرتجعات)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-009 | Sales returns: linked only (must have original invoice). | Session A | accounting | approved |
| DEC-SALES-010 | Return rules: qty ≤ invoiced − prior returns; price = original invoice price; VAT = original tax; COGS = original stock movement cost; same customer/branch; no posting in closed period. | Session A | accounting | approved |
| DEC-SALES-011 | Returns with damaged portion: full invoice reversed; damaged tracked separately. Gift/sample returns: stock adjustment (no AR/revenue/VAT). | Session A | accounting | approved |
| DEC-PURCH-027 | Claims: replacement GRN at zero AP linked to claim, credit-note offset, cash refund, VAT adjustment on credit notes. | §5 | accounting | approved |

**Terminology note (C-18):** "Actual cost of returns" (purchases, out of scope) vs "COGS from original movement" (sales, mandatory) — same principle, different names. Unified terminology: "COGS from original movement."

### 1.3 Advances (المقدمات)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-PURCH-018 | Supplier advances: new asset account (1107/1108), party dimension mandatory, no branch dimension. Posting: payment Dr Supplier Advances/Cr cash; invoice application Dr AP/Cr Supplier Advances. Separate on statement, not netted. Cancellation: Dr Cash/Cr Supplier Advances + reason. VAT not deducted on advances. | §1.7, R-2 | accounting | approved |
| DEC-PURCH-019 | VAT on advances: NO VAT deducted; handled at invoice posting. Subject to tax consultant confirmation. | §1.7 | accounting | approved |
| DEC-SALES-024 | Customer advances: mirror of supplier advances. **Liability account** (not asset). Party dimension mandatory, no branch dimension. | Session A | implementation | pending-implementation |

**Mirror note (C-05):** Customer advances = liability (customer paid, you owe goods or refund). Supplier advances = asset (you paid, supplier owes goods). Mirror accounting, opposite classification. Party dimension mandatory, no branch dimension (same as supplier advances).

**VAT on customer advances (D-06):** VAT is **not** posted at payment receipt — it is posted at the earliest event (invoice issue or delivery), per DEC-SALES-023. **Exception:** for continuous services/subscriptions, the tax authority may require VAT at payment. Temporary position: no VAT on any customer advance until tax consultant confirms. VAT is posted at invoice/delivery. *(Mirror of OI-2 on purchases side.)*

**VAT on customer advances (D-06):** VAT is **not** posted at payment receipt — it is posted at the earliest event (invoice issue or delivery), per DEC-SALES-023. **Exception:** for continuous services/subscriptions, the tax authority may require VAT at payment. Temporary position: no VAT on any customer advance until tax consultant confirms. VAT is posted at invoice/delivery. *(Mirror of OI-2 on purchases side.)*

### 1.4 Credit & Overdue (الائتمان والذمم)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-001 | Credit limit: strict block by default + override with permission (`sales.approve_over_credit`) + mandatory reason. | Session A | accounting | approved |
| DEC-SALES-002 | Credit limit basis: (b) installment plans + (c) PDC cheques mandatory; (d) unfactored orders optional (warning only). | Session A | accounting | approved |
| DEC-SALES-003 | `parties.grace_days` default 0. Zero default + optional per-customer cap. | Session A | accounting | approved |
| DEC-SALES-004 | Credit limit scope: per customer (across all branches), not per branch. | Session A | accounting | approved |
| DEC-SALES-005 | No credit limit = 0 (block all credit sales). "Unlimited" is explicit option, not default. | Session A | accounting | approved |
| DEC-SALES-006 | Overdue fact: `today > due_date`. Grace affects hard-block gate only, not aging fact. | Session A | accounting | approved |
| DEC-SALES-007 | Due date stored (not computed). Empty = immediate. Compare by date, not timestamp. Overdue = remaining balance. Each installment has independent due_date. PDC doesn't cancel overdue. TZ Africa/Cairo. Changing due_date post-posting = independent permission + reason + audit. | Session A | accounting | approved |
| DEC-SALES-008 | Single source of truth: `v_invoice_overdue` view. All screens/reports read from it. | Session A | accounting | approved |
| DEC-SALES-017 | Payment collection: allocation mandatory at posting. FIFO default by due date. Unallocated = explicit customer advance. Overpayment → advance or refund. Payment must match customer/branch. | Session A | accounting | approved |
| DEC-SALES-018 | PDC: not payment until collected. Recorded in "cheques under collection." Does not reduce AR/aging/exposure. Bounced → reverse + fees + re-add to aging at original date. | Session A | accounting | approved |

### 1.5 Discounts (الخصومات)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-019 | Discounts: 3-tier caps (user/role → branch → customer contract). Cost floor (below-cost needs `sales.approve_below_cost`). No stacking. Discount on line not header (VAT). Trade discount ≠ settlement discount. Discount reduces revenue. Promotions via price lists/rules. SoD. Mandatory reason for above-cap. Monthly report. | Session A | accounting | approved |
| DEC-SALES-020 | Settlement discount (cash discount): disabled by default, reserve account + field. Does NOT reduce VAT. If enabled: basis = invoice total; timing = from invoice date; credit limit recalculated; refund proportional on return; auto-cancel if paid late. | Session A | accounting | pending-owner |

**Purchases settlement discount (D-07):** Mirror of DEC-SALES-020. If a supplier offers early-payment discount:
- If the discount is **embedded in the original invoice** (payment terms) → part of invoice price, VAT calculated on it from the start.
- If the discount is **offered after the invoice** → treated as financial income (separate account), **does not reduce VAT Input**, unless the supplier issues an official credit note (which reduces VAT Input).
- Two separate accounts: «خصومات سداد مبيعات» (expense, finance) + «خصومات سداد مشتريات» (income, finance). Must not be one account (C-07).

**Purchases settlement discount (D-07):** Mirror of DEC-SALES-020. If a supplier offers early-payment discount:
- If the discount is **embedded in the original invoice** (payment terms) → part of invoice price, VAT calculated on it from the start.
- If the discount is **offered after the invoice** → treated as financial income (separate account), **does not reduce VAT Input**, unless the supplier issues an official credit note (which reduces VAT Input).
- Two separate accounts: «خصومات سداد مبيعات» (expense, finance) + «خصومات سداد مشتريات» (income, finance). Must not be one account (C-07).

### 1.6 Pricing (التسعير)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-021 | Price lists: multiple from day 1. Snapshot on line (unit_price). Price fixed at commitment. Quotation price not inherited. Effective dates (versioning). Fallback chain: customer → group → branch → company. VAT exclusive storage. `get_effective_price()` single source. Cost floor governs. | Session A | accounting | approved |
| DEC-SALES-022 | Price list versions: `price_list_versions` with `effective_from` (date). Immutable after use. Correction same-day = new version + reason + permission. No retroactive effect. No deletion (superseded_by). | Session A | accounting | approved |

### 1.7 Invoicing Flow (تدفق الفوترة)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-012 | Invoicing flow: mixed — direct invoice for cash/retail/POS; order mandatory for credit/B2B/delivery/scheduled. | Session A | accounting | approved |
| DEC-SALES-013 | Sales order is NOT a financial document — no revenue/COGS/AR/VAT/stock movement. Reservation reduces "available" not "balance", no GL entry, must have expiry. | Session A | accounting | approved |
| DEC-SALES-014 | Partial conversion: `Σ invoiced_qty ≤ ordered_qty` per line. Remaining stays open. Price fixed at order confirmation. Credit check at invoice (warning at order). Auto-close after 90 days idle. Cancel after partial cancels remaining only. Same branch/customer. | Session A | accounting | approved |
| DEC-SALES-015 | Quotation: independent document, no GL/stock/AR impact, no accounting number, loose numbering. Conversion creates new document with new number. | Session A | accounting | approved |
| DEC-SALES-016 | Stock reservations: exist in code (reserved_qty on item_warehouse_qty). Released on conversion/cancellation. **No expiry date** (gap). | Session A + code | accounting | approved (gap identified) |
| DEC-SALES-023 | Invoice before delivery: build both paths, default to delivery. Two control accounts: Unbilled Receivable (asset) + Deferred Revenue (liability). VAT at earliest event per Egyptian law. Tax consultant confirmation before first invoice of pattern. | Session A | accounting | approved |

### 1.9 Customer Groups & Tax (التصنيف والضريبة)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-SALES-025 | Customer groups: build for (ج) (price list + trade discount). Fixed on card, override on invoice with permission+reason (temporary, doesn't change card). Fallback chain. No stacking. | Session A | accounting | approved |
| DEC-SALES-026 | Tax categories: 3 layers (item → customer → invoice line). Fallback: line → item → customer → standard. WHT is separate mechanism. WHT at payment (not invoice). Two accounts: WHT Payable (purchase) + WHT Receivable (sales). WHT transactions table (certificate tracking). | Session A | accounting | approved |
| DEC-SALES-027 | Special tax treatment (government/exempt/export/diplomatic): open item for owner. Tax categories built regardless. | Session A | owner | pending-owner |
| DEC-SALES-028 | WHT: build table now, logic disabled by default. | Session A | accounting | approved |

### 1.10 Purchases (المشتريات)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-PURCH-001 | Four independent documents: PO, GRN, Invoice, Payment. | PURCHASE-CYCLE-DECISIONS §1.1 | accounting | approved |
| DEC-PURCH-002 | Receipt-before-invoice or invoice-before-receipt both supported; partial in both. | §1.2 | accounting | approved |
| DEC-PURCH-003 | Inspection at dock on arrival. No separate sample collection sub-document. | §1.3 | accounting | approved |
| DEC-PURCH-004 | Rejected/damaged = memo only, never valued, never enters avg cost. Quarantine = descriptive location, no account. OI-4 closed. | §1.4, R-4 | accounting | approved |
| DEC-PURCH-005 | Delivery terms per supplier/PO/line. Incoterm informational in Phase-1. Recognition at GRN posting. | §1.5, C-1 | accounting | approved |
| DEC-PURCH-006 | GRNI unified control account (new standalone, party+branch dimension). GRN: Dr INVENTORY/Cr GRNI. Invoice: Dr GRNI/Dr PPV/Dr VAT Input/Cr AP. Payment: Dr AP/Cr cash. Net GRNI=0 regardless of order. | §1.6, R-1 | accounting | approved |
| DEC-PURCH-007 | PPV — difference between invoice price and GRN provisional cost (PO line price) posts to dedicated PPV account. Inventory not retro-adjusted. | §1.6, §1.13 | accounting | approved |
| DEC-PURCH-008 | Cash-at-receipt posts through GRNI/AP in same transaction. No bypass. | §1.6, R-3 | accounting | approved |
| DEC-PURCH-009 | Over-invoicing blocked or requires `purchases.approve_exception` with waive+reason. Inverse invariant: Σ invoice-link qty ≤ accepted qty. | §1.6, R-5 | accounting | approved |
| DEC-PURCH-010 | Mixed payment terms per supplier (cash/Net X/advance). | §1.8 | accounting | approved |
| DEC-PURCH-011 | Cash/bank/wallet/cheque/card allowed. Wallet not in vouchers (OI-6). | §1.9 | accounting | approved |
| DEC-PURCH-012 | Approval model: `purchases.approve_payment` + `purchases.approve_exception`. Quantity/price variance = operator policy (warning, not blocking). PO approval gate (OI-3). Same-user control allowed with audit. SoD compensating control report. | §1.10 | accounting | approved |
| DEC-PURCH-013 | Branches: PO branch = order branch; delivery can end in different branch (user has both; drop "supplier policy allows"). Stock belongs to receiving branch. AP on supplier-party. GRNI carries branch dimension. | §1.11, C-6, C-8 | accounting | approved |
| DEC-PURCH-014 | Period-close respected. Reversal in closed period rejected; correction posts in open period via mirror journal. | §1.12 | accounting | approved |
| DEC-PURCH-015 | Cost recognition: weighted average after accepted quantities only. Rejected never enters. GRN provisional cost = PO line price. PPV absorbs price diff. | §1.13 | accounting | approved |
| DEC-PURCH-016 | Printing: PO/GRN/Invoice/Payment printable A4/A5. | §1.14 | accounting | approved |
| DEC-PURCH-017 | No ETA/ZATCA for purchase invoices. ZATCA accepts any type — bug to close (OI-8). | §1.15 | accounting | approved |
| DEC-PURCH-018 | Supplier advances: new asset account (1107/1108), party dimension mandatory, no branch dimension. Posting: payment Dr Supplier Advances/Cr cash; invoice application Dr AP/Cr Supplier Advances. Separate on statement, not netted. Cancellation: Dr Cash/Cr Supplier Advances + reason. VAT not deducted on advances. | §1.7, R-2 | accounting | approved |
| DEC-PURCH-019 | VAT on advances: NO VAT deducted; handled at invoice posting. Subject to tax consultant confirmation. | §1.7 | accounting | approved |
| DEC-PURCH-020 | GRNI branch dimension mandatory = receiving branch. | §1.6, OI-1 | accounting | approved |
| DEC-PURCH-021 | Inspector identity: user FK mandatory (received_by/inspected_by), optional external_inspector_name. purchases.receive on received_by. | OI-13 | accounting | approved |
| DEC-PURCH-022 | Over-receipt: default 0% (reject). Override via purchases.approve_exception + reason + per-supplier parties.default_over_receipt_pct (default 0%). | OI-14 | accounting | approved |
| DEC-PURCH-023 | Document numbering: per-type + per-branch, number assigned at posting (not draft), gaps allowed with documented state, report «الفجوات غير المبرَّرة» in SoD. Format PO-{branch}-{YYYY}-{seq}. | OI-15 | accounting | approved |
| DEC-PURCH-024 | OI-2 (VAT timing): accountant position = VAT at invoice posting. 90-day GRNI aging report. Tax consultant confirmation before first real invoice. No effect on code/schema. | §7.2 | accounting | approved |
| DEC-PURCH-025 | OI-4 (quarantine) closed — no account, no columns. | §7.2 | accounting | approved |
| DEC-PURCH-026 | OI-9 (delivery terms dependence) resolved: recognition at GRN posting, Incoterm informational. | §3 | accounting | approved |
| DEC-PURCH-027 | Claims: replacement GRN at zero AP linked to claim, credit-note offset, cash refund, VAT adjustment on credit notes. | §5 | accounting | approved |
| DEC-PURCH-028 | Payment allocation vs later returns: define auto-apply vs operator action. | §5 | accounting | approved |
| DEC-PURCH-029 | Post-posting edits: no edits after posting, reversal only. Same for PO after first GRN. | §5 | accounting | approved |
| DEC-PURCH-030 | Reversal in closed period: mirror journal in open period. | §5, §1.12 | accounting | approved |
| DEC-PURCH-031 | Over-receipt tolerance: receiving more than ordered. | §5 | accounting | approved |
| DEC-PURCH-032 | Inspector identity: user FK vs free text vs both. purchases.receive permission. | §5 | accounting | approved |
| DEC-PURCH-033 | Document numbering: per-type, per-branch sequences + gap policy. | §5 | accounting | approved |
| DEC-PURCH-034 | Branch dimension on GRNI: carried (decided in OI-1). | §5 | accounting | approved |
| DEC-PURCH-035 | VAT evidence capture: supplier e-invoice UUID / tax registration. | §5 | accounting | approved |
| DEC-PURCH-036 | SoD compensating control: GRNs where receiver = payment approver; invoices paid with open variances. | §5 | accounting | approved |
| DEC-PURCH-037 | Replacement flow: damaged → replacement GRN at zero AP, linked to claim. | §5 | accounting | approved |
| DEC-PURCH-038 | ZATCA historical reconciliation before flipping type-2 block. | §5 | accounting | approved |
| DEC-PURCH-039 | OI-3 (permissions): purchases.approve_payment, purchases.receive, purchases.approve_po, purchases.approve_exception, purchases.returns. | §3 | accounting | approved |
| DEC-PURCH-040 | OI-5 (returns with credit notes) — Phase-2.5. | §3 | accounting | approved |
| DEC-PURCH-041 | OI-6 (voucher wallet) — Phase-3. | §3 | accounting | approved |
| DEC-PURCH-042 | OI-7 (supplier statement print) — Phase-3. | §3 | accounting | approved |
| DEC-PURCH-043 | OI-8 (ZATCA reject invoiceType != 1) — Phase-3. | §3 | accounting | approved |
| DEC-PURCH-044 | OI-10 (vouchers open-invoices hardcoded type=1) — Phase-3. | §3 | accounting | approved |
| DEC-PURCH-045 | OI-11 (payables tile) — Phase-3. | §3 | accounting | approved |
| DEC-PURCH-046 | OI-12 (PPV account) — Phase-2. | §3 | accounting | approved |

### 1.11 Inventory (المخزون)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-INV-001 | Weighted average cost (not FIFO, not LIFO). LIFO prohibited by IAS 2/EAS. | Session C | accounting | approved |
| DEC-INV-002 | Average cost per warehouse (not per company). Transfer between warehouses uses source warehouse's avg cost. | Session C + code | accounting | approved |
| DEC-INV-003 | `items.cost_price` is "headline cost" (latest purchase) — not used for COGS or cost floor. Cost floor reads from `item_warehouse_qty.avg_cost` per warehouse. | Session C | accounting | approved |
| DEC-INV-004 | Stock count: cycle count default (daily/weekly/monthly/quarterly/annual all supported by same structure). Annual full count mandatory (legal). No auto-adjustment. | Session C | accounting | approved |
| DEC-INV-005 | Stock adjustment: no auto-adjustment. Human approval required. Shortage → separate "inventory shortage" expense (not COGS). Surplus → investigation required. Materiality threshold per branch. SoD: counter ≠ approver ≠ reviewer. Period-close respected. Signed count sheet + annual report. | Session C | accounting | approved |
| DEC-INV-006 | Serial numbers: unique at company level. Mandatory input if enabled on item. Cannot enable on item with existing movements (freeze/backfill decision). Lifecycle tracking. Specific ID for high-value serialized items (owner decision). | Session C | accounting | approved |
| DEC-INV-007 | Expiry dates: tracked per receipt (batch), not per item. FEFO default at issue with warning on override. No sale after expiry (hard block). Alerts at 90/30/7 days. Expired goods → scrap (separate expense), not COGS. Expired unsold → purchase return + claim (Phase-2.5). | Session C | accounting | approved |
| DEC-INV-008 | NRV (write-down) for near-expiry goods: monthly test, write-down to NRV, re-evaluated monthly. Policy: unified default (90 days) or per category (owner decision). | Session C | accounting | pending-owner |
| DEC-INV-009 | FEFO is not a costing method — it's a physical selection rule. Costing remains weighted average. | Session C | accounting | approved |
| DEC-INV-010 | Inter-branch transfer: goods in transit account required (when built). Currently blocked architecturally (same branch only). | Session C | accounting | approved |
| DEC-INV-011 | Reorder levels / expiry alerts / mobile stocktake / labels — partially built. | code | implementation | pending-implementation |
| DEC-INV-012 | Negative stock: `AllowNegativeStock=false` default. Any outbound movement that would make balance negative is rejected. | AGENTS.md, code | accounting | approved |
| DEC-INV-013 | Stock movements ledger + balance in same transaction. All stock changes via `common/stock.ts`. | AGENTS.md | accounting | approved |

### 1.12 Accounting & Treasury (الحسابات والخزينة)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-ACCT-001 | GL complete: chart of accounts, journals, vouchers, checks, cost centers, currencies, period close. | AGENTS.md, docs | accounting | verified-existing |
| DEC-ACCT-002 | Period close: monthly mandatory, hard close annually. Reopen allowed with permission + reason + audit. Sequential open (manual, not automatic). `filed` vs `closed` distinguished. `assertPeriodOpen` in all posting paths. No retroactive posting in closed period. Reports on period_id (financial) vs document_date (operational). | Session D | accounting | approved |
| DEC-ACCT-003 | Fiscal year: Gregorian default (or written approval from tax authority for non-Gregorian). | Session D | accounting | approved |
| DEC-ACCT-004 | Cash variance: daily reconciliation mandatory. Materiality threshold per branch. Reason code mandatory (standardized codes, not free text). SoD: counter ≠ approver ≠ reviewer. 5110 reviewed monthly, not left open year-end. | Session D | accounting | approved |
| DEC-ACCT-005 | Bank reconciliation: monthly mandatory (weekly in cash-heavy). Every real variance → 2106 (no pending without GL entry). Timing items (deposit in transit, outstanding checks) don't hit GL. Classification into standardized categories. SLA 30 days, escalation 60. Bank recon auto-match proposes, user approves (except exact reference match). Bank deposit linked to shift close. | Session D | accounting | approved |
| DEC-ACCT-006 | Full cash cycle: drawer → safe → bank, all with signed documents. 5110 ≠ 2106 (different problems). | Session D | accounting | approved |
| DEC-ACCT-007 | Posting engine: all financial effects via `common/posting.ts`. Balanced journal (Dr = Cr) or reject. `source_type` + `source_id` for traceability. Idempotency via `clientRequestId`. Period guard via `assertPeriodOpen`. | AGENTS.md, code | accounting | verified-existing |
| DEC-ACCT-008 | Branch scoping: all queries filter by `branch_id` from `CurrentBranch()`. Verified against user permissions. | AGENTS.md | accounting | verified-existing |
| DEC-ACCT-009 | Numbering: `db.nextNumber(client, key)` inside transaction. | AGENTS.md | accounting | verified-existing |
| DEC-ACCT-010 | Permissions: `@RequirePermissions` on endpoints. 5 roles, 23+ permissions. | AGENTS.md, code | accounting | verified-existing |
| DEC-ACCT-011 | Fixed assets: registration, depreciation (straight-line + declining balance), disposal with mirror journal, UNIQUE (asset, period). Period close blocks. | docs, AGENTS.md | accounting | verified-existing |
| DEC-ACCT-012 | Bank expenses (E3): auto-generated bank fees/expenses with idempotent run, UNIQUE (rule, period). | docs | accounting | verified-existing |
| DEC-ACCT-013 | E6 monthly closing: auto-close with pre-checks (balanced journals, no drafts, no open invoices, no open shifts, balanced TB, no unreconciled bank lines). Override with `accounting.close_override` permission + reason. Manual lock separate from accounting close. | docs | accounting | verified-existing |
| DEC-ACCT-014 | E2 branch transfers: Dr 1108/Cr 1104 on approval, Dr 1104/Cr 1108 on receipt. 1108 nets to zero company-wide. No P&L impact. Period/lock checks on both branches. | docs | accounting | verified-existing |
| DEC-ACCT-015 | E1 bank reconciliation: CSV import, auto-match, manual match, partial match, timing items, posting of differences to 2106 suspense. | docs | accounting | verified-existing |

### 1.13 HR (الموارد البشرية)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-HR-001 | HR complete: departments, employees, attendance (manual + CSV), leaves, salaries (generation + disbursement), payroll journal. | AGENTS.md, docs | accounting | verified-existing |
| DEC-HR-002 | Insurance band: configurable min/max on insurance salary. | AGENTS.md | accounting | verified-existing |
| DEC-HR-003 | ZKTeco biometric — deferred (not implemented). | AGENTS.md | accounting | verified-existing |

### 1.14 CRM (العملاء المحتملون)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-CRM-001 | CRM basic: sources, leads (pipeline), activities, tickets, convert lead to customer. | AGENTS.md | accounting | verified-existing |
| DEC-CRM-002 | CRM permissions: crm.view, crm.manage, reports.manage. | AGENTS.md | accounting | verified-existing |

### 1.15 Other (أخرى)

| DEC-ID | Decision (literal) | Source | Owner | Status |
|---|---|---|---|---|
| DEC-OTHER-001 | Restaurant master switch (RestaurantsEnabled). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-002 | Delete toggles (30 screens + master). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-003 | Theme (light/dark) via tokens. | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-004 | Print agent (ESC/POS, Windows service). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-005 | Offline queue (IndexedDB + idempotency). | AGENTS.md | accounting | verified-existing |
| DEC-OTHER-006 | SSE for real-time updates. | AGENTS.md | accounting | verified-existing |

---

## §2. Conflict Table (Final — 40 rows after removing 5 NOT-A-CONFLICT)

### Status taxonomy (7 categories)
| Category | Definition | Action |
|---|---|---|
| OPEN | Conflict confirmed, not resolved | Needs decision (all 5 resolved by D-01..D-05) |
| RESOLVED | Conflict existed, resolved by later decision | Documented, closed |
| NOT-A-CONFLICT | Intentional difference or status check | Move to §3 Notes |
| DUPLICATE | Same as another row | Merged into original row (shown in margin) |
| GAP | Code missing something, but no conflict between two decisions | Build it → links to TD entry |
| MISSING-DESIGN | Design not yet approved (no decision made) | Links to M entry |
| PENDING-IMPLEMENTATION | Decision exists, execution deferred (migration) | Links to Phase-2 migration |

### Reclassified conflict table (45 rows after merging 5 duplicates)

| # | Conflict (short) | Category | Links to |
|---|---|---|---|
| C-01 | credit_limit/grace_days on classifications vs per-customer | **RESOLVED** (D-01) | TD-07, TD-12 |
| C-02 | Cost floor reads items.cost_price vs per-warehouse avg | **RESOLVED** (D-02) | TD-13, TD-26 |
| C-03 | WHT: commitment on purchases vs asset on sales | **RESOLVED** | — |
| C-05 | Advances: purchases (asset, no branch) vs sales (not created, branch?) | **MISSING-DESIGN** | M-03, M-08 |
| C-06 | GRNI branch dimension vs Unbilled Receivable (branch not mentioned) | **RESOLVED** (D-03) | M-01, M-02 |
| C-07 | Settlement discount: sales (expense) vs purchases (income) | **RESOLVED** | TD-10 |
| C-08 | price_list_version_id on purchase_order_lines? | **RESOLVED** (D-04) | — |
| C-11 | filed vs closed on periods — needs ALTER | **GAP** | TD-25 |
| C-12 | Control accounts need updated chart of accounts | **GAP** | TD-31 (new) |
| C-13 | assertPeriodOpen in all paths — which bypass? | **GAP** | TD-24 |
| C-15 | Deferred Revenue not in schema | **MISSING-DESIGN** | M-01 |
| C-16 | Unbilled Receivable not in schema | **MISSING-DESIGN** | M-02 |
| C-19 | Serial UNIQUE not in code | **GAP** | TD-14 |
| C-20 | customer_groups missing default_price_list_id / default_trade_discount_pct | **GAP** | TD-06 |
| C-22 | invoice_lines missing price_list_id / price_list_version_id | **GAP** | TD-04 |
| C-23 | orders missing price_list_id | **GAP** | TD-05 |
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
| C-42 | supplier_payment_allocations in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-43 | supplier_claims in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-44 | purchase_invoice_links in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-45 | purchase_rejections in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-46 | purchase_receipts in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-47 | purchase_receipt_lines in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-48 | supplier_advances in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-49 | parties.default_damage_policy in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |
| C-50 | orders.delivery_terms/delivery_terms_note in purchases migration (not run) | **PENDING-IMPLEMENTATION** | Phase-2 migration |

### Merged rows (shown in margin, not in table)
- C-09 → C-01 (DUPLICATE)
- C-17 → C-02 (DUPLICATE)
- C-21 → C-01 (DUPLICATE)
- C-24 → C-19 (DUPLICATE)
- C-40 → C-01 (DUPLICATE)

### Reclassified counts
| Category | Count | Items |
|---|---|---|
| RESOLVED | 7 | C-01, C-02, C-03, C-06, C-07, C-08, C-34 |
| NOT-A-CONFLICT | 0 (moved to §3 Notes) | C-04, C-10, C-14, C-18, C-41 |
| DUPLICATE | 5 (merged into 3 originals) | C-09→C-01, C-17→C-02, C-21→C-01, C-24→C-19, C-40→C-01 |
| GAP | 10 | C-11, C-12, C-13, C-19, C-20, C-22, C-23, C-25, C-26, C-27 |
| MISSING-DESIGN | 14 | C-05, C-15, C-16, C-28, C-29, C-30, C-31, C-32, C-33, C-35, C-36, C-37, C-38, C-39 |
| PENDING-IMPLEMENTATION | 9 | C-42..C-50 (single migration: purchases-cycle.sql) |
| **Total** | **40** | |

**True unique conflicts:** 0 OPEN (all 7 RESOLVED)
**Non-conflicts:** 5 NOT-A-CONFLICT + 5 DUPLICATE (merged)
**Design/build gaps:** 10 GAP + 14 MISSING-DESIGN + 9 PENDING-IMPLEMENTATION = 33

---

## §3. Notes (not conflicts)

### 3.1 Terminology unification (C-18)
"Actual cost of returns" (purchases, out of scope) vs "COGS from original movement" (sales, mandatory) — same principle, different names. Unified terminology: "COGS from original movement."

### 3.2 VAT timing justification (C-04)
Purchases: VAT at invoice posting (OI-2 accountant position). Sales: VAT at earliest of issue/delivery (Egyptian VAT Law 67/2016). Different timing rules, different justification. Not a contradiction — intentional design difference driven by different legal obligations.

### 3.3 Status check (C-10)
Phase-1 v0.3 says "Phase-2 ON HOLD until condition 1." Later decisions opened Phase-2 design work. Condition 1 (verify migration vs change table before running) still holds. No contradiction — design work proceeded, execution did not.

### 3.4 Consistency (C-14)
Customer advances (sales) not in code — supplier advances also in Phase-2. Both pending-implementation. Consistent.

### 3.5 No issue (C-41)
Inter-branch transfer clearing (1108) exists (E2 signed off). No action needed.

### 3.6 Intentional differences (moved from §2 — NOT-A-CONFLICT)

**C-04 — VAT timing: at-invoice (purchases) vs at-earliest-event (sales).**
Intentional design difference — purchases: VAT at invoice posting (OI-2 accountant position). Sales: VAT at earliest of issue/delivery (Egyptian VAT Law 67/2016). Different timing rules, different justification. Not a contradiction.

**C-10 — Phase-1 v0.3 "ON HOLD" vs later decisions opening Phase-2.**
Status check, not a conflict. Condition 1 (verify migration vs change table) still holds. No contradiction — design work proceeded, execution did not.

**C-14 — Customer advances (sales) not in code; supplier advances also Phase-2.**
Consistent: both pending-implementation. Not a conflict.

**C-18 — Returns: purchases "actual cost" vs sales "COGS from original movement".**
Same principle, different terminology. Documentation gap, not contradiction. Unified terminology: "COGS from original movement."

**C-41 — Inter-branch transfer clearing (1108) exists (E2).**
No issue. E2 signed off.

---

## §4. Missing Account Creation (3 items)

| # | Item | Where mentioned | Status |
|---|---|---|---|
| M-01 | Deferred Revenue (sales) account | Session A | [MISSING-DESIGN] — needs owner/accountant confirmation |
| M-02 | Unbilled Receivable (sales) account | Session A | [MISSING-DESIGN] |
| M-03 | Customer Advances account (sales side) | Session A | [MISSING-DESIGN] |

**Note on C-31/C-32/C-33:** These are reclassified as MISSING-DESIGN with sub-category "designed but not created" — the decision exists (OI-1, OI-12), but the account has not been created in the chart of accounts. In the unified document, these appear under a sub-heading: "Accounts designed, not yet created."

---

## §5. Owner Questions (merged from M-04..M-28 and OQ-01..OQ-24)

| # | Question | Domain | M-ref | OQ-ref | Status |
|---|---|---|---|---|---|
| OQ-01 | Does company offer early payment discount (settlement discount)? | Sales | M-06/M-27 | OQ-01/OQ-23 | pending-owner |
| OQ-02 | Does company receive prepayments from customers (advances)? | Sales | M-25 | OQ-02 | pending-owner |
| OQ-03 | Cash return for sales return: immediate cash vs credit balance? | Sales | M-09 | OQ-03 | pending-owner |
| OQ-04 | Does company have government customers requiring WHT? | Sales | M-10 | OQ-04 | pending-owner |
| OQ-05 | Special tax treatment (government/exempt/export/diplomatic)? | Sales | M-11 | OQ-05 | pending-owner |
| OQ-06 | Customer advances usage: (a) reduce invoice / (b) credit balance / (c) both? | Sales | M-08/M-25 | OQ-06 | pending-owner |
| OQ-07 | Does company use serial tracking? Which items? | Inventory | M-13 | OQ-07 | pending-owner |
| OQ-08 | Does company track expiry dates? Which items? | Inventory | M-14 | OQ-08 | pending-owner |
| OQ-09 | NRV policy: unified (90 days) vs per category? | Inventory | M-04 | OQ-09 | pending-owner |
| OQ-10 | NRV re-evaluation: monthly vs fixed at first test? | Inventory | M-05 | OQ-10 | pending-owner |
| OQ-11 | Does company transfer stock between branches (outside system)? | Inventory | M-12 | OQ-11 | pending-owner |
| OQ-12 | Fiscal year: Gregorian or non-Gregorian? Written approval? | Accounting | M-15 | OQ-12 | pending-owner |
| OQ-13 | Cash variance: number of shifts per day, multiple drawers, bank accounts linked? | Treasury | M-16/M-28 | OQ-13/OQ-24 | pending-owner |
| OQ-14 | Bank reconciliation: performed monthly/weekly in practice? | Treasury | M-17 | OQ-14 | pending-owner |
| OQ-15 | Period close: performed monthly in practice, or only annually? | Accounting | M-18 | OQ-15 | pending-owner |
| OQ-16 | Stock count frequency: monthly/quarterly/annual/cycle? | Inventory | M-19 | OQ-16 | pending-owner |
| OQ-17 | Stock adjustment policy: auto vs gated? Materiality threshold? | Inventory | M-20 | OQ-17 | pending-owner |
| OQ-18 | Customer groups: does company use customer groups? | Sales | M-21 | OQ-18 | pending-owner |
| OQ-19 | Price lists: does company use multiple price lists? | Sales | M-22 | OQ-19 | pending-owner |
| OQ-20 | Quotation/order flow: direct invoice or order-first? | Sales | M-23 | OQ-20 | pending-owner (likely answered: mixed) |
| OQ-21 | Invoicing before delivery: does company issue invoice before delivery? | Sales | M-24 | OQ-21 | pending-owner |
| OQ-22 | Supplier settlement discount: do suppliers offer early payment discount? | Purchases | M-07/M-26 | OQ-22 | pending-owner |
| OQ-23 | Customer settlement discount: does company offer early payment discount? | Sales | M-06/M-27 | OQ-01/OQ-23 | pending-owner |
| OQ-24 | Number of daily shifts, multiple drawers, bank accounts linked | Treasury | M-16/M-28 | OQ-13/OQ-24 | pending-owner (merged with OQ-13) |

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
| TD-31 | Chart of accounts update — full list of new accounts needed (GRNI, Supplier Advances, Customer Advances, PPV, Unbilled Receivable, Deferred Revenue, WHT Payable, WHT Receivable, Settlement Discounts Sales, Settlement Discounts Purchases). Plus `filed`/`closed` on periods. | Consolidation | High | C-12 |
| TD-32 | No control account protection exists. AR, AP, VAT, Inventory exposed to manual journal entries. D-17 (Option A: `is_control` on `gl_accounts` + `postJournal` check) closes this. **High priority — implement with P3.** | Session D (control accounts scan) | High | D-17 |
| TD-33 | Chart of accounts incomplete in seed. Account 4107 (خصومات وغرامات) exists in DB but not in `seed.ts`. Fresh deploy will miss it. Resolution: determine source migration, add to seed or ensure migration runs on deploy. **Not blocking B1, but must close before production deploy.** | Session D (INT gate) | Medium | — |
| TD-34 | HTTP-level permission tests deferred. B1-11 (no `purchases.receive` → 403) verified at source decorator level only; a real HTTP 403 test needs a running API server + CI harness. Covered at code level for now. | Session D (B1 review) | Low | B1-11 |
| TD-36 | `purchase_invoice_links` UNIQUE index on `(invoice_id, receipt_id, receipt_line_id, item_id)` does not prevent duplicates when `receipt_line_id IS NULL` (Postgres `NULL != NULL`). B3's unmatched exception links are one-per-invoice by design today; add `CREATE UNIQUE INDEX ... ON purchase_invoice_links(invoice_id, item_id) WHERE receipt_line_id IS NULL` as a guard. Does not block B4. | Session D (B3 review) | Low | B3-05 |
| TD-44 | **عالي — فجوة إثبات (لا تغطية): «GL-10 verification non-reproducible — proof of evidence is single-instance log.»** مرجع 5434 (`CC-VERIFY`) لم يعد متاحًا و`tools/verify-gl10.js` غير قابل لإعادة التشغيل على بيئة نظيفة (GL10-01 يثبّت `base_tables` مطلقًا؛ GL10-11 يعتمد بيانات تاريخية → `NaN`)؛ GL-10 يبقى **PASS مُقيَّد** (لقطة `%TEMP%\gl10-verify-2.txt`، غير قابلة لإعادة الإنتاج) حتى الإغلاق. **الإصلاح قبل أي release:** (1) الأداة تُنشئ بيئتها/بياناتها كاملًا داخليًا (لا اعتماد على 5434)؛ (2) GL10-01 يفحص **الفرق** قبل/بعد لا عددًا مطلقًا؛ (3) GL10-11 يُنشئ 5–10 قيود على CC اختباري ولا يقرأها من `gl_entries`. **معيار الإغلاق:** `verify-gl10.js` **12/12** على أي بيئة نظيفة (migrate-all + seed + بيانات داخلية). **لا يمنع GAP-06.** | GAP-07/GAP-08 | **High** | GL-10, قبل أي release |
| TD-45 | **متوسط — دين اختبار/تشغيل (لا تغطية): «Smoke test not idempotent — pollutes periods, requires clean DB.»** تشغيل smoke بعد B1..B5.4 على نفس القاعدة يتلوّث (`POST /accounting/periods` تداخل فترة مثل «CN closed») فلا ينجح إلا على قاعدة نظيفة. **الإصلاح:** smoke يُنشئ فترة اختبار خاصة (`SMOKE-TEST-{timestamp}`) أو ينظّف فترات الاختبار المميّزة قبل البدء. **معيار الإغلاق:** `smoke-test.js` **606/606** على نفس القاعدة **بعد** B1..B5.4 (بدون reset). **لا يمنع GAP-06.** | GAP-07 | Medium | smoke-test.js |
| TD-46 | **منخفض — قرار منتج/توافق (لا تغطية): «`clientRequestId` should eventually be required on financial mutations.»** `clientRequestId` nullable اليوم (توافق خلفي؛ GAP-06 يفرض idempotency عند توفر مفتاح غير فارغ) بينما AGENTS.md §11 يشترط المفتاح للعمليات القابلة للإعادة. **الإصلاح المستقبلي (v2):** فرض NOT NULL/إلزامية على `invoices`/`vouchers`/`purchase_receipts` (وما يلزم) بعد ترحيل المستدعين. **لا يُغلق في GAP-06.** | GAP-06 | Low | AGENTS.md §11 |
| TD-47 | **منخفض — دين اختبار/تشغيل (لا تغطية): «B5.2/3/4 teardown skips FK cleanup.»** اختبارات B5.2/B5.3/B5.4 تتخطّى تنظيف بياناتها بسبب FK (مثل `ledger_entries.invoice_id_fkey`) فتكون إعادة التشغيل على نفس القاعدة/CI غير حتمية. **الإصلاح:** حذف بترتيب FK أو `ON DELETE CASCADE` بحذر حيث مناسب. **لا يُغلق الآن.** | GAP-06 regression | Low | B5.2/B5.3/B5.4 |
| TD-48 | **متوسط — ثقافة/أمنية (لا تغطية): «Repo history contains revoked token.»** الرمز `sbp_oauth_0528cf9fd6732fef458008c841e1c35af9de2d03` موجود في تاريخ Git المتاح على `origin/main` (commits `69e2aa7`/`fa3251f` عبر `apps/api/apply-p5b.js`); الملف محذوف من القرص و`.gitignore` محدّث لكن git يحتفظ بالblobات. **الإصلاح:** Revoke + Rotate + verify + Audit Log (+ مستقبلي rewrite/force-push). **الإغلاق:** بعد قرار المالك. | Security / GAP-06 | Medium | Supabase access tokens |
| TD-49 | **منخفض — هندسة — ✅ مغلق في Part B:** كان «No unified activity_log helper». أُغلق بـ`common/audit.ts` (`logActivity` بـ`ip: string` إلزامي) + هجرة 9 INSERTs مالية + تحقق `tools/verify-gap01-partB.js` **15/15**. راجع `GAP01-report-PartB.md`. | GAP-01 | Low (Closed) | common/audit.ts |
| TD-50 | **منخفض — ربط (لا تغطية): «No documented linkage between activity_log and gl_journals source.»** لا يوجد تحقق موثق بين `activity_log` و`source_type/source_id` في `gl_journals`. **الإصلاح:** تحقق/ربط في `postJournal`. **لا يُغلق الآن.** | GAP-01 | Low | posting.ts |
| TD-51 | **متوسط — هندسة/منتج (لا تغطية): «`invoiceType=4` (مرتجع شراء) عبر `/sales/invoices` — deprecated / out-of-scope.»** الكود يحمل `INVOICE_POST_ACTION[4] = 'invoice.post.return_purchase'` كنية مستقبلية، لكن مسار `/sales/invoices` (شريحة المبيعات) يجب ألا يستقبل مرتجع شراء؛ يُرفض الآن بـ`400` (fail-closed). القرار: **خارج نطاق GAP-01** (أُسقط A4 كـ`out-of-scope`؛ لا إصلاح). مرتجع الشراء الصحيح: **مطالبة مورد + GRN بديل/إشعار دائن** (DEC-PURCH-027). **الإصلاح المستقبلي (B-phase):** إزالة `invoiceType=4` من DTO + مسار `POST /purchases/claims` + حذف `INVOICE_POST_ACTION[4]`. **معيار الإغلاق:** عدم وجود مرجع لـ`invoiceType=4` في `sales.slice.ts` + غياب أي صف `invoice.post.return_purchase` في `activity_log`. **لا يمنع Part B.** | GAP-01 | Medium | sales.slice.ts |
| TD-52 | **متوسط — هندسة (لا تغطية): «Activity_log INSERTs غير مهاجَرة للـhelper — `ip_address` مفقود في عمليات مالية ثانوية.»** Part B هاجر العمليات الحرجة (B2–B11)؛ INSERTs مباشرة بلا `ip_address` ما زالت في `fixed-assets` · `bank-recon` · `bank-expenses` · `installments` · `hr` (payroll) · `maintenance` وغيرها. **الإصلاح:** هجرة إلى `logActivity` في slice منفصل (ليس GAP-01). **معيار الإغلاق:** `grep -rn "INSERT INTO activity_log" apps/api/src --include="*.slice.ts"` = 0. **لا يعطّل إغلاق GAP-01.** | GAP-01 (ثانوي) | Medium | secondary slices |

---

## §6. Technical Debt (32 items)

| # | Item | Source | Priority | Links to |
|---|---|---|---|---|
| TD-01 | `convertOrder` blocks second conversion after partial | Session A + code | High | — |
## §7. Chart of Accounts — New Accounts Needed

| Account | Type | Code (proposed) | Status |
|---|---|---|---|
| GRNI (Goods Received Not Invoiced) | Liability (current) | 2105 | Designed, not created (OI-1) |
| Supplier Advances (دفعات مقدمة للموردين) | Asset (current) | 1107/1108 | Designed, not created |
| PPV (فروق أسعار الشراء) | Expense | new | Designed, not created (OI-12) |
| Customer Advances (دفعات مقدمة من العملاء) | Liability (current) | new | Designed, not created |
| Unbilled Receivable (ذمم غير مفوترة) | Asset (current) | new | Designed, not created |
| Deferred Revenue (إيراد مؤجل) | Liability (current) | new | Designed, not created |
| WHT Payable (withholding — purchases) | Liability (current) | new | Designed, not created |
| WHT Receivable (withholding — sales) | Asset (current) | new | Designed, not created |
| Settlement Discounts (Sales) | Expense (finance) | new | Reserved, disabled by default |
| Settlement Discounts (Purchases) | Income (finance) | new | Reserved, disabled by default |
| Inventory Damage Expense | Expense | 5112 | Exists |
| Inventory Variance | Expense | 5111 | Exists |

**Note:** `filed`/`closed`/`filed_at`/`filing_reference` columns needed on `periods` table (not new accounts, but new columns).

---

## §8. Acceptance Criteria Index

All acceptance criteria from individual decisions are consolidated here. Each item is testable.

### Purchases
- [ ] Invoice-before-GRN and GRN-before-invoice produce identical GRNI/AP net balances (journal-level test).
- [ ] Over-invoiced quantity blocked or requires `purchases.approve_exception` with recorded reason.
- [ ] Rejected/damaged quantities never appear in inventory valuation or average cost.
- [ ] Cash-at-receipt purchase still produces GRNI/AP entries.
- [ ] Reversal of posted GRN in closed period rejected with Arabic message; correction posts in open period.
- [ ] SoD exception report runs and returns combined-authority cases.
- [ ] Supplier statement separates AP open items (aged) from GRNI memo (unbilled receipts).
- [ ] Invoice price ≠ GRN provisional cost posts difference to PPV; invoice journal balanced; inventory unchanged.
- [ ] GRNI nets to zero on fully-received, fully-invoiced line even when invoice price ≠ PO price.

### Sales
- [ ] Credit invoice exceeding limit rejected without `sales.approve_over_credit`.
- [ ] Override with permission records: user, reason, excess amount, timestamp. Appears in monthly report.
- [ ] **Two distinct cases:** (1) over-limit but not overdue → override with permission (`sales.approve_over_credit`). (2) over-limit + overdue → **absolute block, no permission overrides.** Only remedy: customer pays first.
- [ ] Sales return without `parentInvoiceId` rejected (no override).
- [ ] `Σ return_qty ≤ invoiced_qty − prior_return_qty` per line enforced.
- [ ] Return at original invoice prices (not current price list).
- [ ] COGS of return = original stock movement cost (not current avg).
- [ ] VAT of return = original invoice line tax.
- [ ] Return for different customer/branch rejected.
- [ ] Return in closed period rejected; posts in open period.
- [ ] `v_invoice_overdue` is single source of truth — no duplicate overdue logic in code.
- [ ] Partial conversion: `Σ invoiced_qty ≤ ordered_qty` per order line.
- [ ] Stock reservation has expiry date; auto-release on expiry.
- [ ] Unallocated receipt voucher (2 in demo) frozen + separated from customer statement.
- [ ] Settlement discount (if enabled) does not reduce VAT.
- [ ] Price list version immutable after use; correction same-day = new version + reason.
- [ ] `price_list_id` + `price_list_version_id` on `invoice_lines` and `order_lines`.
- [ ] Customer group override on invoice: permission + reason, temporary (doesn't change card).
- [ ] Tax category resolution: line → item → customer → standard (15%).
- [ ] WHT: payable on purchases (at payment), receivable on sales (at payment). No VAT interaction.
- [ ] `tax_categories` built; items/customers can be assigned.

### Inventory
- [ ] Weighted average per warehouse (not per company). Transfer uses source warehouse avg.
- [ ] Cost floor reads per-warehouse avg_cost, not `items.cost_price`.
- [ ] Stock count: no auto-adjustment. Human approval required.
- [ ] Shortage → separate "inventory shortage" expense (not COGS). Surplus → investigation.
- [ ] Materiality threshold per branch.
- [ ] SoD: counter ≠ approver ≠ reviewer.
- [ ] Serial number: UNIQUE at company level. Mandatory if enabled on item.
- [ ] No sale after expiry (hard block).
- [ ] FEFO default at issue with warning on override.
- [ ] NRV write-down monthly for near-expiry goods.
- [ ] Expired goods → scrap (separate expense), not COGS.
- [ ] Negative stock: rejected unless `AllowNegativeStock=true`.

### Accounting & Treasury
- [ ] Period close: monthly mandatory. `assertPeriodOpen` in all posting paths.
- [ ] Reopen: permission + reason + audit. Filed vs closed distinguished.
- [ ] Cash variance: daily reconciliation. Materiality per branch. Reason code mandatory. SoD.
- [ ] Bank reconciliation: monthly mandatory. Every real variance → 2106. Timing items don't hit GL. SLA 30 days.
- [ ] Full cash cycle: drawer → safe → bank, all with signed documents.
- [ ] `filed`/`closed`/`filed_at`/`filing_reference` on `periods`.

---

## §9. Consolidation Notes

### 9.1 Decisions that need unified naming
- "Actual cost of returns" (purchases, out of scope) vs "COGS from original movement" (sales, mandatory) — same principle, different names. Unified terminology: "COGS from original movement."

### 9.2 Decisions that need explicit justification
- C-04: VAT timing differs between purchases (at invoice) and sales (at earliest event). Intentional — purchases: VAT at invoice posting (OI-2). Sales: VAT at earliest of issue/delivery (Egyptian law). Different timing rules, different justification.

### 9.3 Decisions that need mirror description
- C-05: Advances — purchases (asset, no branch) vs sales (not created, branch?). Customer advances = mirror of supplier advances (party dimension mandatory, no branch dimension). **Liability** (not asset).
- C-06: GRNI (branch dimension mandatory) vs Unbilled Receivable (branch not mentioned). Unbilled Receivable carries branch dimension (mirror of GRNI).

### 9.4 Decisions that need schema verification
- C-13: `assertPeriodOpen` — verify every posting path calls it. Some paths may bypass.
- C-26: Does `items` have `tax_category_id`? Likely missing.

### 9.5 Decisions that need migration plan
- Phase-2 migration (purchases-cycle.sql) not run. Needs revision per accountant §5 + OI-13/14/15 + TD items.
- Sales-side migrations: price_list_versions, tax_categories, customer_groups (alter), parties (credit_limit, grace_days, tax_category_id, customer_group_id), invoice_lines (price_list_id, price_list_version_id, tax_category_id, serial_no UNIQUE), order_lines (price_list_id, price_list_version_id), items (tax_category_id), periods (status, filed_at, filing_reference), wht_transactions, customer_advances, stocktake_sessions/lines/adjustments, v_invoice_overdue view, serial_no UNIQUE constraint.

---

## §10. Summary

- **Decision Registry:** 110+ decisions across 7 domains (Sales 28, Purchases 48, Inventory 13, Accounting 15, HR 3, CRM 2, Other 6). 14 reclassified as `verified-existing`.
- **Conflict Table:** 40 rows (after removing 5 NOT-A-CONFLICT to §3 Notes), reclassified into 6 categories: 0 OPEN, 7 RESOLVED, 5 DUPLICATE (merged), 10 GAP, 14 MISSING-DESIGN, 9 PENDING-IMPLEMENTATION.
- **[MISSING] list:** 28 items (M-01..M-28), all pending-owner. M-01/M-02/M-03 = missing account creation. M-04..M-28 = owner questions (merged with §6).
- **Technical Debt:** 34 items (TD-01..TD-34). TD-32: No control account protection (implemented in P3). TD-33: Chart of accounts incomplete in seed (4107 missing) — must close before production deploy. TD-34: HTTP-level permission tests deferred (low).
- **Open Owner Questions:** 24 items (merged M-04..M-28 + OQ-01..OQ-24).
- **Chart of Accounts:** 10 new accounts (not 13 — Inventory Shortage Expense removed per D-05).

**Next step:** Accountant reviews unified document. Then Statement of Consistency. Then move to next domain (Fixed Assets / HR / Phase-2 execution).

**No migration run. No commit. No push. No DB touched.**

---

## §12. Addendum v1.1 — Design Decisions (DEC-PURCH-047..051)

**Date:** 2026-11-17
**Source:** Phase-2 Execution Brief v1, accountant review of P1 verification report
**Status:** Written decisions only. No migration. No code. No DB.

### DEC-PURCH-047: `purchase_invoice_links.voided_at`

**Decision:** Add `voided_at timestamptz NULL` column to `purchase_invoice_links`.

**Purpose:** When an invoice is cancelled/voided, the link between invoice and receipt must be marked as voided (not deleted) to preserve audit trail. `voided_at` records when the link was voided. NULL = active link.

**Rules:**
- Voiding an invoice sets `voided_at = now()` on all its `purchase_invoice_links`.
- Voided links are excluded from `v_open_purchase_lines` (invoiced_qty not counted).
- Reverse (un-void) not allowed — void is permanent.
- `voided_at` is set by the engine, never by UI.

**Schema change:** `ALTER TABLE purchase_invoice_links ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL;`

**Status:** Design decision. Migration pending (Phase-2).

### DEC-PURCH-048: `purchase_rejections.decision` states

**Decision:** The `decision` column on `purchase_rejections` has 6 possible values. Values 5 and 6 are NOT duplicates — they represent different states:

| Value | Meaning | When set |
|---|---|---|
| 1 | Replace (supplier replaces the rejected goods) | At rejection, if supplier agrees to replace |
| 2 | Accept with discount (authorized) | At rejection, if authorized user accepts with price reduction |
| 3 | Return + claim (return to supplier + issue supplier claim) | At rejection, if goods returned to supplier |
| 4 | Scrap (goods destroyed/written off) | At rejection, if goods are scrapped |
| 5 | Pending decision (initial state) | At creation (default) |
| 6 | Pending decision (awaiting external party) | When waiting for supplier/management decision |

**Rationale:** Value 5 = "we haven't decided yet." Value 6 = "we're waiting for someone else to decide." The distinction matters for reporting: 5 = internal delay, 6 = external delay. Both are "pending" but for different reasons.

**Status:** Design decision. No schema change (column already exists with default 6). Clarification only.

### DEC-PURCH-049: Disposition requires `purchases.approve_exception`

**Decision:** Any disposition on a rejected quantity (values 1-4 in `purchase_rejections.decision`) requires the permission `purchases.approve_exception` + mandatory reason.

**Rules:**
- Creating a rejection (value 5 or 6) requires `purchases.receive` (or higher).
- Changing disposition from 5/6 to 1-4 requires `purchases.approve_exception` + mandatory reason.
- The reason is stored in `purchase_rejections.notes` (or a dedicated `disposition_reason` field).
- SoD: the person who received the goods ≠ the person who approves the disposition (when possible). If same person, appears in SoD report.

**Status:** Design decision. Permission already exists (OI-3). No schema change.

### DEC-PURCH-050: `supplier_advances.branch_id` NOT NULL + clarification

**Decision:** `supplier_advances.branch_id` is **NOT NULL** (not nullable as currently in migration).

**Rationale:** The advance belongs to a branch (the branch that issued the payment). Even though "advance belongs to supplier" (no branch dimension in accounting), the operational record needs a branch for:
- Filtering advances by branch in UI
- Audit trail (which branch issued the advance)
- Reporting (advances by branch)

**Accounting dimension:** Still no branch dimension in the GL entry (advance posts to supplier-level account). The `branch_id` on `supplier_advances` is operational, not accounting.

**Schema change:** `ALTER TABLE supplier_advances ALTER COLUMN branch_id SET NOT NULL;` (or `branch_id integer NOT NULL` in CREATE TABLE).

**Status:** Design decision. Migration change needed (in Phase-2).

### DEC-PURCH-051: `supplier_payment_allocations.payment_id` → `voucher_id` + FK

**Decision:** Rename `payment_id` to `voucher_id` on `supplier_payment_allocations`, and add FK to `vouchers(voucher_id)`.

**Rationale:** The column references a voucher (سند صرف), not a generic "payment." Renaming makes the FK relationship explicit and prevents confusion with other payment types.

**Schema change:**
```sql
ALTER TABLE supplier_payment_allocations RENAME COLUMN payment_id TO voucher_id;
ALTER TABLE supplier_payment_allocations ADD CONSTRAINT fk_supplier_payment_allocations_voucher
    FOREIGN KEY (voucher_id) REFERENCES vouchers(voucher_id);
```

**Status:** Design decision. Migration change needed (in Phase-2).

---

### DEC-PURCH-050: `supplier_advances.branch_id` NOT NULL + clarification

**Decision:** `supplier_advances.branch_id` is **NOT NULL** (not nullable as currently in migration).

**Rationale:** The advance belongs to a branch (the branch that issued the payment). Even though "advance belongs to supplier" (no branch dimension in accounting), the operational record needs a branch for:
- Filtering advances by branch in UI
- Audit trail (which branch issued the advance)
- Reporting (advances by branch)

**Accounting dimension:** Still no branch dimension in the GL entry (advance posts to supplier-level account). The `branch_id` on `supplier_advances` is operational, not accounting.

**Schema change:** `ALTER TABLE supplier_advances ALTER COLUMN branch_id SET NOT NULL;` (or `branch_id integer NOT NULL` in CREATE TABLE).

**Status:** Design decision. Migration change needed (in Phase-2).

### DEC-PURCH-051: `supplier_payment_allocations.payment_id` → `voucher_id` + FK

**Decision:** Rename `payment_id` to `voucher_id` on `supplier_payment_allocations`, and add FK to `vouchers(voucher_id)`.

**Rationale:** The column references a voucher (سند صرف), not a generic "payment." Renaming makes the FK relationship explicit and prevents confusion with other payment types.

**Schema change:**
```sql
ALTER TABLE supplier_payment_allocations RENAME COLUMN payment_id TO voucher_id;
ALTER TABLE supplier_payment_allocations ADD CONSTRAINT fk_supplier_payment_allocations_voucher
    FOREIGN KEY (voucher_id) REFERENCES vouchers(voucher_id) ON DELETE RESTRICT;
```

**Rules:**
- `ON DELETE RESTRICT` — no CASCADE. Deleting a voucher with allocations is prohibited. The voucher must be reversed (not deleted).
- `voucher_type = 2` (صرف) constraint enforced in API, documented in migration as comment.

**Status:** Design decision. Migration change needed (in Phase-2).

---

## D-13: `gl_kind` → `posting_status` (rename)

**Decision:** Rename `purchase_receipts.gl_kind` to `posting_status`. Redefine values:

| Value | Meaning | When set |
|---|---|---|
| 1 | Pending (no GL entry yet) | At creation (status=2, under inspection) |
| 2 | Posted (GRNI journal written) | At approval (status=1) |
| 3 | Reversed (GRNI journal reversed) | At cancellation |

**Rationale:** The original `gl_kind` values (1=GRNI posted, 2=invoice-first path, 3=under inspection) were misleading:
- `gl_kind=2` (invoice-first) would never be recorded on a receipt — it's an invoice property.
- `gl_kind=3` (under inspection) is redundant with `status=2`.
- `gl_kind=1` (GRNI posted) is redundant with `gl_journal_id IS NOT NULL`.

The renamed `posting_status` tracks posting state (pending/posted/reversed) — which is NOT derivable from `gl_journal_id` alone (reversed state needs explicit tracking).

**Schema change:** `ALTER TABLE purchase_receipts RENAME COLUMN gl_kind TO posting_status;` (or `posting_status smallint NULL` in CREATE TABLE).

**Impact:** Low — column is new, no code references, no data. No migration run yet.

**Status:** Design decision. Migration change needed (in Phase-2).

## D-14: `voucher_id` FK details (ON DELETE RESTRICT + voucher_type=2)

**Decision:** (Already in DEC-PURCH-051, clarified here.)

- `ON DELETE RESTRICT` — no CASCADE. Deleting a voucher with allocations is prohibited. The voucher must be reversed (not deleted).
- `voucher_type = 2` (صرف) constraint enforced in API layer, documented in migration as comment.
- Rationale: RESTRICT prevents accidental deletion of allocated vouchers. Reversal (mirror journal) is the correct path for correction.

**Status:** Design decision. Migration change needed (in Phase-2).

## D-15: Permissions seed (5 permissions, role assignments)

**Decision:** Add 5 permissions to `common/security.ts` AND `src/cli/seed.ts` (per AGENTS.md rule #9: "must update both").

**Permissions:**
| Permission | Description |
|---|---|
| `purchases.approve_payment` | Disburse any mathematically valid supplier invoice |
| `purchases.receive` | Create GRN (receive goods) |
| `purchases.approve_po` | Approve/accept purchase order |
| `purchases.approve_exception` | Override over-invoicing / over-receipt with reason |
| `purchases.returns` | Create purchase returns/claims |

**Default role assignments:**
| Role | Permissions |
|---|---|
| Administrator | All 5 |
| Accountant | `purchases.approve_payment` + `purchases.approve_exception` |
| StoreKeeper | `purchases.receive` |
| Manager | `purchases.approve_po` + `purchases.approve_payment` |

**Status:** Design decision. Seed change needed (in Phase-2).

---

## §13. Addendum v1.2 — Design Decisions (D-13, D-14, D-15, D-16, DEC-PURCH-052, DEC-PURCH-053)

**Date:** 2026-11-17
**Source:** Phase-2 Execution Brief v1, accountant review (2026-11-17)
**Status:** Written decisions only. No migration. No code. No DB.

### D-13: `gl_kind` → `posting_status` (rename)

**Decision:** Rename `purchase_receipts.gl_kind` to `posting_status`. Redefine values:

| Value | Meaning | When set |
|---|---|---|
| 1 | Pending (no GL entry yet) | At creation (status=2, under inspection) |
| 2 | Posted (GRNI journal written) | At approval (status=1) |
| 3 | Reversed (GRNI journal reversed) | At cancellation |

**Rationale:** The original `gl_kind` values (1=GRNI posted, 2=invoice-first path, 3=under inspection) were misleading:
- `gl_kind=2` (invoice-first) would never be recorded on a receipt — it's an invoice property, not a receipt property.
- `gl_kind=3` (under inspection) is redundant with `status`.
- `gl_kind=1` (GRNI posted) is redundant with `gl_journal_id IS NOT NULL`.

The renamed `posting_status` tracks posting state (pending/posted/reversed) — which is NOT derivable from `gl_journal_id` alone (reversed state needs explicit tracking).

**Schema change:** `ALTER TABLE purchase_receipts RENAME COLUMN gl_kind TO posting_status;` (or `posting_status smallint NULL` in CREATE TABLE).

**Impact:** Low — column is new, no code references, no data. No migration run yet.

**Status:** Design decision. Migration change applied in P1.R2.

### D-14: `voucher_id` FK details (ON DELETE RESTRICT + voucher_type=2)

**Decision:** (Already in DEC-PURCH-051, clarified here.)

- `ON DELETE RESTRICT` — no CASCADE. Deleting a voucher with allocations is prohibited. The voucher must be reversed (not deleted).
- `voucher_type = 2` (صرف) constraint enforced in API layer, documented in migration as comment.
- Rationale: RESTRICT prevents accidental deletion of allocated vouchers. Reversal (mirror journal) is the correct path for correction.

**Status:** Design decision. Migration change applied in P1.R2.

### D-15: Permissions seed (5 permissions, role assignments)

**Decision:** Add 5 permissions to `common/security.ts` AND `src/cli/seed.ts` (per AGENTS.md rule #9: "must update both").

**Permissions:**
| Permission | Description |
|---|---|
| `purchases.approve_payment` | Disburse any mathematically valid supplier invoice |
| `purchases.receive` | Create GRN (receive goods) |
| `purchases.approve_po` | Approve/accept purchase order |
| `purchases.approve_exception` | Override over-invoicing / over-receipt with reason |
| `purchases.returns` | Create purchase returns/claims |

**Default role assignments:**
| Role | Permissions |
|---|---|
| Administrator | All 5 |
| Accountant | `purchases.approve_payment` + `purchases.approve_exception` |
| StoreKeeper | `purchases.receive` |
| (Manager — does not exist) | `purchases.approve_po` + `purchases.approve_payment` → assigned to StoreKeeper (interim) |

**Note:** D-15 references a "Manager" role that doesn't exist in seed.ts. Assigned to StoreKeeper (closest existing role). Flagged for accountant review (DEC-PURCH-052).

**Status:** Design decision. Seed change applied in P1.R2.

### D-16: Account number resolution (GRNI, Supplier Advances, PPV, Inventory in Transit)

**Decision:** Account numbers for the 4 Phase-2 accounts are determined **after checking `gl_accounts` current state** — no assumptions.

**Finding from schema check (2026-11-17):**
- `gl_accounts` has NO `party_required` or `branch_required` columns. Dimensions are enforced at `gl_entries` (journal line) level: `branch_id` NOT NULL (schema-level), `party_id` nullable (code-level enforcement via posting engine).
- Codes 1107, 1108, 2105: need to be verified against existing `gl_accounts` before assignment. (DB was empty during verification — schema check performed on `db/schema.postgres.sql`.)

**Where dimensions are enforced (§Dimensions):**
- (a) `gl_accounts` columns: ❌ No `party_required`/`branch_required` columns.
- (b) `gl_journal_lines` (`gl_entries`) columns: ✅ `branch_id` NOT NULL (schema-level), `party_id` nullable (code-level via posting engine).
- (c) `gl_mappings` rules: Maps concept → account, but does not enforce dimensions.

**Decision:** Dimensions are enforced at the `gl_entries` (journal line) level. `branch_id` is NOT NULL (always). `party_id` is populated by the posting engine when posting GRNI (supplier), AP, AR, etc. — same pattern as existing accounts.

**Implication for GRNI:** GRNI posts `Dr INVENTORY / Cr GRNI` with `branch_id` = receiving branch (NOT NULL, schema-enforced) and `party_id` = supplier (populated by posting engine, code-enforced). This mirrors how AP/AR work today.

**Account number assignment:**
- 2105: GRNI — verify free. If occupied, use next available in 21xx group.
- 1107: Supplier Advances — verify free. If occupied, use next available in 11xx group.
- 1108: **RESERVED for Inter-branch clearing (E2, DEC-ACCT-014).** Do NOT use for Inventory in Transit. Use 1109 or next available.
- PPV: Expense account in 5xxx group. No conflict with existing accounts.

**Status:** Design decision. Account numbers verified at Phase-2 execution (seed time), not now (DB was empty during verification).

## DEC-PURCH-052: PO approval role

**Decision:** `purchases.approve_po` assigned to Administrator only (interim). D-15 referenced a "Manager" role that does not exist in the system.

**Rationale:** The five existing roles are: Administrator, Accountant, StoreKeeper, SalesRep, Cashier. No "Manager" role exists. Until the owner decides who approves POs, the permission is assigned to Administrator only.

**Rules:**
- `purchases.approve_po`: Administrator only (interim).
- Marked in seed.ts with TODO comment.
- Requires owner input: which role should approve POs?

**Status:** pending-owner (interim = Administrator only).

## DEC-PURCH-053: `purchases.approve_exception` covers both over-invoice and rejection disposition

**Decision:** The permission `purchases.approve_exception` covers BOTH:
- (a) Over-invoice waiver (R-5): invoiced qty > accepted qty
- (b) Rejection disposition (D-10): changing rejection decision from pending (5/6) to 1-4 (replace/accept-with-discount/return+claim/scrap)

**Rationale:** Both are "exceptions" to the normal flow. One permission suffices. The distinction is via `reason` in the database, not via separate permissions.

**Rules:**
- Over-invoice: requires `purchases.approve_exception` + mandatory reason (waive).
- Rejection disposition: requires `purchases.approve_exception` + mandatory reason (disposition choice).
- SoD: the person who received the goods ≠ the person who approves the exception (when possible). If same person, appears in SoD report.

**Status:** Design decision. No schema change. Permission already in D-15 (seed).

**Status:** Design decision. No schema change. Permission already in D-15 (seed).

### DEC-ACCT-018 (D-17): Control account protection via `is_control` on `gl_accounts`

**Decision:** `gl_accounts.is_control boolean NOT NULL DEFAULT false`. `postJournal` rejects manual journal entries on any account with `is_control = true`.

**Initial control accounts:** AR, AP, VAT Input, VAT Output, Inventory, COGS, GRNI. Expanded when Unbilled Receivable, Deferred Revenue, Customer Advances are created.

**Rationale:** No control account protection currently exists (any user with `accounting.manage` can post manual entries to AR/AP/VAT/Inventory). Option B (hardcoded list in posting.ts) was rejected because it creates a second source of truth (code vs schema). Option A (`is_control` column) keeps the definition in the chart of accounts where it belongs.

**Rules:**
- `is_control = true` on AR, AP, VAT Input, VAT Output, Inventory, COGS, GRNI.
- `postJournal` checks: if `source_type` is manual/none AND account.is_control = true → reject with Arabic message.
- Automated postings (GRN, invoice, payment, etc.) bypass the check (they have defined source_types).
- Adding a new control account = `UPDATE gl_accounts SET is_control = true` — no code change.

**Schema change:** `ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS is_control boolean NOT NULL DEFAULT false;`

**Status:** Design decision. Schema + code change needed (in P3, before GRNI account creation).

## DEC-PURCH-054 (D-18): `receipt_links` on `POST /invoices` (purchase invoices)

**Decision:** `POST /invoices` with `invoiceType=2` accepts an optional `receipt_links: [{ receipt_line_id, qty }]` array.

**Rules:**
- API: accepts explicit `receipt_links`. Each link maps an invoice line to a GRN receipt line + quantity matched.
- When `receipt_links` are NOT provided but open GRN lines exist: FIFO auto-match (oldest open GRN line first) — this is the UI default behaviour, implemented in the API as a convenience.
- When no open GRN exists: invoice posts `Dr GRNI / Dr VAT Input / Cr AP` with unmatched GRNI (invoice-before-receipt), no stock movement — supported by design.
- `Σ link qty ≤ accepted_qty` per receipt line (R-5 inverse invariant). Quantity beyond accepted → rejected unless `purchases.approve_exception` + reason (then logged as unmatched, escalated).
- `purchase_invoice_links` records every link (invoice_id, receipt_id, receipt_line_id, item_id, invoiced_qty).
- PPV = invoice net value − GRN provisional (accepted_qty × unit_cost). Posted to 5114 (Dr if positive, Cr if negative).

**Schema/API:** No schema change (table `purchase_invoice_links` exists in P2 migration). `InvoiceInput` gains `receiptLinks?: { receiptLineId: number; qty: number }[]`.

**Status:** Design decision. Implemented in B2.

---

## §11. Statement of Consistency

> **Statement of Consistency — 2026-11-17**
>
> راجعت `docs/ERP-ACCOUNTING-DECISIONS.md` كاملًا (§0–§10).
>
> **أُقرّ بأن الوثيقة متسقة في جوهرها مع قراراتي في الجلسات السابقة**، وأوقّع عليها كمرجع موحّد **بعد تطبيق 7 تصحيحات (E-1..E-7) وقرارَين جديدين (D-06، D-07) موضّحين أدناه**. هذه التصحيحات كلها إعادة اتساق مع قرارات سابقة أو قرارات جديدة — لا تراجع عن أي قرار.
>
> **التصحيحات (E-1..E-7):**
> 1. E-1: حذف §1.8 (تكرار §1.2). إزالة DEC-PURCH-002 من §1.2 (موجود في §1.10).
> 2. E-2: نقل معيارَي PPV/GRNI من §8 Sales إلى §8 Purchases.
> 3. E-3: «Overdue + exceeded customer: absolute block regardless of permission. Only remedy: customer pays first.»
> 4. E-4: حذف «Inventory Shortage Expense» من §7 — العدد النهائي 10 حسابات.
> 5. E-5: فصل §4 إلى §4-A (3 حسابات مفقودة) + §5 (أسئلة مالك، مدمجة مع §6).
> 6. E-6: حذف C-04, C-10, C-14, C-18, C-41 من §2 (نقل إلى §3 Notes).
> 7. E-7: إضافة سطر فاصل في §8 Sales: «Two distinct cases: (1) over-limit but not overdue → override with permission. (2) over-limit + overdue → absolute block.»
>
> **القرارات الجديدة (D-06, D-07):**
> - D-06: VAT على مقدمات العملاء — لا VAT at payment (للسلع). قد يكون VAT at payment للخدمات — يستلزم رأي مستشار ضريبي.
> - D-07: VAT على خصم سداد المشتريات — إيراد تمويلي (لا يخفّض VAT Input) إلا بإشعار دائن رسمي.
>
> **الشروط:**
> 1. التصحيحات E-1..E-7 تُطبَّق على الوثيقة (تم).
> 2. D-06 (VAT على مقدمات العملاء) وD-07 (VAT على خصم سداد المشتريات) يُضافان إلى §1.3 و§1.5 (تم).
> 3. §7 يُحدَّث بحذف «Inventory Shortage Expense» — العدد النهائي 10 حسابات (تم).
> 4. §4 و§6 يُدمجان في قسم واحد «Owner Questions» (تم).
> 5. §2 يصبح 40 صفًا (لا 45) بعد حذف NOT-A-CONFLICT إلى §3 Notes (تم).
>
> **بعد هذه التصحيحات:**
> - **التعارضات المفتوحة: صفر** (لا OPEN).
> - **الوثيقة نهائية وقابلة للتنفيذ** كمرجع.
> - **الـmigration يبقى ON HOLD** حتى اجتياز شرط 1 (Phase-1 v0.3 + OI-13/14/15 + TD-27) — التوقيع على الوثيقة لا يفتح التنفيذ.
>
> **ما لا أوقّعه:**
> - أي تعديل لاحق على §1..§8 بدون مراجعة صريحة مني.
> - أي قرار جديد على البنود PENDING-OWNER بأثر رجعي.
> - أي تفسير للوثيقة يخالف نص قرار في §1.
>
> **حالة المشروع:** جداول التجميع + الوثيقة الموحدة معتمدة بعد التصحيحات. الوحدة التالية (Fixed Assets / HR / Phase-2) لا تُفتح حتى تأكيد التصحيحات.