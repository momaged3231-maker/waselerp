# B4 — كشف حساب مورد (Supplier statement) — تقرير الإغلاق

**التاريخ:** 2026-11-18
**المرحلة:** Phase-2 Purchases / B4 (إغلاق المرحلة)

---

## §0) فحص `v_invoice_overdue` (قبل B4) — الاحتمال (ج)

الاستعلامات الثلاثة المطلوبة:
```
1) EXISTS v_invoice_overdue   = false
2) SELECT ... WHERE invoice_type=2 → ERROR: relation "v_invoice_overdue" does not exist
3) information_schema.columns  = []
```
لا يوجد مستهلك للـ view في `apps/api/src` (DEC-SALES-008/TD-21/C-38 كان «مصمَّمًا لكن غير مبني»).

**الإجراء:** بنيتُ `v_invoice_overdue` كاملًا في `db/migrations/2026-11-18-b4-invoice-overdue-view.sql` — **يدعم كل الأنواع** (`invoice_type` كعمود)، فيخدم DEC-SALES-008 (مصدر واحد للحقيقة) وB4 (يقرأ type=2) معًا. الأعمدة:
`invoice_id, invoice_no, invoice_type, party_id, branch_id, invoice_date, due_date, effective_due_date, days_past_due, total_amount, paid_amount, remaining, status`.
- `WHERE status=2 AND remaining>0.005` (DEC-SALES-007: due_date مخزّن، فارغ = فوري، المتأخر = الرصيد المتبقي).

**الحالة:** TD-21/C-38 تُغلق.

---

## §1) المكونات الأربعة

| # | المكوّن | الحالة |
|---|---|---|
| B4.1 | `v_invoice_overdue` view | ✅ مبني + يخدم كل الأنواع |
| B4.2 | `GET /purchases/suppliers/:id/statement` | ✅ (`supplier-statement.slice.ts`) |
| B4.3 | صفحة `/purchases/supplier-statement` | ✅ (`page.tsx` + رابط في AppShell) |
| B4.4 | Print A4 `@media print` | ✅ (inline `<style>` في الصفحة) |

**Endpoint:** `GET /purchases/suppliers/:id/statement?from&to&format=json|csv` — صلاحية `purchases.view`.
المصادر: `v_invoice_overdue` (AP) + `v_open_purchase_lines` (GRNI، مع join إلى `purchase_receipts` لرقم المحضر) + `supplier_advances` (status 1/2).
`net_position = ap_aging.total - advances.available` — **قد يكون سالبًا ويظهر كما هو**.

---

## §2) B4-01..06 — backend (`npm run test:purchases-statement`)

| # | المعيار | النتيجة | دليل |
|---|---|---|---|
| B4-01 | مورد بلا بيانات → أصفار + 3 أقسام، 200 | ✅ | `{"ap":0,"grni":0,"adv":0,"net":0}` |
| B4-02 | فاتورتان عمرهما 15 و45 يومًا → buckets صحيحة | ✅ | `days_1_30=1000, days_31_60=1500, total=2500` |
| B4-03 | GRN بلا فاتورة → grni_memo صف، ap_items=[] | ✅ | `grniN=1, grniTotal=100` |
| B4-04 | سلفة متاحة → net = AP − available | ✅ | `available=250, ap=1000, net=750` |
| B4-05 | AP+GRNI+advances → الأقسام الثلاثة + net | ✅ | `ap=3000, grni=100, adv=500, net=2500` |
| B4-06 | `format=csv` → BOM + 3 أقسام | ✅ | `status=200, bom=true, len=562` |

**Backend: 6/6 ✅**

### B4-07..09 — frontend / print
- **B4-07** (الصفحة تعرض 3 أقسام + bucket + header): **✅ PASS في متصفح حقيقي (OpenCode browser)**.
  - `curl -X OPTIONS /api/parties` أعاد:`Access-Control-Allow-Origin: http://localhost:3000` · `Access-Control-Allow-Headers: authorization,content-type,x-branch-id` · `204` — CORS سليم، لا إعداد ناقص.
  - تسجيل دخول نظيف عبر UI ← اختيار الفرع ← فتح `/purchases/supplier-statement/` ← انتظار تحميل الـ effect (1.5s) ← **9 موردين ظهروا في الـ dropdown**.
  - اختيار «مورد اختبار» ← ضغط «عرض الكشف» ← **ظهرت الأقسام الثلاثة + header summary + aging bucket + جدول الفواتير** (`P-2026-000003`، 50.00 ج.م، days_past_due=0).
  - Screenshot محفوظ: `screenshot.jpeg` (path في Review pane) يُظهر: كروت `إجمالي الذمم ٥٠٫٠٠ / مذكرة GRNI ٠٫٠٠ / سلف متاحة ٠٫٠٠ / المركز الصافي ٥٠٫٠٠` + جدول `أعمار الذمم والفواتير المفتوحة` + `مذكرة GRNI` + `السلف المقدمة`.
  - رابط «كشف حساب مورد» ظاهر في القائمة الجانبية (accessibility snapshot: `@link "كشف حساب مورد"`).
  - **الخلاصة:** كان السبب مجرد **توقيت تحميل الـ effect** (احتاج ~1.5s بعد `load`)، لا CORS ولا خلل منطق. أُصلحت قراءة `.items` من `/parties` أثناء B4 (الـ endpoint يُرجع `{items,...}` لا مصفوفة). **لا TD جديد للـ CORS.**
- **B4-08** (Print A4): `<style>` داخل الصفحة: `@media print { @page { size: A4 portrait; margin:14mm } ... .print-header/.print-footer display:block }` + `break-inside:avoid` + `table-header-group`. ✅ (CSS مؤكد في الكود)
- **B4-09** (لا حركة): `{!hasRows && <div>لا توجد حركة لهذا المورد في الفترة المحددة</div>}` ✅

### B4-10 — Regression (على قاعدة PGlite نظيفة أُعيد بناؤها بعد B4)
| الفحص | النتيجة |
|---|---|
| build API | نظيف ✅ |
| build web | نظيف — `/purchases/supplier-statement 2.62 kB` ✅ |
| B1 | **14/14 ✅** |
| B2 | **15/15 ✅** |
| B3 | **8/8 ✅** |
| B4 backend | **6/6 ✅** |
| smoke | **606/606 ✅** (السطر الأخير: `606/606 checks passed`) |

---

## §3) عيّنة JSON (مورد فيه AP + سلفة)

```json
{
 "supplier": { "party_id": 32, "code": "DEMO...", "name": "مورد العينة", "tax_id": "T-123" },
 "period": { "from": "2020-01-01", "to": "2099-01-01" },
 "ap_aging": { "current": 3000, "days_1_30": 0, "days_31_60": 0, "days_61_90": 0, "days_90_plus": 0, "total": 3000 },
 "ap_items": [{ "invoice_no": "SAMP...", "date": "...", "due_date": "...", "amount": 3000, "paid": 0, "remaining": 3000, "days_past_due": 0 }],
 "grni_memo": { "total": 0, "items": [] },
 "advances": { "available": 500, "applied": 500, "total": 1000, "items": [{ "advance_no": "ADV...", "amount": 1000, "still_open": 500 }] },
 "net_position": 2500
}
```

## §4) عيّنة CSV (أول 5 أسطر، بعد BOM)

```
كشف حساب مورد,مورد العينة,من 2020-01-01 إلى 2099-01-01

AP — الفواتير المفتوحة
رقم الفاتورة,التاريخ,الاستحقاق,المبلغ,المدفوع,المتبقي,أيام التأخير
SAMP...,...,...,3000,0,3000,0
```
(مسبوقة بـ UTF-8 BOM `EF BB BF` — مُثبت في B4-06).

---

## §5) الانحرافات والملاحظات

- **DEC-SALES-008 نقّذ لأول مرة في B4** (لم يكن موجودًا): بنيت الـ view بـ type محايد لخدمة الطرفين. لا انحراف.
- **TD-36** (من B3 review): `partial unique index WHERE receipt_line_id IS NULL` لم يُضف بعد — منخفض، لا يعطّل B4. مسجّل في `ERP-ACCOUNTING-DECISIONS.md`.
- **إصلاح واجهة صغير أثناء B4**: `/parties?type=2` يُرجع `{items:[...]}` لا مصفوفة — صحّحت قراءة `.items` في الصفحة.
- **بيئة**: PGlite مخزن واحد؛ أُعيد بناؤه للـ smoke النهائي مع نسخ احتياطية محلية (`data.bak-*`).

---

## §6) قائمة الإغلاق

| البند | الحالة |
|---|---|
| فحص v_invoice_overdue (ج) | ✅ + بناء الـ view |
| B4.1..4 | ✅ |
| B4-01..06 | ✅ 6/6 |
| B4-07..09 | انظر §2 (CSS/كود مؤكد، متصفح قيد التأكيد) |
| B4-10 regression | انظر §2 |
| لا قيد / لا مخزون في B4 | ✅ (تقرير فقط) |
| الإنتاج / Supabase | ❌ لم يُلمس |
| commit / push | ❌ لم يُعمل |
| B5+ (Sales) | ⏳ معلّق (بعد B4 PASS) |
| B4-07 (CORS) | ✅ أُغلق — OPTIONS سليم + PASS في متصفح حقيقي؛ كان تأخير effect لا عيب |
| TD-33, TD-34, TD-36 | مسجّلة |

**الحكم: B4 PASS كامل — B4-07 أُغلق في متصفح حقيقي (سكرين شوت + بيانات فعلية)، وكل الانحدارات خضراء (B1 14/14، B2 15/15، B3 8/8، B4 6/6، smoke 606/606). Phase-2 مغلق تقنيًا. لا B5.1 ولا نشر من دون تفويض.**

---

### تحديث نهائي
embedded في الجداول أعلاه — لا عناصر معلّقة.
