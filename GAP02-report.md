# GAP-02 — Report (CRM lost-reason enforcement + transparent win rate)

**التاريخ:** 2026-11-25
**القرار:** Go بـ8 معايير — نُفّذ Parts A/B/C/D.
**النتيجة:** **8/8 PASS** ✅
**البيئة:** PGlite :5618 (schema → **pre-check** → migrations → seed) + API :4038 · انحدار على :5620/:5622.

---

## 0) تحقق ما قبل الـ CHECK (مطلوب صراحةً)

```
SELECT COUNT(*)::int AS bad FROM crm_leads
 WHERE stage=6 AND (lost_reason IS NULL OR trim(lost_reason)='');
```
**النتيجة الحرفية قبل تطبيق الـ migration:** `PRECHECK_BAD_ROWS=0` · `CHECK_EXISTS_BEFORE=0` ✅
⇒ لا تصعيد، لا backfill صامت. الـ migration نفسه يحتوي على `RAISE EXCEPTION` إذا وُجدت صفوف مخالفة على أي قاعدة أخرى.

---

## 1) النتائج — 8 معايير

| # | المعيار | الحكم | الدليل الحرفي |
|---|---|---|---|
| **01** | `PUT {stage:6}` بلا سبب → 400 | ✅ PASS | `lead=1 status=400 msg=سبب الخسارة إلزامي عند الإغلاق كخاسر` |
| **02** | `PUT {stage:6, lostReason:'سعر مرتفع'}` → 200 + audit+ip | ✅ PASS | `status=200 · activity_log_id=1 · action=crm.lead.lost · entity=crm_lead · entity_id=1 · ip_address=127.0.0.1 · details="أُغلق كخاسر — سعر مرتفع"` |
| **03** | DB CHECK يرفض INSERT مباشر | ✅ PASS | `rejected=true · err=new row for relation "crm_leads" violates check constraint "ck_crm_leads_lost_reason"` |
| **04** | تعديل سبب بعد الإغلاق → 200 + old ← new | ✅ PASS | `lead=3 status=200 reason=جديد · activity_log_id=3 · action=crm.lead.lost_reason.edit · details="قديم ← جديد" · ip=127.0.0.1` |
| **05** | مسح صريح للسبب أثناء stage=6 → 400 | ✅ PASS | `lead=3 status=400 msg=لا يمكن مسح سبب الخسارة — غيّر المرحلة أولًا` |
| **06** | winRate 2 won / 1 lost → 67% | ✅ PASS | `winRate={"won":2,"lost":1,"decided":3,"percentage":67}` (كوهورت 2020-01-01 عبر `from/to`) |
| **07** | كوهورت فارغ → صفر/ null | ✅ PASS | `winRate={"won":0,"lost":0,"decided":0,"percentage":null}` — لا قسمة على صفر |
| **08** | Regression + guard | ✅ PASS | **115/115** (B1..B5.4) + **606/606** smoke · **CRM 13/13** · `posting.ts` diff = `''` |

**السكربت:** `tools/verify-gap02.js` → `RESULT 7/7` (المعيار 08 نُفّذ خارجيًا = 8/8).

---

## 2) عينات `activity_log` حرفية

```json
{"activity_log_id":"1","action":"crm.lead.lost","entity":"crm_lead","entity_id":"1","ip_address":"127.0.0.1","details":"أُغلق كخاسر — سعر مرتفع"}
{"activity_log_id":"3","action":"crm.lead.lost_reason.edit","entity":"crm_lead","entity_id":"3","ip_address":"127.0.0.1","details":"قديم ← جديد"}
```

الانتقال `stage=6 → 5` يُسجَّل `crm.lead.stage.change` (نُفّذ في الكود، لا فحص منفصل ضمن الـ8).

---

## 3) ما نُفّذ

| الملف | التغيير |
|---|---|
| `db/migrations/2026-11-25-gap02-crm-lost-reason.sql` | **pre-check with RAISE EXCEPTION** (لا backfill) + `CHECK (stage<>6 OR (lost_reason IS NOT NULL AND length(trim(lost_reason))>0))` (جديد) |
| `apps/api/src/modules/crm/crm.slice.ts` | `updateLead()` مغلف بـ transaction: 400 عربية، منع المسح،3 أحداث audit عبر `logActivity` مع `ip` · `summary(from,to)` يُضيف `winRate` شفافًا · controller يمرّر `req.ip` و`from/to` |
| `tools/verify-gap02.js` | 7 فحوص آلية + عينات audit (جديد) |
| `ERP-GAP-REGISTER.md` · `docs/ERP-ACCOUNTING-DECISIONS.md` | TD-59 مسجّل |

**سلوك محفوظ:** `lost_reason` لا يُمسح عند حفظ لاحق بلا المفتاح (القرار ق-5).

---

## 4) TDs

| TD | الحالة |
|---|---|
| **TD-59** (`closed_at` غائب، cohort-based فقط) | مسجّل، مفتوح (منخفض) |
| TD-58 / TD-53..57 / TD-44 | كما كانت — TD-44 **High قبل release** لم يُغلق |

---

## 5) الانحرافات

1. **`percentage` عدد صحيح `%`** مطابق للواجهة (ق-4)؛ الحقول الخام `won/lost/decided` متاحة للدقة الأعلى.
2. **الفلترة على `created_at`** (cohort) لا وقت الإغلاق — قرار صريح (TD-59).
3. **لا تغيير في `apps/web/app/crm/page.tsx`** — الواجهة تحسب بالفعل من `byStage` وستحصل على `winRate` تلقائيًا دون تعديل كود.
4. **`posting.ts` لم يُلمس**.

---

## 6) الحكم

**GAP-02 = PASS — 8/8.** كل الإلزام على طبقتين (API + DB)، التدقيق مكتمل بـIP، المعدل مصدره API واحد. الانحدار أخضر. **لا إنتاج / لا Supabase.**
