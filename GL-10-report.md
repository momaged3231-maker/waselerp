# GL-10 — الموازنات (Budgets): تقرير التحقق النهائي

**التاريخ:** 2026-11-19
**الحكم:** **PASS — 12/12 معيارًا** · الانحدار أخضر بالكامل (115/115 فحصًا في 9 مجموعات مباشرة + smoke 606/606)
**القيود التنفيذية:** لا commit · لا push · لا إنتاج · لا Supabase — PGlite محلي معزول فقط.
**الإصدار:** `unpinned working tree @ 50006ca` (كل التعديلات غير ملتزمة).

> مرجع دورة المبيعات المعتمد في هذه الوثيقة: **Sales Cycle (B5) مغلق — 11 قرارًا محاسبيًا من 28** (لا يُكتب «28/28»).

---

## 1) ما أُنجز

| البند | القيمة الحرفية |
|---|---|
| **Migration** | `db/migrations/2026-11-19-gl10-budgets.sql` (مُسجّلة في `schema_migrations`: `migration_row = 1`) — **إضافية فقط**: 135 → 137 جدولًا أساسيًا |
| الجداول | `budgets` (رأس: فرع NOT NULL + سنة + اسم + حالة + عملة + created/approved/closed/supersede) · `budget_lines` (حساب + مركز تكلفة NULLable + شهر 1..12 + مبلغ `numeric(18,2)`) |
| الفهارس | `ix_budgets_*` (3) · `ix_bl_*` (2) · **فهارس فريدة جزئية** `ux_bl_nocc` (لـ `cost_center_id IS NULL`) و`ux_bl_cc` (لغير NULL) — لأن `UNIQUE` العادي لا يمنع تكرار NULL في Postgres |
| العرض | `v_budget_actual` — الفعلي = `credit − debit` للحسابات 4xxx و`debit − credit` للـ 5xxx، من `gl_journals.journal_date` مع `status = 2` فقط، وباستبعاد `is_group = true` |
| الصلاحيات | `accounting.approve_budget` · `accounting.close_budget` — أُضيفتا إلى `PERMISSIONS` ودور `Accountant` في `apps/api/src/cli/seed.ts` (النتيجة: `permissions: 53, roles: 5`) |
| الواجهة | **لا شيء** — لا UI في هذا النطاق (0 ملفات web تحتوي `budget`) |
| البناء | `cd apps/api && npm run build` → ناجح (لا أخطاء TypeScript) |

### عمود التاريخ — تحقّق قبل الكتابة (لا افتراض)

`gl_entries` **لا يحتوي عمود تاريخ** (`entry_id, journal_id, line_no, account_id, debit, credit, description, cost_center_id, party_id, branch_id, currency_code, foreign_amount, exchange_rate, created_at`). التاريخ في `gl_journals.journal_date`، والحالة `2 = posted`. لذلك لا يُستبعد أي قيد عكس: قيود العكس سطور مرحّلة بإشارات معاكسة وتُحتسب طبيعيًا (GL10-10).

---

## 2) نقاط النهاية (9)

| # | Method + Path | الصلاحية |
|---|---|---|
| 1 | `GET /accounting/budgets?year=` | `accounting.view` |
| 2 | `GET /accounting/budgets/:id` | `accounting.view` |
| 3 | `POST /accounting/budgets` | `accounting.manage` |
| 4 | `PATCH /accounting/budgets/:id` | `accounting.manage` |
| 5 | `POST /accounting/budgets/:id/approve` | `accounting.approve_budget` |
| 6 | `POST /accounting/budgets/:id/close` | `accounting.close_budget` |
| 7 | `POST /accounting/budgets/:id/revise` | `accounting.manage` |
| 8 | `GET /accounting/reports/budget-vs-actual?budget_id=&month=&format=csv` | `accounting.view` |
| 9 | `GET /accounting/reports/budget-alerts?year=&month=` | `accounting.view` |

كلها في `apps/api/src/modules/accounting/accounting.slice.ts`، مقيدة بالفرع عبر `@CurrentBranch()`.

**أداة التحقق:** `tools/verify-gl10.js` (قابلة لإعادة التشغيل؛ كل فحوص المبالغ delta-based).
**الأمر:** `$env:API_BASE='http://127.0.0.1:4001/api'; $env:PGPORT='5434'; $env:PGDATABASE='postgres'; node tools/verify-gl10.js`
**السجل:** `%TEMP%\gl10-verify-2.txt` — `TOTAL: 12/12`.

---

## 3) GL10-01 .. GL10-12 — النتيجة الحرفية

| المعيار | الحكم | القيم الفعلية (من السجل) |
|---|---|---|
| **GL10-01** المخطط إضافي | ✅ PASS | `budgets=true, budget_lines=true, view=true, cc_nullable=YES, month_type=smallint, partial_indexes=2, base_tables=137, migration_row=1` |
| **GL10-02** الصلاحيات | ✅ PASS | `permission_codes=2, accountant_role_codes=2, cashier_create=403` |
| **GL10-03** إنشاء + 7 رفض | ✅ PASS | `passed=8/8` — مسودة `status=1, lines=2, plannedTotal=10000`؛ رفض: أصل 1101 «مسموحة للإيرادات والمصروفات فقط» · حساب تجميعي 4 · شهر 13 · مبلغ سالب · بند مكرر · بنود فارغة · اسم مكرر (كلها 400) |
| **GL10-04** عملة القاعدة فقط | ✅ PASS | `USD=400, SAR=400`, الرسالة «الموازنات بالعملة الأجنبية غير مدعومة في v1»، موازنة صحيحة `currency=EGP` |
| **GL10-05** اعتماد مستخدم ثانٍ | ✅ PASS | `approve=201, status=2, approved_by=4, approved_at موجود, reason=null, reapprove=400` |
| **GL10-06** SoD | ✅ PASS | بلا سبب `400` + الرسالة تذكر `sameUserApprovalReason`؛ بسبب `201` والسبب محفوظ حرفيًا «اعتماد ذاتي — اختبار GL-10 (سبب موثّق)» |
| **GL10-07** المعتمدة لا تُعدّل | ✅ PASS | `PATCH=400` · القديم `status=4, superseded_by=12` · الجديد `supersedes_id=10, status=1, copied_lines=1` · محاولة مراجعة ثانية للإصدار القديم `400` · المسودة قابلة للتعديل `PATCH=200` و`plannedTotal=8000` |
| **GL10-08** إغلاق مستقل عن E6 | ✅ PASS | إغلاق مسودة `400`؛ بعد الاعتماد `close=201, status=3`؛ إعادة الإغلاق `400`؛ `journalsDelta=0, periodsChanged=false, budgetJournals=0`؛ قراءة/تقرير `200`؛ تعديل مغلقة `400` |
| **GL10-09** مخطط مقابل فعلي | ✅ PASS | `4101=6552.50` · `5101=3294.51` · `4106=0` (وقت الفحص) — مطابق لـ SQL مستقل؛ `planned=10100, actual=10447.01, variance=-347.01, overBudgetLines=2`؛ فلتر شهر 11 → 2 أسطر، شهر 12 → سطر؛ CSV يحمل الإجمالي و`4101` |
| **GL10-10** is_group + العكس | ✅ PASS | `groupRows=0` (حسابان تجميعيان 43/51 لا يُطابَقان) · قيد +500: الفعلي `600 → 1100` (Δ=+500) · قيد مرآة −500: `1100 → 600` (Δ=0) · سطران في قيدين `status=2` |
| **GL10-11** مركز التكلفة | ✅ PASS | `unallocated=7070.00` · `allocated(CC-VERIFY)=617.25` · المجموع `7687.25` = إجمالي الفرع `7687.25` · سطر لكل بucket |
| **GL10-12** تحذير فقط | ✅ PASS | ترحيلان فوق الموازنة `201, 201` · تنبيه `planned=100, actual=1200, excess=1100` · `budgetRefsInPosting=0, budgetLinesInDiff=0, webFiles=0, requireCostCenterAccounts=0, budgetJournals=0` |

**مجموع التحقق:** `TOTAL: 12/12`.

---

## 4) عيّنة حقيقية من `budget-vs-actual`

`GET /accounting/reports/budget-vs-actual?budget_id=14` — إخراج API حرفي (الفرع 1، السنة 2026، عملة EGP):

```json
{
  "budget": { "budgetId": 14, "branchId": 1, "year": 2026, "name": "GL10-66782587-math", "status": 2, "currencyCode": "EGP" },
  "month": null,
  "lines": [
    { "lineId": 23, "accountId": 44, "accountCode": "4101", "accountName": "المبيعات", "accountType": 4, "costCenterId": null, "costCenterName": null, "periodMonth": 11, "plannedAmount": 7000, "actualAmount": 6552.5, "variance": 447.5, "variancePct": 6.39, "overBudget": false },
    { "lineId": 24, "accountId": 52, "accountCode": "5101", "accountName": "تكلفة المبيعات", "accountType": 5, "costCenterId": null, "costCenterName": null, "periodMonth": 11, "plannedAmount": 3000, "actualAmount": 3294.51, "variance": -294.51, "variancePct": -9.82, "overBudget": true },
    { "lineId": 25, "accountId": 49, "accountCode": "4106", "accountName": "إيرادات الخدمة", "accountType": 4, "costCenterId": null, "costCenterName": null, "periodMonth": 12, "plannedAmount": 100, "actualAmount": 1200, "variance": -1100, "variancePct": -1100, "overBudget": true }
  ],
  "totals": { "planned": 10100, "actual": 11047.01, "variance": -947.01, "overBudgetLines": 2 },
  "allocated":   { "lines": 0, "planned": 0, "actual": 0 },
  "unallocated": { "lines": 3, "planned": 10100, "actual": 11047.01 }
}
```

> ملاحظة زمنية: عند GL10-09 كان فعلي 4106 = `0`؛ بعد قيود GL10-12 (+500 ثم +100 على نفس الشهر) أصبح `1200`. الأرقام في العيّنة أعلاه بعد GL10-12، وهي متطابقة مع التنبيه (`1200 − 100 = 1100`).

---

## 5) دليل `posting.ts` — GL10-12

| الفحص | النتيجة الحرفية |
|---|---|
| `git diff --numstat -- apps/api/src/common/posting.ts` | `121  12  apps/api/src/common/posting.ts` (**عمل سابق غير مُلتزم** من E2/E6 — انظر الانحرافات) |
| عدد أسطر `budget` داخل هذا الـ diff | **0** |
| عدد ورود `budget` داخل `posting.ts` نفسه | **0** |
| `mtime(posting.ts)` | `2026-11-19T04:44:55.003Z` |
| `mtime(migration)` | `2026-11-19T05:34:57.622Z` — أي أن الملف لم يُلمس بعد بدء GL-10 |
| قيود بمصدر `budget` | `budgetJournals = 0` |
| ملفات الواجهة التي تحتوي `budget` | `webFiles = 0` |
| حسابات تفرض مركز تكلفة | `requireCostCenterAccounts = 0` (لم يتغير) |

**الخلاصة التقنية:** مساهمة GL-10 في `posting.ts` = **صفر سطر**. تجاوز الموازنة يُنشئ تنبيهًا في تقرير منفصل ولا يوقف الترحيل (`201`) — لا حظر، لا تعديل محرك القيد المزدوج.

---

## 6) الانحدار (B1 … B5.4 + smoke) على قاعدة نظيفة

**بيئة معزولة جديدة تمامًا:** PGlite على المنفذ `5437` (دليل `tools/pg/pglite/data.gl10-regress2`) + API على `4003`، منفصلة عن 4000/4001/5432/5434.

**خطوة التجهيز:** `run-sql.js` (قاعدة + schema) → `migrate-all.js wasel` → `seed.ts` → `seed-reference.js`.
**عدد تحقّق أولي:** `base_tables=137 · migrations=55 · perms=53 · users=1 · invoices=0 · gl_entries=0`.
**بعد الانحدار:** `budgets=0 · budget_lines=0 · budget_journals=0` — أي أن اختبارات الانحدار لم تلمس GL-10.

| المجموعة | الأمر | النتيجة |
|---|---|---|
| B1 | `npm run test:purchases` | **14/14** |
| B2 | `npm run test:purchases-invoice` | **15/15** |
| B3 | `npm run test:purchases-match` | **8/8** |
| B4 | `npm run test:purchases-statement` | **6/6** |
| B5.1 | `npm run test:credit-limit` | **16/16** |
| B5.2 | `npm run test:sales-return` | **17/17** |
| Integration | `npm run test:sales-integration` | **6/6** |
| B5.3 | `npm run test:sales-return-extra` | **9/9** |
| B5.4 | `npm run test:sales-credit-note` | **24/24** |
| Smoke | `node tools/smoke-test.js` (`API_BASE=4003`) | **606/606 checks passed** |

**ترتيب التنفيذ** مطابق لـ `B5-FINAL-REGRESSION-LOG.md`: B1→B2→B3→B4→B5.1→B5.2 → smoke → B5.3 → B5.4 → Integration (B5.2/B5.3/B5.4 تترك بيانات متبقية، لذلك جرى الـ smoke قبلها).

> شفافية: محاولة أولى على منفذ `5436` أُلغيت بالكامل لأن اختبارات B3/B4/B5.1 تستدعي API على `:4000` الذي لا يزال يشير إلى قاعدة ديمو قديمة فظهرت `404` (7/8 · 5/6 · 15/16). أُعيدت على قاعدة نظيفة مع `API_BASE=http://127.0.0.1:4003/api` فظهرت الأرقام المعتمدة أعلاه. لا تُستخدم أرقام المحاولة الأولى كدليل.

---

## 7) الانحرافات والقيود الموثقة

1. **`git diff posting.ts` ليس «0 سطر» حرفيًا**: يظهر `121/12` ناتجًا عن عمل E2/E6 غير مُلتزم سابقًا في نفس الشجرة (mtime `04:44:55Z` قبل ملفات GL-10 بـ ~50 دقيقة). **مساهمة GL-10 = 0 سطر** (صفر ورود `budget` في الملف أو في الـ diff، وclause `assertPeriodOpen/backpost` تعود لما قبل GL-10). هذا انحراف عن الصيغة الحرفية للمعيار GL10-12 وهو موثّق هنا بدل الادعاء بـ 0.
2. **دلالة `cost_center_id = NULL`**: وُجد أثناء تصميم التحقق أن الصيغة الأصلية للعرض كانت تطابق «كل المراكز» عند NULL، فتتحقق «موزّع + غير موزّع > إجمالي الفرع». صُحّحت إلى `IS NOT DISTINCT FROM` (NULL = سطور بلا مركز فقط) قبل التشغيل النهائي — النتيجة `7070.00 + 617.25 = 7687.25`. هذا توضيح دلالة داخل النطاق المعتمد، لا توسيع له.
3. **لا شاشة `/accounting/budgets`**: خطة `ERP-ROADMAP.md` (المرحلة B) تذكر شاشة، لكن الـ Go المعتمد for GL-10 جمّد النطاق على API + تقرير فقط. لم يُنشأ أي ملف واجهة.
4. **تحذير فقط**: التجاوز لا يمنع الترحيل؛ التنبيه متاح عبر `GET /accounting/reports/budget-alerts` فقط. لا تعديل على `posting.ts` ولا ربط بالقيود.
5. **تخفيف SoD**: الموافقة على إنشاء نفس المستخدم واعتماده بشرط `sameUserApprovalReason` إلزامي محفوظ؛ `approved_by` NOT NULL عند الاعتماد. قرار مالك موثّق في `GL-10-Scope-Answers.md`.
6. **العملة الأساسية فقط**: أي `currencyCode` غير `EGP` يُرفض 400 في v1 — لا تحويل عملات.
7. **فصل كامل عن E6/الفترات**: `status=3` للموازنة إغلاق إداري مستقل؛ لا `assertPeriodOpen`، لا قيد إقفال، لا تعديل على `periods` (أثبت GL10-08: `journalsDelta=0, periodsChanged=false`). الأشهر مأخوذة من `budget_lines.period_month` لا من جدول `periods`.
8. **القيود المعتمدة للنطاق**: حسابات 4xxx/5xxx غير التجميعية فقط · فرع إلزامي + مركز اختياري · لا ربط بـ `require_cost_center` · لا حظر · لا Supabase/إنتاج.

---

## 8) الملفات الملموسة

| الملف | التعديل |
|---|---|
| `db/migrations/2026-11-19-gl10-budgets.sql` | جديد — الجداول + الفهارس + العرض (بما فيها تصحيح دلالة NULL) |
| `apps/api/src/modules/accounting/accounting.slice.ts` | خدمة الموازنات + 9 endpoints (مع `Patch` و`round2`) |
| `apps/api/src/cli/seed.ts` | صلاحيتان جديدتان + إسنادهما لدور المحاسب |
| `tools/verify-gl10.js` | جديد — حزام تحقق GL10-01..12 |
| `GL-10-Scope-Answers.md` | إجابات النطاق المعتمدة (من قبل التنفيذ) |
| `apps/api/src/common/posting.ts` | **لم يُلمس** (0 سطر GL-10) |

---

## 9) الحكم النهائي

**GL-10 PASS (12/12) — الانحدار 115/115 عبر 9 مجموعات مباشرة + smoke 606/606.**
لا نشر، لا التزام، لا Supabase. **لم يبدأ GAP-08** — بانتظار «Go» مستقل من المالك.
