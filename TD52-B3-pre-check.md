# TD-52 — Pre-B3 Check (حسابي، قبل أي كود B3)

**التاريخ:** 2026-11-27
**الغرض:** حلّ التناقض الحسابي في تقرير B2 وتحديد باقي B3 بدقة.

---

## 1) `fixed-assets.slice.ts` — النتيجة الحرفية

```
grep -n "INSERT INTO activity_log" apps/api/src/modules/fixed-assets/fixed-assets.slice.ts
```
**الآن: 0 سطر (مُهاجَرة بالكامل في B2).**

**قبل B2 (`git show b6938aa~1`): 2 سطر — 45 و246.**
- السطر 45: داخل دالة `activity()` المساعدة → `fixed_asset` (أنتج `asset.create/dispose/run_depreciation/reverse_disposal`)
- السطر 246: `asset.update` مباشر

**الخلاصة:** الـ audit الأصلي كان **صحيحًا (2)**. جدول تقرير B2 كتب «4» خطأً — **الاحتمال (ب)**: خطأ في الجدول، لا في الكود ولا في الـaudit. لا re-audit مطلوب.

---

## 2) إعادة audit كامل (حالة ما بعد B2)

```
grep -rn "INSERT INTO activity_log" apps/api/src --include="*.ts"    → 15
grep -rn "INSERT INTO activity_log" apps/api/src --include="*.slice.ts" → 12
```

**تفصيل الـ15 (حرفي):**
| الملف | العدد |
|---|---:|
| `common/audit.ts` | 1 (helper) |
| `common/posting.ts` | 2 (`period.backpost` — TD-62) |
| `catalog/items.slice.ts` | 3 |
| `crm/crm.slice.ts` | 1 |
| `inventory/branch-transfer.slice.ts` | 3 |
| `inventory/stock-transfer.slice.ts` | 2 |
| `sales/documents.slice.ts` | 1 |
| `sales/pos.slice.ts` | 2 |

**الحساب المغلق:** B1 = 27 · B2 = **13** (لا 15) · B3 = **12** · المجموع = 27+13+12 = **52 slice** + 1 helper + 2 posting = **55 total** — مطابق للـ audit الأصلي (52 slice).

---

## 3) جدول B3 الفعلي (12 INSERT)

| ملف | العدد | action |
|---|---:|---|
| `catalog/items.slice.ts` | 3 | `item.components`, `item.import`, `item.bulk_price` |
| `crm/crm.slice.ts` | 1 | `crm.lead.convert` |
| `inventory/branch-transfer.slice.ts` | 3 | `stock.branch_transfer.approve/receive/cancel` |
| `inventory/stock-transfer.slice.ts` | 2 | `stock.transfer.approve/receive` |
| `sales/documents.slice.ts` | 1 | `order.status` |
| `sales/pos.slice.ts` | 2 | `order.split`, `order.move` |
| **المجموع** | **12** | |

**بعد B3:** `grep *.slice.ts` = **0** · `grep *.ts` = **3** (helper + posting×2) → معيار إغلاق TD-52 متحقق.

---

## 4) الملفات التي ذُكرت في سؤالك ولم تظهر في الـ audit

فحصتُها حرفيًا: `hr/payroll`, `installments`, `pos/shift`, `settings/app-settings` — **صفر INSERT مباشر** في كل منها (سجلاتها تمر أصلًا عبر `logActivity` أو لا تكتب activity_log). لا ملفات ناقصة. الـ audit الأصلي كان كاملًا.

---

## 5) الحكم

- **الاحتمال (ب)** هو الصحيح: تقرير B2 كتب «4» لـ fixed-assets سهوًا؛ الصحيح **2** → B2 = 13 (PASS كما نُفّذ فعليًا).
- لا re-audit مطلوب، لا تصحيح كود، لا تغيير في B1/B2.
- **B3 = 12 INSERT** (ليس 13). جاهز للـ Go.
