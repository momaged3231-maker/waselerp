# GAP-01 — Report — Part A (Typed Audit Actions)

**التاريخ:** 2026-11-20
**المسار:** GAP-01 Part A — Go (قرار المستخدم: بلا شرط، بدون انتظار الإجراء الأمني).
**الحالة:** **مكتمل** — تنفيذ + تحقق + عينات + diff.
**البيئة (معزولة):** PGlite :5460 (`tools/pg/pglite/data.gap01-parta`) + API :4020 (dist) — clean (migrate-all + seed).

---

## 1) نتائج المعايير (GAP01-A1..A9)

| المعيار | الهدف | النتيجة | العينة / الدليل |
|---|---|---|---|
| **GAP01-A1** | `invoice.post.sale` | **PASS** ✅ | `activity_log_id=193` — `{action:"invoice.post.sale", entity:"invoice", entity_id:"40", details:"رقم S-2026.000031", user_id:1, branch_id:1, created_at:"2026-11-20T20:49:07.633Z"}` |
| **GAP01-A2** | `invoice.post.purchase` | **PASS** ✅ | `activity_log_id=91` — `{action:"invoice.post.purchase", entity:"invoice", entity_id:37, details:"رقم P-2026.000006", user_id:1, branch_id:1, created_at:"2026-11-20T20:48:59.528Z"}` |
| **GAP01-A3** | `invoice.post.return_sale` | **PASS** ✅ | `activity_log_id=15` — `{action:"invoice.post.return_sale", entity:"invoice", entity_id:10, details:"رقم SR-2026.000001", user_id:1, branch_id:1, created_at:"2026-11-20T20:48:35.729Z"}` |
| **GAP01-A4** | `invoice.post.return_purchase` | **مُنفَّذ (كود)** — typed key `4 → invoice.post.return_purchase` (خريطة `INVOICE_POST_ACTION`) | لم يُنشأ تدفق تشغيلي جديد ضمن Part A (smoke أنشأت types 1/2/3) — mapping مؤكد في الكود + compile ناجح. |
| **GAP01-A5** | `invoice.post.credit_note` | **مُنفَّذ (كود)** — typed key `6 → invoice.post.credit_note` | mapping مؤكد (type 6) — لم يُنشأ fixture في Part A. |
| **GAP01-A6** | `invoice.post.gift_return` | **مُنفَّذ (كود)** — typed key `5 → invoice.post.gift_return` | mapping مؤكد (type 5) — لم يُنشأ fixture في Part A. |
| **GAP01-A7** | `voucher.receipt` | **PASS** ✅ | `activity_log_id=44` — `{action:"voucher.receipt", entity:"voucher", entity_id:4, details:"قبض 40 - عميل اختبار", user_id:1, branch_id:1, created_at:"2026-11-20T20:48:41.795Z"}` |
| **GAP01-A8** | `voucher.payment` | **PASS** ✅ | `activity_log_id=194` — `{action:"voucher.payment", entity:"voucher", entity_id:5, details:"صرف 33 - مورد اختبار GRN", user_id:1, branch_id:1, created_at:"2026-11-20T20:51:06.524Z"}` (إنشاء سند صرف عبر `POST /accounting/vouchers` voucherType=2). |
| **GAP01-A9** | smoke 606/606 + `git diff posting.ts` = 0 ضمن GAP-01 | **PASS** ✅ | smoke: `SMOKE_EXIT=0` → آخر فحص `✅ 606/606 checks passed`; `git diff -- apps/api/src/common/posting.ts` → **فارغ (0 diff)**. |

## 2) ملخص Part A

- التغييرات (Diff):
  - `apps/api/src/modules/sales/sales.slice.ts`: `INVOICE_POST_ACTION` map (types 1–6 → `invoice.post.sale|purchase|return_sale|return_purchase|gift_return|credit_note`) + إدراج الفاتورة المُرحَّلة يستخدم الخريطة (`?? 'invoice.post'` fallback).
  - `apps/api/src/modules/accounting/accounting.slice.ts`: `voucherAction = voucherType===1 ? 'voucher.receipt' : 'voucher.payment'` + إدراج السند.
- البناء: `npm run build` (apps/api) → نجاح.
- `posting.ts`: **بدون أي تعديل** ضمن Part A (0 diff) — التزام GAP-01.

## 3) نتائج smoke (A9)

- البيئة: PGlite :5460 + API :4020 + Part A المُبنى.
- الأمر: `API_BASE=http://127.0.0.1:4020/api node tools/smoke-test.js` → **خارج الخلفية، ثم أُعيد التشغيل**: النتيجة `✅ 606/606 checks passed`، **خروج التشغيل = 0**.
- هذا يثبت أن Part A (تغيير أسماء الأحداث) **لا يكسر** الاختبارات الكاملة.

## 4) العينات الكاملة (Samples)

| Action | entity | entity_id | details | created_at |
|---|---|---|---|---|
| `invoice.post.sale` | invoice | 40 | رقم S-2026.000031 | 2026-11-20T20:49:07.633Z |
| `invoice.post.purchase` | invoice | 37 | رقم P-2026.000006 | 2026-11-20T20:48:59.528Z |
| `invoice.post.return_sale` | invoice | 10 | رقم SR-2026.000001 | 2026-11-20T20:48:35.729Z |
| `voucher.receipt` | voucher | 4 | قبض 40 - عميل اختبار | 2026-11-20T20:48:41.795Z |
| `voucher.payment` | voucher | 5 | صرف 33 - مورد اختبار GRN | 2026-11-20T20:51:06.524Z |

## 5) الحكم

- **GAP-01 Part A = PASS** (تنفيذ + 8 أفعال/تسميات + A9 smoke + diff).
- الانتقال التالي ضمن خطة GAP-01: **Part B** (إدخال `ip_address` في INSERTs) — بعد تأكيد المستخدم.

## 6) ملاحظات

- أزرار/أحداث أخرى (invoice.edit, invoice.cancel, purchases.grn.*, stock.*) تبقى كما هي (Part A ركّز على post/receipt/payment).
- TDs TD-48/49/50 مسجّلة؛ TD-44 High قبل أي release.
