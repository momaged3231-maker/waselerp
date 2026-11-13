# واصل ERP — WaselERP

[![CI](https://github.com/momaged3231-maker/waselerp/actions/workflows/ci.yml/badge.svg)](https://github.com/momaged3231-maker/waselerp/actions/workflows/ci.yml)

نظام إدارة مبيعات ومخزون وفروع متعدد الفروع — **معمارية Modular Monolith + Vertical Slices**، واجهة **Next.js SPA (PWA)** تعمل على الموبايل والتابلت والديسكتوب، وخادم **NestJS + PostgreSQL** مركزي.

> 📘 **للتسليم والاستمرارية:** [`AGENTS.md`](AGENTS.md) (دليل الوكيل/المطوّر) · [`docs/HANDOVER.md`](docs/HANDOVER.md) (خطة الشغل + المحاذير) · [`docs/EZEES-COVERAGE.md`](docs/EZEES-COVERAGE.md) (مصفوفة تغطية دليل Ezees ERP)

```
WaselERP/
├── apps/
│   ├── api/          NestJS 10 — Modular Monolith (vertical slices)
│   │   └── src/
│   │       ├── common/           database · posting (القيد المزدوج) · pricing · stock · security · settings
│   │       ├── modules/
│   │       │   ├── auth/         تسجيل الدخول والصلاحيات
│   │       │   ├── catalog/      الفروع والمخازن والوحدات والفئات + الأصناف
│   │       │   ├── parties/      العملاء والموردون وكشوف الحساب
│   │       │   ├── sales/        الفواتير + العروض والأوامر + نقطة البيع + المطاعم
│   │       │   ├── inventory/    الأرصدة، حركات المخزون، التحويل والجرد
│   │       │   ├── treasury/     الخزينة، الورديات، التحويلات، حسابات البنك والبطاقة
│   │       │   ├── accounting/   المحاسبة العامة: حسابات، قيود، سندات، شيكات، تقارير
│   │       │   ├── pricing/      قوائم الأسعار، الكوبونات، عروض الهدايا
│   │       │   ├── eta/          الفاتورة الإلكترونية المصرية (UBL + QR + UUID)
│   │       │   ├── zatca/        الفاتورة الإلكترونية السعودية
│   │       │   ├── hr/           الموظفون، الحضور، المرتبات
│   │       │   ├── reports/      لوحة المعلومات والتقارير
│   │       │   └── admin/        المستخدمون، الأدوار، الإعدادات، سجل العمليات
│   │       └── cli/seed.ts       بذر البيانات الأساسية + شجرة الحسابات
│   ├── web/          Next.js 14 — SPA/PWA (export static) — 20 شاشة
│   └── print-agent/  وكيل طباعة محلي (ESC/POS + درج الكاشير)
├── db/
│   ├── schema.postgres.sql         66 جدول — مخطط PostgreSQL
│   └── migrations/                 ترحيلات تدريجية (p0 · p1 · p2 · p2b · p3 · eta)
├── tools/
│   ├── pg/                        PostgreSQL محلي (تشغيل/فحص) + PGlite مدمج
│   └── smoke-test.js              اختبار end-to-end (230 فحص)
├── analysis/                      نتائج الهندسة العكسية للبرنامج المرجعي
└── docs/                          ARCHITECTURE · HANDOVER · EZEES-COVERAGE · REFERENCE-ANALYSIS
```

## التشغيل السريع (Windows)

```powershell
# 1) قاعدة البيانات — postgres://postgres:postgres@localhost:5432/wasel
node tools\pg\start.js              # PostgreSQL عادي (يحتاج حساب غير Administrator)
#    أو بديل مدمج بدون تثبيت:
node tools\pg\pglite\server.js      # PostgreSQL مُصرّف لـ WASM على نفس المنفذ

# 2) تهيئة قاعدة البيانات + البيانات الأساسية
node tools\pg\run-sql.js wasel db\schema.postgres.sql
cd apps\api; npx ts-node --transpile-only src\cli\seed.ts; cd ..\..

# 3) تشغيل الـ API
cd apps\api
npm run build; node dist\main.js        # http://localhost:4000/api

# 4) تشغيل الواجهة
cd ..\web
npm run dev                              # http://localhost:3000
npm run build                            # static export في مجلد out
```

**بيانات الدخول الافتراضية:** `admin` / `admin123` (غيّرها فوراً من شاشة الإعدادات).

## الاختبار

```powershell
node tools\smoke-test.js                                        # 230 فحص end-to-end
node tools\pg\run-sql.js wasel db\reset-dev-data.sql             # تفريغ البيانات التشغيلية بعد الاختبار
```

## ما تم إنجازه

**الأساس**
- [x] مخطط PostgreSQL (66 جدول) · API كامل الوحدات · RBAC (27 صلاحية × 5 أدوار) · branch scope · سجل عمليات
- [x] 20 شاشة: لوحة التحكم · نقطة البيع · المطاعم · الفواتير · العروض والأوامر · الأصناف · قوائم الأسعار · المخزون · العملاء · الخزينة · المحاسبة (4 شاشات) · التقارير · شئون العاملين · التقسيط · الإعدادات

**P0 — إصلاح النواة** ✅
- [x] RBAC بـ OR/AND · حد الخصم على الخادم · منع البيع بالسالب · حد الائتمان · التحقق من المرتجعات · الورديات والعجز · عكس الأثر بالقيد المزدوج

**P1 — المحاسبة العامة** ✅
- [x] شجرة حسابات هرمية (35 حسابًا) + ربط محاسبي (17 مفهومًا)
- [x] قيود مزدوجة + **ترحيل تلقائي** لكل مستند (فاتورة/خزينة/وردية/قسط/مرتب) داخل نفس الـ transaction
- [x] سندات قبض/صرف · شيكات · مراكز تكلفة · عملات · إقفال فترات · قيد إقفال السنة · قيود متكررة
- [x] ميزان المراجعة · الأرباح والخسائر · الميزانية العمومية · دفتر الأستاذ · ملخص الضريبة · تقرير مراكز التكلفة

**P2 — دورة البيع والشراء** ✅
- [x] قوائم الأسعار حسب العميل · عروض الأسعار · أوامر البيع/الشراء · حجز المخزون
- [x] طرق دفع متعددة (نقد/بطاقة/محفظة) · كوبونات · عروض هدايا · تخصيص الدفعات · الشحن/التوصيل · تعديل الفاتورة

**P3 — نقطة البيع والمطاعم** ✅
- [x] أنواع الطلب (ماشر/توصيل/سفري/صالة) + رسوم التوصيل والسائق · تعليق الفواتير · المرتجع من الكاشير
- [x] الطاولات والقاعات · طلبات الطاولة · شاشة المطبخ · الطبقات والإضافات

**الضرائب والاتصال**
- [x] **ETA مصر** — UUID v1 · XML UBL 2.1 · QR TLV · توقيع RSA · إرسال للهيئة
- [x] **ZATCA** — XML UBL 2.1 + QR TLV + الختم التشفيري + الإرسال/التخليص
- [x] SSE (إشعارات لحظية بين الفروع) · وضع أوفلاين (IndexedDB + idempotency) · Print Agent محلي

## قيد العمل
- [ ] ETA: الربط الحقيقي ببوابة هيئة الضرائب + الإقرار الضريبي الشهري
- [ ] Print Agent: اختبار على طابعة حقيقية + دعم طابعة A4 رسمية
- [ ] P4: المخزون المتقدم (أذون، تشغيلات، سيريال، استيراد Excel، جرد موبايل)
- [ ] P5–P8: المندوبون · الموارد البشرية · الأدوات · الأنظمة المتخصصة
