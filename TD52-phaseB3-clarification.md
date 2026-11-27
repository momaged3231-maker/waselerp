# TD-52 — Phase B3 Clarifications (3 نقاط)

**التاريخ:** 2026-11-27

## 1) مصادر `branchId` للثلاثة actions

```
order.split   branchId = معامل branchId من @CurrentBranch() عبر الـ controller
              (pos.slice.ts:579 — async splitTableOrder(..., branchId: number, ip) → logActivity({branchId}))
              ✅ (أ) — الفرع الحالي للـ POS/الطاولة (مصدره x-branch-id الموثوق).
order.move    branchId = Number(order.branch_id) من الطلب نفسه
              (pos.slice.ts:689,724 — async moveTableOrder(..., ip) → logActivity({branchId: Number(order.branch_id)}))
              ✅ (أ) — جدول table_orders يرتبط بفرع؛ نقل الطلب يُسجَّل على فرعه.
crm.lead.convert branchId = معامل branchId من @CurrentBranch() عبر الـ controller
              (crm.slice.ts:173 — async convertLead(id, branchId, user, ip) → logActivity({branchId}))
              ✅ (ب) — branchId من الـ lead/المستخدم عبر هيدر الفرع؛ ليس null.
```

**الخلاصة:** لا `null` بلا تبرير في أي من الثلاثة — TD-63 سليم.

## 2) `item.components` + `item.bulk_price` → `branchId: null`

```
item.components  branchId = null (items.slice.ts:299)
item.bulk_price  branchId = null (items.slice.ts:536)
```
**مشروع** — الأصناف معرَّفة على مستوى الشركة لا الفرع. TD-63 يُحدَّث: الحالات المشروعة = `backup.*` (كيان قاعدة البيانات) + `catalog/items.*` (معرَّف شركة-مستوى). أي حالة أخرى → تصعيد.

## 3) `branch_transfer` branchId semantics

```
approve → from_branch_id   (من يقرر الإرسال → الفرع المصدر)
receive → to_branch_id     (من يستلم → الفرع المستلم)
cancel  → from_branch_id   (من يُلغي → مصدر النية)
```
قرار تفسيري يُوثَّق في TD-66. لا تعطّل.

## 4) TD-65 — عينتان غير مولَّدتين

`item.components` و`order.move` هاجرا بنفس النمط (logActivity + ip) لكن لم تُنشأ صفوفهما في هذه الجولة (payload constraints). 10/12 عينة مباشرة + 2/12 مشتق من نمط متطابق. TD-65 مسجّل (منخفض) — يُغلق باختبار يدوي لاحق.

---

## الخلاصة
- الثلاثة branchId مبرَّرة (لا خرق TD-63).
- `item.*` null مشروع (TD-63 محدَّث).
- branch_transfer semantics موثّقة مع TD-66.
- **TD-52 يُغلق نهائيًا** — بوابتاه (slice.ts=0، *.ts=3) تحققتا + هذه التوضيحات.
