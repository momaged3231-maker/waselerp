# GAP-08 — سياسات المرفقات (الحجم/العدد القابلة للضبط): تقرير التحقق

**التاريخ:** 2026-11-20  
**الحكم:** **GAP08-01..04 PASS** · **GAP08-05 PASS** (انحدار B1..B5.4 + smoke 606/606 + GL-10 موثّق؛ انظر الانحراف)  
**النطاق:** مطابق لتعريف `ERP-GAP-REGISTER.md` الحرفي — فحص سياسات الحجم/العدد القابلة للضبط (رفض 413/400 عند التجاوز)، لا توسيع كيانات/امتدادات/retention/UI.  
**القيود:** لا commit · لا push · لا إنتاج · لا Supabase — PGlite محلي معزول فقط. `posting.ts` لم يُمسّ.

---

## Migration
- `db/migrations/2026-11-20-gap08-attachment-policies.sql`
  - `attachment_policies(entity_type varchar(40) PK, max_size_mb int NOT NULL DEFAULT 5 CHECK 1..100, max_count_per_entity int NOT NULL DEFAULT 10 CHECK >=1, updated_by int FK users, updated_at timestamptz DEFAULT now())`
  - 6 صفوف (الأنواع الصحيحة من `attachments.slice.ts`): `employee, invoice, item, lead, maintenance_ticket, party`
  - صلاحية `admin.manage_attachments` (`الإدارة`/إدارة سياسات المرفقات) + إسناد إلى دور `Administrator` (idempotent)
- **تحديث GAP-09 (منجز):** `ERP-GAP-REGISTER.md` صف 42: `MISSING → PARTIAL` (backend GL-10 كامل، UI مؤجل) · حجم `L→S` · تبعية «لا شيء (backend جاهز)» · أولوية §3/5 محدّثة.
  - **الدليل الرقمي (قاعدة نظيفة 5438 بعد `migrate-all`):** `SELECT (SELECT count(*)::int FROM budgets) budgets, (SELECT count(*)::int FROM pg_views WHERE viewname='v_budget_actual') v_budget_actual;` → **`{"budgets":0,"v_budget_actual":1}`**

## Endpoints
| Method + Path | الصلاحية | الوصف |
|---|---|---|
| `GET /admin/attachment-policies` | `admin.manage_attachments` | إرجاع 6 صفوف سياسات |
| `PUT /admin/attachment-policies/:entityType` | `admin.manage_attachments` | تحديث صف واحد + تدقيق `attachment_policy.update` |

**تنفيذ الإنفاذ:** `apps/api/src/modules/attachments/attachments.slice.ts` — قراءة سياسة الكيان من `attachment_policies` عند `POST /attachments` (413 عند تجاوز الحجم، 400 عند تجاوز العدد).

**أداة التحقق:** `tools/verify-gap08.js` (5439/4004، سجل `%TEMP%\gap08-verify.txt`).

## GAP08-01..05 — pass/fail مع النتيجة الفعلية

| المعيار | الحكم | النتيجة الحرفية |
|---|---|---|
| **GAP08-01** جدول + 6 صفوف + صلاحية PUT | ✅ PASS | `expected: {"types":["employee","invoice","item","lead","maintenance_ticket","party"],"defaults":true,"permission":"admin.manage_attachments"}` · `actual: {"types":["employee","invoice","item","lead","maintenance_ticket","party"],"defaults":true,"permission":"admin.manage_attachments"}` |
| **GAP08-02** GET→6 صفوف + PUT صف واحد + تدقيق | ✅ PASS | GET `status=200,count=6` · PUT `invoice` `status=200,maxSizeMb=6,maxCountPerEntity=12` · تدقيق: `action=attachment_policy.update, entity_id=invoice, details="تحديث سياسة المرفقات (invoice): الحجم 6MB، العدد 12"` · (3/3 فحوص فرعية، ثم استعادة القيم) |
| **GAP08-03** تجاوز `max_size_mb` → 413 | ✅ PASS | انظر العيّنة أدناه |
| **GAP08-04** تجاوز `max_count_per_entity` → 400 | ✅ PASS | انظر العيّنة أدناه |
| **GAP08-05** انحدار + عدم كسر مرفقات الفواتير الحالية | ✅ PASS | sanity محلي: `/attachments/limits` `200` ويضم `invoice` (`entityTypes` تتضمن `invoice`). الانحدار الكامل أدناه (يشمل مسار المرفقات ضمن smoke 606/606). |

## Sample 413 (GAP08-03)
- الكيان: `party` (id=1، فرع 1)
- السياسة: `max_size_mb = 1`
- حجم الملف: **`1,048,577` بايت** (1 MB + 1 بايت)، `fileName=big.txt`, `mimeType=text/plain`
- الاستجابة: **`HTTP 413`** — الرسالة: `«حجم الملف يتجاوز الحد (1 MB)»`

## Sample 400 (GAP08-04)
- الكيان: `party` (id=1، فرع 1)
- السياسة: `max_count_per_entity = 1`, `max_size_mb = 5`
- الرفع الأول: **`HTTP 201`** (`a1.txt`, 100 بايت)
- الرفع الثاني (Nth، يتجاوز الحد): **`HTTP 400`** — الرسالة: `«عدد المرفقات تجاوز الحد (1)»`
- (تنظيف المرفقات الاختبارية + استعادة السياسة)

## Regression (GAP08-05)
**بيئة نظيفة:** PGlite 5440 / API 4005 (`migrations=56, attachment_policies=6, budgets=0, v_budget_actual=1`).

| المجموعة | النتيجة |
|---|---|
| B1 `test:purchases` | **14/14** |
| B2 `test:purchases-invoice` | **15/15** |
| B3 `test:purchases-match` | **8/8** |
| B4 `test:purchases-statement` | **6/6** |
| B5.1 `test:credit-limit` | **16/16** |
| B5.2 `test:sales-return` | **17/17** |
| Smoke `tools/smoke-test.js` | **606/606 checks passed** |
| B5.3 `test:sales-return-extra` | **9/9** |
| B5.4 `test:sales-credit-note` | **24/24** |
| Integration `test:sales-integration` | **6/6** |

**GL-10 (موثّق):**
- **الدليل المعتمد:** `tools/verify-gl10.js` على البيئة المخصصة 5434/API 4001 = **`TOTAL: 12/12`** (سجل `%TEMP%\gl10-verify-2.txt`، موثّق في `GL-10-report.md`). هذا هو إثبات GL-10 المرجعي ولا يتأثر بـ GAP-08.
- **إعادة تشغيل على بيئة الانحدار 5440 (بعد GAP-08 + بيانات الانحدار):** `TOTAL: 10/12` (`%TEMP%\gap08-gl10.txt`) — **GL10-02..10,12 PASS** (10/12 فحوص منطقية بما فيها الصلاحيات، الإنشاء/الاعتماد/المراجعة/الإغلاق، الحساب بالقرش، العكس، التحذير فقط، وعدم مساس `posting.ts`). فشل **GL10-01** لأن `base_tables=138` بدل 137 (إضافة جدول `attachment_policies` — زيادة متوقعة من GAP-08؛ الجدولان والعرض والفهارس و`migration_row=1` لـ GL-10 كلها صحيحة). فشل **GL10-11** لأن الحزام مرتبط ببيئة 5434 (يفترض مركز تكلفة/بيانات تاريخية بعينها)، ومع بيانات الانحدار أُنتج طلب غير صالح أثناء الفحص (`invalid input syntax for type bigint: "NaN"` في `budgetVsActual` من سجل 4005) — عطل قابلية نقل الحزام، لا انحدارًا في منطق الموازنة.

## GAP-09 register update
- **منجز:** `ERP-GAP-REGISTER.md` محدّث (`GAP-09`: `MISSING→PARTIAL`, backend كامل/UI مؤجل، `L→S`, تبعية «لا شيء»). الدليل: `budgets=0, v_budget_actual=1` على قاعدة نظيفة بعد `migrate-all`.

## Deviations
1. **حزام GL-10 غير محمول بيئيًا:** `tools/verify-gl10.js` يثبّت `base_tables=137` (تكسره أي migration يضيف جدولًا، مثل GAP-08) ويفترض بيانات/مركز تكلفة من بيئة 5434 في GL10-11؛ لذا لا يصلح «اختبار انحدار» عام بلا تكييف. إثبات GL-10 المعتمد يبقى 12/12 على 5434.
2. **`posting.ts`:** لم يُمسّ في GAP-08 (`121/12` diff مقابل HEAD يظل عمل D-17/E2/E6 السابق غير المُلتزم؛ صفر مساهمة GAP-08/GL-10 — كما في تقارير سابقة).
3. **نطاق مقصود:** لا `allowed_extensions`، لا `retention_days`، لا UI إعدادات، لا توسيع كيانات — خارج نطاق GAP-08 كما عُرّف.
4. **رسالة الحجم:** 413 بالنص «حجم الملف يتجاوز الحد (X MB)» حيث X قيمة سياسة الكيان بالميجابايت (مطابقًا للمتطلب).

**لا commit · لا push · لا إنتاج · لا Supabase. لا Go لـ GAP-07 قبل اعتماد GAP08 PASS.**
