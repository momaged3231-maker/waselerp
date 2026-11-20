# B3 — طبقة التقارير + اعتماد الاستثناءات — تقرير الإغلاق

**التاريخ:** 2026-11-17
**المرحلة:** Phase-2 Purchases / B3
**التفويض:** "Go for B3 — 4 مكونات، 8 معايير" + 3 تحققات إلزامية قبل B3.

---

## 0) التحققات الثلاثة قبل B3 (كلها ناجحة)

### تحقق 1 — تغطية عيب B1 (الوحدة غير الأساسية)
- **قبل:** B1 كان 13/13 والعيب موجود (تغطية ناقصة).
- **بعد:** أُضيف **B1-14** في `tests/purchases/purchase-receipt.test.ts`:
  - GRN بـ **2 BOX** (معامل 12) = **24 وحدة أساسية**.
  - يتحقق: `item_warehouse_qty.unit_id = base_unit`، والفرق `on_hand = +24`، و`stock_movements.unit_id = base_unit` و`quantity = 24`.
  - النتيجة الحرفية: `B1-14 non-base unit (2 BOX→24 base) stored at base unit — base=1 delta=24 mv=[{"unit_id":1,"quantity":"24.000000"}]`
- **B1 الآن: 14/14 ✅**

### تحقق 2 — `reference_no` في `stock_movements`
- **السؤال:** schema drift مثل TD-33؟
- **الإجابة:** لا. العمود موجود أصلاً في `db/schema.postgres.sql:379` داخل `CREATE TABLE stock_movements` (ومنذ التأسيس). لم أضف عمودًا جديدًا — أضفت فقط `AND reference_no=$2` في 3 استعلامات اختبار (العمود يُملأ بـ`receiptNo` بواسطة `applyMovement`).
- **TD-35: لا يُنشأ** (لا يوجد drift).

### تحقق 3 — حالة قاعدة PGlite بعد إعادة البناء (4 أسطر مطلوبة)
```
gl_accounts total        = 51       (50 + 4107، بلا تكرار)
is_control=true          = 7        (6 + GRNI 2107)
4 mappings count         = 4
mapping codes            = [{"GRNI":"2107"},{"INVENTORY_IN_TRANSIT":"1110"},{"PPV":"5114"},{"SUPPLIER_ADVANCES":"1109"}]
```
- KEY ACCOUNTS: 1109، 1110، 2106، 2107، 4107، 5114 كلها موجودة؛ `DUPLICATES=[]`.
- **الحالة سليمة.**

---

## 1) Endpoints (4)

| # | Method | Path | الصلاحية |
|---|---|---|---|
| B3.1 | GET | `/purchases/invoices/:id/match` | `purchases.view` |
| B3.2 | POST | `/purchases/invoices/:id/exception` | `purchases.approve_exception` |
| B3.3 | GET | `/purchases/reports/grni-aging` (`?format=csv`) | `purchases.view` |
| B3.4 | GET | `/purchases/reports/grn-variance` (`?format=csv`) | `purchases.view` |

كلها ظهرت في سجل الـ API:
```
Mapped {/api/purchases/invoices/:id/match, GET}
Mapped {/api/purchases/invoices/:id/exception, POST}
Mapped {/api/purchases/reports/grni-aging, GET}
Mapped {/api/purchases/reports/grn-variance, GET}
```

**الملف:** `apps/api/src/modules/purchases/purchase-match.slice.ts` (موديول مستقل، مسجّل في `app.module.ts`).
**قاعدة مهمة:** لا قيد جديد، لا حركة مخزون — الـ exception يسجّل waive/audit فقط؛ `postInvoiceJournal` (B2) و`applyMovement` (B1) هما المساران الوحيدان للترحيل/المخزون. تقرير `docs/PURCHASE-CYCLE-DECISIONS.md` y confirm: المطابقة غير حاجزة افتراضيًا، وتفاوت السعر يُبلَّغ لا يُوقَف (C-3).

---

## 2) B3-01..08 — النتائج (من `npm run test:purchases-match`)

| # | المعيار | النتيجة | دليل حرفي |
|---|---|---|---|
| B3-01 | GRN 10 / invoice 10 → سطر واحد `matched`، فروق 0 | ✅ | `qtyVariance=0, priceVariance=0, status=matched` |
| B3-02 | GRN 10@10 / invoice 10@12 → `price_variance=20`, `qty_variance=0`, `matched` | ✅ | `priceVariance=20, qtyVariance=0, status=matched` |
| B3-03 | invoice 11 / GRN 10 → `qty_variance=1`, `qty_over` | ✅ | `qtyVariance=1, status=qty_over` |
| B3-04 | exception بلا `purchases.approve_exception` → 403 | ✅ | `status=403` (عبر HTTP، مستخدم Cashier) |
| B3-05 | exception بالصلاحية + reason → 200 + سطر `purchase_match_overrides` | ✅ | `status=200 overrides=1` |
| B3-06 | GRN بلا فاتورة → bucket `0-30` | ✅ | `ageDays=0, bucket=0-30` |
| B3-07 | GRN عمره 95 يومًا → bucket `>90` + إنذار | ✅ | `ageDays=95, bucket=>90, warning=true` |
| B3-08 | GRN 10@10 + invoice 10@12 → grn=100, invoiced=120, ppv=20 | ✅ | `grnValue=100, invoiced=120, ppv=20, status=fully_invoiced` |

**المجموعة: 8/8 ✅**

### ملاحظة تصميمية موثّقة (انحراف مقابل المواصفات)
المواصفات ذكرت حالة `price_over` ضمن الحالات، لكن معيار B3-02 يشترط صراحةً `status=matched` مع `price_variance=20`. حسب `docs/PURCHASE-CYCLE-DECISIONS.md` (تفاوت السعر تحذير غير حاجز)، جعلتُ `price_over` **عَلَمًا** (`priceOver: true`) على السطر لا حالةً مستقلة، حتى يتحقق B3-02 حرفيًا ويبقى PPV مسار B2. هذا موثّق هنا ولا يُخفي سلوكًا.

---

## 3) عيّنات التقارير

### GRNI aging sample (بعد GRN بلا فاتورة ثم تعتيمه إلى 95 يومًا)
```
row  = {"partyId":22,"branchId":1,"receiptId":56,"receiptLineId":57,
        "itemId":27,"openQty":5,"openValue":50,"ageDays":0,"bucket":"0-30"}     (B3-06)
row  = {"partyId":22,"branchId":1,"receiptId":56,"receiptLineId":57,
        "itemId":27,"openQty":5,"openValue":50,"ageDays":95,"bucket":">90"}     (B3-07)
warning = true  (>90)
```
الـ buckets: `0-30`، `31-60`، `61-90`، `>90` مع `warning` عند `>90` (DEC-PURCH-024: 90-day alert).

### GRN variance sample
```
{"receiptNo":"GRN-1-2026-000054","itemCode":"B3M-B-...",
 "acceptedQty":10,"unitCost":10,"grnValue":100,
 "invoicedQty":10,"invoiced":120,"ppv":20,"status":"fully_invoiced"}
```

---

## 4) الانحدار (Regression)

| الفحص | النتيجة |
|---|---|
| `npm run build` | نظيف ✅ |
| `npm run test:purchases` (B1) | **14/14 ✅** |
| `npm run test:purchases-invoice` (B2) | **15/15 ✅** |
| `npm run test:purchases-match` (B3) | **8/8 ✅** |
| `node tools/smoke-test.js` (قاعدة نظيفة) | **606/606 ✅** |

> ملاحظة بيئية: الـ smoke يعتمد على قاعدة نظيفة (مثل B2). تشغيل B1/B2/B3 المتكرر يلوّث PGlite (مرتب الشهر الحالي + كشوف بنك + تحويلات)، فأُعيد بناء القاعدة من الصفر (`migrate-all` → `seed` → `seed-reference`) مع حفظ القديم في `tools/pg/pglite/data.bak-b3-20261117-235700/` قبل تشغيل الـ smoke النهائي. B3 أضاف endpoints قراءة فقط، لا تؤثر على قائمة فحوص الـ smoke الثابتة.

---

## 5) الانحراف عن التصميم

- **`price_over` كعَلَم لا حالة:** موثّق في §2 (مطلوب لتحقيق B3-02 حرفيًا مع بقاء PPV غير حاجز).
- **الـ exception undmatched link:** يُسجَّل بـ `receipt_line_id=NULL` (عمود موجود وقابل للـ NULL في schema) بدل إضافة عمود حالة جديد — `v_open_purchase_lines` يربط على هذا العمود، فلا ينقص رصيد GRN المفتوح، ولا يُلامس GL. `voided_at` يبقى NULL لأنه سجل تدقيق نشط لا رابط ملغى.
- لا انحرافات أخرى.

---

## 6) قائمة الإغلاق

| البند | الحالة |
|---|---|
| تحقق 1 (unit test B1-14) | ✅ B1 = 14/14 |
| تحقق 2 (`reference_no`) | ✅ في schema — لا TD-35 |
| تحقق 3 (DB state) | ✅ 51 / 7 / 4 + الأرقام |
| B3.1 match API | ✅ |
| B3.2 exception API | ✅ |
| B3.3 GRNI aging + CSV | ✅ |
| B3.4 GRN variance + CSV | ✅ |
| B3-01..08 | ✅ 8/8 |
| Regression B1/B2/B3 | ✅ 14/14 + 15/15 + 8/8 |
| لا قيد جديد / لا مخزون جديد في B3 | ✅ |
| الإنتاج / Supabase | ❌ لم يُلمس |
| commit / push | ❌ لم يُعمل |
| B4 | ⏳ معلّق — بعد B3 PASS |
| TD-33 / TD-34 | مسجّلان |

**الحكم: B3 PASS تقني — جاهز للمراجعة. لا B4 ولا نشر إنتاج من دون تفويض جديد.**

---

### تحديث الـ smoke النهائي
**606/606 ✅** — `node tools/smoke-test.js` على قاعدة PGlite نظيفة بعد B3 (السطر الأخير: `606/606 checks passed`). لا انحدار من B3.
