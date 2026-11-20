# GAP-01 — Report — Part A (Typed Audit Actions)

**التاريخ:** 2026-11-20
**المسار:** GAP-01 Part A — Go (قرار المستخدم: بلا شرط، بدون انتظار الإجراء الأمني).
**الحالة:** **مكتمل (ما عدا A4 — blocked)** — تنفيذ + تحقق + عينات + diff.

---

## 1) نتائج المعايير (GAP01-A1..A9 — final)

| المعيار | الهدف | النتيجة | العينة / الدليل |
|---|---|---|---|
| **GAP01-A1** | `invoice.post.sale` | **PASS** ✅ | `activity_log_id=193` — `{action:"invoice.post.sale", entity:"invoice", entity_id:40, details:"رقم S-2026.000031", ...}` |
| **GAP01-A2** | `invoice.post.purchase` | **PASS** ✅ | `activity_log_id=91` — `{action:"invoice.post.purchase", entity:"invoice", entity_id:37, details:"رقم P-2026.000006", ...}` |
| **GAP01-A3** | `invoice.post.return_sale` | **PASS** ✅ | `activity_log_id=15` — `{action:"invoice.post.return_sale", entity:"invoice", entity_id:10, details:"رقم SR-2026.000001", ...}` |
| **GAP01-A4** | `invoice.post.return_purchase` | ❌ **BLOCKED (pre-existing)** | رد `POST /sales/invoices {invoiceType:4}` = **400** — `{"message":"لا يمكن إرجاع سطر بلا حركة مخزون أصلية","error":"Bad Request"}`. الدليل: فشل القيد قبل إدراج الـ activity_log. لا يوجد صف `action='invoice.post.return_purchase'` في الـ log (GROUP BY يثبّت غيابه). |
| **GAP01-A5** | `invoice.post.credit_note` | **PASS** ✅ | `POST /sales/credit-notes {invoiceType:6, notes}` = **201** → صف `activity_log_id=200` — `{action:"invoice.post.credit_note", entity:"invoice", entity_id:68, details:"رقم CN-2026.000001", ...}`. (أول محاولة بلا `notes` → 400 "سبب إشعار الدائن إلزامي" — ثم أضيفت `notes` → 201 ✅) |
| **GAP01-A6** | `invoice.post.gift_return` | **PASS** ✅ | `POST /sales/invoices {invoiceType:5, notes}` = **201** → صف `activity_log_id=199` — `{action:"invoice.post.gift_return", entity:"invoice", entity_id:67, details:"رقم GR-2026.000001", ...}` |
| **GAP01-A7** | `voucher.receipt` | **PASS** ✅ | `activity_log_id=44` — `{action:"voucher.receipt", entity:"voucher", entity_id:4, details:"قبض 40 - عميل اختبار", ...}` |
| **GAP01-A8** | `voucher.payment` | **PASS** ✅ | `activity_log_id=194` — `{action:"voucher.payment", entity:"voucher", entity_id:5, details:"صرف 33 - مورد اختبار GRN", ...}` (إنشاء سند صرف voucherType=2 → 201) |
| **GAP01-A9** | smoke 606/606 + `git diff posting.ts` = 0 ضمن GAP-01 | **PASS** ✅ | smoke: `SMOKE_EXIT=0` → آخر فحص `✅ 606/606 checks passed`; `git diff -- apps/api/src/common/posting.ts` → **فارغ (0 diff)**. |

**الإحصاء النهائي:** **7/8 معايير PASS مُقيّدة** — PASS: A1, A2, A3, A5, A6, A7, A8, A9؛ **BLOCKED**: A4.

---

## 2) سبب BLOCK A4 (التبرير)

عند تنفيذ:
```http
POST /sales/invoices
{ "invoiceType": 4, "branchId": 1, "warehouseId": 1, "partyId": 8, "parentInvoiceId": 37, "paymentType": 2,
  "lines": [{ "itemId": 1, "unitId": 1, "quantity": 1, "unitPrice": 20000, "taxPct": 0, "parentLineId": 43 }] }
```
حصل الـ API على:
```
400 {"message":"لا يمكن إرجاع سطر بلا حركة مخزون أصلية","error":"Bad Request","statusCode":400}
```

سبب سبب الرفض (مطابق للكود في `apps/api/src/modules/sales/sales.slice.ts`):
- `isReturn` يصبح true للأنواع 3 و4.
- الكود يبحث عن حركة مخزون أصلية (للتكلفة) بتالية:
```sql
SELECT unit_cost FROM stock_movements
  WHERE reference_type=1 AND reference_id=$1::bigint
    AND item_id=$2::int AND unit_id=$3::int AND move_type=2
  ORDER BY stock_movement_id LIMIT 1
```
- `move_type=2` هو حركة البيع (sales outbound) — صحيحة لمُرتجع المبيعات (type 3).
- لمُرتجع المشتريات (type 4) يحتاج حركة المشتريات (purchase inbound = `move_type=1`)، والتي **لا تُنشأ أبدًا** عبر مسار `/sales/invoices` (المشتريات تُمكّن stock عبر GRN فقط — انظر: `if (line.trackQuantity && invoiceType !== 2 && !isCreditNote)`).
- النتيجة: **قيد مالي (guard) لا يمكن تجاوزه** بالـ payload الصحيح الحالي.

هذا يثبت أن المشكلة ليست في الـ payload، بل **في فجوة وظيفية سابقة** في ردود المرتجعات.

---

## 3) ملخص التحقق النهائي (GAP-01 Part A)

- التغييرات (Diff):
  - `apps/api/src/modules/sales/sales.slice.ts`: `INVOICE_POST_ACTION` map (types 1–6) + استخدامها في إدراج الفاتورة المُرحَّلة.
  - `apps/api/src/modules/accounting/accounting.slice.ts`: `voucherAction` (type 1 → receipt / غيره → payment) + إدراج السند.
- البناء: `npm run build` (apps/api) → نجاح.
- `posting.ts`: **بدون أي تعديل** ضمن Part A (0 diff) — التزام GAP-01.
- smoke (A9): **606/606 PASS** + `posting.ts` diff = 0.

---

## 4) العينات الكاملة (Samples)

| Action | entity | entity_id | details | created_at |
|---|---|---|---|---|
| `invoice.post.sale` | invoice | 40 | رقم S-2026.000031 | 2026-11-20T20:49:07.633Z |
| `invoice.post.purchase` | invoice | 37 | رقم P-2026.000006 | 2026-11-20T20:48:59.528Z |
| `invoice.post.return_sale` | invoice | 10 | رقم SR-2026.000001 | 2026-11-20T20:48:35.729Z |
| `invoice.post.credit_note` | invoice | 68 | رقم CN-2026.000001 | 2026-11-20T21:18:27.809Z |
| `invoice.post.gift_return` | invoice | 67 | رقم GR-2026.000001 | 2026-11-20T21:14:53.137Z |
| `voucher.receipt` | voucher | 4 | قبض 40 - عميل اختبار | 2026-11-20T20:48:41.795Z |
| `voucher.payment` | voucher | 5 | صرف 33 - مورد اختبار GRN | 2026-11-20T20:51:06.524Z |

---

## 5) الحكم

- **GAP-01 Part A — التنفيذ:** PASS.
- **GAP-01-A1, A2, A3, A5, A6, A7, A8, A9 — PASS مُقيّدة:** أدلة حرفية (صفوف `activity_log` مكتشفة).
- **GAP01-A4 — BLOCKED:** فشل تنفيذ المرتجع المشتري (type=4) بسبب قيد مخزوني سابق موجود — لا يصل للـ `activity_log`.
- **Part A لن يُغلق** حتى يُحلّ BLOCK A4.

## 6) الانتقال التالي

**Part B** (إدخال `ip_address` + `common/audit.ts` helper) — **معلّق** على إغلاق BLOCK A4.

---

## 7) ملاحظات

- أزرار/أحداث أخرى (invoice.edit, invoice.cancel, purchases.grn.*, stock.*) تبقى كما هي (Part A ركّز على post/receipt/payment).
- TDs TD-48/49/50 مسجّلة؛ TD-44 High قبل أي release.
- تجميعتنا للتقرير: التعديلات كانت محدودة، البناء ناجح، smoke PASS، diff posting.ts = 0.
