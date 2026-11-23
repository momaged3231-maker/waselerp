# GAP-01 — Report — Part C (One row per operation)

**التاريخ:** 2026-11-24
**المسار:** Part C = Go (بعد إغلاق Part A 8/8 وPart B 13/13).
**النتيجة:** **C2–C10 = 9/9 PASS** ✅ · **C1 = تعارض بين النص الحرفي ونطاق TD-52** (مفصّل أدناه).

---

## 1) C1 — فحص INSERTs (أسرع وأهم معيار)

**الأمر الحرفي:**
```
grep -rn "INSERT INTO activity_log" apps/api/src --include="*.ts"
```

**النتيجة الفعلية:** **54 سطرًا** (المتوقع حرفيًا: 1).

| الملف | عدد INSERTs | التصنيف |
|---|---:|---|
| `apps/api/src/common/audit.ts` | **1** | ✅ الـ helper الوحيد — الهدف |
| `apps/api/src/common/posting.ts` | **2** | محظور تعديله ضمن GAP-01 (B12: diff = 0) — TD-52 |
| `apps/api/src/modules/accounting/accounting.slice.ts` | 15 | عمليات محاسبية ثانوية (حسابات/مراكز تكلفة/شيكات/فترات/موازنات…) — TD-52 |
| `apps/api/src/modules/treasury/treasury.slice.ts` | 3 | خزينة/ورديات — TD-52 |
| `apps/api/src/modules/inventory/branch-transfer.slice.ts` | 3 | تحويل بين الفروع — TD-52 |
| `apps/api/src/modules/inventory/stock-transfer.slice.ts` | 2 | تحويل مخزون — TD-52 |
| `apps/api/src/modules/admin`, `attachments`, `backup`, `bank-expenses`, `bank-recon`, `catalog/items`, `checks`, `crm`, `fixed-assets`, `parties`, `purchases/purchase-match`, `sales/documents`, `sales/pos`, `settings/print-profiles` | 30 | TD-52 |
| **المجموع** | **54** | 1 helper + 2 posting + 51 TD-52 |

### تحليل التعارض

- **TD-52 (سُجّل في هذه الجولة بقرار المالك):** ينص صراحة على أن INSERTs الثانوية «لا يعطّل إغلاق GAP-01»، ومعيار إغلاقه = صفر INSERTs في `*.slice.ts`.
- **B12:** يفرض `git diff posting.ts = 0` ضمن GAP-01، بينما `posting.ts` يحتوي على INSERTين — أي أن **C1 الحرفي لا يمكن أن يتحقق مع B12** دون خرق B12.
- **النتيجة المنطقية:** C1 الحرفي (1 سطر) يتطلب تنفيذ TD-52 بالكامل + لمس `posting.ts` — وكلاهما مستبعد بقرار المالك في نفس الرسالة.

### ما الذي تحقّق فعليًا (نطاق GAP-01)

فحص سلاسل Actions الحرجة (B2–B11) خارج الـ helper:
```
grep -rn "'invoice\.post\.\|'voucher\.receipt'\|'voucher\.payment'\|'gl\.journal\.create'\|'purchases\.grn\.\|'stock\.operation'\|'stock\.voucher\.approve'\|'stock\.count\.approve'" apps/api/src --include="*.ts"
```
النتائج كلها حقول `action:` داخل استدعاءات `logActivity` — **صفر INSERT خام لأي من الأفعال الحرجة**. أي: لا تسجيل مزدوج في المسارات التي هاجرها Part B.

**الحكم المقترح:** C1 = **PASS ضمن نطاق GAP-01** (helper واحد للعمليات الحرجة، صفر INSERT مزدوج لها)؛ الـ51 المتبقية = TD-52. **يحتاج تأكيد المالك** لأن النص الحرفي لـ C1 يقول «سطر واحد فقط».

---

## 2) C2..C9 — نتائج `SELECT COUNT(*)` حرفية

**السكربت:** `tools/verify-gap01-partC.js` → **RESULT 8/8** (بعد إصلاح C8).
**البيئة:** PGlite :5600 (migrate+seed) + API :4026.

| المعيار | الاستعلام / النتيجة الحرفية | الحكم |
|---|---|---|
| **C2** | `invoice_id=2` → `COUNT(*) WHERE action='invoice.post.sale' AND entity_id='2'` = **1** | ✅ PASS |
| **C3** | `voucher_id=2` → `COUNT(*) WHERE action='voucher.receipt' AND entity_id='2'` = **1** | ✅ PASS |
| **C4** | `receipt_id=2` → `COUNT(*) WHERE action='purchases.grn.create' AND entity_id='2'` = **1** | ✅ PASS |
| **C5** | `journal_id=8` → `COUNT(*) WHERE action='gl.journal.create' AND entity_id='8'` = **1** | ✅ PASS |
| **C6** | `operation_id=4` → `COUNT(*) WHERE action IN ('stock.operation','stock.voucher.approve','stock.count.approve') AND entity_id='4'` = **1** | ✅ PASS |
| **C7** | `clientRequestId='dup-test-*'` مرتين → statuses **201/200**، نفس `invoice_id=7` → `COUNT(*) WHERE action='invoice.post.sale' AND entity_id='7'` = **1** | ✅ PASS |
| **C8** | `invoice_id=8` بعد edit → `post=1`, `edit=1`, `total=2` | ✅ PASS **بعد إصلاح** |
| **C9** | `invoice_id=9` بعد cancel → `post=1`, `cancel=1`, `total=2` | ✅ PASS |

### إصلاح C8 (تغيير كود واحد ضمن Part C)

- **العيب المكتشف:** التعديل يعيد كتابة الفاتورة عبر `SalesService.create`، فكان يُسجَّل `invoice.post.sale` **مرة ثانية** → `post=2 · total=3` (فشل C8 في التشغيل الأول).
- **الإصلاح:** في `apps/api/src/modules/sales/sales.slice.ts` — إدراج `invoice.post.*` أصبح مشروطًا بـ`if (!editOf)`؛ التعديل يُسجَّل مرة واحدة عبر `invoice.edit` في `reverseForEdit`.
- **إعادة التحقق:** `8/8 PASS` — `post=1 · edit=1 · total=2`.

## 3) C10 — الانحدار على قواعد نظيفة

> أُعيد بناء بيئتين نظيفتين فعليًا (`PGLITE_DIR` صريح، `users:1 · branches:1`) بعد أن تبيّن أن محاولة أولى استخدمت مجلد البيانات المشترك (8 مستخدمين/5 فروع) فأفشلت smoke — سُجّل كخطأ بيئة لا كفشل كود.

| الحزمة | البيئة | النتيجة |
|---|---|---|
| B1 `test:purchases` | PGlite :5602 (clean) | **14/14 PASS** |
| B2 `test:purchases-invoice` | :5602 | **15/15 PASS** |
| B3 `test:purchases-match` | :5602 + API :4028 | **8/8 PASS** |
| B4 `test:purchases-statement` | :5602 + API :4028 | **6/6 PASS** |
| B5.1 `test:credit-limit` | :5602 + API :4028 | **16/16 PASS** |
| B5.2 `test:sales-return` | :5602 + API :4028 | **17/17 PASS** |
| B5.3 `test:sales-return-extra` | :5602 + API :4028 | **9/9 PASS** |
| B5.4 `test:sales-credit-note` | :5602 + API :4028 | **24/24 PASS** |
| Integration `test:sales-integration` | :5602 + API :4028 | **6/6 PASS** |
| **المجموع** | — | **115/115 PASS** |
| Smoke | PGlite :5604 (clean) + API :4030 | **606/606 PASS** (`SMOKE_EXIT=0`) |

**C10 = PASS** ✅.

## 4) الخلاصة المطلوبة

```
C1: 54 سطرًا (1 helper + 2 posting + 51 TD-52) — المتوقع الحرفي 1 → انظر تحليل التعارض
C2: invoice_id=2  → COUNT=1
C3: voucher_id=2  → COUNT=1
C4: receipt_id=2  → COUNT=1
C5: journal_id=8  → COUNT=1
C6: operation_id=4 → COUNT=1
C7: invoice_id=7 (dup) → COUNT=1, statuses 201/200
C8: invoice_id=8 → post=1, edit=1, total=2  (بعد إصلاح الكود)
C9: invoice_id=9 → post=1, cancel=1, total=2
C10: B1..B5.4 = 115/115 · smoke = 606/606
TD-52 registered: yes (ERP-GAP-REGISTER §4 + docs/ERP-ACCOUNTING-DECISIONS.md §6)
Code changes: 1 — sales.slice.ts: guard invoice.post row with `if (!editOf)` (C8 fix)
posting.ts diff: 0
```

## 5) الحكم

- **C2–C10: 9/9 PASS** بأدلة COUNT حرفية + انحدار كامل.
- **C1: PASS ضمن النطاق** (صفر INSERT مزدوج للأفعال الحرجة) لكن **لا يلبي النص الحرفي «سطر واحد»** بسبب TD-52 وB12.
- **GAP-01 يُغلق** إذا اعتُبر C1 ضمن النطاق؛ وإلا يلزم قرار المالك: إما (أ) اعتماد التفسير النطاقي، أو (ب) تنفيذ TD-52 كاملًا + تعديل `posting.ts` (خرق B12).
- لا إنتاج / لا Supabase.
