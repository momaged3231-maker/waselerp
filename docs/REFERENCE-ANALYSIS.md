# تحليل البرنامج المرجعي (Ezee Manager Pro 1.8.6.46)

> الغرض من هذا التحليل **استخراج المتطلبات الوظيفية فقط** (ما الذي يجب أن يعمل) — وليس نسخ التنفيذ.
> كل الأكواد والمخطط النهائي في `WaselERP` مكتوب من الصفر؛ الجداول أدناه استُخدمت كمرجع سلوكي وفيه فرق في التسمية والبنية.

## 1) هوية الهدف (من REA — تحليل ثابت بدون تشغيل)

| البند | القيمة |
|---|---|
| الاسم | EzeeManagerPro.exe — "Ezee Manager Pro / TebaLink ERP" |
| الإصدار | 1.8.6.46 |
| التقنية | .NET Framework 4.8 (`useLegacyV2RuntimeActivationPolicy`)، PE32 x86، CIL |
| الواجهة | WinForms + `DevComponents.DotNetBar2` 14.1 (Ribbon)، خطوط عربية (Hacen Beirut) |
| التقارير | `CrystalDecisions.*` 13.0 (ملفات `.rpt` مدمجة + مجلد Report) |
| البيانات | SQL Server (`Server=.\sqlexpress`، `System.Data.SqlClient`)، مضيء على `SQL2012/SQL2014` |
| إضافات | `EzeeZatca` + `Zatca.EInvoice.SDK` (فاتورة إلكترونية)، `Interop.zkemkeeper` (بصمة/حضور)، `QRCoder`، `Ionic.Zip`، `Newtonsoft.Json` |
| المقاس | 37.8MB · 950 TypeDef · 48,605 MethodDef · 11,829 Field · 473 ManifestResource |

## 2) الحماية (من REA)

- **ConfuserEx** (`ConfusedByAttribute`): أسماء الـ TypeDef كلها مشفّرة (تحويل Unicode غير مرئي)، الـ namespaces مسطّحة، ونصوص الـ user strings (#US) **مشفّرة** → استخراج SQL الخام من الكود غير ممكن.
-的资源 (ManifestResource) names كانت **غير مشفّرة** →ADM731 تقرير `.rpt` كان هو المصدر richest لفهم الوحدات.
- الـ user strings عددها 0 في الـ metadata inspection (تأكيد على التشفير).

**النتيجة العملية:** التحليل Static للكود أُعطي قيمة محدودة؛ التحليل الفعّال جاء من (أ) الموارد، (ب) مخطط قاعدة البيانات، (ج) الـ Stored Procedures/Functions.

## 3) خريطة الوحدات من الـ 227 تقرير مدمج + 52 ملف

| الوحدة | أدلة من أسماء التقارير |
|---|---|
| البيانات الأساسية والأصناف | `ItemSalesRpt, ItemMovRpt, ItemPharsRpt (الأصناف النشطة), ItemsUnderReorderPoint, PriceList, ExpiredItemsRpt, BarCode/Zebra (ملصقات)` |
| المخازن | `StoreOperationsRpt, stores_balance, stores_items_movement, GardOperations (الجرد), RequiredInsRpt, StoreTempRpt` |
| المبيعات | `Bills, BillsTotal, Bills_items_movement, CashierAndDelivery, TotalSalesCountRpt, Netreceipt` |
| المشتريات | `InsRpt, InsDet, InsReceipt, GetRequiredIns, SupcustRpt` |
| الخزينة | `Cash, Cash_Report, GroupedCash, Cash_Treceipt_A7, AccountAnalysisMonthly, HesabMoutagra (حساب المطرح/المقبوض), UserTreasureDefict` |
| العملاء والموردون | `SupCustAccounts_all/PerSupCust, CustPaymentAnnually, RepPaymentAnnually, CustDeptorBalance, CustPalancePeriodAlert` |
| شئون العاملين | `Salaries, SalaryDetails, RptAttendAndLeave, AbsenseAndVacations, OverTime, loanEkrar, Skills, EmpCard, Rpt_EmpBasicData` |
| نقاط البيع/المطاعم | `Restaurant, CasherAndDelivery, RecptPOS, CookOrder, GetRestaurantBusyTables, PeriodClose_A7, HourSalesRpt` |
| فرعي | `ECommerce.BillsTotal_shipping, Shipping_Receipt_A5` (شحن) |

## 4) مخطط قاعدة البيانات المرجعي (SQL Server) — 100 جدول

- **الأصناف**: `Items` (91 عمود — سعر بيع/آجل/تكلفة، 5 وحدات تحويل، باركود 7 حقول، ضريبة، خصم، FIFO/LIFO/AVGC، سيريال، تواريخ انتهاء، ZATCA codes)، `Category`, `Units`, `tb_UnitsTypes`, `tb_PriceList`, `tb_Price_Show`, `ItemsParents`, `ItemsGift`, `Item_Serials`.
- **المخزون**: `Store_Operation` + `Operation_Details` (تحويل/جرد)، `tb_ItemOperations` (40 عمود — دفتر حركات شامل)، `Items_Start_Balance` (رصيد افتتاحي)، `tb_ItemStores`.
- **الفواتير**: `Invoice_master` (101 عمود) + `invoice_details` — ملاحظة: `invoice_type` يفرّق بين المبيعات والمشتريات والمرتجعات، `payment_type` (نقد/آجل)، `Is_Cashier`, `Pilot_ID` (مندوب), `Period_ID`, `Eta_*` (الفوترة الإلكترونية).
- **العملاء والموردون**: `SupCust` (41 عمود — `SupCust_Type` عميل/مورد، `MaxCredit`, `RepID`, `pricelist`, `Period`), `SupCust_Accounts` (حركات الحساب).
- **الخزينة**: `Cashes` (الصناديق), `Cash` (الحركات: `action_direction`, `action_type`, `BankActionID`), `Cash_actionTypes`, `Bank_actions`, `BANKS`, `tb_UserTreasuryDeficit` (عجز الكاشير).
- **الفروع**: `Branches`, `Co-Branches`, `BranchAccounts`, `UsersStores` (صلاحيات المخازن), `UsersCategoreis`.
- **الصلاحيات**: `Users` + `Permissions` + `Active_Permissions` (ربط مباشر مستخدم↔صلاحية).
- **التقسيط**: `Installments` + `Installments_Paids`.
- **الموارد البشرية**: `Emps` (44 عمود), `Attendance`, `Leave`, `OverTime`, `SalaryDetails`, `PaidSalaries`, `Departments`, `Courses`, `Skills`, `Experince`, `Care`, `AbsenceAndVacations`.
- **أخرى**: `tb_Periods` (فترات مالية + إقفال), `tb_synch` (مزامنة!), `tb_SMS`, `Astazan` (العُزل/المنتجين), `Sheets`/`Statments*` (كشوف حساب تفصيلية), `tb_Pilots` (مندوبين).

**319 روتين SQL** (133 function + 123 procedure + 63 trigger)BearGemischte منطق العمل — أمثلة:
`GetItemBalanceByStore`, `GetFinalTotalOfBill`, `CheckMaxCredit`, `GetdiscountofBill_Hesba`, `IsPeriodOverLapped`, `CashCurrentBalanceByPeriod`, `GetRepMonthSales`, `GetTotalSalaryDetailOfEmp`, `Rpt_Periods`, `userTreasury`, `AllowRemoteConnection`, `GetEzeeManagerDatabases` (أرشفة سنوية).

## 5) ما تم أخذه كمتطلب (وما لم يؤخذ)

| ✅ أُخذ كمتطلب | ❌ لم يُؤخذ (تنفيذ أصلي) |
|---|---|
| تقسيم الوحدات الست ونقاط الدخول | أسماء الجداول/الأعمدة الأصلية |
| Multi-branch على قاعدة مركزية | الـ 319 روتين SQL الأصلية |
| وحدات متعددة للصنف + أسعار | ملفات Crystal Reports الأصلية |
| فترات مالية وإقفال | أسماء الـ Forms/String resources الأصلية |
| دفتر حركات مخزون شامل | كود الـ WinForms |
| تقسيط + ورديات + عجز كاشير | |
| صلاحيات لكل فرع/مخزن/فئة | |
| فاتورة إلكترونية (ZATCA) كنقطة تمديد | |
| باركود + ملصقات +QR | |

## 6) أدوات التحليل المستخدمة

- **REA MCP** (`inspect_managed_artifact`, `inspect_managed_members`, `inspect_analysis_view`) — جرد الـ metadata والموارد وكشف ConfuserEx.
- **استخراج نصوص ثنائي/أحادي البايت** من الملف (Node) — أسماء أعمدة الـ DB ووحدات التقارير وواجهات الـ resx.
- **SQL Server** — قراءة مخطط الـ 100 جدول و319 روتين (قراءة فقط، بدون تعديل على قاعدة البيانات الأصلية).
- **مخطط WaselERP** (PostgreSQL) أُعيد تصميمه بناءً على السلوك المطلوب: `invoices/invoice_lines` موحّدة بدل `Invoice_master/invoice_details`، `ledger_entries` بدل `SupCust_Accounts`، `stock_movements` بدل `tb_ItemOperations`، `roles + permissions` بدل الربط المباشر، `cash_transactions` بدل `Cash`.

## 7) حدود التحليل (مهم)

- التحليل كان **static فقط**: لم يُشغَّل البرنامج ولا حُدِّثت قاعدة البيانات الأصلية.
- بُنِي الـ metadata التام بحدود السعة (48,605 دالة) → تم تقييد الفحص بمعاملات مقبولة (تقرير `resource-limit`).
- نصوص SQL داخل الكود **مشفّرة** → لم تُقرأ مباشرة؛ استُنتجت القواعد من الـ functions والجداول بدلًا منها.
- الـ ZATCA/ETA والـ Crystal Reports تُعامل كـ **نقاط تمديد** ولم تُنفَّذ بعد.
