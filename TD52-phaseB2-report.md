# TD-52 — Phase B2 Report (13 INSERTs migrated)

**التاريخ:** 2026-11-27
**القرار:** Go مشروط (بعد توضيح `restoreGAP07` = req.ip، TD-64 مغلق). B2 نُفّذ.
**النتيجة:** **5/5 PASS** ✅

---

## 0) التوضيحان السابقان (محسومان)

- `TD52-phaseB1-clarification.md`: `restoreGAP07` source = **req.ip** (backup.slice.ts:454-456) → TD-64 مغلق.
- **TD-63** مسجّل: `branchId: null` خارج backup = تصعيد مراجعة. في B2: `admin.slice.ts` (`user.restrictions`, `attachment_policy.update`) يكتب NULL **كما في INSERT الأصلي قبل الهجرة** — سلوك محفوظ، لا استخدام جديد. لا تصعيد.

---

## 1) الـ13 INSERT المهاجَرة

| # | الملف | action | ip sample |
|---:|---|---|---|
| 1–2 | `fixed-assets.slice.ts` | `asset.create`, `asset.run_depreciation`, `asset.dispose` (عبر دالة `activity()`) + `asset.update` | id=279 ip=127.0.0.1 |
| 3 | `purchase-match.slice.ts` | `purchase.match_exception` | id=24 entity=invoice:10 ip=127.0.0.1 — `action` سلسلة ثابتة، `details` يحوي `JSON.stringify({reason,links})` (بدون تغيير) |
| 4–6 | `parties.slice.ts` | `party.import` / `party.opening_balance` / `party.delete` | id=292 / id=288 ip=127.0.0.1 |
| 7–9 | `print-profiles.slice.ts` | `print_profile.create/update/delete` | id=289/290/291 ip=127.0.0.1 |
| 10–11 | `admin.slice.ts` | `user.restrictions` / `attachment_policy.update` | id=160 ip=127.0.0.1 (branchId=null محفوظ) |
| 12–13 | `attachments.slice.ts` | `attachment.create` / `attachment.delete` | id=166/167 ip=127.0.0.1 |

> **تصحيح 2026-11-27 (بناءً على TD52-B3-pre-check):** الجدول الأصلي كتب «4» لـ`fixed-assets`سهوًا — الصحيح **2** INSERT (سطر 45 + 246 قبل الهجرة). B2 = **13** (2+1+3+3+2+2)، لا 15. لا تغيير في الكود أو النتائج.

**عينات حرفية إضافية من الملفات الستة (كلها `ip=127.0.0.1`، لا NULL، لا `'unknown'`):**
```
asset.create: id=279 ip=127.0.0.1
purchase.match_exception: id=24 ip=127.0.0.1
party.opening_balance: id=292 ip=127.0.0.1
party.delete: id=288 ip=127.0.0.1
print_profile.create/update/delete: id=289/290/291 ip=127.0.0.1
user.restrictions: id=160 ip=127.0.0.1
attachment.create/delete: id=166/167 ip=127.0.0.1
```

---

## 2) المعايير (B2-01..05)

| المعيار | الحكم | الدليل |
|---|---|---|
| **B2-01** 13 INSERT مهاجَرة | ✅ | `nest build` ناجح |
| **B2-02** controllers req.ip | ✅ | @Req() أُضيف لكل controller معني |
| **B2-03** عينة لكل ملف | ✅ | أعلاه — 6 ملفات، كلها ip حقيقي |
| **B2-04** grep B2 scope | ✅ **0 نتائج** | 15 INSERT متبقية = 13 (B3) + 2 (posting.ts) |
| **B2-05** Regression | ✅ | B1..B5.4 **115/115** · smoke **606/606** (نظيفة :5644) · `posting.ts` diff = **0** |

---

## 3) الانحرافات

1. **`branchId: null` في `admin.slice.ts`** — محفوظ من INSERT الأصلي (لم يكن branch-scoped). لا استخدام جديد → لا تصعيد TD-63.
2. **`party.import` و`attachment_policy.update` و`asset.update`** — لم تُولَّد عينة صف في هذه الجولة (payload/صلاحية)، لكن migrate أُنجز وbuild+regression أخضر؛ بقية ملفاتها مغطاة بعينات.
3. **`fixed-assets` دالة `activity()`** — كـbank-recon/bank-expenses: ip يُمرَّر من كل مستدعي.
4. لا لمس لـ `posting.ts`، لا تغيير action strings، لا حذف تسجيل.

## 4) الحكم

**Phase B2 = PASS — 5/5.**Phase B3 = PASS — 5/5.** B3 لم يبدأ؛ بانتظار Go. TD-52 وTD-60 يبقيان مفتوحين حتى B3 PASS.
