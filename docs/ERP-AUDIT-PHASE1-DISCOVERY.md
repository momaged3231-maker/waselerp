# WaselERP — Phase 1: System Discovery (2026-11-16)

## النطاق
البيئة: قاعدة محلية `wasel` (PGlite — PostgreSQL) — بيانات تجريبية 100% (لا توجد أي بيانات إنتاج).
النظام: Next.js (static export) ←→ NestJS API على `127.0.0.1:4000/api` ←→ PostgreSQL.

---

## 1. دليل الحسابات (Chart of Accounts) — 45 حساب
المستوى الفعلي (مستخرج من `gl_accounts`):
- **أصول T1 (12):** 1101 النقدية بالصندوق، 1102 النقدية بالبنك، 1103 ذمم العملاء، 1104 المخزون، 1105 ضريبة مدخلات، 1106 مصروفات مدفوعة مقدماً، 1107 أوراق قبض، 1201 أثاث، 1202 مجمع إهلاك.
- **خصوم T2 (7):** 2101 ذمم الموردين، 2102 ضريبة مخرجات، 2103 مصروفات مستحقة، 2104 قروض قصيرة الأجل، 2105 أوراق دفع.
- **حقوق ملكية T3 (4):** 3101 رأس المال، 3102 مسحوبات، 3103 الأرباح المحتجزة.
- **إيرادات T4 (8):** 4101 مبيعات، 4102 مردودات مبيعات، 4103 خصم مسموح، 4104 إيرادات أخرى، 4105 توصيل، 4106 إيرادات خدمية، 4107 خصومات وغرامات.
- **مصروفات T5 (14):** 5101 COGS، 5102 مردودات مشتريات، 5103 رواتب، 5104 إيجارات، 5105 كهرباء ومياه واتصالات، 5106 إدارية، 5107 مصروفات مالية، 5108 إهلاكات، 5109 خصم الموردين، 5110 فروقات صندوق، 5111 فروقات جرد، 5112 تالف وهادر، 5113 إضافات مخزون.

## 2. الربط المحاسبي (gl_mappings) — مكتمل 29/29
أصناف الربط تغطي: AP, AR, BANK, CASH, CASH_DIFF, COGS, DAMAGE_EXPENSE, DELIVERY_FEE, DISCOUNT, EMPLOYEE_ADVANCE, INSURANCE_PAYABLE→2104, INVENTORY, INVENTORY_ADDITION, INVENTORY_VARIANCE, NOTES_P/R, OTHER_EXPENSE, OTHER_INCOME, PURCHASE_DISCOUNT, PURCHASE_RETURNS, RETAINED_EARNINGS, SALARY_DEDUCTION→4107, SALARY_EXPENSE, SALARY_PAYABLE, SALES, SALES_RETURNS, SERVICE_CHARGE, VAT_INPUT→1105, VAT_OUTPUT→2102.

## 3. محرك القيد المزدوج (posting.ts)
- `postJournal` — شرط `total debit = total credit` وإلا فشل كامل، period open guard: `assertPeriodOpen` يرفض الترحيل داخل فترة مقفلة برسالة عربية واضحة.
- كل أثر مالي يمر من هنا: فواتير (postInvoiceJournal)، حركات مرتجعات، سندات قبض/صرف، تسويات، رواتب — كلها في **نفس الـ transaction** مع المستند → لا توجد قيود نصفية.
- **Idempotency:** المستندات تدعم `client_request_id` كـ idempotency key؛ سندات القيد اليدوي بلا key (مساريد فقط) — القيد المرحل لا يُعدّل؛ التصحيح بعكس القيد (غير قابل للتعديل بعد الترحيل بطبيعة التصميم).
- `postInvoiceJournal` يحترم `EnableGLPosting=false` (يعطّل الترحيل بصراحة — البيئة الافتراضية `true`).
- كل مستوى journal يحتوي `source_type` + `source_id` للتتبع العكسي.

## 4. المخزون (stock.ts)
- **التقييم:** المتوسط المرجح المتحرك `item_warehouse_qty.avg_cost` — متوسط متجدد بعد كل حركة واردة (ليس FIFO ولا طبقات).
- COGS عند البيع = معدل التكلفة الحالياً في نفس الـ transaction.
- لا سلبيات: `AllowNegativeStock=false` → أي حركة صادرة بالسالب تُرفض.
- ‏`item_warehouse_qty` keyed على الوحدة الأساسية للصنف (baseUnit) — لا تعدد سجلات لنفس الصنف بوحدات مختلفة.
- كل حركة تكتب في `stock_movements` (ledger) وتحدّث الرصيد في نفس المعاملة.
- الخصم/الضريبة للوحدات البديلة تُطابق عبر `item_units` + `factor` قبل الوصول لـ ledger.

## 5. الفروع — قيد تصميمي مهم مكتشف
- **كل قيد في هذا ERP يقيّد بـ `branch_id`** — والفواتير والقيود كلها تربط بفرع.
- **التحويل بين المخازن (stock-transfers) يشترط أن يكون المخزنان من نفس الفرع** (`new BadRequestException('أحد المخازن لا يتبع الفرع الحالي')`) — لا توجد آلية لحركة مخزون عبر فرعين من نفس المستند. هذا **قيد معماري موثق** — يُصنّف في التقرير كميزة مفقودة/قيد تصميمي.
- نفس الشيء للخزائن: كل حركة نقدية تربط بفرع الصندوق.

## 6. الصلاحيات
- 5 أدوار جاهزة: مدير النظام (1)، محاسب (2)، كاشير (3)، مندوب مبيعات (4)، أمين مخزن (5).
- كل endpoint عليه `@RequirePermissions` صريحة أو `RequireAnyPermission` (OR) أو لا يتطلب شيئاً للقراءة العامة (الفحص عبر `JwtAuthGuard` العام + `PermissionsGuard`).

## 7. الفترات والإقفال
- جدول `periods`: فرع + نطاق تاريخ + `is_closed`.
- `resolvePeriod`: الفترة المحدودة (start/end) تتقدم على الفترة المفتوحة — لذا إقفال شهر **سيمنع** أي ترحيل فيه فعلياً.
- الإقفال يمر عبر `/accounting/periods/:id/close`.

## 8. الإعدادات المستخدمة فعلياً
`EnableGLPosting=true` (GL مفعّل)، `AllowNegativeStock=false`.
`RequireCashierShift=false` (افتراضي)، `BlockBelowCostSale=false`.

## 9. فجوة مكتشفة (تسبق الاختبار)
**إعادة سداد الموردين تُسند للدائنون وليس توزيع كامل لكل فاتورة** — لا يوجد سجل تحصيلات/مستندات typealloc افتراضي موجود مسبقاً — التخصيص متوفر عبر `vouchers.allocations` وإشعارات الأقساط. الدفع الجزئي المخصص مدعوم.

## 10. الخرائط — العملية ← الحسابات (المتوقع)
| العملية | القيد المتوقع |
|---|---|
| مشتريات نقدية | Dr INVENTORY / Cr CASH |
| مشتريات آجلة | Dr INVENTORY + Dr VAT_INPUT / Cr AP |
| خصم مورد | Cr PURCHASE_DISCOUNT |
| مرتجع مشتريات | Dr AP / Cr INVENTORY + Cr VAT_INPUT |
| مبيعات نقدية | Dr CASH / Cr SALES + Cr VAT_OUTPUT + Dr COGS / Cr INVENTORY |
| مبيعات آجلة | Dr AR / Cr SALES + Cr VAT_OUTPUT |
| مرتجع مبيعات | Dr SALES + Dr VAT_OUTPUT / Cr CASH-AR + Dr INVENTORY / Cr COGS |
| سند قبض عميل | Dr CASH/BANK / Cr AR (allocation invoices) |
| سند صرف مورد | Dr AP / Cr CASH/BANK (allocation invoices) |
| مصروف إداري | Dr OTHER_EXPENSE(5106) / Cr CASH |
| راتب | Dr SALARY_EXPENSE(5103) / Cr SALARY_PAYABLE(2103) + Dr SALARY_PAYABLE / Cr CASH |
| تالف | Dr DAMAGE_EXPENSE(5112) / Cr INVENTORY |
| فروقات جرد | Dr/Cr INVENTORY ↔ INVENTORY_VARIANCE(5111) |
| إضافة مخزون | Dr INVENTORY / Cr INVENTORY_ADDITION(5113) |

## 11. أخطاء مكتشفة أثناء اكتشاف البيئة (لم تُصلح — تنتظر التقرير)
لا شيء في الكود نفسه بعد. نلاحظ فقط أن الـ schema لا يفرض حالة فريدة عبر الفروع على نفس رقم الإيصال... تمت معالجتها سابقاً في D27 (invoice_no فريد لكل فرع).
