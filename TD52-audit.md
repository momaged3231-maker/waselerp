# TD-52 + TD-60 — Part A: Audit Report (قراءة فقط، بلا كود)

**التاريخ:** 2026-11-26
**القرار:** Go لـ TD-52+TD-60 — **Part A أولًا (audit فقط)**، بانتظار مراجعة المالك قبل Parts B/C.

---

## 1) الأمر 1 — كل `INSERT INTO activity_log`

```
grep -rn "INSERT INTO activity_log" apps/api/src --include="*.ts"
```
**النتيجة: 55 سطرًا** = 1 helper (`audit.ts`) + 2 `posting.ts` + 52 `*.slice.ts`.

### الجدول الكامل (52 INSERTs في `*.slice.ts` — كلها خارج الـhelper، `ip_address` مفقود)

| الملف | السطر | ما يُسجّل (action) | عبر `logActivity`؟ | `ip_address` مملوء؟ |
|---|---:|---|:---:|:---:|
| `accounting.slice.ts` | 394 | `gl.journal.post` | ❌ | ❌ |
| `accounting.slice.ts` | 412 | `gl.journal.void` | ❌ | ❌ |
| `accounting.slice.ts` | 721 | `gl.voucher.cancel` | ❌ | ❌ |
| `accounting.slice.ts` | 1019 | `period.manual_lock` | ❌ | ❌ |
| `accounting.slice.ts` | 1046 | `period.manual_unlock` | ❌ | ❌ |
| `accounting.slice.ts` | 1166 | `period.close_override` | ❌ | ❌ |
| `accounting.slice.ts` | 1455 | `period.close` | ❌ | ❌ |
| `accounting.slice.ts` | 1497 | `period.reverse_close` | ❌ | ❌ |
| `accounting.slice.ts` | 1509 | `period.reverse_close` | ❌ | ❌ |
| `accounting.slice.ts` | 1650 | `gl.year.close` | ❌ | ❌ |
| `accounting.slice.ts` | 2264 | `budget.create` | ❌ | ❌ |
| `accounting.slice.ts` | 2304 | `budget.update` | ❌ | ❌ |
| `accounting.slice.ts` | 2341 | `budget.approve` | ❌ | ❌ |
| `accounting.slice.ts` | 2370 | `budget.close` | ❌ | ❌ |
| `accounting.slice.ts` | 2426 | `budget.revise` | ❌ | ❌ |
| `admin.slice.ts` | 180 | `user.restrictions` | ❌ | ❌ |
| `admin.slice.ts` | 306 | `attachment_policy.update` | ❌ | ❌ |
| `attachments.slice.ts` | 169 | `attachment.create` | ❌ | ❌ |
| `attachments.slice.ts` | 192 | `attachment.delete` | ❌ | ❌ |
| `backup.slice.ts` | 62 | `backup.export` | ❌ | ❌ |
| `backup.slice.ts` | 135 | `backup.restore` | ❌ | ❌ |
| `backup.slice.ts` | 260 | `backup.restore` | ❌ | ❌ |
| `bank-expenses.slice.ts` | 76 | `bank_expense` | ❌ | ❌ |
| `bank-recon.slice.ts` | 121 | (bank recon import) | ❌ | ❌ |
| `bank-recon.slice.ts` | 163 | `bank_recon` | ❌ | ❌ |
| `catalog/items.slice.ts` | 298 | `item.components` | ❌ | ❌ |
| `catalog/items.slice.ts` | 479 | `item.import` | ❌ | ❌ |
| `catalog/items.slice.ts` | 537 | `item.bulk_price` | ❌ | ❌ |
| `checks.slice.ts` | 153 | `check.create` | ❌ | ❌ |
| `checks.slice.ts` | 222 | `check.status` | ❌ | ❌ |
| `crm.slice.ts` | 191 | `crm.lead.convert` | ❌ | ❌ |
| `fixed-assets.slice.ts` | 45 | `fixed_asset` (create) | ❌ | ❌ |
| `fixed-assets.slice.ts` | 246 | `asset.update` | ❌ | ❌ |
| `inventory/branch-transfer.slice.ts` | 497 | `stock.branch_transfer.approve` | ❌ | ❌ |
| `inventory/branch-transfer.slice.ts` | 611 | `stock.branch_transfer.receive` | ❌ | ❌ |
| `inventory/branch-transfer.slice.ts` | 708 | `stock.branch_transfer.cancel` | ❌ | ❌ |
| `inventory/stock-transfer.slice.ts` | 387 | `stock.transfer.approve` | ❌ | ❌ |
| `inventory/stock-transfer.slice.ts` | 498 | `stock.transfer.receive` | ❌ | ❌ |
| `maintenance.slice.ts` | 414 | `maintenance.warranty_*` (auditWarranty) | ❌ (خاص) | ✅ `'policy'` |
| `parties.slice.ts` | 290 | `party.import` | ❌ | ❌ |
| `parties.slice.ts` | 388 | `party.opening_balance` | ❌ | ❌ |
| `parties.slice.ts` | 406 | `party.delete` | ❌ | ❌ |
| `purchases/purchase-match.slice.ts` | 201 | `purchase.match_exception` | ❌ | ❌ |
| `sales/documents.slice.ts` | 465 | `order.status` | ❌ | ❌ |
| `sales/pos.slice.ts` | 680 | `order.split` | ❌ | ❌ |
| `sales/pos.slice.ts` | 726 | `order.move` | ❌ | ❌ |
| `settings/print-profiles.slice.ts` | 148 | `print_profile.create` | ❌ | ❌ |
| `settings/print-profiles.slice.ts` | 185 | `print_profile.update` | ❌ | ❌ |
| `settings/print-profiles.slice.ts` | 199 | `print_profile.delete` | ❌ | ❌ |
| `treasury.slice.ts` | 168 | `cash.account.create` | ❌ | ❌ |
| `treasury.slice.ts` | 277 | `cash.transaction` | ❌ | ❌ |
| `treasury.slice.ts` | 486 | `shift.close` | ❌ | ❌ |

**استثناءات خارج `*.slice.ts`:**
- `common/audit.ts:20` — الـ helper الوحيد (`ip_address` ✅).
- `common/posting.ts:130,142` — `period.backpost` (سيُبقى مباشرًا → TD-62).

**حالة خاصة:** `maintenance.slice.ts:414` (`auditWarranty`) يملؤ `ip_address` بقيمة ثابتة `'policy'` — ليس IP حقيقيًا، لكنه INSERT مخصص داخل Part C من GAP-03. يُدرج ضمن الهجرة في Part B إن لزم توحيد الشكل.

---

## 2) الأمر 2 — أدوات `verify-*`

```
ls tools/verify-*.js
```
10 أدوات: `verify-gap-batch.js`, `verify-gap01-partB.js`, `verify-gap01-partC.js`, `verify-gap02.js`, `verify-gap03.js`, `verify-gap06-concurrency.js`, `verify-gap06.js`, `verify-gap07.js`, `verify-gap08.js`, `verify-gl10.js`.

## 3) الأمر 3 — التبعيات التاريخية

```
grep -n "base_tables|= 137|= 138|= 139|5434|5435|CC-VERIFY|reference data" tools/verify-*.js
```

| الأداة | السطر | التبعية | التقييم |
|---|---:|---|---|
| `verify-gap-batch.js` | 5,6,17 | `5434` كمنفذ افتراضي + تعليق | **تبعية بينية فقط** — يقرأ من API/DB يتحكم به المتصل عبر env؛ لا تبعية بيانات تاريخية. يجب التحقق عند التعديل (TD-60). |
| `verify-gap-batch.js` | 77,79,82 | `CC-VERIFY` | **ينشئه بنفسه** (`POST /accounting/cost-centers` ثم يقرأه) — نمط TD-44، سليم. |
| `verify-gap07.js` | 7,253 | `5434` في تعليق/regression info فقط | **نص توثيقي** لا كود قابل للتنفيذ — لا تبعية فعلية. |
| `verify-gl10.js` | 131 | كلمة `reference data` في تعليق | **سليم** — مقفل في TD-44 (ذاتي التأسيس، grep=0 للقيم التاريخية). |

**الخلاصة:** لا تبعية بيانات تاريخية فعلية في أي أداة. `verify-gap-batch.js` يستحق مراجعة تعديل صغيرة لتحديث التعليق الافتراضي (5434 → `env PGPORT`) ضمن TD-60 Parts.

---

## 4) الخلاصة للمراجعة

- **TD-52:** 52 INSERT ثانوي + 1 audit خاص (`maintenance`) → كلها مرشحة للهجرة في Part B.
- **TD-52-04:** `grep *.ts` بعد الهجرة = 3 أسطر (`audit.ts` + `posting.ts` ×2) — لا 1، بسبب TD-62.
- **TD-60:** لا إصلاحات جوهرية مطلوبة؛ تعديل تعليقي فقط في `verify-gap-batch.js`.
- **posting.ts:** لا يُلامس.

**بانتظار مراجعتك قبل Parts B/C.**
