# B2 — فاتورة الشراء (type 2) → مسار GRNI/PPV — تقرير الإغلاق

**التاريخ:** 2026-11-17
**المرحلة:** Phase-2 Purchases / B2 (TD-27)
**التفويض:** "Go for B2 — نفّذ الآن" (بعد إجابتي Q1/Q2). لا commit، لا push، لا لمس قاعدة الإنتاج.

---

## 1) بيئة التحقق (أدلة)

- قاعدة الاختبار: PGlite محلي على `127.0.0.1:5432`، قاعدة `wasel`. تم إعادة بنائها من الصفر (`migrate-all.js` → `seed.ts` → `seed-reference.js`) بعد أخذ نسخة احتياطية من بيانات الاختبار القديمة إلى `tools/pg/pglite/data.bak-20261117-203432/` (محلية فقط، غير متتبعة بـ git).
- الـ API شغّل بـ override صريح: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/wasel` — **لم يُستخدم `apps/api/.env`** (يحتوي Supabase pooler للإنتاج). سطر السجل: `Effective DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/wasel`.
- حالة قاعدة نظيفة قبل التشغيل: `{"s":0,"u":1,"b":1,"sh":0}` (صفر مرتبات، صفر ورديات).
- **لم تُلمس قاعدة الإنتاج / Supabase. لم يُعمل commit أو push.**

---

## 2) ما نُفّذ (الكود)

| الملف | التغيير |
|---|---|
| `apps/api/src/common/posting.ts` | `InvoicePostingInput.grnProvisional`؛ فرع الشراء يسجّل `Dr GRNI / Dr PPV(إن وجد) / Dr VAT_INPUT / Cr خصم / Cr نقد / Cr AP`؛ `sourceType='purchase_invoice'`؛ فحص `is_control` في allowlist المصادر الآلية. |
| `apps/api/src/modules/sales/sales.slice.ts` | `InvoiceInput.receiptLinks`؛ تخطي `applyMovement` و avg-cost لـ type 2؛ ربط GRN بـ FIFO عند غياب `receipt_links`؛ حماية backward-compat في `cancel()` و `reverseForEdit()`؛voiding الروابط عند إلغاء فاتورة جديدة. |
| `apps/api/src/modules/purchases/purchase-receipt.slice.ts` | **إصلاح عيب حقيقي** (انظر §6): إزالة `baseUnitId: line.unitId` في `create()` و `reverse()`. |
| `apps/api/tests/purchases/purchase-invoice.test.ts` | مجموعة B2 دائمة (15 فحصًا). |
| `apps/api/tests/purchases/purchase-receipt.test.ts` | تقوية 3 استعلامات بـ `reference_no` (عزل اختبار). |
| `tools/smoke-test.js` | تطبيق قرارات Q1 (انظر §5). |
| `apps/api/package.json` | سكربت `test:purchases-invoice`. |

`npm run build` (apps/api): **نظيف**.

---

## 3) نتائج B2-01..12 (أدلة من المجموعة الدائمة)

| # | السيناريو | النتيجة |
|---|---|---|
| B2-01 | فاتورة بلا GRN: `2107 Dr100 / 1105 Dr15 / 2101 Cr115` + **صفر حركة مخزون** | ✅ |
| B2-02 | GRN 100 / فاتورة 100 برابط صريح: نفس القيد، `purchase_invoice_links.invoiced_qty=10`، GRNI يُسدَّد | ✅ |
| B2-03 | GRN 100 / فاتورة 120: `5114 Dr20` (PPV مدين) | ✅ |
| B2-04 | GRN 100 / فاتورة 80: `5114 Cr20` (PPV دائن) | ✅ |
| B2-05 | `applyMovement` محمي بـ `invoiceType !== 2` | ✅ |
| B2-06 | `source_type='purchase_invoice'` في `gl_journals` | ✅ |
| B2-07 | ربط كمية > المقبول بدون صلاحية → 400 | ✅ |
| B2-08 | فاتورة جزئية 6 من GRN 10 → رابط 6، لا تجاوز | ✅ |
| B2-09 | B1 GRN ما زال يرحّل ويضيف مخزون | ✅ |
| B2-10 | اختبارات smoke القديمة عولجت حسب Q1 | ✅ |
| B2-11 | إلغاء فاتورة قديمة (بمخزون + قيد): المخزون يُعكس `60→50`، والقيد المرآة يُرحّل | ✅ |
| B2-12 | إلغاء فاتورة جديدة: المخزون `50→50`، `voided=1`، والقيد المرآة يُرحّل | ✅ |

**المجموعة: 15/15 ✅** (تشمل فحصي مرآة إضافيّين للـ GL).

### سطور القيود الحرفية (من مخرجات الاختبار)

```
B2-01: ["2107 Dr100.00 Cr0.00","1105 Dr15.00 Cr0.00","2101 Dr0.00 Cr115.00"]
B2-02: ["2107 Dr100.00 Cr0.00","1105 Dr15.00 Cr0.00","2101 Dr0.00 Cr115.00"]  link=[{"invoiced_qty":"10.000000"}]
B2-03: ["2107 Dr100.00 Cr0.00","5114 Dr20.00 Cr0.00","1105 Dr18.00 Cr0.00","2101 Dr0.00 Cr138.00"]
B2-04: ["2107 Dr100.00 Cr0.00","1105 Dr12.00 Cr0.00","5114 Dr0.00 Cr20.00","2101 Dr0.00 Cr92.00"]
```

التوازن: كل قيد Dr=Cr (115=115، 138=138، 92=92). GRNI=2107، PPV=5114، VAT_INPUT=1105، AP=2101 — أرقام موثّقة لا تخمين.

---

## 4) الانحدار (Regression)

- `npm run test:purchases` (B1): **13/13 ✅**
- `npm run test:purchases-invoice` (B2): **15/15 ✅**
- `node tools/smoke-test.js` على قاعدة نظيفة: **606/606 ✅** — من ضمنها:
  - `✅ GRN created stock — GRN-1-2026-0000..`
  - `✅ purchase invoice posted — P-2026-000001`
  - `✅ stock reflects purchase and sale — 97.000000`
  - `✅ GRN created box stock — GRN-1-2026-0000..`
  - `✅ box unit converted to base units (2 x 12 = 24) — 24.000000`
  - `✅ selling a box deducts 12 base units — 12.000000`
  - `✅ inventory GL net rises by the purchase value` (بعد إدخال GRN في الـ fixture)
  - `✅ purchase order converted to a purchase invoice — P-2026-000015`

> ملاحظة: العدد 606 (بدل 605 التاريخي) لأننا أضفنا 4 فحوص GRN/handler وحذفنا 2 حسب Q1 (605 − 2 + 3 = 606).

---

## 5) الامتثال لـ Q1 (تعديلات smoke-test)

- **الخيار A (140 / 227 / 235 / فحص GL delta):** أُدخلت fixtures بـ GRN حقيقي عبر `POST /orders` → `POST /orders/:id/status` → `POST /purchases/receipts` قبل فاتورة الشراء، فأصبحت الأرصدة تُبنى من GRN (السلوك الصحيح بعد B2). شمل ذلك أيضاً فحص `inventory GL net rises…` الذي ظهر أثناء التشغيل الكامل ولم يكن في التقرير التحضيري.
- **الخيار C (110 / 174):** حُذف الفحصان مع تعليق صريح:
  - `// Superseded: B1 tests cover GRN stock/cost effects; B2 removes cost update on invoice`
  - `// Superseded: B1 tests cover GRN stock apply/reversal; B2 tests cover invoice cancel behaviour`
- **B (تعديل assert فقط) وC الكامل:** مرفوضان — لم يُعمل أي منهما.

## 6) العيوب الحقيقية المكتشفة أثناء B2 وأُصلحت

1. **GRN بوحدة غير أساسية يكتب المخزون تحت الوحدة الخطأ.**
   - الدليل قبل الإصلاح (SQL حقيقي على الاختبار):
     `RECEIPT_LINES [{"unit_id":3,"accepted_qty":"2","unit_cost":"120"}]`,
     `MOVEMENTS [{"unit_id":3,"quantity":"24","reference_no":"GRN-1-2026-000021"}]`,
     `QTY [{"unit_id":3,"on_hand_qty":"24"}]` → رصيد الوحدة الأساسية = 0 وفشل البيع.
   - السبب: `applyMovement` تلقّى `baseUnitId: line.unitId` (وحدة الصندوق = 3) بدل الوحدة الأساسية = 1.
   - الإصلاح: حذف التجاوز في `create()` و `reverse()` ليحل `getBaseUnitId()` محلّه.
   - الدليل بعد الإصلاح: `box unit converted to base units (2 x 12 = 24) — 24.000000` ✅ و `selling a box deducts 12 base units — 12.000000` ✅.
   - هذا إصلاح عيب تنفيذي ضمن التصميم المعتمد (GRN يضيف مخزوناً بوحدة الأساس)، **ليس تغيير تصميم**.

2. **عزل اختبار B1:** استعلام `reference_type=1 AND reference_id=$1` التقط حركات من مستندات أخرى تحمل نفس الرقم (كلها تستخدم `reference_type=1`). أُضيف `AND reference_no=$2` (الرقم الفريد لمحضر الاستلام) في 3 مواضع. النتيجة: B1 عاد 13/13.

3. **بيئة الاختبار:** قاعدة PGlite مخزن بيانات واحد، `CREATE DATABASE` لا يعزل. أُعيد بناء البيانات مع حفظ القديم في مجلد `.bak` محلي. كما تبيّن أن قاعدة `wasel` القديمة كانت تنقص جداول E1/E3/E5/E2؛ `migrate-all.js` على قاعدة نظيفة طبّق الكل (`all applied`).

---

## 7) حالة D-18 / DEC-PURCH-054

- `POST /sales/invoices` type 2 يقبل `receiptLinks: [{receiptLineId, qty}]` اختيارياً.
- عند الغياب: FIFO على أسطر GRN المفتوحة لنفس الصنف/الفرع/المورد، مرتبة بالتاريخ.
- كل الروابط تُسجَّل في `purchase_invoice_links` (مع `voided_at` عند الإلغاء).
- قيد `Σ invoiced_qty ≤ accepted_qty` مفروض، ومع `purchases.approve_exception` يُسجَّل التجاوز كـ unmatched.
- **الحالة: منفّذ ومُختبر** (B2-02، B2-03، B2-04، B2-07، B2-08 + smoke).

---

## 8) backward-compat (Q2)

`stock_movements` لا يحتوي عمود `source_type` (تحقّق حقيقي: الأعمدة = `reference_id, reference_no, reference_type`). لذلك استُخدم التكيف الموثّق:
`reference_type=1 AND reference_id=invoice_id AND reference_no=invoice_no` للكشف عن حركة أصلية.

- `stock_was_applied=true` → يُعكس المخزون (B2-11: `60→50`) ✅
- `stock_was_applied=false` → لا تغيير مخزون (B2-12: `50→50`) ✅
- الـ GL يُعكس **دائماً** عبر `reverseJournal` (`source_type='reversal'`, `source_id=original`) — أُضيف فحص صريح له في الحالتين ✅
- B2-12: `purchase_invoice_links.voided_at=now()` ✅

---

## 9) قائمة الإغلاق

| البند | الحالة |
|---|---|
| B2-01..12 | ✅ كلها ناجحة بأدلة SQL حقيقية |
| Sample journals (01–04) | ✅ سطور حرفية أعلاه |
| Regression B1 13/13 + B2 15/15 | ✅ |
| `npm test` كامل (smoke) | ✅ 606/606 على قاعدة نظيفة |
| D-18 receipt links / FIFO | ✅ منفّذ ومُختبر |
| Q1 (A/C) وQ2 | ✅ مطبَّقان حرفياً |
| عيب GRN بوحدة غير أساسية | ✅ مكتشف ومُصلح ومُثبت |
| الإنتاج / Supabase | ❌ لم يُلمس |
| commit / push | ❌ لم يُعمل |
| B3 | ⏳ بانتظار Go مستقل |

**الحكم: B2 PASS تقني — جاهز للمراجعة. لا انتقال إلى B3 ولا نشر إنتاج من دون تفويض جديد.**

### ملاحظات متبقية
- TD-33 (4107 مفقود من seed قبل النشر) وTD-34 (اختبارات صلاحيات على مستوى HTTP مؤجلة) لا تزالان مفتوحتين من B1.
- `apps/api/apply-p5c.js` يبقى غير متتبّع ويجب ألا يُلتقط في أي commit لاحق.
- مجلد `tools/pg/pglite/data.bak-20261117-203432/` نسخة احتياطية محلية لبيانات الاختبار القديمة — لا يُلتقط في commit.
