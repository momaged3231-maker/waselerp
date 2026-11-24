# GAP-02 — Pre-check (CRM)

**التاريخ:** 2026-11-25
**الحالة:** **pre-check فقط — لا Go.** بانتظار مراجعة المالك وإصدار 6–8 معايير.
**البيئة:** PGlite معزول :5616 (`migrate-all` كامل) + فحص كود `apps/api/src/modules/crm/crm.slice.ts` و`apps/web/app/crm/page.tsx`.

---

## 1) `crm_leads` — البنية والقيم

**لا يوجد عمود `status`.** الحقل هو **`stage smallint NOT NULL DEFAULT 1`** — ليس enum ولا varchar.

| stage | الاسم (من `STAGES` في `crm.slice.ts:6`) |
|---:|---|
| 1 | جديد |
| 2 | تم التواصل |
| 3 | مؤهل |
| 4 | عرض سعر |
| 5 | **مكسوب (won)** |
| 6 | **خاسر (lost)** |

**`lost_reason` موجود** (`text`, **nullable=YES**) — الانطباع باسم `loss_reason` خاطئ؛ الاسم الفعلي `lost_reason`.

أعمدة حرفية ذات صلة من `information_schema.columns`:
```
stage          | smallint               | nullable=NO | default=1
lost_reason    | text                   | nullable=YES | default=-
party_id       | integer                | nullable=YES | default=-
converted_at   | timestamp with time zone | nullable=YES | default=-
```
**لا CHECK/UNIQUE constraints على الجدول** (استعلام `pg_constraint` أعاد صفر صفوف). أي: لا قيد يمنع `stage=6` بلا سبب.

---

## 2) مسار الإغلاق كـ lost اليوم

**لا يوجد `closeLead` / `markAsLost`.** الإغلاق يتم عبر **PATCH عام**:

```
PUT /crm/leads/:id   →   CrmService.updateLead()   (crm.slice.ts:117–134)
```

السطر الحاسم (125):
```sql
lost_reason = CASE WHEN $13::boolean THEN $12::text ELSE lost_reason END
```
حيث `$13 = dto.lostReason !== undefined` (سطر 132)، `$12 = dto.lostReason ?? null` (سطر 131).

أي:
- `PUT {stage:6}` → يُغلق كخاسر **بدون أي سبب** (يُبقى `lost_reason` على قيمته السابقة أو NULL).
- `PUT {stage:6, lostReason:'...'}` → يُخزَّن السبب.
- لا تحقق من الـ `stage` نفسه، لا تحقق من الـ `lostReason`، لا تدقيق `activity_log` عند الإغلاق كخاسر (بخلاف `crm.lead.convert` في سطر 160).

**نقطة انتباه:** `lost_reason` يُكتب فقط إن أُرسل المفتاح صراحةً — أي أن إعادة حفظ التذكرة بدون المفتاح **لا تمسح** السبب (مطلوب الحفاظ على هذا السلوك في GAP-02).

---

## 3) هل `loss_reason` مطلوب حاليًا؟

**لا.** الدليل من الكود: `updateLead()` لا يتحقق من الـ stage ولا من السبب — `$13` يُستخدم فقط لتقرير **هل تُكتب القيمة**، لا **هل يُسمح بالتحديث**. لا `BadRequestException` في المسار. DB يسمح NULL.

⇒ المعيار المطلوب «إغلاق lost بلا سبب ← 400» **غير مُطبَّق اليوم**.

---

## 4) هل يوجد endpoint / report لمعدل الكسب؟

**لا يوجد endpoint ولا حقل `winRate`/`win_rate` في الـ API** (`grep` عبر `apps/api/src` = صفر نتائج).

- `GET /crm/summary` (`crm.slice.ts:239–254`, controller:261) يعيد فقط:
  `{ byStage: [{stage,count,value}...], openTickets, dueActivities }`.
- الحساب **في الواجهة فقط**: `apps/web/app/crm/page.tsx:151–156`:
  ```js
  wins = byStage.find(stage === 5).count
  losses = byStage.find(stage === 6).count
  winRate = decided ? Math.round((wins / decided) * 100) : '—'
  ```
  معنوان: «معدل الكسب (محسوم)» و`wins مكسوب / losses خاسر`.

⇒ الصيغة موجودة لكنها **UI-only وغير قابلة للاختبار عبر API**، ولا تُفرق بين lead محسوم فعليًا وlead بسبب ناقص.

---

## 5) الاختبارات الحالية

- `tools/smoke-test.js` يغطي CRM عند السطور **2071–2113** (`GET /crm/summary`، إنشاء lead، `PUT stage:2`، نشاط، تحويل إلى طرف، ثم `summary` مجددًا) — **13 فحصًا** حسب السجل.
- **صفر اختبارات** تغطي إغلاق `stage:6` / سبب الخسارة (`grep tools` عن `lostReason|lost_reason|stage: 6` = صفر نتائج).
- عمليات D7 السابقة تحققت يدويًا (23/23) لكنها **غير مؤتمتة** في repo.

⇒ GAP-02 يحتاج سكربت تحقق مستقل + فحوص انحدار.

---

## 6) ملخص الأسئلة الخمسة

| السؤال | الجواب |
|---|---|
| قيم status؟ | لا `status` — `stage smallint` (1 جديد … 5 مكسوب، 6 خاسر) |
| `loss_reason`؟ | الاسم **`lost_reason`**، موجود، **nullable** |
| مسار الإغلاق؟ | `PUT /crm/leads/:id` → `updateLead()` في `crm.slice.ts:117–134` (لا endpoint مخصص) |
| السبب مطلوب؟ | **لا** — يمكن `stage=6` بلا سبب، بلا تحقق وبلا 400 |
| Win-rate endpoint؟ | **لا** — `/crm/summary` يعطي `byStage` فقط؛ النسبة محسوبة في `page.tsx:151–156` |

---

## 7) ما أحتاجه قبل Go (6–8 معايير)

1. **أين توضع قاعدة الإلزام:** في `updateLead()` فقط، أم في DB CHECK أيضاً (`stage<>6 OR lost_reason IS NOT NULL`)؟ *(أوصي بالاثنين: 400 واضح + CHECK كحماية أخيرة).*
2. **تسمية الحقل في المعايير:** هل نبقي `lostReason` في API أم نضيف alias `lossReason`؟ *(أوصي بالإبقاء على `lostReason` لتوافق الواجهة).*
3. **مصدر رقم المعدل:** هل يُضاف `winRate` إلى `GET /crm/summary` (حساب خادمي) أم endpoint منفصل `GET /crm/reports/win-rate`؟ *(أوصي بإضافته إلى summary مع حقول `won/lost/decided` الشفافة).*
4. **تقريب النسبة:** صحيحة `%` (كما في UI) أم رقم عشري بمنزلتين؟
5. **السلوك عند overwrite:** هل يُسمح بتغيير `lost_reason` لتذكرة خاسرة مغلقة، وهل يُسجَّل `activity_log` (`crm.lead.lost` / `crm.lead.lost_reason.edit`)؟
6. **النطاق الزمني:** هل المعدل محسوب على كل التواريخ أم يقبل `from/to` (للمطابقة مع تقارير GAP-01)؟

**لا كود كُتب، لا Go صدر.** TD-58 مسجّل. TD-44 (GL-10 self-contained) يبقى High — قبل أي release.
