# P1 — Verification Report: Migration vs Change Table

**Date:** 2026-11-17
**Executor:** WaselERP agent (read-only verification)
**Migration file:** `db/migrations/2026-11-17-purchases-cycle.sql` (209 lines)
**Change table source:** `docs/PURCHASE-CYCLE-DECISIONS.md` §2 (Architecture) + §7.3 (Migration status)

---

## Result: **FAIL**

3 discrepancies found. Per Phase-2 Execution Brief v1 §P1: "Any difference = FAIL."

---

## A. Change Table → Migration (forward check)

Each item in the change table vs its location in the migration:

| # | Change table item | In migration? | Location | Status |
|---|---|---|---|---|
| 1 | `parties.default_delivery_terms` (new column) | ⚠️ PARTIAL | Line 24: `default_terms` (not `default_delivery_terms`) | **DISCREPANCY #1** |
| 2 | `parties.default_damage_policy` (new column) | ✅ | Line 29 | PASS |
| 3 | `parties.default_terms_note` (not in change table, in migration) | ✅ extra | Line 25 | EXTRA (reasonable addition) |
| 4 | `orders.delivery_terms` (new column) | ✅ | Line 36 | PASS |
| 5 | `orders.delivery_terms_note` (new column) | ✅ | Line 37 | PASS |
| 6 | `orders.goods_received_by` moved to purchase_receipts | ✅ (not on orders) | Line 34 (comment) | PASS |
| 7 | `purchase_receipts` table | ✅ | Lines 42-65 | PASS |
| 8 | `purchase_receipts.received_by` (FK users) | ✅ | Line 54 | PASS |
| 9 | `purchase_receipts.inspected_by` (FK users) | ✅ | Line 55 | PASS |
| 10 | `purchase_receipts.external_inspector_name` (from OI-13) | ❌ | Not present (Step 0, separate migration) | **EXPECTED** — Step 0 handles this |
| 11 | `purchase_receipts.gl_journal_id` / `gl_kind` | ✅ (extra, reasonable) | Lines 62-63 | EXTRA (GL linkage) |
| 12 | `purchase_receipts.branch_id` (GRNI dimension) | ✅ | Line 45 | PASS |
| 13 | `purchase_receipts.party_id` (GRNI dimension) | ✅ | Line 48 | PASS |
| 14 | `purchase_receipt_lines` table | ✅ | Lines 73-96 | PASS |
| 15 | `purchase_rejections` table | ✅ | Lines 101-113 | PASS |
| 16 | `supplier_claims` table | ✅ | Lines 119-137 | PASS |
| 17 | `supplier_advances` table | ✅ | Lines 142-160 | PASS |
| 18 | `supplier_payment_allocations` table | ✅ | Lines 165-173 | PASS |
| 19 | `purchase_invoice_links` table | ✅ | Lines 178-189 | PASS |
| 20 | `purchase_match_overrides` table | ✅ | Lines 194-202 | PASS |
| 21 | `v_open_purchase_lines` view | ❌ | Not present | **DISCREPANCY #2** |
| 22 | No quarantine account/columns (OI-4 closed) | ✅ | No quarantine anywhere | PASS |
| 23 | No `orders.goods_received_by`/`goods_received_at` | ✅ | Not on orders | PASS |
| 24 | `grni_account_id` + party/branch dimension notes | ⚠️ PARTIAL | Comments present (lines 45, 48), no `grni_account_id` column | **DISCREPANCY #3** |
| 25 | Seed accounts: GRNI (2105), Supplier Advances (1107/1108), PPV | ✅ (comment) | Line 17-18, 207 | PASS (seed, not migration) |
| 26 | Everything additive; no changes to existing semantics | ✅ | All ALTERs use `IF NOT EXISTS` | PASS |

## B. Migration → Change Table (reverse check)

Elements in the migration with no corresponding change table item:

| Migration element | Source in change table? | Verdict |
|---|---|---|
| `parties.default_terms` (line 24) | ⚠️ Doc says `default_delivery_terms` (naming) | DISCREPANCY #1 |
| `parties.default_terms_note` (line 25) | Not in change table | EXTRA (reasonable addition) |
| `parties.default_damage_policy` (line 29) | ✅ §2, §7.3 | OK |
| `orders.delivery_terms` (line 36) | ✅ §2 | OK |
| `orders.delivery_terms_note` (line 37) | ✅ §2 | OK |
| `purchase_receipts` table (lines 42-65) | ✅ §2 | OK |
| `purchase_receipt_lines` table (lines 73-96) | ✅ §2 | OK |
| `purchase_rejections` table (lines 101-113) | ✅ §2 | OK |
| `supplier_claims` table (lines 119-137) | ✅ §2 | OK |
| `supplier_advances` table (lines 142-160) | ✅ §2 | OK |
| `supplier_payment_allocations` table (lines 165-173) | ✅ §2 | OK |
| `purchase_invoice_links` table (lines 178-189) | ✅ §2, §7.3 | OK |
| `purchase_match_overrides` table (lines 194-202) | ✅ §2 | OK |
| `gl_journal_id`/`gl_kind` on purchase_receipts | Not explicitly in change table | EXTRA (GL linkage, reasonable) |
| `received_by`/`inspected_by` on purchase_receipts | ✅ §7.3 (C-4) | OK |
| `branch_id`/`party_id` on purchase_receipts | ✅ §2 (GRNI dimensions) | OK |
| `cost_value` generated column on purchase_receipt_lines | Not explicitly in change table | EXTRA (reasonable) |
| `decision` column on purchase_rejections (default 6) | Not explicitly in change table | EXTRA (reasonable) |
| `status` columns with defaults | ✅ §2 | OK |
| Indexes (all) | Not explicitly in change table | EXTRA (standard practice) |
| `UNIQUE` constraints | Not explicitly in change table | EXTRA (standard practice) |

## C. Discrepancy Details

### DISCREPANCY #1: `default_terms` vs `default_delivery_terms`
- **Change table (§2):** `parties.default_delivery_terms` (new column)
- **Migration (line 24):** `ALTER TABLE parties ADD COLUMN IF NOT EXISTS default_terms varchar(40);`
- **Nature:** Naming discrepancy. Same column, different name.
- **Impact:** Low — functional, but name mismatch means code/doc references `default_delivery_terms` while DB has `default_terms`.
- **Possible cause:** Shortened name during authoring.
- **Recommendation:** Align — either rename migration to `default_delivery_terms` or update doc to `default_terms`. Recommend `default_delivery_terms` (matches doc intent).

### DISCREPANCY #2: `v_open_purchase_lines` view missing
- **Change table (§2):** `v_open_purchase_lines` view listed as schema addition.
- **Migration:** No `CREATE VIEW` statement.
- **Nature:** Genuine gap — view not created.
- **Impact:** Medium — view provides "open purchase lines" for reporting. Not blocking for Phase-2 core (GRN/Invoice/Settlement), but needed for reports.
- **Recommendation:** Add `CREATE VIEW IF NOT EXISTS v_open_purchase_lines AS ...` to migration or a separate migration. Can be deferred to Phase-2 reports step.

### DISCREPANCY #3: `grni_account_id` column missing on `purchase_receipts`
- **Change table (§7.3):** "Add `grni_account_id` + party/branch dimension notes (account created via seed, not in migration)."
- **Migration:** No `grni_account_id` column. Has `gl_journal_id` and `gl_kind` (GL linkage), plus comments about party/branch dimensions.
- **Nature:** The accountant said "account created via seed, not in migration" — meaning the GRNI *account* is created via seed. But the `grni_account_id` *column* on `purchase_receipts` was requested. The migration has `gl_journal_id` (FK to gl_journals) which serves the same purpose (linking to the GL journal that posted GRNI). The `grni_account_id` column might be redundant since gl_mappings already maps GRNI → account.
- **Impact:** Low — `gl_journal_id` provides GL linkage. `grni_account_id` would be redundant with gl_mappings.
- **Possible cause:** Intentional — gl_mappings + gl_journal_id suffice; separate column unnecessary.
- **Recommendation:** Clarify with accountant: is `grni_account_id` on `purchase_receipts` needed, or does `gl_journal_id` + gl_mappings suffice? If needed, add column. If not, remove from §7.3.

## D. Extra Elements in Migration (not in change table)

| Element | Verdict |
|---|---|
| `parties.default_terms_note` (line 25) | Reasonable addition — notes for delivery terms. No objection. |
| `gl_journal_id`/`gl_kind` on purchase_receipts (lines 62-63) | Reasonable — GL linkage. No objection. |
| `cost_value` generated column on purchase_receipt_lines (line 88) | Reasonable — computed accepted_qty × unit_cost. No objection. |
| `decision` column on purchase_rejections (line 106, default 6) | Reasonable — audit trail. No objection. |
| Indexes (all) | Standard practice. No objection. |
| `UNIQUE` constraints | Standard practice. No objection. |

## E. Additional Observations

1. **`purchase_rejections.decision` values:** Migration comment says "1 replace, 2 accept-with-discount, 3 return+claim, 4 scrap, 5 pending, 6 pending decision (default)." Values 5 and 6 both seem to mean "pending." Minor inconsistency in own comments, not in doc. No functional impact.

2. **`supplier_advances.branch_id` is `integer NULL` without FK.** Doc says "no branch dimension" for advances. Having a nullable branch_id without FK is reasonable (optional branch reference). No objection.

3. **`supplier_advances.UNIQUE (branch_id, advance_no)`:** In PostgreSQL, NULLs are not considered equal, so multiple advances with NULL branch_id and same advance_no would be allowed. This is standard PostgreSQL behavior. If strict uniqueness is needed, use a partial unique index. Minor.

4. **`purchase_receipts.party_id` is nullable.** Doc says party (supplier) is a GRNI dimension. Having it nullable allows GRNs without a supplier (e.g., opening stock, internal). Reasonable. No objection.

5. **`purchase_receipts.order_id` is nullable.** Allows GRN without PO. Reasonable (invoice-first flow, opening stock). No objection.

6. **No `external_inspector_name` column** — expected, as OI-13 is Step 0 (separate migration). Not a discrepancy.

## F. Summary

| Metric | Value |
|---|---|
| Change table items checked | 26 |
| Migration elements checked (reverse) | 20+ |
| PASS | 23 |
| DISCREPANCY | 3 (all low-impact) |
| EXTRA (reasonable) | 6 |
| EXPECTED (Step 0) | 1 |

### Discrepancies requiring resolution before P2:

| # | Discrepancy | Impact | Recommendation |
|---|---|---|---|
| 1 | `default_terms` vs `default_delivery_terms` naming | Low | Align names (recommend `default_delivery_terms` to match doc) |
| 2 | `v_open_purchase_lines` view missing | Medium | Add to migration or defer to Phase-2 reports step |
| 3 | `grni_account_id` column missing on `purchase_receipts` | Low | Clarify: needed, or does `gl_journal_id` + gl_mappings suffice? |

### Result: **FAIL**

Per Phase-2 Execution Brief v1 §P1: "Any difference = FAIL."

3 discrepancies found. 2 are naming/possibly-intentional. 1 is a genuine gap (missing view).

---

## G. Escalation

Per the brief's escalation protocol:

```
تصعيد #1
- البند: P1
- السيناريو: Verification of migration vs change table
- التعليمات الحالية: P1 §1-5 (read migration, read change table, produce comparison, check reverse, output PASS/FAIL)
- التباس: 3 discrepancies found (naming, missing view, missing column)
- الخيارات المقترحة:
  A) Fix all 3 discrepancies in migration before P2 (rename column, add view, add grni_account_id)
  B) Clarify which discrepancies are intentional (grni_account_id possibly redundant with gl_mappings; default_terms possibly intended shorter name) and fix only the genuine gap (v_open_purchase_lines)
  C) Accept all as-is (grni_account_id not needed, default_terms is the intended name, view deferred)
- توصية المنفّذ: Option B — clarify #1 and #3 (likely intentional), fix #2 (genuine gap)
- ما هو معطّل حتى الرد: P2 (Step 0), P3 (accounts), B1-B4 (build) — all blocked until P1 resolves
```

**No P2. No P3. No build. No DB. No commit. No push.**

Awaiting your decision on the 3 discrepancies.