# TD-52 — Phase B1 Report (27 INSERTs migrated to `logActivity`)

**التاريخ:** 2026-11-27
**القرار:** Go صادر (مذكور في الرسالة؛ Phase B1 فقط).
**النتيجة:** **5/5 PASS** ✅ — 27 INSERT مهاجَرة، `grep *.slice.ts` (B1 files) = 0، regression 115/115 + 606/606، `posting.ts` diff = 0.

---

## 1) الـ27 INSERT المهاجَرة (قائمة)

| # | الملف | السطر الأصلي | action |
|---:|---|---:|---|
| 1–15 | `accounting.slice.ts` | 394, 412, 721, 1019, 1046, 1166, 1455, 1477, 1509, 1650, 2264, 2304, 2341, 2370, 2426 | `gl.journal.post`, `gl.journal.void`, `gl.voucher.cancel`, `period.manual_lock`, `period.manual_unlock`, `period.close_override`, `period.close`, `period.reverse_close`×2, `gl.year.close`, `budget.create/update/approve/close/revise` |
| 16–18 | `treasury.slice.ts` | 168, 277, 486 | `cash.account.create`, `cash.transaction`, `shift.close` |
| 19–20 | `checks.slice.ts` | 153, 222 | `check.create`, `check.status` |
| 21–22 | `bank-recon.slice.ts` | 121, 163 | دالة `activity()` عامة + `auditNote` (كل action يمر عبر `logActivity`) |
| 23 | `bank-expenses.slice.ts` | 76 | دالة `activity()` (`bank_expense.*`) |
| 24–26 | `backup.slice.ts` | 62, 135, 260 | `backup.export`, `backup.restore`×2 (branchId=null — لا FK) |
| 27 | `maintenance.slice.ts` | 414 | `auditWarranty` — استُبدل `'policy'` بـ `ip` حقيقي |

**النمط المطبّق:** `await logActivity(client, { userId, branchId, action, entity, entityId, details, ip })` — `ip` إلزامي في التوقيع؛ كل controller يمرّر `req.ip ?? req.socket?.remoteAddress ?? 'unknown'`.

---

## 2) النتائج (B1-01..05)

| المعيار | الحكم | الدليل |
|---|---|---|
| **B1-01** — 27 INSERT مهاجَرة | ✅ | القائمة أعلاه؛ البناء ناجح `nest build` |
| **B1-02** — controllers تمرر `req.ip` | ✅ | ~40 controller/طريقة خدمة أُضيف لها `@Req() req: Request` + `const ip = ...` |
| **B1-03** — sample `activity_log` لكل ملف | ✅ | أدناه — كلها `ip=127.0.0.1`، لا NULL، لا `'policy'`، لا `'unknown'` |
| **B1-04** — `grep "INSERT INTO activity_log" <B1 files>` | ✅ **0 نتائج** | 28 INSERT متبقية كلها خارج B1 (26 لـB2/B3 + 2 `posting.ts`) |
| **B1-05** — Regression | ✅ | B1..B5.4 = **115/115** · smoke (نظيفة :5642) = **606/606** · `posting.ts` diff = **0** |

---

## 3) عينات `activity_log` حرفية (لكل ملف)

```
accounting.slice.ts:  gl.journal.post: id=199 entity=gl_journal:143 ip=127.0.0.1
                      period.manual_lock: id=159 entity=period:6 ip=127.0.0.1
                      period.close: id=191 entity=period:9 ip=127.0.0.1
                      gl.year.close: id=26 entity=gl_journal:24 ip=127.0.0.1
                      budget.create: id=193 entity=budget:1 ip=127.0.0.1
treasury.slice.ts:    cash.account.create: id=144 entity=cash_account:4 ip=127.0.0.1
                      cash.transaction: id=6 entity=cash_transaction:3 ip=127.0.0.1
                      shift.close: id=172 entity=shift:3 ip=127.0.0.1
checks.slice.ts:      check.create: id=76 entity=check:3 ip=127.0.0.1
                      check.status: id=77 entity=check:3 ip=127.0.0.1
bank-recon.slice.ts:  bank_recon.import: id=188 entity=bank_recon:0 ip=127.0.0.1
                      bank_recon.create_run: id=101 entity=bank_recon:1 ip=127.0.0.1
                      bank_recon.post_run: id=102 entity=bank_recon:1 ip=127.0.0.1
bank-expenses.slice:  bank_expense.create: id=182 entity=bank_expense:7 ip=127.0.0.1
backup.slice.ts:      backup.export: id=200 entity=database:0 ip=127.0.0.1
maintenance.slice.ts: maintenance.warranty_charge_override: id=195 entity=maintenance_ticket:2 ip=127.0.0.1
```

> `backup.restore` لم يُنشأ عينة في هذه الجولة ( necessitate RESTORE payload مع meta/tables صالح — فحص GAP-07 يغطيه تاريخيًا)؛ `backup.export` من الملف نفسه كافٍ كعينة الملف.

---

## 4) Part C — TD-60 (تعليقي فقط)

- `tools/verify-gap-batch.js:5-6` — `5434` → وصف env (`PGPORT` من المتصل). ✅
- لا تبعيات تاريخية فعلية في بقية أدوات `verify-*` (كما في `TD52-audit.md`).

---

## 5) الانحرافات

1. **`logActivity` قبل`branchId: number | null`** — كان `number` فقط؛ `backup.*` يكتب `branchId=NULL` (كما في INSERT الأصلي). وسّعت النوع إلى `number | null` في `common/audit.ts`. لا تغيير في بصمة الـ helper للعمليات الأخرى.
2. **`backup.restoreGAP07`** كان يستقبل `sourceIp`؛ أُمرّر كـ ip للـ logActivity (`restoreGAP07(body, user, ip, ip)`).
3. **bank-recon `activity()` وbank-expenses `activity()`** — دالتان مساعدتان عامتان تمرّRAN ip من كل مستدعي.
4. لا لمس لـ `posting.ts` · لا تغيير action strings · لا حذف تسجيل (كل INSERT أصبح logActivity).

## 6) الحكم

**Phase B1 = PASS — 5/5.** 27 INSERT مهاجَرة بـ IP فعلي، grep B1 files = 0، regression أخضر. **B2/B3 لم تبدأ.** TD-52 وTD-60 يبقيان مفتوحين حتى اكتمال B2/B3.
