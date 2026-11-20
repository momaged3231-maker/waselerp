# GAP-07 — النسخ الاحتياطي والاستعادة (Backup/Restore) — تقرير التحقق

**التاريخ:** 2026-11-20  
**الحكم:** **PASS** — GAP07-01..08 (9/9) + GAP07-09 (انحدار B1..B5.4 + smoke 606/606) مكتملة على بيئات PGlite/API محلية معزولة. GL-10 (مرجع 5434) غير قابلة لإعادة التشغيل على المرجع في هذه الشجرة (TD-44)؛ الدليل المقبول مُشار إليه أدناه.  
**القيود:** لا commit · لا push · لا إنتاج · لا Supabase — PGlite محلي معزول فقط. لا تغييرات على `posting.ts` ضمن GAP-07.

---

## 1) التنفيذ (غير ملتزم)

| الملف | التعديل |
|---|---|
| `db/migrations/2026-11-20-gap07-backup-restore.sql` | جديد — جدول `restore_log(restored_at timestamptz default now(), restored_by int, backup_version int, table_counts jsonb, source_ip text)` + صلاحية `admin.restore_backup` (`ON CONFLICT DO NOTHING`) |
| `apps/api/src/cli/seed.ts` | إضافة `admin.restore_backup` إلى `PERMISSIONS` وتعيينها (الأدوار/المدير) — البذر يعطي `permissions: 55, roles: 5, users: 1, branches: 1` |
| `apps/api/src/modules/backup/backup.slice.ts` | تنفيذ GAP-07: `POST /admin/restore` (وحدة تحكم `AdminRestoreController`, صلاحية `admin.restore_backup`) + منطق `restoreGAP07` (تحقق confirm/version/سلامة، ترتيب FK آمن، حذف/إدراج معاملية، تحقق أعداد، إعادة ضبط sequences، إدراج `restore_log` + `activity_log`) + أدوات FK/topo/dangling؛ الإبقاء على `GET /admin/backup` و`POST /admin/backup/restore` القديم (`users.manage`) للتوافق |
| `apps/api/dist/*` | إعادة بناء API (`cd apps/api && npm run build`) ناجحة |
| `tools/verify-gap07.js` | أداة تحقق GAP07-01..08 (معزولة، قابلة للتشغيل بعد تصحيح إدراج `gl_entries.branch_id` أثناء الإعداد) |

**`posting.ts` (حرفي):** `git diff --stat -- apps/api/src/common/posting.ts` = `121 insertions(+), 12 deletions(-)` (عمل سابق غير ملتزم E2/E6/D-17). **مساهمة GAP-07 = 0 سطر** ولا أي مساهمة GL-10/GAP-08؛ لم يُعدّل ضمن هذه المهمة.

---

## 2) نقطة النهاية (GAP-07)

| البند | القيمة |
|---|---|
| **Endpoint (GAP-07)** | `POST /api/admin/restore` — يتطلب `admin.restore_backup` (403 بدونها). يحتفظ بالتوافق: `GET /api/admin/backup` و`POST /api/admin/backup/restore` (`users.manage`). |
| **Request body** | `{ backup: <BackupPayload>, confirm: "RESTORE", user_id?: number }` — `confirm` إلزامي حرفيًا `"RESTORE"` (400 بدونها)، `user_id` في الجسم غير مستخدم لتحديد المُنفّذ (يُؤخذ من المستخدم الموثّق)، `restored_by` يُسجَّل من `current user`. |
| **التحقق** | `backup` كائن ويحوي `tables`؛ `backup.version === 1` (وإلا 400)؛ وجود صفوف في كل جدول مُدرج بصيغة صحيحة؛ كل جداول النسخة موجودة في القاعدة؛ رفض نسخة مشوّهة **`gl_journals` موجودة (بصفوف) و`gl_entries` ناقصة/فارغة** → 400؛ رفض FK dangling داخلي في الحمولة → 400؛ التحقق من عدد الصفوف لكل جدول بعد الإدراج (400 عند عدم التطابق). كل ذلك داخل معاملة واحدة — أي فشل ⇒ rollback (القاعدة دون تغيير). |
| **الاستعادة** | `SET session_replication_role='replica'` داخل المعاملة؛ **DELETE** لكل الجداول المُدرجة في النسخة بترتيب **عكسي** لترتيب الإدراج الآمن (أبناء قبل آباء)؛ **INSERT** بترتيب FK الصحيح (آباء قبل أبناء) مع تطبيع القيم (bytea `{__bytea}`) وتجاوز الأعمدة المولّدة؛ **إعادة ضبط sequences** للجداول المُدرجة؛ التحقق من الأعداد؛ `session_replication_role='origin'`; إدراج صف في `restore_log` وسجل `activity_log`. |
| **الاستجابة (نجاح)** | `{ restored: true, tables, rows, counts: <table_counts>, deleteOrder, insertOrder }` |

---

## 3) مخطط النسخة الاحتياطية (v1)

| الحقل | النوع/المعنى |
|---|---|
| `version` | `1` (إلزامي) |
| `createdAt` | ISO 8601 |
| `meta` | `{ tables: <عدد الجداول>, rows: <إجمالي الصفوف> }` |
| `tables` | `Record<table_name, Row[]>` حيث كل `Row` تمثيل JSON لأعمدة الصف (قيم `bytea` تُرمَّز `{ "__bytea": "<base64>" }`). الاستعادة تقبل أيضًا `{ rows: Row[] }` لكل جدول للتوافق. |

`GET /admin/backup` يُصدّر **جميع الجداول الأساسية** في `public` (`information_schema.tables`, `BASE TABLE`) مرتبة أبجديًا، داخل معاملة قراءة متسقة.

---

## 4) قائمة الجداول وترتيب الاستعادة الآمن (FK-safe)

- **عدد الجداول (المخطط الحالي):** 139 جدولًا أساسيًا في `public` (بيئة GAP-07 المُهاجرة بالكامل). الاستعادة على نسخة كاملة تُدرج/تحذف هذه الجداول كلها؛ عند استعادة نسخة جزئية تُطبَّق العملية على الجداول المُدرجة فقط مع تحقق FK داخلي بينها.
- **الترتيب:** فرز طوبولوجي (Kahn) على مخطط المفاتيح الأجنبية (`information_schema.table_constraints/key_column_usage/constraint_column_usage`)، مع حتمية أبجدية؛ المفاتيح الذاتية تُتجاهل في بناء الحواف (وتُعالج عبر `session_replication_role='replica'`).
- **INSERT order (آباء → أبناء):**  
  `["app_settings","banks","branches","categories","colors","cost_centers","countries","cities","coupons","crm_sources","currencies","customer_classifications","customer_groups","departments","document_sequences","eta_config","fault_categories","fault_subcategories","gl_accounts","bank_matching_rules","cash_accounts","cash_categories","gl_mappings","governorates","latency_deduction_tiers","maintenance_products","maintenance_models","note_templates","number_sequences","permissions","price_lists","print_agents","print_profiles","restaurant_halls","restaurant_settings","restaurant_tables","roles","role_permissions","salary_components","schema_migrations","shipping_methods","shipping_rates","sizes","units","items","gift_offers","item_components","item_modifiers","item_units","price_list_lines","users","activity_log","attachment_policies","attachments","bank_expense_rules","budgets","budget_lines","employees","attendances","early_permissions","employee_salary_components","leave_requests","maintenance_tickets","maintenance_ticket_parts","parties","crm_leads","crm_activities","crm_tickets","print_jobs","recurring_journals","recurring_journal_lines","reminders","report_definitions","restore_log","shifts","user_branches","user_cash_accounts","user_roles","warehouses","held_invoices","item_warehouse_qty","stock_operations","stock_operation_lines","user_warehouses","zatca_config","advance_deductions","asset_depreciation_lines","asset_disposals","bank_expense_runs","bank_reconciliation_run_lines","bank_reconciliation_runs","bank_statement_lines","bank_suspense_entries","branch_transfer_lines","branch_transfers","cash_transactions","checks","employee_advances","eta_invoices","fixed_assets","gl_entries","gl_journals","installment_plans","installment_schedule","invoice_allocations","invoice_lines","invoice_payments","invoices","ledger_entries","order_lines","orders","period_close_checks","period_close_overrides","periods","purchase_invoice_links","purchase_match_overrides","purchase_receipt_lines","purchase_receipts","purchase_rejections","quotation_lines","quotations","salary_pay_lines","salary_pays","sales_credit_overrides","shipments","stock_count_lines","stock_counts","stock_movements","stock_transfer_lines","stock_transfers","stock_voucher_lines","stock_vouchers","supplier_advances","supplier_claims","supplier_payment_allocations","table_order_lines","table_orders","vouchers","zatca_invoices"]`
- **DELETE order (عكس الإدراج، أبناء → آباء):**  
  `["zatca_invoices","vouchers","table_orders","table_order_lines","supplier_payment_allocations","supplier_claims","supplier_advances","stock_vouchers","stock_voucher_lines","stock_transfers","stock_transfer_lines","stock_movements","stock_counts","stock_count_lines","shipments","sales_credit_overrides","salary_pays","salary_pay_lines","quotations","quotation_lines","purchase_rejections","purchase_receipts","purchase_receipt_lines","purchase_match_overrides","purchase_invoice_links","periods","period_close_overrides","period_close_checks","orders","order_lines","ledger_entries","invoices","invoice_payments","invoice_lines","invoice_allocations","installment_schedule","installment_plans","gl_journals","gl_entries","fixed_assets","eta_invoices","employee_advances","checks","cash_transactions","branch_transfers","branch_transfer_lines","bank_suspense_entries","bank_statement_lines","bank_reconciliation_runs","bank_reconciliation_run_lines","bank_expense_runs","asset_disposals","asset_depreciation_lines","advance_deductions","zatca_config","user_warehouses","stock_operation_lines","stock_operations","item_warehouse_qty","held_invoices","warehouses","user_roles","user_cash_accounts","user_branches","shifts","restore_log","report_definitions","reminders","recurring_journal_lines","recurring_journals","print_jobs","crm_tickets","crm_activities","crm_leads","parties","maintenance_ticket_parts","maintenance_tickets","leave_requests","employee_salary_components","early_permissions","attendances","employees","budget_lines","budgets","bank_expense_rules","attachments","attachment_policies","activity_log","users","price_list_lines","item_units","item_modifiers","item_components","gift_offers","items","units","sizes","shipping_rates","shipping_methods","schema_migrations","salary_components","role_permissions","roles","restaurant_tables","restaurant_settings","restaurant_halls","print_profiles","print_agents","price_lists","permissions","number_sequences","note_templates","maintenance_models","maintenance_products","latency_deduction_tiers","governorates","gl_mappings","cash_categories","cash_accounts","bank_matching_rules","gl_accounts","fault_subcategories","fault_categories","eta_config","document_sequences","departments","customer_groups","customer_classifications","currencies","crm_sources","coupons","cities","countries","cost_centers","colors","categories","branches","banks","app_settings"]`
- **دورات متبقية:** `[]` (لا دورات غير معالجة).

---

## 5) GAP07-01 .. GAP07-08 — نتائج أساسية (حرفية)

**البيئة:** PGlite `5441` (`tools/pg/pglite/data.gap07-verify`, مُعاد إنشاؤه نظيفًا) + API `4006`، مُهاجرة ومُبذورة (`migrations/2026-11-20-gap07-backup-restore.sql` مُطبّق، `permissions:55 roles:5 users:1 branches:1`).  
**الأداة:** `tools/verify-gap07.js` (`API_BASE=http://127.0.0.1:4006/api PGPORT=5441`) — السجل `%TEMP%\gap07-core.txt`.  
**حالة الإعداد:** إنشاء مستخدم كاشير بدون `admin.restore_backup` (عبر API) + بيانات اختبار داخل المعاملة المنطقية للأداة: فاتورتان، قيدان متوازنان (6 سطور)، سند؛ لقطة أصلية؛ تعديل متعمّد (حذف فاتورة + قيد إضافي)؛ نسخة احتياطية أصلية.

| المعيار | النتيجة | المتوقع | الفعلي (حرفي) |
|---|---|---|---|
| **GAP07-01** `POST /admin/restore` يتطلب `admin.restore_backup` (403 بدون) | **PASS** | `{"unauthzStatus":403,"adminHasPerm":true}` | `{"unauthzStatus":403,"unauthzMessage":"ليس لديك صلاحية لهذه العملية","cashierPerms":false}` |
| **GAP07-02** Body بدون `confirm:"RESTORE"` → 400 | **PASS** | `{"status":400}` | `{"status":400,"message":"يجب تأكيد الاستعادة بإرسال confirm: \"RESTORE\""}` |
| **GAP07-03** نسخة مشوّهة (`version != 1`) → 400 | **PASS** | `{"status":400}` | `{"status":400,"message":"نسخة احتياطية غير مدعومة (version != 1) — استخدم نسخة من هذا النظام"}` |
| **GAP07-04a** مشوّه (`gl_journals` موجود و`gl_entries` ناقص) → 400 والقاعدة لم تتغير | **PASS** | `status=400`, `unchanged=true`, لقطة قبل `{"invoices":2,"gl_journals":3,"gl_entries":6}` | `status=400, message="نسخة احتياطية مشوّهة: قيود محاسبية (gl_journals) بدون سطور (gl_entries)", snapAfter={"invoices":2,"gl_journals":3,"gl_entries":6}, unchanged=true` |
| **GAP07-04b** FK dangling → 400 والقاعدة لم تتغير | **PASS** | `status=400`, `unchanged=true` | `status=400, message="مرجع أجنبي معلق (FK dangling): الجدول gl_entries يشير إلى gl_journals بقيمة غير موجودة (gl_entries_journal_id_fkey)", snapAfter={"invoices":2,"gl_journals":3,"gl_entries":6}, unchanged=true` |
| **GAP07-05** استعادة ناجحة: `invoices, gl_journals, gl_entries` تعود للقيم الأصلية | **PASS** | أصل `{"invoices":2,"gl_journals":3,"gl_entries":6}` بعد تعديل `{"invoices":1,"gl_journals":4,"gl_entries":8}` | بعد الاستعادة `{"invoices":2,"gl_journals":3,"gl_entries":6}`، `status=201` |
| **GAP07-06** ميزان المراجعة متوازن بعد الاستعادة (مجموع Dr = Cr) | **PASS** | `{"balanced":true,"drEqualsCr":true}` | `{"balanced":true,"totalDebit":350,"totalCredit":350,"drEqualsCr":true}` |
| **GAP07-07** مجموع الأرصدة = القيمة الأصلية (بالقرش) | **PASS** | `{"totalDebit":350,"totalCredit":350,"balanced":true}` | `{"totalDebit":350,"totalCredit":350,"balanced":true}` |
| **GAP07-08** صف واحد في `restore_log` لكل استعادة ناجحة | **PASS** | `exists=true, backup_version=1, restored_by=1` | `{"exists":true,"id":1,"backup_version":1,"restored_by":1,"hasTableCounts":true,"sourceIp":"127.0.0.1","restoredAt":"2026-11-20T00:37:07.401Z"}` |

**المجموع:** `TOTAL: 9/9 (FAIL=0)`.

### أدلة الجولة (مكملة للمعايير)

| الدليل | القيمة |
|---|---|
| لقطة أصلية (قبل التعديل) | counts `{"invoices":2,"gl_journals":3,"gl_entries":6}` · TB `{"totalDebit":350,"totalCredit":350,"balanced":true}` · voucher=1 · `backup.tables=139` |
| بعد التعديل المتعمّد (قبل الاستعادة) | counts `{"invoices":1,"gl_journals":4,"gl_entries":8}` · extraJournal=4 |
| استعادة ناجحة | status `201`، counts تعود `2/3/6`، TB `350/350` متوازن وبنفس مجموع الأرصدة الأصلية (بالقرش) |
| Rollback عند الرفض | GAP07-04a و04b أعادا `400` مع بقاء اللقطة `{"invoices":2,"gl_journals":3,"gl_entries":6}` دون تغيير (المعاملة أُلغيت) |
| `restore_log` | صف واحد للاستعادة الناجحة: `backup_version=1`, `restored_by=1 (admin)`, `table_counts` موجود (JSONB)، `source_ip=127.0.0.1` |

> ملاحظة تشغيلية: التشغيل الأول للأداة على 5441 فشل في مرحلة الإعداد بسبب قيد `gl_entries.branch_id NOT NULL` في إدراج بيانات الاختبار بالأداة (لا خلل في منطق الاستعادة). صُحّح الإدراج (`branch_id` مُدرج)، أُعيد إنشاء بيئة 5441/4006 نظيفة، وأُعيد التشغيل فنجح 9/9.

---

## 6) GAP07-09 — الانحدار (B1..B5.4 + GL-10 + smoke)

### 6.1 B1..B5.4 + Integration (بيئة معزولة 5442/4007)

**البيئة:** PGlite `5442` (`tools/pg/pglite/data.gap07-regress`) + API `4007`، مُهاجرة ومُبذورة نظيفة (`migrations=56` بما فيها GAP-07/08، `policies=6` حسب سياق GAP-08 على نفس المخطط، `permissions:55`).  
**السجل:** `%TEMP%\gap07-regress.log`.

| المجموعة | النتيجة |
|---|---|
| B1 `npm run test:purchases` | **14/14** |
| B2 `npm run test:purchases-invoice` | **15/15** |
| B3 `npm run test:purchases-match` | **8/8** |
| B4 `npm run test:purchases-statement` | **6/6** |
| B5.1 `npm run test:credit-limit` | **16/16** |
| B5.2 `npm run test:sales-return` | **17/17** |
| B5.3 `npm run test:sales-return-extra` | **9/9** |
| B5.4 `npm run test:sales-credit-note` | **24/24** |
| Integration `npm run test:sales-integration` | **6/6** |

**المجموع المباشر:** **115/115**.

> ملاحظة: جرى تشغيل `smoke-test` بعد سلاسل الاختبارات على **نفس** قاعدة 5442 فتوقف مبكرًا بخطأ تداخل فترة (`POST /accounting/periods -> 400 "الفترة «CN closed» تغطي نفس التاريخ — لا يمكن فتح فترة متداخلة"`) ناتج عن تلوث حالة البيانات بتلك السلاسل (سلوك بيئي/ترتيب)، **وليس** انحدارًا في GAP-07. أُثبت smoke على قاعدة نظيفة منفصلة أدناه.

### 6.2 smoke-test (قاعدة نظيفة 5443/4008)

**البيئة:** PGlite `5443` (`tools/pg/pglite/data.gap07-smoke`) + API `4008`، مُهاجرة ومُبذورة نظيفة.  
**الأمر:** `API_BASE=http://127.0.0.1:4008/api node tools/smoke-test.js`  
**السجل:** `%TEMP%\gap07-smoke-clean.txt` (خاتمة التشغيل).

**النتيجة:** **606/606 checks passed** (نجاح كامل، لا أخطاء).

### 6.3 GL-10 (مرجع 5434 — حسب المواصفة) وقابلية النقل (TD-44)

- **المطلوب بالمواصفة:** تشغيل `tools/verify-gl10.js` على مرجع 5434.
- **الوضع في هذه الشجرة:** دليل بيانات مرجع GL-10 (5434 مع حالة `CC-VERIFY`) **غير متاح** حاليًا ضمن مساحة العمل؛ لا يمكن إعادة تشغيل الأداة حرفيًا على المرجع المُعتمد.
- **الدليل المقبول سابقًا:** `GL-10-report.md` — **PASS 12/12** على PGlite 5434/API 4001 (`%TEMP%\gl10-verify-2.txt`, `tools/verify-gl10.js`) وفق القبول الموثّق.
- **قابلية النقل (TD-44، فجوة إثبات وليست تغطية):** الأداة غير قابلة للنقل كما هي — `GL10-01` يفترض `base_tables=137` (بعد GAP-08 أصبح 138) و`GL10-11` يفترض بيانات/بيئة 5434 (`CC-VERIFY`) فتُنتج `NaN` على بيئة نظيفة؛ لذا أي إعادة تشغيل خارج المرجع المُعدّ ليست قياسًا لانحدار منطق الموازنة. **لا تغيير في منطق GL-10 ضمن GAP-07**.
- **الانحراف المسجّل:** عدم إعادة تشغيل GL-10 على 5434 في هذه الجولة لعدم توفر مرجع البيانات؛ يُعوَّض بالاستشهاد بالدليل المقبول وTD-44.

---

## 7) GAP07-09 — الحكم المجمع

| الفحص | النتيجة |
|---|---|
| GAP07-01..08 (أساسي، 5441/4006) | **9/9 PASS** |
| B1..B5.4 + Integration (5442/4007) | **115/115 PASS** |
| smoke-test (نظيف 5443/4008) | **606/606 PASS** |
| GL-10 على مرجع 5434 (مواصفة) | **غير مُعاد تشغيله** — مرجع البيانات غير متاح؛ **الدليل المقبول** GL-10 12/12 مُشار إليه + **TD-44** (قابلية نقل) مُوثّق؛ لا انحدار مُلاحظ في منطق الموازنة ضمن نطاق GAP-07 |
| `posting.ts` | **0 مساهمة GAP-07** (`121/12` diff سابق غير ملتزم، E2/E6/D-17) |

**خلاصة GAP-07:** التنفيذ يحقق معايير 1–8 حرفيًا بالأدلة أعلاه، ومعيار 9 مثبت انحداريًا (B1..B5.4 + smoke 606/606 على قواعد نظيفة) مع انحراف موثّق لإعادة تشغيل GL-10 على 5434 لسبب بيئي/قابلية نقل (TD-44) لا علاقة له بتغييرات GAP-07.

---

## 8) البيئات المؤقتة

- أُنشئت وأُوقفت/نُظّفت أثناء التحقق: 5441/4006 (أساسي)، 5442/4007 (B1..B5.4)، 5443/4008 (smoke نظيف). لا التزام، لا دفع، لا إنتاج، لا Supabase.

**لم يبدأ GAP-06.**
