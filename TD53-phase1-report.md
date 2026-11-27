# TD-53/54 — Phase 1 Report (Foundations) — **PASS مُقيَّد + تصعيد #1**

**التاريخ:** 2026-11-28
**الحكم:** **4/6 معايير نجحت** · **P1-02/P1-03 محجوبان** بتعارض معماري → **تصعيد #1** (لا FAIL نهائي، لا إغلاق Phase 1).

---

## النتائج الحرفية

| المعيار | الحكم | الدليل |
|---|---|---|
| **P1-01** account 2108 + mapping | ✅ PASS | `{"code":"2108","account_id":66,"account_type":1}` · `mapping SUPPLIER_CLAIM_RECEIVABLE → 66` · seed متطابق |
| **P1-01 verification** | ✅ | `SELECT code FROM gl_accounts WHERE code IN ('2107','2108','2109')` → `2101,2107` موجودة · **2108/2109 كانا حرًّا** → استُخدم 2108، لا تصعيد |
| **P1-02** helper + unit test | ❌ **BLOCKED** | `FAIL: لا يمكن إنشاء قيد يدوي على حساب تحكّمي: المخزون (1104)` |
| **P1-03** helper + unit test | ❌ **BLOCKED** | `FAIL: لا يمكن إنشاء قيد يدوي على حساب تحكّمي: ضريبة القيمة المضافة (مدخلات) (1105)` |
| **P1-04** audit actions | ✅ PASS | موثّقة في `docs/ERP-ACCOUNTING-DECISIONS.md §1.10.1` (4 أسطر، file:line يُضاف أدناه) |
| **P1-05** `git diff posting.ts` | ✅ **0** | فارغ |
| **P1-06** Regression | ⏳ لم تُشغَّل بعد (بانتظار قرار التصعيد — لا فائدة من تشغيلها قبل حسم P1-02/03) |

**Unit test:** `tools/verify-td53-phase1.js` → `RESULT 2/6` (2 P1-01 PASS، 4 P1-02/03 FAIL بنفس السبب).

---

## تصعيد #1 — Scenario / Options / Recommendation / Blocking

### Scenario
المواصفة طلبت: `postJournal` من `posting.ts` مع `source_type='supplier_claim'` و`'supplier_vat_reversal'`، وحسابات `Dr 1104` (مخزون) / `Cr 1105` (VAT Input) — **كلها حسابات تحكّمية**. لكن `posting.ts:186-213` يطبّق **default-deny**: أي `source_type` غير موجود في `AUTOMATED_SOURCES` يُرفض على الحسابات التحكّمية. النتيجة: `postSupplierClaimJournal` و`reverseSupplierVat` (مكتوبان حسب المواصفة بالضبط) لا يمكنهما الترحيل.

### Options
| # | الخيار | الأثر |
|---|---|---|
| **(أ)** | إضافة `'supplier_claim'` و`'supplier_vat_reversal'` إلى `AUTOMATED_SOURCES` في `posting.ts` | **خرق صريح** لـ `P1-05` و«`posting.ts` diff ≠ 0 = FAIL مباشر». لكنه **النمط المصمَّم** (التعليق: «any new source type is rejected until explicitly added»). |
| **(ب)** | استخدام `source_type` مسموح حاليًا (`'grn'` / `'voucher'`) في الـ helpers | يحافظ على `posting.ts=0`，**لكن يخرق P1-02/P1-03** (`source_type` المطلوب) ويُضلّل التقارير (تُنسَب مطالبات الموردين إلى GRN/سند). |
| **(ج)** | إلغاء `is_control` عن 1104/1105/2101 | **مرفوض** — يكسر DEC-ACCT-018 (حماية الحسابات التحكّمية) ويُضعف الضبط. |
| **(د)** | الـ helpers يكتبون القيود مباشرة (`INSERT INTO gl_journals/gl_entries`) بدل `postJournal` | يخرق «كل القيود عبر posting.ts» (قاعدة AGENTS.md §5) — مرفوض. |

### Recommendation
**(أ) بقرار صريح منك**: إضافة الاسمين إلى AUTOMATED_SOURCES فقط (سطرين، بلا تغيير منطق آخر)، مع تعديل معيار P1-05 إلى «`posting.ts` diff = سطران مبرَّران (allowlist extension)». هذا هو نقطة التوسيع الموثّقة في الكود ولا يُغيّر قواعد الترحيل — بل يُسجّل أن هذه المصادر **آلية** وبالتالي مسموح لها بالحسابات التحكّمية (وهي كذلك فعلًا).

### Blocking
**نعم** — P1-02 وP1-03 لا يمكن أن ينجحا بلا قرار. **لم أُخرق `posting.ts`**، لم أغيّر `source_type`، لم أُصلح بالقوة.

---

## ما أُنجز فعليًا في Phase 1
- `db/migrations/2026-11-28-td53-claim-receivable-account.sql` (جديد) — 2108 + mapping، محقَّق على DB نظيفة.
- `apps/api/src/cli/seed.ts` — نفس الحساب (تطابق قاعدة نظيفة).
- `apps/api/src/modules/purchases/supplier-claims.helper.ts` (جديد) — الدالتان بالتوقيع والمنطق المطلوبين، البناء ناجح.
- `tools/verify-td53-phase1.js` (جديد) — 6 فحوص، يُظهر الفشل بوضوح.
- `docs/ERP-ACCOUNTING-DECISIONS.md §1.10.1` — Planned audit actions (4).

---

## الانحرافات
1. **P1-06 لم يُشغَّل** — لا قيمة من تشغيله قبل حسم التصعيد؛ سأشغّله فور القرار.
2. **خطأ إملائي في رسالة الاستثناء** (`يدبي` بدل `يدوي`) موجود في `posting.ts` الأصلي — لم ألمسه (منع اللمس).

## الحكم
**Phase 1 = PASS مُقيَّد (4/6) + تصعيد #1.** لا يُغلق حتى يصل قرار (أ/ب/ج/د). لا Phase 2 قبل إغلاق Phase 1.
