# TD-53/54 — Phase 1 Report v2 (Foundations) — COMPLETED

**التاريخ:** 2026-11-28 · **القرار:** تصعيد #1 مقبول — (أ) allowlist append-only.
**الحكم:** **6/6 PASS** ✅ (P1-01, 02, 02b, 03, 04, 05-revised, 06).

---

## P1-01 — Claim Receivable account (TD-67 ✅)

```
SELECT code, account_id, account_type FROM gl_accounts WHERE code='2108'
→ [{"code":"2108","account_id":16,"account_type":1}]
SELECT account_id FROM gl_mappings WHERE mapping_key='SUPPLIER_CLAIM_RECEIVABLE'
→ [{"account_id":16}]
```
- قبل الجدولة: `SELECT code FROM gl_accounts WHERE code IN ('2107','2108','2109')` → `2108/2109` كانا حرًّا → استُخدم **2108** (لا تصعيد).
- `seed.ts` متطابق: `{ code:'2108', name:'ذمم مطالبات الموردين', type:1, mapping:'SUPPLIER_CLAIM_RECEIVABLE', parent:'21' }`.
- Migration: `db/migrations/2026-11-28-td53-claim-receivable-account.sql`.

## P1-02 + P1-03 — helpers + unit tests

`apps/api/src/modules/purchases/supplier-claims.helper.ts` (جديد):
- `postSupplierClaimJournal(client, {branchId,supplierId,claimId,amount,description})`
- `reverseSupplierVat(client, {branchId,supplierId,supplierInvoiceId,vatAmount,description})`

`tools/verify-td53-phase1.js` → **RESULT 7/7**:
```
PASS | P1-02 journal balanced + source | {"d":"100.00","c":"100.00","t":"supplier_claim","id":"1"}
PASS | P1-02 Dr/Cr accounts | 1104 Cr 100.00 / 2108 Dr 100.00
PASS | P1-03 journal balanced + source | {"d":"14.00","c":"14.00","t":"supplier_vat_reversal","id":"2"}
PASS | P1-03 Dr/Cr accounts | 1105 Cr 14.00 / 2101 Dr 14.00
PASS | P1-02b bogus source rejected | لا يمكن إنشاء قيد يدوي على حساب تحكّمي: المخزون (1104)
```
كل اختبار داخل transaction مع `ROLLBACK` — لا بيانات دائمة.

## P1-04 — Planned audit actions ✅

`docs/ERP-ACCOUNTING-DECISIONS.md §1.10.1` — جدول «Planned audit actions»:
`supplier.claim.create` (Ph3) · `supplier.claim.settle` (Ph4) · `supplier.claim.reverse` (Ph4) · `purchase.credit_note.post` (Ph2).

## P1-05 (revised) — posting.ts configuration ✅

```
git diff --numstat -- posting.ts  →  2  0   (2 insertions, 0 deletions)
git diff -- posting.ts:
+    // TD-53/54 P1 — supplier claims & VAT reversal (DEC-PURCH-027 v2) post to control accounts.
+    'supplier_claim', 'supplier_vat_reversal',
```
- `is_control && !AUTOMATED_SOURCES.has(...)` — **لم يتغير**.
- `assertPeriodOpen`, توازن Dr=Cr — **لم يتغيرا**.
- **default-deny ما زال قائمًا** (P1-02b: `bogus_test_type` مرفوض).
- TD-69 مسجّل + `POSTING-CONFIG-RULE.md` يوثّق «configuration append-only، logic immutable».

## P1-06 — Regression

**B1..B5.4 = 115/115** (14+15+8+6+16+17+9+24+6، `BAD=0`) · **smoke = 606/606** (`SMOKE_EXIT=0`) على قاعدة نظيفة :5666 / API :4068.

---

## Deviations
لا انحرافات. التعديل الوحيد على `posting.ts` = 2 سطرallowlist (مصرّح به صراحةً في P1-05 revised / TD-69).

## الحكم
**Phase 1 = PASS 6/6.** TD-67 وTD-68 مغلقان · TD-69 مسجّل. **Phase 2 جاهز للـ Go.**
