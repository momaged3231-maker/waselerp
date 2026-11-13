# تسليم المشروع — WaselERP

هذا الملف موجّه للوكيل/المطوّر اللي هيكمّل. اقرأ `AGENTS.md` الأول (التشغيل + القواعد)، وبعدين الملف ده (خطة الشغل).

**آخر تحديث:** 2026-11-13 — **230 فحص end-to-end ناجح** · 66 جدول · 16 slice · 20 شاشة · P0 و P1 و P2 و P3 منجزة + ETA مصر.

> **تحديث 2026-11-13 (ليلًا):** اكتملت **P3** — نقطة البيع والمطاعم: أنواع الطلب (ماشر/توصيل/سفري/صالة) مع رسوم التوصيل والسائق، تعليق واسترجاع الفواتير، المرتجع من الكاشير، الطاولات والقاعات، طلبات الطاولة، شاشة المطبخ، والطبقات والإضافات.
> حالة كل بند بالتفصيل في **`docs/EZEES-COVERAGE.md`** (§4.1 P0 · §4.2 P1 · §4.3 P2 · §4.4 ETA · §4.5 P3).

> **تحديث 2026-11-13 (صباحًا):** تمت مراجعة دليل Ezees ERP كاملًا (65 صفحة) ومقارنته بالكود. النتيجة في **`docs/EZEES-COVERAGE.md`**: 24 شاشة موجودة جزئيًا، 41 غير موجودة، ولا توجد محاسبة عامة. كما اكتُشفت 12 مشكلة P0 (منها: الكاشير لا يستطيع إنشاء فاتورة بيع، وتسوية المخزون السالبة تزيد الرصيد). **اقرأ §4 في ملف التغطية قبل تنفيذ أي ميزة جديدة.**

> **بيئة التطوير الجديدة:** لو PostgreSQL غير متاح (مشكلة الـ Administrator على Windows)، شغّل `node tools/pg/pglite/server.js` — PostgreSQL مُصرّف لـ WASM بيتكلم بروتوكول PostgreSQL الحقيقي على المنفذ 5432. شغّل الـ API بـ `DB_POOL_MAX=6`.

---

## 1) فين المشروع بالظبط

| | |
|---|---|
| المستودع | `https://github.com/mohamedmagedalisalem-dotcom/waselerp` (**private**) |
| الفرع | `main` |
| نسخة محلية | `C:\Users\Server-PC\Desktop\WaselERP` (Linux/Mac: clone عادي) |
| الـ CI | `.github/workflows/ci.yml` — بيشتغل على كل push: type-check → build → schema → seed → **70 فحص end-to-end** → web build |

```bash
git clone https://github.com/mohamedmagedalisalem-dotcom/waselerp.git
cd waselerp && cat AGENTS.md          # اقراه الأول
```

> **ملاحظة Linux/Docker:** الـ CI بيستخدم `postgres:16` service container. لو بتطوّر على Linux شغّل Postgres عادي و export `DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasel`.

---

## 2) حالة كل جزء (بالحقيقة، مش بالتمنّي)

### ✅ شغّال ومتحقَّق (70/70 فحص + تحقق يدوي في المتصفح)
| 영역 | الدليل |
|---|---|
| auth / RBAC / branch scope | دخول + 23 صلاحية + 401/403 |
| دورة الفاتورة | شراء → بيع → **إلغاء مع عكس أثر المخزون** + idempotency |
| دفتر المخزون | رصيد 97 بعد 100 شراء و3 بيع — مطابق |
| الخزينة | إيداع 250 → الرصيد اتحدّث |
| كشوف العملاء | قيد 49.30 بعد فاتورة آجلة |
| **وحدات متعددة** | 2 كرتونة (×12) = 24 قطعة؛ بيع كرتونة = −12 |
| **التقسيط** | 3 أقساط (300+300+300) + سداد 300 + قائمة المستحقات |
| **ZATCA** | XML + hash 44 حرف + QR PNG + حفظ المستند |
| **SSE** | البث 200 + حدث `connected` |
| **Print Agent** | توليد ESC/POS 987 بايت (init + cut + عربي سليم) |
| **أوفلاين** | Service Worker مسجّل + IndexedDB read/write |
| 12 شاشة | تحقّق بصري في المتصفح (RTL، باركود، سلة، وحدات، طباعة) |

### ⚠️ مُنفَّذ لكن **مش متحقَّق على أرض الواقع**
| البند | السبب | المطلوب لإثباته |
|---|---|---|
| Print Agent على طابعة حقيقية | مفيش طابعة على جهاز التطوير | تجربة على Xprinter/Epson: ضبط `POST /config` + أمر طباعة + فتح الدرج |
| ZATCA عند بوابة ZATCA | مفيش CSID حقيقي | onboarding (compliance) → CSID + مفاتيح → اختبار على simulation |
| أوفلاين بإرسال فعلي | الاختبار تم على مستوى IndexedDB فقط | فصل النت → بيع → رجوع النت → التأكد من وصول الفاتورة |
| SSE بين فرعين | اتختبر على نسخة واحدة | تشغيل نسختين على branchين مختلفين وتحديث المخزون لحظيًا |

### 🟡 ناقص (مش موجود أصلًا)
- قوائم الأسعار حسب العميل (`price_lists` في المخطط، الـ API ناقص)
- شاشة CRUD كاملة للفروع/المخازن/الفئات/الوحدات (الـ API موجود، الـ UI جزئي)
- منع البيع عند نفاد الرصيد
- ترحيل الفواتير المعلّقة (holds) في نقطة البيع
- تطبيق موبايل أصلي (PWA بيغطي الحاجات الأساسية)

---

## 3) خطة الشغل مرتّبة (خُدها بالتسلسل)

### المرحلة 1 — استكمال التحقق (الأعلى قيمة)
1. **الطباعة على طابعة حقيقية** — ابدأ بـ `npm run agent:start` + `POST /config` ثم `POST /print`. لو الطابعة Windows: تأكد اسمها في `GET /printers` وغيّر ترميز العربية لو محتاج UTF-8.
2. **Oفلاين حقيقي** — في DevTools → Network → Offline → بيع → شوف شارة "فاتورة بانتظار الإرسال" → رجّع النت → اتأكد من وصولها + الـ idempotency.
3. **SSE بين فرعين** — أنشئ فرع تاني، وبيع في الأول، وشوف التحديث في الثاني.

### المرحلة 2 — ZATCA الإنتاجي (أعلى مخاطرة تشغيلية)
1. Onboarding من بوابة ZATCA (compliance) → CSID token + secret + شهادة + مفتاح ECDSA.
2. خزّنهم في `zatca_config` (أو في متغيرات بيئة + secret manager في الإنتاج).
3. **استبدل التوليد الحتمي بـ Canonical XML (C14N)** — الـ hash الحالي محسوب على XML مولّد بـ string builder، وZATCA بتقبل hash المستند بعد canonicalization.
4. اختبار على `simulation` endpoint الأول، بعدين `production`.
5. اربطه بالاختيار التلقائي: مبسطة (B2C) ↔ ضريبية (B2B) حسب وجود الرقم الضريبي للعميل.

### المرحلة 3 — ميزات ناقصة
4. **قوائم الأسعار**: `price_lists` + `price_list_lines` موجودان — ناقص: endpoint لتطبيق قائمة سعر على صنف + اختيارها للعميل + تطبيقها في نقطة البيع.
5. **منع البيع عند نفاد الرصيد**: setting + فحص في `SalesService.create` (المخزون موجود في `item_warehouse_qty`).
6. **UI كامل للإعدادات**: فئات/وحدات/مخازن (CRUD endpoints موجودة).
7. **الفواتير المعلّقة (holds)**: جدول `parked_sales` + شاشة.

### المرحلة 4 — تشغيل Production
8. TLS أمام الـ API (nginx / Caddy / IIS) + **الـ DB مقفول خارج الشبكة الداخلية**.
9. `JWT_SECRET` قوي + `WASEL_AGENT_TOKEN` لكل كاشير (مش الافتراضي).
10. PostgreSQL كخدمة Windows + backup يومي + مراقبة.
11. الـ Print Agent كخدمة Windows (Task Scheduler / NSSM) على كل جهاز كاشير.

---

## 4) إزاي تعطي الوكيل التاني مهام (prompts جاهزة)

**للتحقق من الشغل الحالي:**
> "clone the repo, read AGENTS.md, run the CI locally (npm run db:migrate && npm run db:seed && npm test) and report the result. Don't change code unless a check fails."

**لإضافة ميزة:**
> "read AGENTS.md §4 (architectural rules) and §6 (backlog). Implement item X. Keep the vertical-slice structure, raw SQL with explicit casts, every stock change through common/stock.ts, and every financial write in one transaction. Add coverage to tools/smoke-test.js. `npm test` must pass."

**لإصلاح باج:**
> "run npm test, read the failing check, find the root cause (don't patch the symptom), fix it, keep the rule that every query parameter needs an explicit cast, and add a regression check."

---

## 5) محاذير بتوقّع الوكيل (أهمها)

1. **PostgreSQL بيرفض التشغيل كـ Administrator** (ويندوز). الحل: حساب `pgwasel` + `C:\pg` + `C:\pgdata` —详细 في `AGENTS.md §7`.
2. **الـ cluster لازم `--encoding=UTF8`** — الافتراضي على ويندوز WIN1252 وبيكسر العربي.
3. **كل باراميتر SQL لازم cast صريح** (`$1::int`, `$2::text`) — Postgres مش بيعرف النوع لوحده، وبيطلع خطأ "could not determine data type".
4. **كل استعلام COUNT لازم يجيب نفس الـ JOINs** تاع الاستعلام الأساسي — غير كده: "missing FROM-clause entry".
5. **دفتر المخزون**: ممنوع تكتب في `item_warehouse_qty` مباشرة — استخدم `applyMovement` من `common/stock.ts`.
6. **الـ idempotency**: أي POST لازم `clientRequestId` + unique index في `invoices.client_request_id` — غير كده العرض المزدوج هيفوّت فاتورة.
7. **الواجهة static**: أي تعديل في `apps/web` محتاج `npm run web:build` قبل ما تشوفه (`tools/web-serve.js` بيقدّم مجلد `out`).
8. **`analysis/db/` و `analysis/strings/` مستبعدين من Git** (محتوى مستخرج من منتج تاني) — متاحين محليًا على جهاز التطوير بس.
9. **طباعة الأرقام العربية**: `formatMoney` في `lib/api.ts` — متأكد إن أي رقم جديد يعدّي منها.
10. **العربية RTL**: أي شاشة جديدة لازم `dir="rtl"` (موجود في `app/layout.tsx`) + تستعمل `AppShell`.

---

## 6) آخر حالة للخدمات على جهاز التطوير

```
PostgreSQL   localhost:5432/wasel   (postgres/postgres)
API          http://localhost:4000/api
الواجهة      http://localhost:3000   (admin/admin123)
Print Agent  http://127.0.0.1:4100
```
