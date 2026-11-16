# E6 — FINAL SIGN-OFF CHECK (مراجعة التوقيع النهائي)

**التاريخ:** 2026-11-16 · **النظام:** WaselERP · **النطاق:** إصلاح عيوب E6 المراجعة + الأقسام 1–4
**قاعدة البيئة المعزولة للبوابة:** `wasel_e6rev` (PGlite 127.0.0.1:5434) · **PostgreSQL الحقيقي:** PostgreSQL 18.6 على 127.0.0.1:5432، قاعدة اختبار جديدة معزولة `wasel_signoff` (لا تمس `wasel` التطويرية ولا `wasel_month2`) · **API الاختبار:** :4270 (signoff) و:4250 (month2) و:4260 (e6rev)
**لا إنتاج · لا Supabase الإنتاج · لا E2/E4 · لا تعديل apply-p5c.js · لا تفعيل الرصيد المتناقص في الواجهة.**

---

## القسم 1 — Manual lock vs Accounting Close (CRITICAL) — تم الفصل الكامل

### المشكلة
المسار القديم `POST /accounting/periods/:id/close|reopen` (قفل بلا أثر محاسبي) كان يغيّر `is_closed` نفسه، فيتعارض دلاليًا مع `closeMonth` ويسمح بـ«فتح» فترة مُقفَلة محاسبيًا.

### الإصلاح (تطبيقي)
- **أعمدة جديدة على `periods`** (migration additive `db/migrations/2026-11-17-e6-signoff.sql`): `manual_lock`, `manual_lock_at`, `manual_lock_by`, `manual_lock_reason`. لا تلمس `is_closed` / `closing_entry_id` / `net_income` / `closed_at` / `closed_by` أبدًا.
- **الصلاحيات (seed):** `periods.admin` (قفل/فك القفلة الإدارية فقط) — منفصلة عن `accounting.close` وعن `accounting.close_override` وعن `accounting.backpost`.
- **Endpoints (تصحيحية):** `POST /accounting/periods/:id/manual-lock` و`manual-unlock` بصلاحية `periods.admin`، **سبب إلزامي**، وقيد في `activity_log` (`period.manual_lock` / `period.manual_unlock`). **Endpoints القديمة `close|reopen` محذوفة نهائيًا.**
- **الترحيل محجوب إداريًا:** `assertPeriodOpen()` في `common/posting.ts` ترفض الآن أي ترحيل داخل فترة `is_closed` **أو** `manual_lock` (برسالة عربية واضحة) — يغطي كل الموديولات (invoices/vouchers/E3/E5/payroll/…)، وفحص إضافي `manual_lock` في `bank-expenses` (الترحيل والعكس) و`bank-recon` و`fixed-assets`.
- **الإقفال المحاسبي مرفوض داخل قفل إداري** (`closeMonth` و`reverseClose`) بنفس الرسالة العربية؛ **العكس لا يفك القفلة الإدارية**.
- **الاستثناء الوحيد الصريح (backpost):** `JournalInput.backpostReason` + endpoint `POST /accounting/journals` يقبل `backpostReason` — يتطلب صلاحية مستقلة `accounting.backpost` (رفض 403 بدونها) + سبب إلزامي + قيد في `activity_log` (`period.backpost`). كل المسارات التلقائية محظورة بغير هذا الاستثناء.
- **كل مسار إقفال محاسبي يمر بنفس checklist ونفس posting flow** — لا يوجد مسار «قفل بلا قيد» إطلاقًا بعد الفصل.
- **Web:** لا استدعاءات لأي endpoint محذوف (مسارات `/accounting/periods/*/close|reopen` موجهة مسبقًا إلى `/accounting/periods`).

### التحقق (بوابات الأدلة)
- `tools/smoke-test.js` — اختبارات القفل اليدوي الجديدة: (1) القفل يُطبَّق 201، (2) **`is_closed` لا يتغير** عبر GET periods، (3) الترحيل داخل قفل إداري → 400، (4) فك القفل → الترحيل 201. (Smoke regression كاملة: **570/570**، كان 568 سابقًا — الزيادة = فحوص القفل الإداري.)
- `tools/e6-review-gate.js` — **G14 manual administrative lock ≠ accounting close**: 10 فحوص (قفل 201 · is_closed=false · closing_entry_id=null · قيد 400 داخل القفل · **backpost بصلاحية accounting.backpost ينجح 201** · close-month 400 داخل القفل · reverse-close 400 · unlock 201 · الترحيل بعد الفك 201 · **close-month ينجح 201 بعد unlock+توليد الاستحقاقات**). G17 (سبب فارغ → 400). G18 (محاولة تجاوز بدون صلاحية → 403 ولا سجلات تدقيق).
- **النتيجة:** 105/105 فحصًا ناجحًا في البوابة.

## القسم 2 — Real PostgreSQL Concurrency Test — PostgreSQL 18.6 حقيقي (ليس PGlite)

**البيئة:** عنقود PostgreSQL محلي حقيقي `C:\pgdata` (PostgreSQL 18.6، حساب خدمة `pgwasel`)، قاعدة اختبار جديدة معزولة **`wasel_signoff`** — أُنشئت بـ `tools/realtest/signoff-db-create.js` ثم `migrate-all` (كامل migrations) + `seed-reference` + `seed`. الـ API يعمل على **Port 4270** متصل بـ `wasel_signoff`.

**الاختبار** `tools/realtest/e6-concurrency.js`:
1. إنشاء فترة 2029-06-01..2029-06-30 (ثم 2029-07 عند إعادة التشغيل) — لا قواعد E3 ولا أصول في هذه القاعدة.
2. ترحيل قيد إيرادات (Dr 1101 / Cr 4101 بمبلغ 1,000.00) داخل الفترة.
3. إطلاق **3 طلبات `close-month` متزامنة**.
4. التحقق في القاعدة مباشرةً — **لكل نافذة**:

```
created period: 2 / 3
posted revenue journal: {"journalId":1 / 3}
RETAINED 3103 before close: 0 / 1000.00
three concurrent close-month statuses: 201, 400, 400     (نافذتان متتاليتان)
close #1: 201  netProfit=1000  journalId=2 / 4
close #2/#3: 400 «الفترة ... مقفلة بالفعل — لا يمكن إقفالها مرة أخرى»
elapsed ms: 70 / 62
period_close journals: 1
period row: {"is_closed":true,"closing_entry_id":"2"/"4","net_income":"1000.00"}
journals in period: manual(posted, balanced) + period_close(posted, balanced)
RETAINED 3103 after close: 1000.00 / 2000.00   (delta = +1000.00 بالضبط مرة واحدة)   ← NO double count
trial balance balanced: true
re-close status: 400  «... مقفلة بالفعل ...»   (رفض عربي واضح)
activity_log 'period.close' rows for the period: 1
RESULT: 11/11 checks passed   EXIT=0
```

**القبول المعروض عليه:** قيد إقفال واحد فقط ✓ · `closing_entry_id` واحد ✓ · RETAINED يرحّل مرة واحدة فقط ✓ · TB متوازن ✓ · إعادة الطلب → 400 برسالة عربية ✓ · سجل التدقيق صف واحد ✓ · **الخلاصة: PASS على PostgreSQL الحقيقي (مرتان متتاليتان).**

## القسم 3 — E3/E5 Override Authorization — تم بالكامل

### المتطلبات المصاغة → التنفيذ
| المتطلب | التنفيذ |
|---|---|
| صلاحية مستقلة ومحددة لكل تجاوز، ليست `accounting.close` وحدها | صلاحية جديدة **`accounting.close_override`** (seed؛ المحاسب لا يحصل عليها افتراضيًا؛ Admin فقط) |
| سبب إلزامي + سجل (مستخدم/تاريخ/سبب/القاعدة/الأصل/الفترة/المبلغ) | جدول **`period_close_overrides`** (migration additive): `check_code` (`e3_bank_expense_due`/`e5_depreciation_due`)، `due_key` (`rule:<id>:<date>` / `asset:<id>:<YYYY-MM>`)، `due_label`, `due_amount`، `reason`، `created_by`, `created_at` |
| منع التكرار/التغيير بعد الاعتماد | **UNIQUE (period_id, check_code, due_key)** · لا أي endpoint تعديل/حذف · تسجيل التجاوز داخل **نفس معاملة الإقفال** → لو فشل الفحص تُرد كل الصفوف (لا سجلات معلّقة لإغلاق فاشل) |
| مستخدم `accounting.close` وحده → 403 ولا تغيير | `waive()` يرمي `ForbiddenException` (403) قبل أي كتابة؛ المعاملة تُلغى بالكامل؛ الفترة تبقى مفتوحة |
| استحقاق واحد متجاوز والباقي يظهر بالنتيجة | التجاوز per-item هو الافتراضي: الباقي يُدرج مع أسمائه ومبالغه في رسالة الرفض (`remaining`) وتفاصيل الفحص، ولا يُخفى أي استحقاق |
| التوجل/التفعيل والصلاحيات في الاتنين (seed + security) | الصلاحيات تُبذر في `seed.ts` وتستهلك عبر `@RequirePermissions` / `user.permissions.includes` |

### سلوك آخر مهم
- **Whole-check bypass (legacy `bypassReason`)** أيضًا يتطلب `accounting.close_override`؛ بدونها 403.
- **Failing close يسجّل التجاوزات فقط مع نجاح الإقفال** — لا صفوف تدقيق مسربة لمحاولة مرفوضة.
- `period_close_overrides` يُعرض في `GET /accounting/periods/:id/close-report` (مع المنفّذ والمبلغ والسبب والتاريخ) — دون أي مسار تعديل.
- رسالة الرفض **تذكر كل العناصر** (أسماء + مبالغ لكل واحد) — يتيح للمراجع رؤية كل ما هو مستحق غير المُولّد.
- التفصيل الكامل في `period_close_checks.details` (status=3) مع كل عنصر.

### التحقق (G15 — 17 فحصًا)
1. إنشاء مستخدم بدور Accountant موسّعة بـ `accounting.close` **دون** `accounting.close_override` ✓ 2. إنشاء كاشير بدون أي صلاحية إقفال ✓
3. الإقفال بلا تجاوز ← 400 والرسالة تذكر كل الاستحقاقات (الأسماء) ✓
4. مستخدم accounting.close وحده يستخدم `bypassReason` ← **403** ولا يتغير شيء (is_closed=false) ✓
5. كاشير يستخدم `overrides` ← **403** ✓
6. تجاوز عنصر واحد فقط ← 400 والباقي يظهر (اسم العنصر الباقي في الرسالة) ✓
7. تجاوز جميع الاستحقاقات التسعة (6 قواعد E3 + 3 أصول E5 في فبراير 2027) ← **201** ✓
8. تقرير الإقفال يحتوي **9 صفوف تجاوز** (مبالغ > 0، أسباب، المنفّذ) في E3 وE5 معًا ✓
9. G17: سبب فارغ ← 400 ✓ · G18: كل محاولة بلا صلاحية ← 403 و**صفر صفوف** في السجل ✓

## القسم 4 — Final Regression بعد الإصلاح — كامل ونظيف

| البوابة | الأثر | النتيجة |
|---|---|---|
| `npm test` (smoke-test, قاعدة طازجة `wasel_e6rev` معزولة) | **570/570** (568 السابقة + فحصَي القفل الإداري الجديدين؛ الأقسام 44–48 والإقفال والتجاوزات محدّثة لفحص السلوك الصحيح) | ✅ EXIT=0 |
| E6 review gate (نفس البيئة الطازجة) | **105/105** (السابقة 80 + G14 قفل≠إقفال 10 + G15 تفويض التجاوز 17 + G17/G18 + حقول التقارير والتدقيق) | ✅ EXIT=0 |
| Real PostgreSQL concurrency (`wasel_signoff` :5432/PG 18.6) | **11/11** | ✅ EXIT=0 |
| Month-2/Month-3 verification (`wasel_month2` + `tools/month2-audit.js` + TB API) | انظر التفصيل أدناه | ✅ مطابق حتى القرش |
| TB final | **2,134,078.42 = 2,134,078.42** (46 قيدًا / 166 سطرًا — صفر قيد غير متوازن، صفر قيد مسودة غير مرحّل، صفر سطر يتيم) | ✅ متوازن |
| Equation | 1,286,841.45 = 766,576.00 + 520,265.45 (أ = خ + حق) | ✅ دقيقة |
| October 2026 close | قيد #30 `period_close` −6,974.44 مرحّل بتاريخ الفترة، متوازن | ✅ |
| November 2026 close | قيد #46 `period_close` −1,960.11 مرحّل بتاريخ الفترة، متوازن | ✅ |
| ACTUAL vs EXPECTED | الأصول 1,286,841.45 · الخصوم 766,576.00 · حقوق الملكية 520,265.45 · RETAINED 190,265.45 (من 199,200) · المخزون 540,505.56 · خسارة الشهرين −8,934.55 · ذمم 142,976 / 681,422 — كلها بلا تغيّر | ✅ Expected vs Actual حتى القرش |

**ملاحظات بعد الإصلاح (bugs تم اكتشافها وأُصلحت أثناء هذا التوقيع):**
- **[F-1]** عمود `amount` لم يكن ضمن SELECT فحص E3 في `runCloseChecklist` فظهرت الاستحقاقات بمبلغ NaN — أُصلح (المبالغ الآن تعرض/تُسجّل فعليًا).
- **[F-2]** رسالة رفض الإقفال كانت تذكر عناوين الفحوص فقط — وأصبحت تتضمن **تفاصيل كل عنصر مستحق** (الاسم + المبلغ) — متطلب «كل استحقاق ظاهر للمستخدم في نتيجة الفحص».
- **[F-3]** تفاصيل فحوص E3/E5 تسجّل نص سبب التجاوز (bypassReason) عند نجاح التجاوز — التتبع الكامل.
- **[F-4]** قاعدة `wasel_month2` احتاجت الـ migration الجديدة additive — طبّقت (بلا أي أثر على البيانات/المنطق؛ نفس ما طُبّق على `wasel_signoff`).
- smoke-test بعد تشغيلين على نفس القاعدة يفشل متوقعًا في payroll (التوليد مرة واحدة لكل شهر) — **يجب تشغيل smoke على قاعدة طازجة فقط**؛ كل الأرقام هنا من تشغيل واحد على قاعدة طازجة.

**الأداء/الصحة العامة للبوابات:** الـ gate الآن يتحقق من القفل الإداري والترخيص والتجاوزات والتسجيل والتدقيق في مسار الإقفال نفسه، ويترك القيود المالية دون تغيير. E1 (المطابقة البنكية) وE3 (الرسوم) وE5 (الإهلاك) مغطاة داخل smoke-test كما هي (الأقسام الجديدة لا تتعارض — نفس 570/570)، ومربعات الطباعة/الوردية/الحذف لم تتأثر.

**ما لم يُنفذ (خارج النطاق المصرّح به):** نشر إنتاج · migrations على Supabase الإنتاج · E2/E4 · تفعيل الرصيد المتناقص في الواجهة · ملفات PDF/Excel للأصول — قائمة كما سبق.

**السجل/ال commits:** الإصلاح موزع على commits مرحلية موثقة في `git log` (`7538f8c` E6 → `c5d9b05` إصلاحات المراجعة → `8fb6d25` gate/reset → `f47dc4c` التقرير السابق) + هذا التوقيع النهائي (commit أدناه — راجع `git log`).

**الحالة: التسليم بانتظار الاعتماد.**
