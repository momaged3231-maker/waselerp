# AGENTS.md — WaselERP

نظام إدارة مبيعات ومخزون وفروع متعدد الفروع. **Next.js 14 (SPA/PWA)** + **NestJS 10 (Modular Monolith, Vertical Slices)** + **PostgreSQL 16+** (مركزي) + **Print Agent محلي** (ESC/POS).

هذا الملف هو نقطة البداية لأي وكيل (أو مطور) يكمّل المشروع. اقرأه قبل تعديل أي كود.

---

## 1) التشغيل السريع

```bash
# 0) PostgreSQL محلي (Windows) — لازم حساب غير Administrator (راجع §7)
node tools/pg/start.js

# 1) المخطط + البيانات الأساسية
node tools/pg/run-sql.js wasel db/schema.postgres.sql
cd apps/api && npx ts-node --transpile-only src/cli/seed.ts && cd ../..

# 2) بيانات تجريبية (اختياري)
node tools/demo-data.js

# 3) الـ API  (http://localhost:4000/api)
cd apps/api && npm run build && node dist/main.js

# 4) الواجهة (http://localhost:3000)
cd apps/web && npm run build && cd ../.. && node tools/web-serve.js

# 5) وكيل الطباعة (اختياري، على جهاز الكاشير) — http://127.0.0.1:4100
cd apps/print-agent && npm install && node server.js
```

بيانات الدخول: `admin` / `admin123` (غيّرها من شاشة الإعدادات).

سكربتات مختصرة في جذر المشروع: `npm run db:migrate` · `db:seed` · `db:reset` · `db:demo` · `api:build` · `api:start` · `web:build` · `web:start` · `agent:start` · `test` · `test:print`.

## 2) الاختبارات (مهم جدًا)

```bash
npm test          # tools/smoke-test.js — 369 فحص end-to-end
npm run test:print   # tools/print-agent-test.js — توليد ESC/POS بدون طابعة
```

`smoke-test.js` يغطي: الدخول، الـ RBAC، كل endpoints القراءة، دورة الفاتورة الكاملة (شراء → بيع → إلغاء مع عكس المخزون)، الـ idempotency، وحدات متعددة، التقسيط، ZATCA، و SSE.
**أي تعديل في الـ API لازم يعدّي `npm test` قبل الـ commit.**

## 3) بنية المشروع

```
apps/api/src/
  common/           database.service.ts (pg pool + transaction + nextNumber)
                    stock.ts (دفتر المخزون — كل حركة لازم تمر من هنا)
                    posting.ts (محرك القيد المزدوج — كل أثر مالي لازم يمر من هنا)
                    settings.ts (إعدادات قابلة للقراءة من الكود)
                    security.ts (JwtAuthGuard, PermissionsGuard, scrypt)
  modules/          auth · catalog · parties · sales · inventory · treasury
                    hr · reports · admin · events · installments · zatca
                    accounting (المحاسبة العامة: حسابات، قيود، سندات، شيكات)
  cli/seed.ts       بذر البيانات الأساسية + شجرة الحسابات والربط المحاسبي
apps/web/
  app/              الصفحات (Next.js App Router, static export)
  components/       AppShell (قائمة + شريط + تبديل الفرع) · AccountingNav
  lib/              api.ts (fetch + token + refresh) · session.tsx
                    offline.ts (IndexedDB queue) · live.ts (SSE) · print.ts (وكيل الطباعة)
apps/print-agent/  خدمة طباعة محلية (server.js + printer.ps1 + install-service.ps1 + run-agent.ps1)
db/                 schema.postgres.sql · seed · reset-dev-data.sql · migrations/
docs/               ARCHITECTURE.md · REFERENCE-ANALYSIS.md · EZEES-COVERAGE.md
tools/              pg/ (تشغيل + فحص DB + pglite) · smoke-test.js · demo-data.js
                    web-serve.js · restart-api.ps1
```

## 4) القواعد المعمارية (لا تكسرها)

1. **Vertical slices**: كل feature في `modules/<slice>` مستقل. ممنوع استيراد من slice تاني —الح.Common فقط.
2. **Raw SQL عبر `pg`**: ممنوع ORM. الاستعلامات parameterized (لا string interpolation) و**كل باراميتر عليه cast صريح** (`$1::int`, `$2::text` …) — Postgres مش بيعرف النوع لوحده.
3. **كل حركة مخزون تروح من `common/stock.ts`** (ledger + تحديث الرصيد في نفس الـ transaction). ممنوع تعديل `item_warehouse_qty` مباشرة.
4. **كل المعاملات المالية ذرّية**: الفاتورة + السطور + الحركات + دفتر العميل + الخزينة + **القيد المحاسبي** في `db.transaction()` واحدة.
5. **كل أثر مالي يمر من `common/posting.ts`**: فاتورة، حركة خزينة، تحويل، وردية، سداد قسط، مرتب. القيد لازم يكون متوازن (مدين = دائن) وإلا تُرفض العملية كلها.
6. **الربط المحاسبي**: كل مفهوم تجاري (مبيعات، ذمم، مخزون، خزينة، ضريبة…) مرتبط بحساب في `gl_mappings`. لو الربط ناقص العملية تفشل برسالة واضحة — لا تكتب حركات مالية بغير قيد.
7. **Branch scope**: كل استعلام يقيّد بـ `branch_id` من `CurrentBranch()` (هيدر `x-branch-id` يتحقق منه ضد صلاحيات المستخدم).
8. **الترقيم**: `db.nextNumber(client, key)` داخل الـ transaction (جدول `number_sequences`).
9. **الصلاحيات**: endpoints عليها `@RequirePermissions('...')`، والصلاحيات في `common/security.ts` + `src/cli/seed.ts` (لازم تتحدّث في الاتنين). `RequireAnyPermission` = OR، `RequirePermissions` = AND.
10. **الواجهة**: عربي RTL. `apiFetch` في `lib/api.ts` بيضيف التوكن + الفرع تلقائيًا — ممنوع `fetch` مباشر لـ API.
11. **الـ offline queue**: أي عملية لازم تكون قابلة للإعادة = `clientRequestId` كـ idempotency key.

## 5) الحالة الحالية (منجزة ومتحقَّق منها)

- ✅ أساس: مخطط PostgreSQL (96 جدول) · API كامل الوحدات · RBAC (32 صلاحية × 5 أدوار) · branch scope · audit log
- ✅ نقطة البيع (سلة، باركود، خصم، ضريبة، نقدي/آجل/مختلط، إيصال، طباعة)
- ✅ المبيعات/المشتريات/المرتجعات + إلغاء فاتورة بعكس أثر المخزون
- ✅ دفتر المخزون + التحويل والجرد والتسوية + متوسط التكلفة · **سند الجرد المستقل** (رأس+sطور، موظف إلزامي، snapshot للرصيد، اعتماد يطبق الفروقات + قيد فروقات الجرد 5111) · **أذون المخازن** (وارد/صادر/تالف/افتتاحي، مسودة→اعتماد→تطبيق، قيد محاسبي لكل نوع: 5112 تالف وهادر، 5113 إضافات مخزون)
- ✅ الخزينة + الورديات + التحويلات
- ✅ العملاء والموردون + كشوف الحساب + حد الائتمان
- ✅ وحدات بيع متعددة (معامل تحويل) — سلة نقطة البيع + محرر في شاشة الأصناف
- ✅ التقسيط (خطط، جدول، سداد، تنبيه مستحقات)
- ✅ SSE (تحديث لحظي للمخزون بين الفروع)
- ✅ وضع أوفلاين (IndexedDB queue + idempotency + مزامنة تلقائية)
- ✅ Print Agent محلي (ESC/POS + درج الكاشير + طابعات شبكة)
- ✅ ZATCA (XML UBL 2.1 + QR TLV + ختم ECDSA/RSA + clearance/reporting)
- ✅ **المحاسبة العامة (P1)**: شجرة حسابات + ربط محاسبي + قيود مزدوجة + ترحيل تلقائي لكل مستند + سندات قبض/صرف + شيكات + مراكز تكلفة + عملات + إقفال فترات + ميزان/أرباح وخسائر/ميزانية/أستاذ/ضريبة
- ✅ **دورة البيع والشراء (P2)**: قوائم الأسعار حسب العميل + عروض أسعار + أوامر بيع/شراء + حجز مخزون + تحويل لفاتورة + طرق دفع متعددة + كوبونات + عروض هدايا + تخصيص الدفعات + الشحن/التوصيل + تعديل الفاتورة
- ✅ **فاتورة إلكترونية مصرية (ETA)**: UUID v1 + XML UBL 2.1 + QR TLV (وسوم 1–8) + توقيع RSA + إرسال للهيئة (عنوان البوابة قابل للضبط)
- ✅ **نقطة البيع والمطاعم (P3)**: أنواع الطلب + رسوم التوصيل/السائق + تعليق الفواتير + مرتجع من الكاشير + الطاولات (بالدليل الرسمي: قاعات بأكواد، رسوم خدمة بنمطين، أصناف إضافية، ملاحظات جاهزة، فصل مائدة)
- ✅ **سند الجرد (P4.1)**: رأس+sطور، موظف مختص إلزامي، سند واحد مفتوح لكل مخزن،snapshot للرصيد عند الإضافة، تكرار يُجمع، رفض الكمية المساوية للرصيد، تعديل الكمية يُعيد الحساب، إضافة مجموعة، استيراد Excel، الاعتماد يطبق الفروقات على المخزون + قيد محاسبي (حساب 5111 فروقات الجرد)، السند المعتمد لا يُعدّل ولا يُحذف.
- ✅ **أذون المخازن (P4.2)**: وارد/صادر/تالف/افتتاحي، مسودة→اعتماد→تطبيق على المخزون، نفس الصنف بنفس الوحدة يُجمع، السند المعتمد لا يُعدّل ولا يُحذف، قيد محاسبي لكل نوع (Dr INVENTORY / Cr INVENTORY_ADDITION COGS / INVENTORY DAMAGE_EXPENSE / INVENTORY INVENTORY / RETAINED_EARNINGS)، حسابات 5112 و5113 + ربط gl_mappings.
- ✅ 30 شاشة + PWA (manifest + service worker)
- ✅ **P7 — الإعدادات والأدوات (2026-11-14)**: تقييد مخازن/صناديق لكل مستخدم (API `GET/PUT /admin/users/:id/restrictions` + `GET /admin/restrictions/options` + مودال «مخازن / صناديق» في تبويب المستخدمون + تنفيذ فعلي في قوائم المخزن/الصندوق للكاشير/المندوب) · تبويب «النسخ الاحتياطي» في الإعدادات (تنزيل JSON كامل + استعادة مع تأكيد ومسح/إعادة إدراج مع audit) · مرفقات الفواتير (`AttachmentsPanel` في تفاصيل الفاتورة — رفع/تنزيل/حذف، حد 5MB) · تصدير CSV + طباعة/PDF من التقارير · جدول محوري (`/reports/pivot/sales`, `/reports/pivot/stock`) · دول/مدن/شحن + البيانات الأساسية
- ✅ **الواجهة (2026-11-14)**: Sidebar مجمّع بنمط SaaS (SVG icons, 6 مجموعات) + لوحة معلومات بأيقونات SVG — راجع commit 8b44683
- ✅ **هوية الشركة للطباعة (2026-11-14)**: `GET /sales/print-context` (sales.view/pos.operate) تغذّي CompanyName/Phone/Address/TaxNumber/InvoiceFooter + إظهار/إخفاء أقسام الإيصال (`ReceiptShowBranchName/PartyName/Totals`) + `ReceiptCopies` 1–5 + `ReceiptPaperSize` (thermal80/58 عبر الوكيل؛ A5/A4 بالمتصفح مع @page) + **تذكرة مطبخ** (`KitchenTicketEnabled` + نسخ، `/kitchen-ticket` بلا أسعار من شاشة المطاعم) + **حد الائتمان استباقي في POS** (عرض المديونية/المتاح + تحذير قبل الحفظ) + `ShowTaxOnReceipt` + `TaxName` — راجع `docs/GAP-SETTINGS-EZEES.md`
- ✅ **مفاتيح تحكم حقيقية (2026-11-14، الجولة 2)**: `ItemCodeAuto` (كود تلقائي ITM-… من number_sequences داخل transaction) · `RequireRepOnSale` (رفض الحفظ بلا مندوب — server-side + رسالة واضحة) · `BlockBelowCostSale` (منع البيع بأقل من التكلفة — الهدايا مستثناة) · `DefaultPaymentType` (نمط الدفع الافتراضي في POS) · `KitchenPrinterName` (طابعة مطبخ Windows مخصصة، فارغ = الطابعة الافتراضية) — كلها في «الإعدادات ← إعدادات النظام» وكل مفتاح يُستهلك فعليًا في الكود
- ✅ **P6 — الموارد البشرية (2026-11-14)**: إدارات · موظفون (ربط إدارة/مسمى) · مكونات مرتب (ثابت/نسبة) وإسناد لكل موظف · حضور + استيراد CSV · إجازات/أذونات واعتماد/رفض · سلف وصرف بقيد خزينة · **توليد مرتبات** (مكونات + وقت إضافي + إجازة غير مدفوعة + تأمينات + خصم سلف) بقيد استحقاق متوازن · **صرف جماعي** بقيد خزينة · قسيمة راتب · تقارير رواتب/حضور · حسابات `1106/2103/2104/4107` وربط `gl_mappings` · شاشة `/hr` بكل التبويبات
- ✅ **P7 — استكمال الأدوات (2026-11-14)**: **تصدير Excel (.xlsx) حقيقي** بدون تبعيات (`common/xlsx.ts` + `GET /reports/xlsx`) · مرفقات على الأصناف والعملاء بجانب الفواتير · الجدول المحوري · النسخ الاحتياطي/الاستعادة · تقييد مخازن/صناديق
- ✅ **Print Agent — اختبار ميداني (2026-11-14)**: طُبع فعليًا على `POS-80C` (USB) و`EPSON TM-T20II` (مشتركة) · إصلاح `StartDocPrinter` (DOC_INFO_1 + RAW) · تثبيت كخدمة Windows عبر `install-service.ps1` (Scheduled Task `WaselPrintAgent` + إعادة تشغيل تلقائية + `agent.env`) · دعم A4/A5 عبر طباعة المتصفح و`@page`
- ✅ `npm test` → 369/369 فحصًا ناجحًا (الأقسام 44–48)

## 6) الشغل اللي فاضل (مرتّب بالأولوية)

> الخطة الكاملة حسب المراحل P0–P9 في `docs/EZEES-COVERAGE.md`.
> P0 ✅ — P1 ✅ — P2 ✅ — P3 ✅ — ETA (مصر) ✅ الأساس — **P4.1 سند الجرد ✅ — P4.2 أذون المخازن ✅ — P6 ✅ — P7 ✅ (2026-11-14)**

1. **P4 — المخزون المتقدم**: ✅ **سند الجرد منجز** ✅ **أذون المخازن منجز** (وارد/صادر/تالف/افتتاحي). المتبقي: تحويل غير مباشر + استلام · تشغيلات/صلاحية/سيريال · حد الطلب · استيراد Excel للشاشات الأخرى · ملصقات · جرد موبايل.
2. **P5 — العملاء والمندوبون**: مجموعات/تصنيفات · أعمار ديون · مندوبون/مشرفون/عمولات · عقد تقسيط متكامل (ضامنون) · تذكيرات.
3. **P6 — الموارد البشرية**: ✅ **منجزة (2026-11-14)** — إدارات · موظفون · مكونات مرتب وإسناد · حضور + CSV · إجازات/اعتماد · سلف/صرف · توليد مرتبات + قيد استحقاق · صرف جماعي + قيد خزينة · قسيمة · تقارير. المتبقي: بصمة أجهزة (ZKTeco) · أذونات/انصراف · تأمينات متقدمة (شرائح).
4. **P7 — الإعدادات والأدوات**: ✅ **منجزة (2026-11-14)** — تقييد مخازن/صناديق · نسخ احتياطي/استعادة · مرفقات (فواتير/أصناف/عملاء) · **تصدير xlsx حقيقي** · CSV/PDF · جدول محوري · دول/مدن/شحن · البيانات الأساسية.
5. **P8 — الأنظمة المتخصصة**: مقاولات · عقارات · CRM · متجر · اعتمادات · خطابات ضمان · سيارات · صيانة · معدات (تُبنى بطلب سوقي واضح).
6. **P9 — المتبقي**: الربط الحقيقي لبوابة هيئة الضرائب المصرية + الإقرار الضريبي الشهري · حزمة واتساب/المساعد الذكي.
7. **Print Agent — اختبار ميداني**: ✅ **منجز (2026-11-14)** — طباعة حقيقية على `POS-80C` و`EPSON TM-T20II` + تثبيت كخدمة Windows (`install-service.ps1`) + دعم A4/A5 عبر المتصفح. المتبقي: اختبار A4 على ليزر حقيقي، واستخدام TCP 9100 للطابعات المشتركة من حساب SYSTEM.
8. **إشعارات لحظية أدق**: SSE داخل نسخة API واحدة؛ لو اتشغّل أكتر من instance → استبدل `EventEmitter` بـ Redis pub/sub.
9. **تطبيق موبايل أصلي** (اختياري — PWA بيغطي الحاجة).

## 7) محاذير بيئية مهمة (Windows)

- **PostgreSQL بيرفض يشتغل كـ Administrator.** الحل المطبّق: حساب Windows محلي `pgwasel` (كلمة السر في `tools/pg/start.js` — غيّرها) + `C:\pg` للـ binaries + `C:\pgdata` للـ data dir.
  ```powershell
  net user pgwasel 'Pg$Wasel2026' /add
  icacls C:\pgdata /grant "pgwasel:(OI)(CI)F" /T /Q
  ```
  تم تهيئة الـ cluster بـ `--encoding=UTF8 --locale=C` (لازم! الـ default على ويندوز WIN1252 وبيرفض العربي).
- **بديل بلا صلاحيات إدارية: PGlite.** لو مفيش PostgreSQL مثبّت، شغّل `node tools/pg/pglite/server.js` — PostgreSQL مُصرّف لـ WASM بيتكلم بروتوكول PostgreSQL الحقيقي على المنفذ 5432، فيشتغل عليه `pg` والـ API زي ما هو. البيانات في `tools/pg/pglite/data`.
  - ملاحظة: `maxConnections` لازم أكبر من 1 (الـ API بيستخدم pool) — الإعداد في `tools/pg/pglite/server.js`.
  - ابدأ الـ API بـ `DB_POOL_MAX=6` على PGlite.
- البيانات في `apps/web` تُبنى static (`out/`) — بعد أي تعديل على الواجهة لازم `npm run web:build`.
- `tools/web-serve.js` serves `out/` مع SPA fallback.

## 8) مراجع

- `docs/EZEES-COVERAGE.md` — **مصفوفة تغطية دليل Ezees ERP (65 صفحة) مقابل النظام** + الفجوات + خطة البناء المرتبة + أخطاء P0 المكتشفة. **اقرأه قبل أي شغل جديد.**
- `docs/ARCHITECTURE.md` — قرارات المعمارية + الأمان + الأداء + تفاصيل الميزات الخمس الأخيرة.
- `docs/REFERENCE-ANALYSIS.md` — تحليل البرنامج المرجعي (مصدر المتطلبات) + حدود التحليل.
- `apps/print-agent/README.md` — إعداد الطابعات وتوكن الوكيل.
