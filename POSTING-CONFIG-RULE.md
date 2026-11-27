# Posting Engine — Configuration vs Logic (TD-69)

**التاريخ:** 2026-11-28 · **مبدأ مُلزِم لكل TD جديد يُدخل `source_type`.**

## الفرق

| | `posting.ts` **Logic** | `posting.ts` **Configuration** (`AUTOMATED_SOURCES`) |
|---|---|---|
| التعريف | قواعد الترحيل: توازن Dr=Cr · `assertPeriodOpen` · حماية `is_control` · قواعد `require_cost_center` · FK/GL | مجموعة أسماء `source_type` المسموح لها بالحسابات التحكّمية |
| الحالة | **غير قابل للتعديل** (immutable) | **append-only** (تنمو مع كل مصدر مالي جديد) |
| مثال تغيير ممنوع | تعديل شرط `is_control && !AUTOMATED_SOURCES.has(...)` · إلغاء فحص التوازن · relaxed period check | — |
| مثال تغيير مطلوب | — | إضافة `'supplier_claim'`, `'supplier_vat_reversal'` (TD-53/54) |

## السابقة (تاريخ الإضافات)
- B1: `grn` · B2: `purchase_invoice` · B4: `supplier_payment` · GAP-06: `voucher` للمراجعة · **TD-53/54: `supplier_claim` + `supplier_vat_reversal`**.
- **default-deny محفوظ:** أي `source_type` جديد بدون إضافة صريحة = مرفوض على الحسابات التحكّمية.

## القاعدة لكل TD جديد
> أي TD يُدخل `source_type` جديدًا يجب أن يتضمن **في نطاقه الصريح** تحديث `AUTOMATED_SOURCES` (سطر واحد داخل الـ Set). لا يُعتبر هذا «تعديل logic» ولا يخرق «`posting.ts` logic unchanged».

## معيار التحقق (يُطبَّق في TD-53/54 P1-05 revised)
```
git diff posting.ts insertions = 2 exactly
git diff posting.ts deletions  = 0
diff lines contain: 'supplier_claim' + 'supplier_vat_reversal'
is_control check line unchanged
default-deny test: sourceType='bogus' on is_control=true → rejected
```
