# GAP-01 — Report — Part B (Unified Audit Helper + IP Attribution)

**التاريخ:** 2026-11-21
**المسار:** Part B = Go (قرار المستخدم بعد إسقاط A4 كـ`out-of-scope` / TD-51).
**الحالة:** **PASS — 13/13 معيارًا** (B1..B11 + B12 + B13).

---

## 1) `common/audit.ts` — المسار والتوقيع

- **الملف:** `apps/api/src/common/audit.ts` (جديد).
- **التوقيع (ip إلزامي):**
```ts
export async function logActivity(client: PoolClient, params: {
  userId: number;
  branchId: number;
  action: string;
  entity: string;
  entityId: string | number;
  details?: string;
  ip: string;          // ← required — TypeScript يمنع النسيان
}): Promise<void>;
```
- **الإدراج:** `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details, ip_address) VALUES ($1::int,$2::int,$3::varchar,$4::varchar,$5::varchar,$6::text,$7::varchar)`.
- **B1 = PASS** ✅ (تحقق السكربت: `audit.ts loaded` + نمط `ip: string` موجود).

## 2) Controllers تمرر `req.ip`

النمط المطبّق في كل controller: `const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';`

| الملف | الـ endpoints المتأثرة |
|---|---|
| `apps/api/src/modules/sales/sales.slice.ts` | `POST /sales/invoices`, `PUT /sales/invoices/:id`, `POST /sales/invoices/:id/cancel`, `POST /sales/credit-notes`, `POST /sales/credit-notes/:id/cancel`, `POST /purchases/invoices`, `POST /purchases/invoices/:id/cancel` |
| `apps/api/src/modules/sales/pos.slice.ts` | `POST /pos/table-orders/:id/close` (يحوّل لفاتورة) |
| `apps/api/src/modules/sales/documents.slice.ts` | `POST /quotations/:id/convert`, `POST /orders/:id/convert` |
| `apps/api/src/modules/accounting/accounting.slice.ts` | `POST /accounting/journals`, `POST /accounting/vouchers` |
| `apps/api/src/modules/purchases/purchase-receipt.slice.ts` | `POST /purchases/receipts`, `POST /purchases/receipts/:id/reverse` |
| `apps/api/src/modules/inventory/stock-voucher.slice.ts` | `POST /stock-vouchers/:id/approve` |
| `apps/api/src/modules/inventory/stock-count.slice.ts` | `POST /stock-counts/:id/approve` |
| `apps/api/src/modules/inventory/inventory.slice.ts` | `POST /inventory/operations` |

**الـ 6 INSERTs المالية المُهاجَرة إلى الـ helper** (داخل transaction client، بلا `posting.ts`):

| # | الملف | Action | entity |
|---|---|---|---|
| 1 | sales.slice.ts | `invoice.post.*` (typed من Part A) | invoice |
| 2 | sales.slice.ts | `invoice.edit` (عبر `reverseForEdit`) | invoice |
| 3 | sales.slice.ts | `invoice.cancel` | invoice |
| 4 | accounting.slice.ts | `gl.journal.create` | gl_journal |
| 5 | accounting.slice.ts | `voucher.receipt|payment` | voucher |
| 6 | purchase-receipt.slice.ts | `purchases.grn.create` + `purchases.grn.reverse` | purchase_receipt |
| + | stock-voucher.slice.ts | `stock.voucher.approve` | stock_voucher |
| + | stock-count.slice.ts | `stock.count.approve` | stock_count |
| + | inventory.slice.ts | `stock.operation` | stock_operation |

## 3) B1..B11 — النتائج + عينات حرفية

**السكربت:** `tools/verify-gap01-partB.js` → **RESULT 15/15** (B1 + B0 login + B2..B11 مع B10/B11 مقسّمة).
**البيئة:** PGlite :5462 (نظيفة: migrate-all + seed) + API :4022 (dist).
**القيمة المطلوبة:** `ip_address` مملوء، ليس `NULL`، ليس فارغًا، وليس `'unknown'`.

| المعيار | العملية | الحكم | صف `activity_log` حرفي |
|---|---|---|---|
| **B1** | helper موجود بـ`ip` إلزامي | ✅ PASS | `apps/api/src/common/audit.ts` — `ip: string` + `ip_address` |
| **B2** | فاتورة بيع | ✅ PASS | `{activity_log_id:193, action:"invoice.post.sale", entity:"invoice", entity_id:"40", ip_address:"127.0.0.1", created_at:"2026-11-21T00:52:03.702Z"}` |
| **B3** | فاتورة شراء | ✅ PASS | `{id:91, action:"invoice.post.purchase", entity:"invoice", entity_id:"37", ip_address:"127.0.0.1", created_at:"2026-11-21T00:51:56.265Z"}` |
| **B4** | مرتجع بيع | ✅ PASS | `{id:15, action:"invoice.post.return_sale", entity:"invoice", entity_id:"10", ip_address:"127.0.0.1", created_at:"2026-11-21T00:51:42.420Z"}` |
| **B5** | CN | ✅ PASS | `{id:200, action:"invoice.post.credit_note", entity:"invoice", entity_id:"44", ip_address:"127.0.0.1", created_at:"2026-11-21T00:53:44.413Z"}` |
| **B6** | هدية عائدة | ✅ PASS | `{id:201, action:"invoice.post.gift_return", entity:"invoice", entity_id:"45", ip_address:"127.0.0.1", created_at:"2026-11-21T00:53:44.462Z"}` |
| **B7** | سند قبض | ✅ PASS | `{id:44, action:"voucher.receipt", entity:"voucher", entity_id:"4", ip_address:"127.0.0.1", created_at:"2026-11-21T00:51:46.829Z"}` |
| **B8** | سند صرف | ✅ PASS | `{id:205, action:"voucher.payment", entity:"voucher", entity_id:"5", ip_address:"127.0.0.1", created_at:"2026-11-21T00:53:44.696Z"}` |
| **B9** | قيد يدوي | ✅ PASS | `{id:95, action:"gl.journal.create", entity:"gl_journal", entity_id:"82", ip_address:"127.0.0.1", created_at:"2026-11-21T00:51:56.736Z"}` |
| **B10** | GRN + عكس GRN (صفّان) | ✅ PASS | `{id:203, action:"purchases.grn.create", entity:"purchase_receipt", entity_id:"5", ip_address:"127.0.0.1", ...}` + `{id:204, action:"purchases.grn.reverse", entity:"purchase_receipt", entity_id:"5", ip_address:"127.0.0.1", ...}` |
| **B11** | تسوية مخزون (3 مسارات) | ✅ PASS | `{id:16, action:"stock.operation", entity:"stock_operation", entity_id:"1", ip_address:"127.0.0.1", ...}` + `{id:81, action:"stock.voucher.approve", entity:"stock_voucher", entity_id:"11", ip_address:"127.0.0.1", ...}` + `{id:82, action:"stock.count.approve", entity:"stock_count", entity_id:"2", ip_address:"127.0.0.1", ...}` |

> **ملاحظة منهجية:** smoke يغطي B2/B3/B4/B7/B9/B10a/B11 كاملًا، لكنه لا ينشئ CN/هدية عائدة/سند صرف/عكس GRN؛ لذلك أنشأها `verify-gap01-partB.js` عبر API مباشرة (كلها أعادت **201**) قبل جلب الصفوف. لا توجد نتيجة «تم» بلا صف حرفي.

## 4) B12 — `git diff posting.ts`

```
$ git diff --stat -- apps/api/src/common/posting.ts
(فارغ — 0 سطر)
```
**B12 = PASS** ✅ — لم يُلمس `posting.ts` ضمن GAP-01 (لا Part A ولا Part B).

## 5) B13 — الانحدار على قاعدة نظيفة

| الحزمة | البيئة | النتيجة |
|---|---|---|
| B1 `test:purchases` | PGlite :5463 (migrate+seed) | **14/14 PASS** |
| B2 `test:purchases-invoice` | :5463 | **15/15 PASS** |
| B3 `test:purchases-match` | :5463 + API :4023 | **8/8 PASS** |
| B4 `test:purchases-statement` | :5463 + API :4023 | **6/6 PASS** |
| B5.1 `test:credit-limit` | :5463 + API :4023 | **16/16 PASS** |
| B5.2 `test:sales-return` | :5463 + API :4023 | **17/17 PASS** |
| B5.3 `test:sales-return-extra` | :5463 + API :4023 | **9/9 PASS** |
| B5.4 `test:sales-credit-note` | :5463 + API :4023 | **24/24 PASS** |
| Integration `test:sales-integration` | :5463 + API :4023 | **6/6 PASS** |
| **المجموع** | — | **115/115 PASS** |
| Smoke `tools/smoke-test.js` | PGlite :5462 (نظيفة) + API :4022 | **606/606 PASS** (`SMOKE_EXIT=0`) |

**B13 = PASS** ✅.

## 6) فحص smoke لنوع 4 (المطلوب في التقرير)

```
$ grep -n "invoiceType.*4|: 4|type=4|مرتجع شراء|إرجاع|return_purchase" tools/smoke-test.js
tools/smoke-test.js:2749:  disposalType: 4, ...     ← غير ذي صلة (نوع استبعاد أصل)
tools/smoke-test.js:3266:  orderType: 4,             ← غير ذي صلة (طلب طاولة)
```
**صفر نتائج ذات صلة** ✅ — لا يوجد أي اختبار يعتمد على `invoiceType=4`. لا حاجة لحذف أو تعليق (`// Deprecated (TD-51)`).

## 7) TDs

| البند | الحالة |
|---|---|
| **TD-49** (unified activity_log helper) | **أُغلق ✅** — `common/audit.ts` + 9 INSERTs مالية مهاجَرة + `ip` إلزامي في التوقيع. |
| **TD-51** (type=4 deprecated) | **مُسجّل ✅** — `ERP-GAP-REGISTER.md §4` + `docs/ERP-ACCOUNTING-DECISIONS.md §6`. لا يمنع Part B. |
| TD-44 (GL-10 reproducibility) |仍是 High — قبل release. |
| TD-48 (Security token) | ينتظر المالك خارج المحادثة. |

## 8) الانحرافات (Deviations)

1. **A4 أُعيد تصنيفه** من `BLOCKED` إلى `out-of-scope` بقرار المالك (لا إصلاح) — Part A أصبح **8/8**. هذا التغيير توثيقي فقط ولا يمس الكود.
2. **B2 المذكور «6 INSERTs»:** هاجرت 9 INSERTs مالية فعليًا (منها GRN reverse + 3 مسارات مخزون) لتغطية **كل** معايير B2–B11، بزيادة 3 عن العدد التقديري — لا حذف ولا تغيير سلوك، توحيد فقط.
3. **`req.ip` خلف proxy:** استُخدمت الصيغة المؤقتة المتفق عليها (`req.ip ?? req.socket.remoteAddress ?? 'unknown'`). ضبط `X-Forwarded-For` الدقيق مؤجل إلى TD منفصل إن لزم.

## 9) الحكم النهائي

- **GAP-01 Part A = 8/8 PASS** (A4 خارج النطاق — TD-51).
- **GAP-01 Part B = PASS — 13/13** (B1..B11 أدلة صفوف حرفية + B12 + B13).
- **TD-49 = مغلق · TD-51 = مسجّل.**
- `posting.ts` بلا أي diff ضمن GAP-01. لا إنتاج / لا SupABASE.
- **الخطوة التالية:** Part C (صف واحد لكل عملية — GAP01-11 الأصلي) بقرار منفصل.
