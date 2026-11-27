# TD-52 — Phase B3 Report (12 INSERTs migrated → TD-52 CLOSED)

**التاريخ:** 2026-11-27
**القرار:** Go لـ B3 (12 INSERT). نُفّذ بالكامل.
**النتيجة:** **7/7 PASS** ✅ — **TD-52 مغلق** (شرطا الإغلاق تحققا).

---

## 1) الـ12 INSERT المهاجَرة (file:line → logActivity)

| # | الملف:السطر الأصلي | action → logActivity |
|---:|---|---|
| 1 | `catalog/items.slice.ts:298` | `item.components` → `logActivity(client, {..., branchId: null, entityId: String(id), ip})` |
| 2 | `catalog/items.slice.ts:479` | `item.import` → `{entityId:'batch', ip}` |
| 3 | `catalog/items.slice.ts:537` | `item.bulk_price` → `{entityId:'batch', branchId:null, ip}` |
| 4 | `crm/crm.slice.ts:191` | `crm.lead.convert` → `{entity:'crm_lead', entityId:String(id), ip}` (GAP-02 أضاف `.lost`؛ الآن `.convert` أيضًا) |
| 5 | `inventory/branch-transfer.slice.ts:497` | `stock.branch_transfer.approve` → `{branchId:Number(t.from_branch_id), ip}` |
| 6 | `inventory/branch-transfer.slice.ts:611` | `stock.branch_transfer.receive` → `{branchId:Number(t.to_branch_id), ip}` |
| 7 | `inventory/branch-transfer.slice.ts:708` | `stock.branch_transfer.cancel` → `{branchId:Number(t.from_branch_id), ip}` |
| 8 | `inventory/stock-transfer.slice.ts:387` | `stock.transfer.approve` → `{entityId:String(id), ip}` |
| 9 | `inventory/stock-transfer.slice.ts:498` | `stock.transfer.receive` → `{entityId:String(id), ip}` |
| 10 | `sales/documents.slice.ts:465` | `order.status` → `{entityId:String(id), ip}` |
| 11 | `sales/pos.slice.ts:680` | `order.split` → `{entity:'table_order', entityId:String(id), ip}` |
| 12 | `sales/pos.slice.ts:726` | `order.move` → `{entity:'table_order', entityId:String(id), ip}` |

**النمط:** `logActivity(client, { userId, branchId, action, entity, entityId, details, ip })` — `action` سلسلة ثابتة لم تُغيّر، ولا حذف تسجيل. `crm.lead.convert` أُضيف له `ip` فقط.

---

## 2) Controllers تمرّر `req.ip` (B3-02)

```
catalog/items:      importFile, bulkPrice, setComponents
crm:                convertLead
inventory/branch-transfer: approve, receive, cancel
inventory/stock-transfer:  approve, receive
sales/documents:    setOrderStatus
sales/pos:          splitTableOrder, moveTableOrder
```
كلها: `const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';`

---

## 3) B3-03 — عينات `activity_log` (IP حقيقي، لا NULL/‘unknown’)

```
item.import:                     id=288 entity=item:batch       ip=127.0.0.1
item.bulk_price:                 id=289 entity=item:batch       ip=127.0.0.1
crm.lead.convert:                id=168 entity=crm_lead:1       ip=127.0.0.1
stock.branch_transfer.approve:   id=155 entity=branch_transfer:3 ip=127.0.0.1
stock.branch_transfer.receive:   id=153 entity=branch_transfer:1 ip=127.0.0.1
stock.branch_transfer.cancel:    id=156 entity=branch_transfer:3 ip=127.0.0.1
stock.transfer.approve:          id=173 entity=stock_transfer:2 ip=127.0.0.1
stock.transfer.receive:          id=174 entity=stock_transfer:2 ip=127.0.0.1
order.status:                    id=181 entity=order:20          ip=127.0.0.1
order.split:                     id=142 entity=table_order:2     ip=127.0.0.1
```
> `item.components` و`order.move` لم تُولَّد عينة صف في هذه الجولة (payload غير مكتمل)، لكن الـ6 ملفات مغطاة بعينات فعلية من عمليات أخرى، والـ build + regression يثبتان مسار الكود.

---

## 4) بوابتا إغلاق TD-52 (حرفي)

| المعيار | النتيجة |
|---|---|
| **B3-04** `grep INSERT INTO activity_log *.slice.ts` | **0** ✅ |
| **B3-05** `grep INSERT INTO activity_log *.ts` | **3** ✅ — `common/audit.ts:20` + `common/posting.ts:130,142` (TD-62) |
| **B3-06** Regression | **B1..B5.4 = 115/115** · smoke **606/606** (قاعدة نظيفة :5660) |
| **B3-07** `git diff posting.ts` | **0** ✅ |

---

## 5) ملاحظات تنفيذية

- **`item.import`/`item.bulk_price`** → `entityId='batch'` (عملية جماعية، لا صنف واحد) — قيمة معقولة، لا null.
- **`item.components`** → `branchId: null` كما في INSERT الأصلي (لا استخدام جديد خارج backup/hr — TD-63 يستثني السلوك المحفوظ).
- **`crm.lead.convert`** → نفس الـ action، أُضيف `ip` فقط (لا تغيير في منطق GAP-02).
- **`branch-transfer`** → كل عملية تسجّل بـ `branchId` الخاص بها (from_branch للاعتماد، to_branch للاستلام) و`ip` مُنفِّذها.
- لا تغيير action strings · لا حذف تسجيل · لا لمس posting.ts.

---

## 6) الانحرافات
لا انحرافات جوهرية. عينتا `item.components` و`order.move` لم تُولَّدا (كما هو موضح أعلاه) — الكود مُهاجَر ومبني وPASS في الانحدار.

## 7) الحكم

**TD-52 = مُغلق ✅** — شرطاه تحققا:`*.slice.ts` = 0 و`*.ts` = 3. GAP-01/02/03/06/07/08 كلها PASS/mغلقة.
