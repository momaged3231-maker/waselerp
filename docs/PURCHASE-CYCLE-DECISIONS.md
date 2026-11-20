# Purchases Cycle — Committed Decisions (Draft for Approval)

Status: **Design + initial assets authored. NOT executed.**
Date: 2026-11-17 (revised after independent review + accountant sign-off)
Owner: WaselERP owner + accounting approval required where marked

---

> **اعتماد Phase-1 v0.3 — 2026-11-17**
> الوثيقة والـmigration معتمدتان وفق verdict المراجع + قرارات المحاسب + إغلاق PPV.
> شرط 1: التحقق من مطابقة الملف لجدول التغييرات يتم قبل تشغيل الـmigration؛ أي فرق يوقف التنفيذ ويُبلغ.
> شرط 2: ثلاثة قرارات (هوية المفتش، تجاوز الاستلام، ترقيم المستندات) تُتخذ أولًا في جلسة Phase-2 قبل أي schema أو كود.
> حالة الـmigration: ON HOLD حتى اجتياز الشرط 1. لا DB، لا commit، لا push قبل ذلك.

---

## 1. Approved commercial rules

1. **Four independent documents** in the purchases flow:
   - `Purchase Order` — quantity, terms, delivery terms (Incoterm), line-level tax, item/warehouse defaulting from party/PO
   - `Goods Receipt Note (GRN)` — accepted / rejected / missing / damaged quantities per line, inspector mandatory, timestamped
   - `Supplier Invoice` — can be raised before receipt, after receipt, or partially in either direction
   - `Supplier Payment` — independent treasury event, may be split/merged flexibly

2. **Receipt-before-invoice or invoice-before-receipt** both supported; partial in both supported.

3. **Inspection is at the dock on arrival.** No separate «sample collection» sub-document is required by default.

4. **Damage/Rejected/Short quantities** follow supplier-specific rules:
   - default policy is configurable per supplier; falls back to company default
   - per-line override at reception time with mandatory reason + audit log
   - rejected goods are physically held under a descriptive location for supplier return; release is a logistics action with no accounting entry.
   - **Rejected/damaged quantities are NEVER valued and never enter average cost (R-4 option (a)):** memo quantity only in `purchase_receipt_lines` + descriptive quarantine location; risk stays with supplier until replacement/credit note. **No quarantine account, no `Dr Quarantine / Cr GRNI`** (OI-4 closed).

5. **Delivery terms are per supplier / per PO / per line (override allowed)** — e.g. EXW / FOB shipping point / DAP / DDP. Incoterm is a free-text tag on the PO + supplier default; **informational in Phase-1 (C-1)**. Recognition always occurs at GRN posting; the Incoterm does not gate accounting.

6. **State recognition rules (inventory/GRNI/AP):** — unified GRNI control account (OI-1: new standalone account with party + branch dimension; R-1).
   - GRN posted (accepted qty only): `Dr INVENTORY [accepted qty × PO line price] / Cr GRNI`
   - Invoice posted (before or after GRN — same entry): `Dr GRNI [GRN provisional amount] / Dr PPV [price difference, if any] / Dr VAT Input / Cr AP [invoice total]`
   - GRN provisional unit cost = **PO line unit price** (excl. VAT). This is the value posted to inventory at GRN.
   - If invoice price < GRN provisional price → PPV is a credit (contra-expense).
   - GRN after invoice: `Dr INVENTORY / Cr GRNI`.
   - Payment: `Dr AP / Cr Cash-Bank-Card-Wallet-Cheque`.
   - Net effect: GRNI = 0 for every fully-received, fully-invoiced line **regardless of document order**. GRNI is a control account — no manual GL entries (R-1).
   - Cash-at-receipt purchases still post through GRNI/AP in the **same transaction** (R-3), auto-allocated; no bypass of the AP-GRNI path.
   - Over-invoicing (qty invoiced > accepted) is not a policy choice: **blocked** or requires `purchases.approve_exception` with recorded waive+reason (R-5). Inverse invariant: `Σ invoice-link qty ≤ accepted qty` per receipt line.
   - Incoterm is informational in Phase-1 (C-1); recognition always at GRN posting.

7. **Payments / allocation:**
   - Supplier statement shows supplier-wise open items; allocation across invoices is supported at payment time, not invoice creation.
   - Supplier invoices may accumulate payments (partial, full, multiple). Supplier invoices may serve returns/adjustments (purchased returns credited).
   - Payment allocation does not block invoice validation; it triggers supplier-ledger updates (Cr AP at invoice, Dr paid/settled at payment).
   - **Supplier advances (R-2 / OI-1):** new asset account «دفعات مقدمة للموردين» (proposed 1107/1108), party dimension mandatory, **no branch dimension** (advance belongs to supplier). Posting: on payment `Dr Supplier Advances / Cr Cash-Bank-Card-Wallet-Cheque`; on invoice application `Dr AP / Cr Supplier Advances` for the applied portion only. Shown as a separate line on the supplier statement — **not netted into AP**. Cancellation/refund: `Dr Cash / Cr Supplier Advances` with mandatory reason.
   - **VAT on advances (OI-2 sub-item):** NO VAT deducted on advances; VAT handled at invoice posting only. Subject to written tax-consultant confirmation before first real invoice of this pattern.

8. **Mixed payment terms per supplier** — `cash at receipt`, `Net X`, `advance`, all configurable. No assumption of a single term model. Cash-at-receipt posts through GRNI/AP in the same transaction (R-3).

9. **Cash/bank/wallet/cheque/card** all allowed for supplier payments; default = cash as in current seed. **E-wallet is NOT a voucher payment method in current builds — only invoice payments.** Fix needed in `METHOD_LABEL` and vouchers UI to enable wallet, and in API if needed (see open item OI-6). Cash-at-receipt still produces GRNI/AP entries (R-3).

10. **Approval model — cost-driven and role-driven:**
    - `purchases.approve_payment` permission is its own gate. Users with it can disburse any mathematically valid supplier invoice even if quantity/price differ — explicit owner direction, documented risk.
    - Quantity variance tolerance, price variance tolerance: **operator policy**, not system-enforced by default. Warning UI, not blocking.
    - PO walk-through approval / acceptance requires the same or higher role — specific gate: not yet seeded; see open item OI-3.
    - **Distinction (C-3):** line-level override (§1.4, mandatory reason) ≠ invoiced-over-accepted (`purchases.approve_exception`). Different permission, different gate.
    - Same-user control (procurement + receiving + payment authority combined) is allowed per owner policy; audit mandatory.
    - **`purchases.approve_exception`** (R-5) required to waive over-invoicing with recorded reason.
    - **SoD compensating control (review gap 10):** a report listing GRNs where receiver = payment approver, and invoices paid with open variances. Mandatory deliverable in build order.

11. **Branches:**
    - PO branch = branch where order raised; delivery can end up in a different branch (permitted if user has both branches; C-6 — drop the «supplier policy allows» condition or add the field, decision: **drop in Phase-1**, revisit if needed).
    - Warehouse receipt happens at the physical warehouse regardless of PO branch; stock belongs to receiving branch (via `applyMovement(..., branchId: receivingBranch)`).
    - AP stays on the supplier-party with own ledger; branching is by receipt document, not by AP.
    - **GRNI carries the branch dimension (C-8 / OI-1):** mandatory = receiving branch, so GRNI ties to branch-split inventory.

12. **Period-close respected.** If the period is closed/manual-locked, the document is rejected with a clear Arabic message (existing `assertPeriodOpen` wired through posting.ts). Reversal in a closed period is rejected; correction posts in the open period via mirror journal (review gap 4).

13. **Cost recognition:** weighted average after accepted quantities only. Rejected/missing quantities never enter average cost.
    - If invoice arrives before inspection, no cost recognition until accepted.
    - If invoice arrives after GRN, `unit_cost` comes from GRN accepted quantity at weighted-avg.
    - Rejected/damaged quantities are memo only (R-4 option (a)).
    - **Purchase Price Variance (PPV):** any difference between invoice unit price and GRN provisional cost posts to a dedicated PPV account at invoice time. Inventory is **not** retro-adjusted; moving average is not disturbed.
    - **GRN provisional cost** = PO line unit price — definitional, not a policy choice.

14. **Printing:** PO, GRN, Invoice, Payment all printable (A4/A5) via browser + print agent for PO/GRN A5 with signature lines. Not delivered yet.

15. **No ETA/ZATCA for purchase invoices.** Code blocks ETA (`eta.slice.ts:122`). ZATCA currently accepts any invoice type — bug to close (see open item OI-8). Reconcile any historical type-2 rows already submitted before flipping the block.

---

## 2. Architecture (proposed; not implemented)

### New slice — `apps/api/src/modules/purchases/`

- `purchase-order.slice.ts` — PO list/create/update/convert (replaces sales-owned convert path for orderType=2)
- `purchase-receipt.slice.ts` — GRN list/create/update, batch/approve/reject per line; drives `applyMovement` and `GRNI` posting via `postInvoiceJournal` (or dedicated GRN path)
- `purchase-match.slice.ts` — three-way matching information (non-blocking by default; waives tracked with reason)
- `purchase-claims.slice.ts` — supplier claims, replacements, reductions, cash refunds; handles quarantine release/shortage reversal
- `purchase-advances.slice.ts` — supplier advances (new), separate from AP ledger
- `purchase-payment-allocation.slice.ts` — batch-payment allocate-across-invoices; back-settled after returns are known
- `purchase-report.slice.ts` — 6 core reports: supplier statement, AP aging, GRN vs invoiced variance, top suppliers, cost prices by line, low-stock reorder (reuses existing inventory data)

### Schema additions (pending Phase-2 SQL approval)

- `purchase_receipts`, `purchase_receipt_lines`
- `purchase_invoice_links` (partial invoice ↔ receipt mapping)
- `purchase_claims`
- `purchase_advances`
- `parties.default_delivery_terms` + `parties.default_damage_policy` (new columns) (C-5)
- `orders.delivery_terms` + `orders.delivery_terms_note` (new columns) — `goods_received_by` moved to `purchase_receipts` (C-4)
- `purchase_receipts.received_by` / `inspected_by` carry receiver/inspector identity; gated by `purchases.receive` permission (OI-3)
- `v_open_purchase_lines` view
- **NO quarantine account/columns** (OI-4 closed, R-4 option (a))
- **NO `orders.goods_received_by` / `orders.goods_received_at`** (moved to purchase_receipts, C-4)
- **Seed accounts required (created via seed, not in migration): GRNI (2105), Supplier Advances (1107/1108), PPV «فروق أسعار الشراء» (OI-12).**

Migration file authored: `db/migrations/2026-11-17-purchases-cycle.sql` (NOT RUN, pending revision per §5/§7).

### Postings (when Phase-2 lands)

- GRN posted: `Dr INVENTORY / Cr GRNI` (new account GRNI, party + branch dimension — OI-1)
- Invoice posted (before or after GRN): `Dr GRNI / Dr PPV / Dr VAT Input / Cr AP` (no inventory movement; PPV absorbs price difference; VAT at invoice — OI-2)
- Payment posted: `Dr AP / Cr CASH/BANK/CARD/WALLET/CHEQUE`
- Advance paid: `Dr Supplier Advances / Cr CASH/...`
- Advance applied: `Dr AP / Cr Supplier Advances`
- Cash-at-receipt: GRNI/AP entries in same transaction (R-3)
- PPV account: new expense account «فروق أسعار الشراء» — non-control, party optional (OI-12).

### UI (when Phase-2/-3 lands)

New tenant «المشتريات» in the sidebar (after «المبيعات»):
- أوامر الشراء — list / create / edit / partial-convert to GRN / cancel
- محاضر الاستلام — list / create (from PO) / inspect per-line / accept / reject
- فواتير الموردين — list / create / link to GRN / cancel (mirrors `/invoices` filters type 2/4)
- مدفوعات الموردين — voucher-style any party type from accounting `accounting/vouchers` with `voucherType=صرف`
- مطالبات الموردين — create/track
- كشوف حساب المورد — new page `/purchases/supplier-statement` (A4 print, Excel)
- دفعات مقدمة للموردين — `/purchases/advances`
- تقارير — new tab under `/reports` or dedicated `/purchases/reports`

---

## 3. Open items — approvals required (accountant + owner)

| ID | Item | Status |
|---|---|---|
| OI-1 | GRNI account: new standalone, party + branch dimension | **Decided** (accountant sign-off §7) |
| OI-2 | VAT-input recognition when invoice precedes receipt | **Accountant position: VAT at invoice posting** + 90-day GRNI aging report; written tax-consultant confirmation before first real invoice of this pattern |
| OI-3 | New permissions seed (`purchases.approve_payment`, `purchases.receive`, `purchases.approve_po`, `purchases.approve_exception`, `purchases.returns`) + role assignment | Open (RBAC) |
| OI-4 | Quarantine account + policy for rejected quantities | **Closed** (R-4 option (a): no account) |
| OI-5 | Returns with credit-notes for purchase returns | Open (Phase-2.5) |
| OI-6 | Voucher `METHOD_LABEL` lacks **e-wallet**; add + set default payment method per voucher type=2 | Open (Phase-3) |
| OI-7 | Supplier statement print template — Arabic header, signature line, page footer | Open (Phase-3) |
| OI-8 | Fix **ZATCA to reject invoiceType != 1** (currently allows purchases); reconcile historical type-2 rows | Open (Phase-3) |
| OI-9 | Delivery-terms dependence policy | **Resolved**: recognition at GRN posting; Incoterm informational (C-1) |
| OI-10 | UI: `/accounting/vouchers` open-invoices hardcoded `type=1` (sales) — respect voucherType ⇄ invoiceType (type=2) | Open (Phase-3) |
| OI-11 | Render «payables» tile in `apps/web/app/page.tsx` | Open (Phase-3) |
| OI-12 | PPV account «فروق أسعار الشراء» — new expense account, non-control, party optional | Open (Phase-2) |
| OI-13 | Inspector identity on `purchase_receipts`: user FK vs free text vs both; gate via `purchases.receive` | **Decided (accountant, 2026-11-17)** — user FK mandatory for `received_by`/`inspected_by`; optional `external_inspector_name` (text) for external inspectors only; `purchases.receive` on received_by, same-or-higher on inspected_by |
| OI-14 | Over-receipt tolerance: allowed up to a value? requires `purchases.approve_exception`? prohibited? | **Decided (accountant, 2026-11-17)** — default 0% (reject); override only via `purchases.approve_exception` + mandatory reason + per-supplier `parties.default_over_receipt_pct` (default 0%) |
| OI-15 | Document numbering: per-type / per-branch + gap policy (PO/GRN/claim/advance) — reuse existing pattern or new | **Decided (accountant, 2026-11-17)** — per-type + per-branch; number assigned at posting (not draft); gaps allowed only with documented state; report «الفجوات غير المبرَّرة» in SoD report; format `PO-{branch}-{YYYY}-{seq}` |

---

## 4. Build order (re-sequenced per review recommendation)

**Step 0 (first 30 min of Phase-2):** OI-13/14/15 **decided by accountant (2026-11-17)** — see §3 (OI-13/14/15) and §7.2. Implementation agent records these in the schema before writing code; no further decision needed. If any implementation question is not answered by v0.3, the agent stops and escalates (no silent invention).

1. **GRN slice**: minimal `purchase_receipts` + `purchase_receipt_lines` + `postReceipt` (applyMovement with accepted quantities only, posts `GRNI` journal) + `purchases.receive` permission.
2. **Invoice/GRNI settlement**: invoice → GRN recognition incl. VAT Input and **PPV**; invoice cancel mirror journal (reuse `/accounting/vouchers` but fix OI-10); invoice-before-GRN posts `Dr GRNI / Dr PPV / Dr VAT Input / Cr AP`.
3. **Supplier statement page**: read AR/AP from parties-statement engine (unified `/parties/{id}/statement` usable directly) + A4 print — **after** settlement exists (reviewer re-sequence).
4. **Claims** (after GRN and Invoice are live) — replacement GRN at zero AP linked to claim, credit-note offset, cash refund; VAT adjustment on credit notes (overlaps OI-5).
5. **Advances** (after claims or in parallel).
6. **Payment allocation** (batch allocation across invoices; back-settled after returns known — define auto-apply vs operator action).
7. **Reports** (supplier statement, AP aging with GRNI memo section, GRN/Variance, reorder, SoD exception report).
8. **Frontend screens** (per §2 UI).
9. **ZATCA/ETA gating** (OI-8 only, after historical reconciliation).
10. **E2E / smoke extension** (only after explicit owner approval; no DB-test gate yet).

---

## 5. Out of scope (intentionally deferred) + review gaps to close

Deferred:
- Multi-invoice payment batches (treat recurring as manual).
- Currency/multi-currency for foreign suppliers until FX policy approved.
- Import/customs clearance: invoice status before goods clear customs is a separate flow (custom duty costing).
- Returns value = actual cost of returns, not current average cost.
- Automatic deduction of rebates/discounts after settlement (manual, supplier-side).
- Full workflow approvals with levels (manager→finance) — single-permission «approve_payment» only.
- Changes to sales flows, branch transfers (E2), bank reconciliation (E1), period closing (E6).

Review gaps (decide before/during Phase-2):
- Claims postings definition (replacement / credit-note offset / cash-refund + VAT adjustment).
- Payment allocation vs later returns: auto-apply credit note to oldest open invoice vs force operator action.
- Post-posting edits: after posting, no edits, reversal only; same for PO after first GRN.
- Reversal in a closed period: mirror journal dated in the open period (defined path).
- Over-receipt tolerance: receiving more than ordered.
- Inspector identity: user FK vs free text vs both; `purchases.receive` permission.
- Document numbering: per-type, per-branch sequences + gap policy (PO/GRN/claim/advance).
- Branch dimension on GRNI: carried (decided in OI-1).
- VAT evidence capture: supplier e-invoice UUID / tax registration on purchase invoices for VAT purchase ledger.
- Segregation-of-duties compensating control: GRNs where receiver = payment approver; invoices paid with open variances.
- Replacement flow definition: damaged → replacement GRN at zero AP, linked to claim, same PO line or new line.
- ZATCA historical reconciliation before flipping the type-2 block.

---

## 6. Acceptance criteria (minimum)

When all phases complete:

- [ ] Owner can create a PO from UI, with delivery_terms and per-line tax.
- [ ] On arrival, GRN is created against the PO; per-line accepted/rejected quantities are recorded.
- [ ] Stocks increase by accepted quantity on GRN, no double-count when invoice arrives later.
- [ ] Supplier ledger balances see GRN/AP effect exactly once.
- [ ] Invoice-before-receipt does not increase inventory until GRN is posted.
- [ ] Partial receipt + partial invoice works end-to-end.
- [ ] **Journal-level test:** invoice-before-GRN and GRN-before-invoice produce identical GRNI/AP net balances for the same line.
- [ ] Over-invoiced quantity is blocked or requires `purchases.approve_exception` with recorded reason.
- [ ] Rejected/damaged quantities never appear in inventory valuation or average cost (assert on movement + costing tables).
- [ ] Cash-at-receipt purchase still produces GRNI/AP entries.
- [ ] Reversal of a posted GRN in a closed period is rejected with the Arabic message; the correction path posts in the open period.
- [ ] SoD exception report runs and returns the combined-authority cases.
- [ ] Supplier statement separates **AP open items (aged)** from **GRNI memo (unbilled receipts)**.
- [ ] Mixed payment terms (cash / Net30 / wallet / advance) work without code change.
- [ ] Owner can print PO/GRN/invoice (A4 or A5).
- [ ] Invoice price ≠ GRN provisional cost posts the difference to PPV; the invoice journal is balanced; inventory is unchanged.
- [ ] GRNI nets to zero on a fully-received, fully-invoiced line **even when invoice price ≠ PO price** (PPV absorbs the difference).
- [ ] Every purchase document that affects supplier liability produces a journal touching GRNI and AP (or Supplier Advances), verifiable by query.

---

## 7. Review verdict & accountant sign-off

### 7.1 Independent review verdict (2026-11-17)

**Not approvable as written — approve with conditions.** Commercial rules (§1) and out-of-scope (§5) approved as-is. §1.6/§1.13 accounting model held pending R-1…R-5 and C-1/C-2. Key blockers resolved above:
- R-1: `Cr AP only` was an unbalanced entry → replaced with unified GRNI model (§1.6).
- R-2: advances posting + account defined (§1.7).
- R-3: cash-at-receipt posts through GRNI/AP (§1.6/§1.8).
- R-4: option (a) — rejected never valued; OI-4 closed (§1.4/§1.6).
- R-5: over-invoicing blocked or `purchases.approve_exception` (§1.6/§1.10).
- C-1…C-8: resolved (Incoterm informational, recognition at GRN, approval gate defined, goods_received_by moved, default_damage_policy added, branch condition dropped, GRNI aging = memo, phases defined).

### 7.2 Accountant sign-off (OI-1 / OI-4 / advances / OI-2)

> **اعتماد محاسبي — دورة المشتريات**
> أوافق على: (1) حساب GRNI جديد مستقل بأبعاد party+branch؛ (2) «المرفوض لا يُقيَّم» وإغلاق OI-4 بلا حساب حجز؛ (3) حساب مقدمات كموجود أصل بلا بُعد فرع؛ (4) إثبات ضريبة المدخلات عند ترحيل الفاتورة مع ضابط تقرير GRNI أعمار شهري.
> **استثناء واحد:** OI-2 يخضع لتأكيد مستشار ضريبي مكتوب قبل أول فاتورة فعلية بالنمط، دون أثر على الكود أو الـschema.
> **الحالة:** Phase-1a (الوثيقة) جاهزة للتعديل؛ الـmigration تبقى ON HOLD حتى إعادة إرسالها معدّلة للمراجعة.
>
> **ملاحظة v0.3 (PPV):** فروق أسعار الشراء (PPV) أُضيفت في §1.6/§1.13/§2/§3 (OI-12)/§4/§6/§7.3. الاعتماد أعلاه يغطيها الآن (البند (5): PPV = «فروق أسعار الشراء» كحساب مصروف non-control).

Accountant decisions recorded:
- **OI-1 (GRNI):** new standalone account, classification = current liability «بضاعة مستلمة غير مفوترة (GRNI)», proposed 2105 (or next available in current-liabilities group), party dimension mandatory = supplier, branch dimension mandatory = receiving branch, control account — no manual GL entries. Reuse of 1104 rejected.
- **OI-4 (Quarantine):** option (a) — rejected/damaged never valued; memo quantity only; no quarantine account; OI-4 closed.
- **Advances:** new asset «دفعات مقدمة للموردين» (proposed 1107/1108), party mandatory, NO branch dimension, posting `Dr Supplier Advances / Cr Cash-…` then `Dr AP / Cr Supplier Advances`, separate line on supplier statement (not netted into AP), VAT not deducted on advances (handled at invoice).
- **OI-2 (VAT):** accountant position = VAT Input posted at invoice posting (not at GRN); compensating control = mandatory monthly GRNI aging report; any GRNI balance older than agreed period (suggested 90 days) = tax claim without supply, must be reversed or frozen. Subject to written tax-consultant confirmation before first real invoice of this pattern; **no effect on code or schema** in either case.
- **OI-13 (Inspector):** `received_by` and `inspected_by` = user FK mandatory (separate columns; may be same user). Optional `external_inspector_name` (text) for external inspectors only — never a substitute for FK. `purchases.receive` on `received_by`; same-or-higher on `inspected_by`. (Accountant, 2026-11-17.)
- **OI-14 (Over-receipt):** default 0% (reject with Arabic message). Override only via `purchases.approve_exception` + mandatory reason + per-supplier `parties.default_over_receipt_pct` (default 0%). (Accountant, 2026-11-17.)
- **OI-15 (Numbering):** per-type + per-branch; number assigned at posting (not draft); gaps allowed only with documented state; report «الفجوات غير المبرَّرة» in SoD report; format `PO-{branch}-{YYYY}-{seq}`. (Accountant, 2026-11-17.)

### 7.3 Migration status

The migration file `db/migrations/2026-11-17-purchases-cycle.sql` remains **ON HOLD** and must be revised (per accountant §5) before running:
- Add `grni_account_id` + party/branch dimension notes (account created via seed, not in migration).
- Remove quarantine account/columns (OI-4 closed).
- Add `parties.default_damage_policy` (C-5).
- Move `goods_received_by`/`goods_received_at` from `orders` to `purchase_receipts` (already covered by `received_by`/`inspected_by`).
- Add `purchase_invoice_links` table.
- Seed accounts required (created via seed, not in migration): **GRNI (2105), Supplier Advances (1107/1108), PPV «فروق أسعار الشراء» (OI-12)**. No new columns for PPV/Advances.
- Keep everything additive; no changes to existing table semantics until ALTER lands.

**No migration will be run, no test will write to any DB, no commit/push, until the revised migration is reviewed and explicitly approved.**

---

## 8. Session closure (2026-11-17)

**Achieved (Phase-1):**
- v0.1 → v0.2 → v0.3: review verdict (R-1…R-5, C-1…C-8) closed; accountant sign-off (OI-1, OI-4, advances, OI-2, PPV/OI-12); OI-13/14/15 decided.
- Migration file revised (additive, ON HOLD).
- Status: Phase-1 **closed and approved**; Phase-2 **open**.

**Remaining (Phase-2, in order per §4):**
- Step 0: record OI-13/14/15 in schema (decisions already in §3/§7.2).
- GRN slice (purchase_receipts + lines + postReceipt + purchases.receive).
- Invoice/GRNI settlement (incl. PPV) + cancel mirror.
- Supplier statement (after settlement).
- Claims, advances, payment allocation, reports, frontend, ZATCA gating, E2E.

**Design changes during implementation:** none allowed silently. Any design change becomes v0.4 with explicit approval before proceeding.

**Commitment (per accountant note):** each Phase-2 session closes with «what achieved + what remains + any design change» before moving on.