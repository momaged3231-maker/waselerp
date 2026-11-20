# P1 — Extra Items Documentation

**Date:** 2026-11-17
**Migration file:** `db/migrations/2026-11-17-purchases-cycle.sql`
**Source:** P1 verification report §B (reverse check)

---

## 6 EXTRA items (in migration, not in change table)

These items were added to the migration without an explicit entry in the change table (docs/PURCHASE-CYCLE-DECISIONS.md §2 or §7.3). Each is documented below.

| # | Item | Location (line) | Purpose | Who added | Necessary vs Optional | Verdict |
|---|---|---|---|---|---|---|
| E-1 | `parties.default_terms_note` (text) | Line 25 | Notes field for delivery terms (free-text clarification of Incoterm, e.g., "FOB shipping point, buyer pays freight") | Implementation agent (during migration authoring) | **Optional** — but reasonable; delivery terms without notes is limiting | ✅ Keep |
| E-2 | `gl_journal_id` + `gl_kind` on `purchase_receipts` | Lines 62-63 | GL linkage: `gl_journal_id` FK to `gl_journals`, `gl_kind` (1=GRNI posted, 2=invoice-first path, 3=under inspection). Populated by the engine, never by UI. | Implementation agent (during migration authoring) | **Necessary** — without GL linkage, GRN cannot be traced to its journal entry. Mirrors `invoices.gl_journal_id` pattern. | ✅ Keep |
| E-3 | `cost_value` generated column on `purchase_receipt_lines` | Line 88 | Computed `accepted_qty * unit_cost` STORED. Provides line-level cost value without runtime calculation. | Implementation agent (during migration authoring) | **Optional** — but useful for reporting and audit. Could be computed at query time. | ✅ Keep |
| E-4 | `decision` column on `purchase_rejections` (smallint, default 6) | Line 106 | Audit trail: records the disposition decision (1=replace, 2=accept-with-discount, 3=return+claim, 4=scrap, 5=pending, 6=pending decision default). | Implementation agent (during migration authoring) | **Necessary** — rejection without disposition is an untracked liability. Audit requirement. | ✅ Keep |
| E-5 | Indexes (all) | Various | Performance: FK lookups, branch/party filtering, receipt line retrieval. | Implementation agent (standard practice) | **Optional** — but standard practice. Without indexes, queries on large tables will be slow. | ✅ Keep |
| E-6 | `UNIQUE` constraints | Various | Data integrity: `UNIQUE (branch_id, receipt_no)`, `UNIQUE (receipt_id, line_no)`, `UNIQUE (payment_id, invoice_id)`, etc. | Implementation agent (standard practice) | **Necessary** — prevents duplicate receipts, duplicate lines, duplicate allocations. | ✅ Keep |

---

## Summary

All 6 EXTRA items are **reasonable additions** that follow standard practice. None contradict the design. None introduce new concepts not covered by the decisions. None are blocking.

**Recommendation:** Keep all 6. Document them here (done). No further action needed.

---

## Additional migration elements not in §7.3 change table (but in §2 Architecture)

These are in the migration and in §2 (Architecture) of the purchases doc, but not in §7.3 (Migration status checklist):

| Element | In §2 Architecture? | In §7.3? | In migration? | Verdict |
|---|---|---|---|---|
| `purchase_rejections` table | Not listed in §2 | Not listed | ✅ Yes (lines 101-113) | Reasonable — audit trail for rejections. Keep. |
| `supplier_claims` table | Listed as `purchase_claims` | Not listed | ✅ Yes (lines 119-137) | Naming difference: `purchase_claims` (doc) vs `supplier_claims` (migration). `supplier_` is more specific. Keep, note naming. |
| `supplier_advances` table | Listed as `purchase_advances` | Not listed | ✅ Yes (lines 142-160) | Naming difference: `purchase_advances` (doc) vs `supplier_advances` (migration). `supplier_` is more specific. Keep, note naming. |
| `supplier_payment_allocations` table | Not listed in §2 | Not listed | ✅ Yes (lines 165-173) | Reasonable — payment-to-invoice allocation. Keep. |
| `purchase_match_overrides` table | Not listed in §2 | Not listed | ✅ Yes (lines 194-202) | Reasonable — three-way match overrides. Keep. |
| `purchase_invoice_links` table | ✅ Listed in §2 | ✅ Listed in §7.3 | ✅ Yes (lines 178-189) | PASS. |
| `parties.default_damage_policy` | ✅ Listed in §2 | ✅ Listed in §7.3 | ✅ Yes (line 29) | PASS. |
| `orders.delivery_terms` / `delivery_terms_note` | ✅ Listed in §2 | Not listed in §7.3 | ✅ Yes (lines 36-37) | In §2, not §7.3. OK. |
| `v_open_purchase_lines` view | ✅ Listed in §2 | Not listed in §7.3 | ❌ Not in migration (added in P1.R2) | FIXED in P1.R2. |
| `grni_account_id` column | Not listed in §2 | Listed in §7.3 | ❌ Not in migration | RESOLVED: not needed (gl_mappings suffices). |
| `external_inspector_name` column | Not listed in §2 | Not listed | ❌ Not in migration | EXPECTED: Step 0 (separate migration). |

---

## Naming differences (doc vs migration)

| Doc name | Migration name | Verdict |
|---|---|---|
| `parties.default_delivery_terms` | `parties.default_delivery_terms` (fixed in P1.R2) | ✅ Aligned |
| `purchase_claims` | `supplier_claims` | `supplier_` is more specific. Keep. Note in unified doc. |
| `purchase_advances` | `supplier_advances` | `supplier_` is more specific. Keep. Note in unified doc. |

---

**No migration run. No DB touched. No commit. No push.**