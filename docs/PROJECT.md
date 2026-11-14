# 📘 وثائق مشروع WaselERP — WaselERP

> وثيقة شاملة للمشروع — النسخة الحالية (آخر تحديث: 2026-11-14).

---

## 1. نظرة عامة

**WaselERP** هو نظام إدارة مبيعات ومخزون وفروع متعدد الفروع (Multi-Branch POS / Inventory / Accounting) مبني على:

| الطبقة | التقنية |
|---|---|
| **الواجهة** | Next.js 14 (App Router) — **SPA / PWA** (static export) + PWA manifest + service worker. عربي RTL. |
| **الـ API** | NestJS 10 — Modular Monolith + **Vertical Slices** |
| **قاعدة البيانات** | PostgreSQL 16+ (مركزي) — raw SQL عبر `pg` (بدون ORM) |
| **الطباعة** | Print Agent محلي (ESC/POS + درج الكاشير) على المنفذ 4100 |
| **الضرائب** | **ZATCA** (السعودية) + **ETA** (مصر — UBL 2.1 + QR TLV + توقيع RSA + UUID v1) |
| **الإشعارات** | SSE (Server-Sent Events) + Offline queue (IndexedDB + idempotency) |

الهدف: نظام متكامل لـ **إدارة المبيعات والمخزون والمال** لمطاعم/محلات متعددة الفروع، بمعالجة فاتورة إلكترونية حقيقية (مصر + السعودية)، وبناء متخصص عالي الجودة دون ملحقات زخرفية.

---

## 2. البنية المعمارية

```
WaselERP/
├── apps/
│   ├── api/           NestJS 10 — src/
│   │   ├── common/    database · posting (القيد المزدوج) · pricing · stock · security · settings
│   │   └── modules/   auth · catalog · parties · sales · inventory · treasury
│   │                   accounting · pricing · eta · zatca · hr · reports · admin · events
│   │                   installments · reminders · customer-groups
│   ├── web/           Next.js 14 — app/ · components/ · lib/ (PWA)
│   └── print-agent/   ESC/POS local agent
├── db/
│   ├── schema.postgres.sql
│   └── migrations/    ترحيلات تدريجية
├── tools/             pg/ · smoke-test.js · demo-data.js · web-serve.js · print-agent-test.js
├── docs/              ARCHITECTURE · HANDOVER · EZEES-COVERAGE · REFERENCE-ANALYSIS · PROJECT
└── analysis/          نتائج الهندسة العكسية (مستبعد من Git)
```

### القواعد المعمارية (من `AGENTS.md` — لا تكسرها)
1. **Vertical slices**: كل feature في `modules/<slice>` مستقل. ممنوع الاستيراد من slice تاني — الح.Common فقط.
2. **Raw SQL عبر `pg`**: parameterized + **كل باراميتر cast صريح** (`$1::int`, `$2::text` …).
3. **كل حركة مخزون تمر من `common/stock.ts`** (ledger + رصيد داخل transaction واحدة).
4. **كل المعاملات المالية ذرّية**: الفاتورة + السطور + الحركات + الخزينة + **القيد المحاسبي** في `db.transaction()` واحدة.
5. **كل أثر مالي يمر من `common/posting.ts`** (فاتورة، خزينة، تحويل، وردية، سداد قسط، مرتب).
6. **الربط المحاسبي**: كل مفهوم تجاري مرتبط بحساب في `gl_mappings`; القيد لازم متوازن (Dr = Cr).
7. **Branch scope**: كل استعلام يقيّد بـ `branch_id` من `CurrentBranch()`.
8. **الترقيم**: `db.nextNumber(client, key)` داخل transaction.
9. **الصلاحيات**: endpoints بـ `@RequirePermissions('...')`.
10. **الواجهة**: عربي RTL. `apiFetch` في `lib/api.ts` يضيف التوكن + الفرع تلقائيًا.
11. **الأوفلاين**: أي عملية قابلة لإعادة = `clientRequestId` كـ idempotency key.

---

## 3. حالة المراحل (Roadmap P0 → P9)

> المخطط الكامل في `docs/EZEES-COVERAGE.md`.

| المرحلة | الوصف | الحالة |
|---|---|---|
| **P0** | أساس نواة النظام (auth/RBAC/DB/stock/posting) | ✅ مكتمل ومتحقَّق |
| **P1** | المحاسبة العامة (قيود مزدوجة، سندات، شيكات، تقارير) | ✅ مكتمل ومتحقَّق |
| **P2** | دورة البيع والشراء (قوائم الأسعار، أوامر، حجز، تقسيط، كوبونات) | ✅ مكتمل ومتحقَّق |
| **P3** | نقطة البيع والمطاعم (طلبات، طاولات، قاعات، مكيفات) | ✅ مكتمل ومتحقَّق |
| **ETA** | الفاتورة الإلكترونية المصرية (UBL 2.1 + QR + توقيع + UUID) | ✅ أساس + توليد/توقيع/إرسال — **الربط الحقيقي بالبوابة بانتظار بيانات الـ gateway** |
| **ZATCA** | الفاتورة الإلكترونية السعودية (UBL + QR + ختم ECDSA/RSA) | ✅ أساس + توليد/توقيع/إرسال — **الربط الحقيقي بانتظار بيانات الـ gateway** |
| **P4** | المخزون المتقدم | 🟡 **سند الجرد ✅ · أذون المخازن ✅ · تحويل مخزن ✅** · تحويل غير مباشر/استلام · تشغيلات/صلاحية/سيريال · حد الطلب · استيراد Excel · ملصقات · جرد موبايل |
| **P5** | العملاء والمندوبون | 🟡 مجموعات العملاء ✅ · كشوف الأعمار/الديون · مندوبون/مشرفون/عمولات · **التقسيط بضامنين ✅** · تذكيرات ✅ |
| **P6** | الموارد البشرية | ✅ الموظفون · الحضور · الإجازات · المرتبات |
| **P7** | الإعدادات والأدوات | ⬜ ناقص (تصدير، مرفقات، نسخ احتياطي، جدول محوري، تقييد مخازن/صناديق) |
| **P8** | الأنظمة المتخصصة | ⬜ مقاولات · عقارات · CRM · متجر · اعتمادات · خطابات ضمان · سيارات · معدات · **✅ صيانة الأجهزة (P8.1)** — استلام، فحص، قطع غيار، سداد/تسليم، تقارير |
| **P9** | المتبقي | ⬜ الربط الحقيقي لبوابة الضرائب + الإقرار الشهري · حزمة واتساب/المساعد الذكي |

### إنجازات P4–P6 (آخر تحديث)
- **P4.3**: تحويل مخزن (draft → approve outbound → receive inbound) مع ربط محاسبي.
- **P4.5/P4.6**: تنبيهات إعادة الطلب (`/inventory/reorder-alerts`) + انتهاء الصلاحية (`/inventory/expiry-alerts`).
- **P4.8**: شاشة **ملصقات الأصناف** (`/labels`) — اختيار/طباعة باركود + أبعاد متعددة.
- **P4.9**: شاشة **الجرد الموبايل** (`/mobile-stocktake`) — مسح كود/باركود + كميات + حفظ على المخزن.
- **P5.1**: مجموعات العملاء + تصنيفات (`/parties/groups`, ...).
- **P5.5**: **التذكيرات** (`/reminders`, `/reminders/upcoming`) + شاشة `/reminders`.
- **P6**: شجرة الحسابات + HR (أقسام، موظفون، حضور، إجازات، **رواتب** `/hr/salaries`).

---

## 4. نقاط النهاية الرئيسية للـ API

- `POST /api/auth/login` — تسجيل الدخول (scrypt + JWT)
- `GET /api/auth/me` — المستخدم + الصلاحيات + الفرع
- `GET /api/dashboard/summary` — لوحة التحقق
- **المبيعات**: `POST /api/sales/invoices`, `POST /api/sales/invoices/:id/cancel`, `GET /api/sales/invoices/:id`
- **المخزون**: `GET /api/inventory/balances`, `GET /api/inventory/reorder-alerts`, `GET /api/inventory/expiry-alerts`, `/api/inventory/stock-counts`, `/api/inventory/stock-vouchers`, `/api/inventory/stock-transfers`
- **الخزينة**: `/api/treasury/*` (إيداع/سحب/تحويل/ورديات/ميزان/مفتاح فرع)
- **المحاسبة**: `/api/accounting/*` (حسابات/قيود/سندات/شيكات/تقارير)
- **ETA**: `/api/eta/*` (إنشاء/إرسال/تخليص)
- **ZATCA**: `/api/zatca/*`
- **HR**: `/api/hr/departments`, `/api/hr/employees`, `/api/hr/attendance`, `/api/hr/leaves`, `/api/hr/salaries`, `/api/hr/salaries/:id/status`
- **التذكيرات**: `/api/reminders`, `/api/reminders/upcoming`, `/api/reminders/:id/done`
- **الأعداد**: `/api/reports/*` (مبيعات، مخزون، ذمم، كاشير، هامش)

---

## 5. التشغيل المحلي (Windows)

```powershell
# 0) PostgreSQL محلي (Windows) — حساب غير Administrator
node tools\pg\start.js

# أو PGlite بديل
node tools\pg\pglite\server.js        # DB على 127.0.0.1:5432

# 1) المخطط + البيانات الأساسية
node tools\pg\run-sql.js wasel db\schema.postgres.sql
cd apps\api && npx ts-node --transpile-only src\cli\seed.ts && cd ..\..

# 2) API
cd apps\api && npm run build && node dist\main.js     # http://localhost:4000/api

# 3) الواجهة
cd ../web && npm run build && cd ../..
node tools\web-serve.js                             # http://localhost:3000
```

- **الواجهة**: أي تعديل في `apps/web` لازم `npm run web:build` قبل المشاهدة.
- **الطباعة**: `cd apps\print-agent && npm install && node server.js` (منفذ 4100).

---

## 6. الاختبارات

```bash
npm test              # tools/smoke-test.js — end-to-end suite
npm run test:print    # tools/print-agent-test.js — توليد ESC/POS بدون طابعة
```

- القسم 40 من الاختبار يغطي سند الجرد · القسم 41 أذون المخازن · القسم 42 (أو الأقسام المتبقية) التذكيرات.
- **قبل أي commit في الـ API لازم `npm test` ينجح 100%.**

---

## 7. البيئة الإنتاجية (مفعلة حتى الآن)

| المكوّن | الحالة |
|---|---|
| **Supabase DB** | مشروع `lkrywkixijclebyjxxoo` — pooler IPv4 `aws-1-eu-west-2.pooler.supabase.com:6543` |
| **Vercel API** | `https://waselerp.vercel.app/api` — مشروع `wasel` (`prj_xA2MESu8xsQbWJ4Ls6DAXsjquR6s`) — production **Ready** · Serverless entry `apps/api/api/index.ts` + `apps/api/vercel.json` (`@vercel/node`) |
| **Vercel (الواجهة)** | `https://web-two-alpha-85.vercel.app` — مشروع `web` (`prj_3dbyMnxH4ajrAVAH5vpsSLD3m9iF`) — production **Ready** · build: `npm install --prefix apps/web` / `npm --prefix apps/web run build` / output `apps/web/out` |
| **Frontend API base** | `NEXT_PUBLIC_API_BASE = https://waselerp.vercel.app/api` |
| **API env (Vercel)** | `DATABASE_URL` (Supabase pooler) · `JWT_SECRET` · `FRONTEND_URL = https://web-two-alpha-85.vercel.app` |
| **Cloudflare quick tunnel** | `https://monica-daughters-search-tackle.trycloudflare.com/api` |
| **ETA gateway** | **بانتظار** بيانات الـ client_id / secret + الشهادة + رابط الاختبار من العميل |

- **الربط الإنتاجي**: الواجهة (`web-two-alpha-85.vercel.app`) بتتصل مباشرة بالـ API (`waselerp.vercel.app/api`) — مشروعين Vercel منفصلين، كل واحد ليه repo/entrypoint/env مستقل.
- **قاعدة الإنتاج**: Supabase (PostgreSQL) — لازم تستخدم **Pooler** (IPv4: `aws-1-eu-west-2.pooler.supabase.com:6543`) لأن الـ direct host IPv6-only. SSL: `rejectUnauthorized: false`.
- **CORS**: يتحكم فيها `FRONTEND_URL` على الـ API — لازم تكون نعمًا لهذا الـ frontend URL.

---

## 8. قيود ومعلومات مهمة

1. **ETA/ZATCA**: الربط الحقيقي بالبوابة (gateway) في انتظار بيانات الـ gateway للمشروع.
2. **Print Agent**: اختبار ميداني على طابعة حقيقية + دعم A4 رسمي + تثبيت كخدمة Windows.
3. **الـ mobile native**: PWA متاح، تطبيق أصلي في P9.
4. **Cloud**: لو اتشغّل أكتر من instance للـ API → استبدل SSE `EventEmitter` بـ Redis pub/sub.

---

## 9. خطة التسليم النهائي

- [ ] إكمال باقي المراحل P4→P9 (كما هو مخطط في `docs/EZEES-COVERAGE.md`).
- [ ] `npm test` كامل ناجح.
- [ ] تحديث الوثائق (`AGENTS.md` §5/§6).
- [ ] commit + push إلى GitHub (`momaged3231-maker/waselerp`, branch `main`).
- [ ] إبلاغ العميل بآخر المستجدات.

---

## 10) تفاصيل دليل استخدام Epees ERP — محتوى باحث منه (إضافة 2026-11-14)

### مصدر البيانات
- الدليل الرسمي: `https://help.tebalink.com` — آخر تحديث: 8–10 أكتوبر 2026.
- **ملاحظة**: الموقع غير متاح الآن، لذلك اعتمدت على النسخ المحفوظة في `C:\Users\moham\AppData\Local\Temp\opencode\ezees` (HTML + TXT لكل صفحات الدليل + ملف `_digest.md` بقائمة المحتوى).

### أهم التفاصيل المستخرجة من الصفحات الرئيسية التي تمت قراءتها بعمق:

#### A) فاتورة البيع (`sales-invoice`)
1. تسجيل الفاتورة في **6 خطوات**: بيانات الرأس ← إضافة الأصناف ← جدول الأصناف ← الخصم والضريبة والإجمالي ← طرق السداد.
2. رقم الفاتورة + بادئه (م.د) + تاريخ يجب أن يبقى داخل الفترة المحاسبية المفتوحة.
3. حقل **«المرحل»** شرط لإنشاء القيد المحاسبي و**إرسال الفاتورة للهيئة**.
4. إدخال سريع للأصناف: باركود (كود/بديل/وحدة/ميزان/QR-GS1) أو `5*1234` أو استيراد Excel.
5. الخصم (نسبة/مبلغ + إضافات) والضريبة (ض.قيمة مضافة − ض.خصم) والصافي: `الإجمالي + الإضافات − الخصومات + ض.قيمة مضافة − ض.خصم`.
6. طرق السداد: نقدي / آجل / فيزا / تحويل / مختلط. البيع الآجل يتطلب حساب عميل في الدليل المحاسبي + حد ائتمان.
7. الفاتورة **المؤقتة** (معلقة): لا تُحسب ولا تُطبع ولا تُرسل إلا بعد التأكيد.
8. بعد الإرسال لا يُعدَّل الفاتورة — التصحيح عبر مرتجع بيع/مدين.

#### B) شاشة الكاشير POS (`pos-cashier`)
1. قبل البيع: **وردية مفتوحة** + **مخزن افتراضي** للفرع.
2. أنواع الطلب: مباشر / سفري / توصيل / صالة (Din In / Take Away / Delivery).
3. إضافة الأصناف: لمس / باركود / بحث / سيريال / إضافات / هدايا.
4. العميل: البيع المباشر اختياري (عميل نقدي افتراضي)؛ التوصيل/الآجل إلزامي.
5. الدفع: نقدي/فيزا/تحويل/آجل/جزئي؛ نافذة الدفع للمدفوع/المتبقى.
6. تعليق الفاتورة (F-key) + استكمالها أو إلغائها.
7. طباعة: إيصال كاشير، درج نقدية، مطبخ، شيك مطاعم.

#### C) الجرد وسند التسوية (`stock-count`)
1. اعتماد الحركات المعلقة أولًا (أذون/تحويلات/إنتاج).
2. الموظف المختص إلزامي؛ سند واحد غير معتمد لكل مخزن.
3. الكمية المتوقعة = رصيد الحركات المعتمدة لحظة الإضافة.
4. الفرق: موجب = زيادة / سالب = عجز. مساواة الرصيد → تُرفض.
5. الاعتماد = تطبيق الفروقات + قيد تسوية.

#### D) التقارير (`reports-stores`)
1. ارصدة المخازن (و Pivot)، حركة الأصناف، أذون المخازن، أصناف تحت حد الطلب → تحويل لأمر شراء.
2. تقارير الفواتير (مبيعات/مشتريات/ضريبة)، الأوامر، الأرقام المسلسلية، نقاط البيع، مطاعم، إحصائي يومي.

#### E) نماذج أساسية مشتركة في كل شاشات التقارير
- الفلاتر + زر العرض + طباعة/تصدير.
- الصلاحيات والفرع.
- النقر المزدوج يفتح المستند الأصلي.

### ترجمة مباشرة لاحتسابات الدليل إلى WaselERP
- صافي الفاتورة = الإجمالي + الإضافات − الخصومات + ضريبة القيمة المضافة − ضريبة الخصم.
- الفترة المحاسبية تُحدَّد للفاتورة (التاريخ يجب أن يبقى داخلها).
- المخزن الافتراضي + صندوق/فرع أساس التسجيل النقدي.

### ما تم تطبيقه في الواجهة (فترة البحث)
- `/labels` (ملصقات باركود) · `/mobile-stocktake` (جرد موبايل) · `/reminders` (تذكيرات) · `/hr/salaries` (رواتب).
