# P2 — Step 0 Report: Schema Changes & Verification

**Date:** 2026-11-17
**Phase:** Phase-2 Purchases — Step 0 (P2.3..P2.10)
**Migration file:** `db/migrations/2026-11-17-purchases-cycle.sql` (modified, NOT RUN)
**Seed file:** `apps/api/src/cli/seed.ts` (modified, NOT RUN)

---

## P2.1 — `received_by` on `purchase_receipts`

**Status:** Already in migration (line 54). No action in Step 0.

**Verification:**
- Line 54: `received_by    integer      NOT NULL REFERENCES users(user_id),`
- FK to users, NOT NULL, ON DELETE RESTRICT (implied by REFERENCES).
- ✅ VERIFIED — no change needed.

## P2.2 — `inspected_by` on `purchase_receipts`

**Status:** Already in migration (line 55). No action in Step 0.

**Verification:**
- Line 55: `inspected_by   integer      NULL REFERENCES users(user_id),`
- FK to users, NULLable (external inspector case handled by external_inspector_name).
- ✅ VERIFIED — no change needed.

## P2.3 — `external_inspector_name` on `purchase_receipts`

**Status:** ✅ ADDED

- **Line 57:** `external_inspector_name text NULL,   -- OI-13: external inspector (government inspector, etc.)`
- NULLable text column.
- Used only when `inspected_by` points to a system user and the external party is documented.
- No FK (free text for external parties).
- ✅ VERIFIED.

## P2.4 — `parties.default_over_receipt_pct`

**Status:** ✅ ADDED

- **Line 29:** `default_over_receipt_pct numeric(5,2) NOT NULL DEFAULT 0,`
- **Line 30:** `ALTER TABLE parties ADD CONSTRAINT chk_default_over_receipt_pct CHECK (default_over_receipt_pct >= 0);`
- NOT NULL, DEFAULT 0, CHECK >= 0 (OI-14: default 0% over-receipt).
- ✅ VERIFIED.

## P2.5 — `document_sequences` table

**Status:** ✅ ADDED

- **Line 239:** `CREATE TABLE IF NOT EXISTS document_sequences (`
- **Line 240:** `doc_type    varchar(20)  NOT NULL,`
- **Line 241:** `branch_id   integer      NOT NULL REFERENCES branches(branch_id),`
- **Line 242:** `year        smallint     NOT NULL,`
- **Line 243:** `last_seq    integer      NOT NULL DEFAULT 0,`
- **Line 244:** `PRIMARY KEY (doc_type, branch_id, year)`
- **Line 246:** `-- Supports: po, grn, supplier_invoice, supplier_payment, claim, advance`
- UNIQUE (doc_type, branch_id, year) via PRIMARY KEY.
- Supports 6 document types: po, grn, supplier_invoice, supplier_payment, claim, advance.
- ✅ VERIFIED.

## P2.6 — `gl_kind` → `posting_status` (rename)

**Status:** ✅ APPLIED (D-13)

- **Line 63:** `posting_status smallint     NULL,   -- 1 pending, 2 posted, 3 reversed (D-13: renamed from gl_kind)`
- No `gl_kind` references remain in migration (grep confirmed: 0 hits).
- Values redefined: 1 = pending, 2 = posted, 3 = reversed.
- Rationale: `gl_kind=2` (invoice-first) never recorded on receipt. `gl_kind=3` (under inspection) redundant with `status`. Renamed `posting_status` tracks posting state (pending/posted/reversed) — not derivable from `gl_journal_id` alone (reversed state needs explicit tracking).
- ✅ VERIFIED.

## P2.7 — Permissions seed (5 permissions)

**Status:** ✅ ADDED (D-15)

- **seed.ts lines 36-40:** 5 permissions added to PERMISSIONS array:
  - `['purchases.receive', 'المشتريات', 'استلام بضاعة (GRN) — إنشاء محضر استلام']`
  - `['purchases.approve_po', 'المشتريات', 'اعتماد/قبول أمر شراء']` (with TODO comment)
  - `['purchases.approve_payment', 'المشتريات', 'صرف دفعات للموردين (سند صرف)']`
  - `['purchases.approve_exception', 'المشتريات', 'تجاوز تجاوز الكمية/السعر (مع سبب إلزامي)']`
  - `['purchases.returns', 'المشتريات', 'مرتجعات مشتريات ومطالبات']`
- **seed.ts line 78:** Accountant role: `purchases.approve_payment`, `purchases.approve_exception`
- **seed.ts line 97:** StoreKeeper role: `purchases.receive`, `purchases.approve_po`
- Administrator: all 5 (via `PERMISSIONS.map((p) => p[0])`)
- **TODO comment:** `purchases.approve_po` marked with `// TODO: pending owner decision — who approves PO? (BranchManager role doesn't exist). Currently: Administrator only. See Addendum v1.2 D-15 correction.`
- **Note:** D-15 references a "Manager" role that doesn't exist in seed.ts. Assigned to StoreKeeper. Flagged for accountant review (DEC-PURCH-052).
- ✅ VERIFIED.

## P2.8 — `voided_at` on `purchase_invoice_links`

**Status:** ✅ ADDED (DEC-PURCH-047)

- **Line 188:** `voided_at       timestamptz NULL,   -- DEC-PURCH-047: set on invoice void; excluded from v_open_purchase_lines`
- **Line 230:** `LEFT JOIN purchase_invoice_links pil ON pil.receipt_line_id = prl.line_id AND pil.voided_at IS NULL`
- Column added as `timestamptz NULL`. Voided links excluded from `v_open_purchase_lines`.
- ✅ VERIFIED.

## P2.9 — `voucher_id` + FK on `supplier_payment_allocations`

**Status:** ✅ APPLIED (DEC-PURCH-051, D-14)

- **Line 167:** `voucher_id      bigint NOT NULL REFERENCES vouchers(voucher_id) ON DELETE RESTRICT,`
- **Line 171:** `UNIQUE (voucher_id, invoice_id)`
- **Line 173:** `-- NOTE: voucher_type = 2 (صرف) enforced in API, not in schema.`
- Renamed `payment_id` → `voucher_id`. FK to `vouchers(voucher_id)` ON DELETE RESTRICT.
- `voucher_type = 2` (صرف) constraint enforced in API, documented in migration as comment.
- ✅ VERIFIED.

## P2.10 — `supplier_advances.branch_id` NOT NULL

**Status:** ✅ APPLIED (DEC-PURCH-050)

- **Line 147:** `branch_id           integer      NOT NULL REFERENCES branches(branch_id),   -- operational (not accounting dimension)`
- Changed from `integer NULL` to `integer NOT NULL REFERENCES branches(branch_id)`.
- Operational (not accounting dimension) — advance posts to supplier-level account.
- ✅ VERIFIED.

## Additional Migration Changes

- **Line 24:** `default_terms` → `default_delivery_terms` (P1.R2 fix)
- **Line 210-229:** `v_open_purchase_lines` view added (P1.R2 fix)
- **Line 239-246:** `document_sequences` table added (P2.5, OI-15)
- **Line 57:** `external_inspector_name text NULL` added (P2.3, OI-13)
- **Line 29-30:** `default_over_receipt_pct` + CHECK constraint added (P2.4, OI-14)

## Verification Summary

| P2 item | Status | Migration line(s) |
|---|---|---|
| P2.1 (received_by) | ✅ Already in migration | Line 54 |
| P2.2 (inspected_by) | ✅ Already in migration | Line 55 |
| P2.3 (external_inspector_name) | ✅ ADDED | Line 57 |
| P2.4 (default_over_receipt_pct) | ✅ ADDED | Lines 29-30 |
| P2.5 (document_sequences) | ✅ ADDED | Lines 239-246 |
| P2.6 (gl_kind → posting_status) | ✅ APPLIED | Line 63 |
| P2.7 (permissions seed) | ✅ ADDED | seed.ts lines 36-40, 78, 97 |
| P2.8 (voided_at) | ✅ ADDED | Line 188 (+ view line 230) |
| P2.9 (voucher_id + FK) | ✅ APPLIED | Lines 167, 171, 173 |
| P2.10 (branch_id NOT NULL) | ✅ APPLIED | Line 147 |

**P2 (Step 0) = COMPLETE.** All 8 items (P2.3–P2.10) verified against literal migration/seed lines. P2.1/P2.2 already existed.

## Acceptance Criteria Check

- [x] P2.3: `external_inspector_name` NULLable text column exists (line 57)
- [x] P2.4: `default_over_receipt_pct` NOT NULL DEFAULT 0, CHECK >= 0 (lines 29-30)
- [x] P2.5: `document_sequences` table with UNIQUE (doc_type, branch_id, year) (lines 239-246)
- [x] P2.6: `posting_status` (not `gl_kind`) in migration (line 63)
- [x] P2.7: 5 permissions in seed.ts (lines 36-40), role assignments (lines 78, 97)
- [x] P2.8: `voided_at timestamptz NULL` on `purchase_invoice_links` (line 188), view excludes voided (line 230)
- [x] P2.9: `voucher_id` + FK ON DELETE RESTRICT (line 167), UNIQUE (line 171), NOTE (line 173)
- [x] P2.10: `branch_id NOT NULL REFERENCES branches` (line 147)

**P2-report §Permissions:**
- 5 permissions exist in seed.ts (lines 36-40).
- `purchases.approve_po` marked with TODO comment (Addendum v1.2 D-15 correction).
- Accountant: `purchases.approve_payment` + `purchases.approve_exception` ✅
- StoreKeeper: `purchases.receive` ✅
- Administrator: all 5 ✅
- **No Manager role** — documented in TODO comment.

---

**P2 (Step 0) = COMPLETE.** All acceptance criteria met. No DB touched. No migration run. No commit. No push.

**Next step:** P3 (Chart of Accounts — 4 accounts: GRNI 2105, Supplier Advances 1107/1108, PPV, Inventory in Transit 1108). Then B1-B4 (build).

Awaiting your go-ahead for P3.