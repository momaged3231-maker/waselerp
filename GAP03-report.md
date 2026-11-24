# GAP-03 — Report (Warranty Policy Enforcement + TD-56)

**التاريخ:** 2026-11-24
**القرار:** Go صدر (14 معيارًا: A/B/C/D) — نُفِّذ Part C أولًا (TD-56).
**النتيجة:** **14/14 PASS** ✅
**البيئة:** PGlite :5610 (migrate + seed، 57 صلاحية) + API :4032 · انحدار على :5612/:5614.

---

## 1) النتائج — 14 معيارًا

| # | المعيار | الحكم | الدليل الحرفي |
|---|---|---|---|
| **01** | Schema: 4 أعمدة + CHECK | ✅ PASS | `cols=4/4 check=1` — `warranty_start_date`, `warranty_end_date`, `warranty_charged`, `warranty_charge_reason` + `ck_maintenance_tickets_warranty_dates` |
| **02** | مدة افتراضية من product/model | ✅ PASS | `tables=2/2 derivedEnd=2027-11-23` (من `warranty_duration_days=365`) |
| **03** | ضمان بلا `warranty_ref` → 400 | ✅ PASS | `status=400 msg=مرجع الضمان إلزامي عند تفعيل الضمان` |
| **04** | ضمان بلا تاريخ بداية → 400 | ✅ PASS | `status=400 msg=تاريخ بداية الضمان إلزامي` |
| **05** | ضمان + `actualCost>0` وغير مُحصَّل → 400 | ✅ PASS | `status=400 msg=لا يمكن تحصيل تذكرة ضمان — استخدم maintenance.charge_warranty` |
| **06** | تحصيل ضمان بلا صلاحية → 403 | ✅ PASS | `status=403 msg=تحصيل تذكرة ضمان يتطلب صلاحية maintenance.charge_warranty` (مستخدم بصلاحية `maintenance.manage` فقط) |
| **07** | تحصيل بصلاحية + سبب → 201 + audit | ✅ PASS | `status=201 reason=عطل متعمد auditRows=1` — `activity_log.action='maintenance.warranty_charge_override'` |
| **08a** | ضمان + قطع + بلا دفع → قيد COGS فقط | ✅ PASS | `ticket=3 journal_id=1 d=14.00 c=14.00` — `تكلفة قطع صيانة — MAIN-0003`، بلا قيد سداد |
| **08b** | عادية + قطع + بلا دفع → قيد COGS (**TD-56 fix**) | ✅ PASS | `ticket=4 journal_id=2 d=14.00 c=14.00` |
| **08c** | عادية + قطع + دفع → COGS + قيد سداد | ✅ PASS | `ticket=11 journal_id=6 سداد d=20.00` + `journal_id=7 تكلفة d=14.00` |
| **08d** | ضمان بلا قطع → لا قيد | ✅ PASS | `ticket=12 journals=[]` |
| **10** | `GET /maintenance/reports/warranty` | ✅ PASS | `status=200 count=8 charged=2 uncharged=6 totalCogs=28` + `overrides[]` |
| **11** | `git diff posting.ts` = 0 | ✅ PASS | `diff=''` |
| **12** | Regression B1..B5.4 + smoke | ✅ PASS | **115/115** + **606/606** (`SMOKE_EXIT=0`) |

**السكربت:** `tools/verify-gap03.js` → **RESULT 13/13** (المعيار 12 نُفّذ خارجيًا = 14/14).

---

## 2) Sample journals (حرفية)

| الحالة | journal_id | source_type | description | Dr | Cr |
|---|---:|---|---|---:|---:|
| **08a** ضمان بلا دفع | 1 | `maintenance_ticket` | تكلفة قطع صيانة — MAIN-0003 | 14.00 | 14.00 |
| **08b** عادية بلا دفع (TD-56) | 2 | `maintenance_ticket` | تكلفة قطع صيانة — MAIN-0004 | 14.00 | 14.00 |
| **08c** عادية بدفع | 6 | `maintenance_ticket` | سداد صيانة — MAIN-0011 | 20.00 | 20.00 |
| **08c** عادية بدفع | 7 | `maintenance_ticket` | تكلفة قطع صيانة — MAIN-0011 | 14.00 | 14.00 |

كل قيد COGS = `Dr COGS / Cr INVENTORY` بـ `partsCost` (2 قطع × 7.00 متوسط تكلفة). **لا AR ولا إيراد في 08a/08b** (بلا قيد سداد).

---

## 3) ما نُفِّذ (Code)

| الملف | التغيير |
|---|---|
| `db/migrations/2026-11-24-gap03-warranty-policy.sql` | 4 أعمدة على التذاكر + `warranty_duration_days` على المنتج/الموديل + CHECK + index (جديد) |
| `apps/api/src/modules/maintenance/maintenance.slice.ts` | helper `assertWarrantyPolicy` (ref/dates/charge/expiry) · `auditWarranty` · حقول جديدة في create/update/inspect/deliver · **TD-56**: نقل قيد COGS خارج `if (paid > 0)` · `warrantyReport()` + endpoint `GET /maintenance/reports/warranty` |
| `apps/api/src/cli/seed.ts` | صلاحيتان جديدتان: `maintenance.charge_warranty`, `maintenance.warranty_override` (المدير يحصل عليهما تلقائيًا) |
| `tools/verify-gap03.js` | 13 فحصًا آليًا + عينات قيود (جديد) |
| `ERP-GAP-REGISTER.md` · `docs/ERP-ACCOUNTING-DECISIONS.md` | TD-53..57 مسجّلة |

---

## 4) TDs

| TD | الحالة في هذه الجولة |
|---|---|
| **TD-56** (COGS مشروط بالدفع) | ✅ **مُصلَح** — 08a/08b يثبتان القيد بلا دفع |
| **TD-57** (`max_charge` ميت) | مسجّل، **مفتوح** (منخفض — لا يعطّل) |
| TD-53 / TD-54 / TD-55 | مسجّلة، مفتوحة (خارجة عن نطاق v1) |
| TD-44 | High — قبل أي release |

---

## 5) الانحرافات (Deviations)

1. **صلاحيتان جديدتان** أُضيفتا للـ seed (55 → 57 صلاحية) — مطلوبتان لـ 06/07 وexpiry override. لا تغيير في الأدوار غير المدير.
2. **تجاور سبب التجاوز:** عند تذكرة ضمان منتهية **غير مُحصَّلة**، يُطلب `warranty_override` + سبب، لكن السبب يُسجَّل في `activity_log` فقط (لا عمود مخصص على التذكرة) لأن مواصفة Part A لم تتضمن `warranty_override_reason`. يُوثَّق هنا.
3. **لا حساب `warranty_claims`** ولا(rpc) مطالبة مورد — قرار صريح (TD-54).
4. **لا أهلية تلقائية** من فاتورة/GRN — قرار صريح (TD-53).
5. **لا UI** — API + تقرير JSON فقط، حسب النطاق.
6. **`posting.ts` لم يُلمس** — القيد عبر `maintenance.slice.ts` مباشرة (GAP03-11).

---

## 6) الحكم

**GAP-03 = PASS — 14/14.** Part C نُفّذ أولًا وأصلح TD-56. الانحدار الكامل أخضر. **لا إنتاج / لا Supabase.**
