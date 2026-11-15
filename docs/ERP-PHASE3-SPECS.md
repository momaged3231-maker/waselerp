# ERP Phase 3 — مواصفات E1–E6 (2026-11-16)

> **الحالة:** تحليل · تصميم · توثيق — **صفر كود** ووفق القاعدة: لا يُنفّذ أي تغيير برمجي قبل اعتماد هذا من المالك.
> الوثائق مستقلة، كل وحدة في ملفها الخاص.

---

## 1. ترتيب الوحدات

| # | الوحدة | الاختصار | المصدر | الأولوية |
|---|---|---|---|---|
| E1 | تسوية الحسابات البنكية | Bank Reconciliation | موروث من Audit 2026-11-16 | عالية |
| E2 | تحويل بين الفروع | Cross-Branch Transfer | موجود جزئيًا (نفس الفرع فقط) → مرفوض بين الفروع حاليًا | عالية |
| E3 | رسوم/عمولة بنكية آلية | Bank Expense Auto-Rules | جزئي — `recurring_journals` موجود للتشغيل اليدوي فقط | متوسطة |
| E4 | إشعارات استحقاق العميل | Customer Statements | ناقص — CRM وreminders موجودان، لكن لا إرسال | متوسطة |
| E5 | الأصول الثابتة والإهلاك | Fixed Assets & Depreciation | 1201/1202/5108 موجودان في المخطط بدون منطق داخلي | عالية |
| E6 | الإقفال الشهري الآلي | Automated Monthly Closing | `periods.is_closed` + `closePeriod` + `reopen` موجودان يدويًا فقط | عالية |

---

## 2. جدول: موجود / ناقص / مكسور

| الوحدة | الموجود في الكود | ما ينقص | مكسور | الحكم |
|---|---|---|---|---|
| **E1** | `cash_accounts` type=2 · `gl_accounts` + روابط · `vouchers` · `gl_journals` كامل | `bank_statement_lines` · `bank_matching_rules` · `bank_reconciliation_runs` | لا | **ناقص (كاملة)** |
| **E2** | `stock_transfers`/`stock_transfer_lines` تحتوي `transfer_no` و`serial` و`qty` · `stock_movements` ledger كامل · `/approve` → `transfer_out` · `/receive` → `transfer_in` · يُتحقق من نفس الفرع فقط | `branch_transfers` · `branch_transfer_lines` · منطق `transfer_out`/`transfer_in` عبر الفروع | لا | **ناقص (جزئيًا متوفر)** — التحقق من `branch_id` في `stock-transfer.slice.ts` يجب تعديله |
| **E3** | `recurring_journals` + `recurring_journal_lines` + `computeNextDate` + `runRecurring` · لا `bank_expense_rules` · لا دمج مع كشف البنك | `bank_expense_rules` · scheduler hook بتوقيت الشهر · دمج الربط مع E1 عند إنزاله | طريحًا: القوالب تعمل لكن لا automation بـ `day_of_month` (وemmbeded رمل الخطير ميحمرار) | **ناقص + موجود مكسور جزئيًا** |
| **E4** | `parties` (phone · email · mobile) · `customer_groups` · `crm_tickets` (human task) · `vouchers` (قبض) · `voucher_allocations` (التوزيع) · `ETA/ZATCA` (يُرسل فاتورة للهيئة) | لا إشعارات تلقائية؛ لا SMTP/WhatsApp provider؛ لا `statement_templates`· `statement_triggers`· `statement_log` | لا | **ناقص (كاملة)** |
| **E5** | `gl_accounts` 1201/1202/5108 (مراهم فقط) · لا كود للأصول الثابتة · لا إهلاك تلقائي | `fixed_assets` · `asset_depreciation_lines` · `asset_disposals` · `runDepreciation` · job شهري | لا | **ناقص (كاملة)** |
| **E6** | `periods` مع `is_closed` + `/accounting/periods` (create/close/reopen) + `assertPeriodOpen` + `assertPeriodOpen` all callers | `period_close_checks` · `closing_entry` · `preCloseCheck` · auto-generate next period | لا | **ناقص (كاملة، بأساسات جيدة)** |

---

## 3. ارتباطات التضمين — أين تتشابك

| الرابط | التفصيل |
|---|---|
| E3 ← E1 | الخطوة الأولى في E3 (run rule بغض النظر عن التقويم) لا تتطلب E1؛ لكن E3 الإنتاجية تحتاج E1 (كشف البنك الوارد) لاكتشاف الرسوم المتغيرة |
| E5 ← E6 | بعد الاعتماد على إقفال الشهر، يمكن إهلاك شهر تحت الفترة المقفلة بأمان |
| E4 ← E1 | `statement_triggers` يربط بأرصدة العميل في الوقت الحقيقي — لا يفيد إلا مع truth source صحيحة |
| E2 × E1 | تحويل بين فروع بنكتين ساعات لا يحتاج إلي E1؛ لكن فروع متتابعة في نفس الشركة يحتاج متسوق (مع E1) |
| E5 × E6 | إهلاك شهر أبريل بعد إقفال أبريل — يلزم E6 مغلق |
| E6 × كل | الإقفال الآلي يستخدم كل `gl_accounts` بمعرفات أكيدة وفق mapping `RETAINED_EARNINGS` — يوجد مسبقًا |

**الترتيب المقترح للتنفيذ:** E1 → E6 → E2 → E5 → E3 → E4

---

## 4. إحصاءات وعدد المستندات

- 6 مستندات spec تغطي الوحدات الست.
- 0 تعديلات على الكود في هذه المرحلة.
- التقرير هذا التجميع فقط، والمرجعيات تُبلّغ في كل وحدة.

---

## 5. إرشادات النشر الآمن

1. كل DDL تُطبق على قاعدة CI أولًا (`tools/pg/migrate-all.js` من البيئة الفارغة).
2. لا تُدخل ميكرو فإن في production إلا بعد ما يتأكد أنها غير متجهة رجوعًا.
3. كل spec ينفذ نفسه منفصلًا — يصبح smoke-test فعلاً الاختبار.
4. لا تغير فترة أي قيد `gl_journals` بواسطة أي شيء في هذه المرحلة — كل شيء يعمل حاليًا بدون تعديل.

---

## 6. جدول مرجعي — ملفات المواصفات

| # | الملف | البنية | أسهم |
|---|---|---|---|
| E1 | `docs/E1-BANK-RECONCILIATION.md` | مطابق | `bank_statement_lines` · `bank_matching_rules` · `bank_reconciliation_runs` · تقارير 3 |
| E2 | `docs/E2-INTER-BRANCH-TRANSFER.md` | مطابق | `branch_transfers` · `branch_transfer_lines` · `entry_in/out` |
| E3 | `docs/E3-AUTO-BANK-EXPENSES.md` | مطابق | `bank_expense_rules` · scheduler hook |
| E4 | `docs/E4-CUSTOMER-STATEMENTS.md` | مطابق | `statement_templates` · `statement_triggers` · `statement_log` |
| E5 | `docs/E5-FIXED-ASSETS-DEPRECIATION.md` | مطابق | `fixed_assets` · `asset_depreciation_lines` · `asset_disposals` |
| E6 | `docs/E6-MONTHLY-CLOSING.md` | مطابق | `period_close_checks` · `closing-entry` |
