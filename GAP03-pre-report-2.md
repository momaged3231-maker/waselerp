# GAP-03 — Step 0: Semantics Check (قبل أي كود)

**التاريخ:** 2026-11-24
**الحالة:** **Step 0 فقط — لا كود، لا Go للتنفيذ.** بانتظار مراجعة المالك.
**البيئة:** PGlite معزول :5608 (`data.gap03-step0`) — `migrate-all` كامل (schema + كل migrations)، بلا seed/demo.

---

## 1) الاستعلام الحرفي المطلوب

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'maintenance_tickets';
```

**النتيجة (35 عمودًا — مخرجات حرفية):**

| column_name | data_type | nullable |
|---|---|---|
| ticket_id | integer | NO |
| branch_id | integer | NO |
| branch_cash_account_id | integer | YES |
| ticket_no | character varying | NO |
| customer_name | character varying | NO |
| phone | character varying | NO |
| phone2 | character varying | YES |
| product_id | integer | NO |
| model_id | integer | NO |
| serial_no | character varying | YES |
| item_color | character varying | YES |
| accessories | jsonb | NO |
| product_condition | text | NO |
| customer_notes | text | YES |
| max_charge | numeric | NO |
| received_at | timestamp with time zone | NO |
| expected_delivery | date | YES |
| estimated_cost | numeric | NO |
| actual_cost | numeric | **YES** |
| total_paid | numeric | NO |
| advance_posted | boolean | NO |
| advance_journal_id | integer | YES |
| payment_journal_id | integer | YES |
| advance_amount | numeric | NO |
| last_payment_amount | numeric | NO |
| inspection_status | smallint | NO |
| delivery_status | smallint | NO |
| check_report | text | YES |
| engineer_id | integer | YES |
| created_by | integer | YES |
| delivered_by | integer | YES |
| delivered_at | timestamp with time zone | YES |
| is_warranty | boolean | NO |
| warranty_ref | character varying | YES |
| created_at | timestamp with time zone | NO |

**أعمدة الضمان الحالية:** `is_warranty` (boolean, NO) + `warranty_ref` (varchar, YES). **لا** `warranty_start_date` · `warranty_end_date` · `warranty_charged` · `warranty_charge_reason` · `warranty_applied`.

**`maintenance_ticket_parts`:** `ticket_part_id`, `ticket_id`, `item_id`, `quantity`, `unit_price`, `unit_cost`, `created_at`.

**القيود:** `UNIQUE (branch_id, ticket_no)` + FKs + NOT NULLs. **لا CHECK على التواريخ** (سيُضاف في GAP03-01).

---

## 2) الإجابات الحرفية على الأسئلة الثلاثة

### سأ: `actual_cost` = ما يدفعه العميل أم تكلفة القطعة؟

**الجواب: ما يُحصَّل من العميل (سعر البيع/الأجر المتفق عليه) — ليس تكلفة القطعة.**

الأدلة من الكود:
- `inspectTicket()` (سطر 631–641): `actual_cost = COALESCE($5::numeric, actual_cost)` من `dto.actualCost` — **قيمة يدخلها المستخدم** at inspection.
- `list()`/`report()` (309–310، 741–742): حالة السداد = `COALESCE(actual_cost, estimated_cost) - total_paid <= 0.004`.
- `serviceReport()` (334–336): `SUM(COALESCE(actual_cost, estimated_cost))` كـ`totalValue`، و`totalRemaining` = نفسه minus `total_paid`.
- تكلفة القطعة تُخزَّن **منفصلة** في `maintenance_ticket_parts.unit_cost` وتُجمَع في `partsCost` — لا تُكتب إلى `actual_cost`.

⇒ **التطبيق الصحيح لـ GAP03-05:** منع `actual_cost > 0` عند الضمان = منع تحصيل العميل. **لا** يمنع استهلاك القطع من المخزون.

### س ب: `max_charge` = سقف تحصيل أم تكلفة تقديرية؟

**الجواب: سقف تحصيل بالاسم، لكنه غير مُطبَّق إطلاقًا (dead field).**

- يظهر 3 مرات فقط في `maintenance.slice.ts`: SELECT (29)، INSERT (415)، UPDATE (493).
- **صفر تحقق/مقارنة/قيد** في أي مكان (API أو UI): لا `actual_cost <= max_charge`، لا تنبيه، لا رفض.
- التكلفة التقديرية هي **حقل منفصل**: `estimated_cost` (يُستخدم في `COALESCE` عندما يكون `actual_cost` NULL).

⇒ لا يعني شيئًا تشغيليًا اليوم. لا يُستخدم كبديل عن `estimated_cost`.

### س ج: `partsCost` = تكلفة القطع (من الجدول) أم مبلغ محسوب؟

**الجواب: مبلغ محسوب (derived) من `maintenance_ticket_parts`، وليس عمودًا مخزَّنًا.**

- التعريف في `list()` (سطر 36):
  `(SELECT COALESCE(SUM(quantity * unit_cost),0) FROM maintenance_ticket_parts WHERE ticket_id = t.ticket_id) AS "partsCost"`
- `unit_cost` يُكتب عند الفحص من `getWarehouseCost(client, itemId, warehouseId)` متوسط التكلفة المرجّح (سطر 598، 626).
- `partsCost` يُستخدم في:
  - التقارير: `profit = total - partsCost` (762).
  - القيد عند التسليم (683–702): `Dr COGS / Cr INVENTORY` بقيمة `partsCost`.

---

## 3) ⚠️ اكتشاف حرج أثناء Step 0 (يؤثر على GAP03-08)

**قيد COGS لقطع الغيار مشروط حاليًا بـ `paid > 0`:**

```
deliverTicket() — maintenance.slice.ts:682
if (paid > 0) {
   partsCost = SUM(quantity * unit_cost) ...
   postJournal(Dr COGS / Cr INVENTORY, partsCost)
}
```

**العاقبة اليوم:** تذكرة ضمان بلا تحصيل (`paid=0`) تستهلك قطعًا من المخزون **دون أي قيد محاسبي** → مخزون ناقص بلا مقابل، بالضبط ما حذّر منه قرارك في س-3.

**مطلوب في GAP03-08 (بعد Go):** نقل كتلة قيد COGS خارج `if (paid > 0)` بحيث تُنفَّذ عند `partsCost > 0` بغض النظر عن التحصيل، مع بقاء قيد السداد (`postMaintenanceCash`) مشروطًا بـ `paid > 0`. هذا تعديل داخل `maintenance.slice.ts` — **لا لمس لـ `posting.ts`** (GAP03-11).

---

## 4) خلاصة Step 0 (للمراجعة)

| السؤال | الجواب | الأثر على المعايير |
|---|---|---|
| `actual_cost` | **مبلغ محصَّل من العميل** (سعر خدمة يدوي) | GAP03-05 صحيح: منعه عند الضمان = منع AR |
| `max_charge` | سقف بالاسم، **غير مُطبَّق** (حقل ميت) | لا يُستخدم كبديل؛ `estimated_cost` هو التقدير |
| `partsCost` | **محسوب** من `maintenance_ticket_parts.quantity * unit_cost` | GAP03-08: القيد بـ partsCost مستقل عن التحصيل |
| قيد COGS الحالي | **داخل `if (paid > 0)`** — خلل | يجب إخراجه في GAP03-08 |

**القرار المطلوب منك:** مراجعة هذه الدلالات ثم إصدار Go لتنفيذ Parts A/B/C/D بالـ12 معيارًا. **لم يُكتب أي كود GAP-03 بعد.**
