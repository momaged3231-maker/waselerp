# معمارية WaselERP — القرارات والأساس

## 1) القرارات المعمارية (والسبب)

| القرار | الاختيار | السبب |
|---|---|---|
| نمط الخادم | **Modular Monolith + Vertical Slices** | كل feature في وحدة مستقلة (`modules/<slice>`) مع حدود صارمة. مشروع واحد = نشر واحد = تشغيل بسيط، مع عزل منطقي يمنع "البيكولا". Microservices在这个 الحجم = تكلفة تشغيل بلا فائدة. |
| العرض | **Next.js 14 SPA (static export) + PWA** | نظام داخلي بلا SEO → SSR لا يضيف قيمة. SPA أخف وأسرع على الموبايل، ويعمل offline عبر Service Worker، وقابل للتثبيت على ويندوز/أندرويد كتطبيق. |
| البيانات | **PostgreSQL 16+ (مركزي)** | كل الفروع على قاعدة واحدة مع `branch_id` في كل جدول → استعلامات موحّدة، تقارير فورية بين الفروع، نسخة احتياطية واحدة. PostgreSQL أقوى في JSONB والـ window functions والتقارير. |
| الوصول للبيانات | **Raw SQL عبر `pg` + Dapper-style repositories** | التقرير في نظام ERP يحتاج تحكم كامل في الـ joins والنوافذ. لا نضيف طبعة ORM تُخفي الـ SQL. الاستعلامات كلها مُفهرسة ومكتوبة يدوياً. |
| الأمان | **JWT قصير (15د) + Refresh (7ي) + RBAC + Branch Scope** | الـ DB لا يُفتح خارج الشبكة الداخلية؛ العميل لا يحمل أي صلاحية على البيانات. |
| realtime | **SSE (قيد التطوير)** لإشعارات تغيّر المخزون بين الفروع | أخف من WebSocket، يعمل عبر HTTP proxies، كافٍ لإرسال إشعارات فقط (بدون بث ثنائي الاتجاه). |

## 2) طبقات المشروع

```
┌───────────────────────────────────────────────────────────┐
│ apps/web  — Next.js SPA / PWA                              │
│  lib/api.ts (fetch + token + refresh) · lib/session.tsx   │
│  AppShell (قائمة + شريط + تبديل الفرع) · صفحات features  │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS + Bearer JWT + x-branch-id
┌───────────────▼───────────────────────────────────────────┐
│ apps/api — NestJS Modular Monolith                         │
│  Guards: JwtAuthGuard → PermissionsGuard → BranchScope     │
│  Slices: auth · catalog · parties · sales · inventory ·    │
│          treasury · hr · reports · admin · installments · reminders · customer-groups · events │
│  common/: database.service (pg pool + tx + numbering)      │
│            stock.ts (دفتر المخزون) · security.ts            │
└───────────────┬───────────────────────────────────────────┘
                │ Connection pool (منطقة داخلية فقط)
┌───────────────▼───────────────────────────────────────────┐
│ PostgreSQL — 71 جدول · 86 FK · 61 Index                    │
└───────────────────────────────────────────────────────────┘
```

## 3) قواعد تصميم الـ slices

1. **كل slice مستقل**: `auth / catalog / parties / sales / inventory / treasury / hr / reports / admin`.
2. **Slice لا يستورد من slice أخرى**؛.Shared contracts في `common/`.
3. **كل كتابة-affecting motion يمر عبر `common/stock.ts`** → لا يوجد مسار يغيّر المخزون من خارج دفتر الحركات.
4. **كل استعلام يقيّد بـ `branch_id`** (من الهيدر `x-branch-id` أو من `CurrentBranch`).
5. **الأرقام التسلسلية** من جدول `number_sequences` بـ `INSERT … ON CONFLICT DO UPDATE` داخل نفس الـ transaction → لا تكرار ولا فجوات.
6. **المعاملات المالية ذرّية**: الفاتورة + السطور + حركات المخزون + قيد دفتر العميل + حركة الخزينة كلها في `db.transaction()` واحدة.

## 4) نموذج البيانات (مختصر)

| المجموعة | الجداول |
|---|---|
| التنظيم والصلاحيات | `branches, users, roles, permissions, role_permissions, user_roles, user_branches` |
| الفترات | `periods, number_sequences` |
| الكتالوج | `categories, units, warehouses, items, item_units, item_components, price_lists, price_list_lines` |
| الأرصدة | `item_warehouse_qty` |
| الفواتير | `invoices, invoice_lines` |
| المخزون | `stock_movements, stock_operations, stock_operation_lines` |
| الخزينة | `cash_accounts, cash_categories, cash_transactions, shifts` |
| العملاء والموردون | `parties, ledger_entries, installment_plans, installment_schedule` |
| الموارد البشرية | `departments, employees, attendances, leave_requests, salary_pays` |
| التذكيرات والمجموعات والتقسيط (ضامنون) | `reminders, customer_groups, customer_group_members, installment_guarantors, installment_plans, installment_schedule` |
| التدقيق | `activity_log, app_settings` |

## 5) الأمان

| الطبقة | التطبيق |
|---|---|
| النقل | TLS أمام الـ API (nginx / IIS / Caddy). الـ DB لا يُفتح خارج الشبكة الداخلية. |
| الهوية | Access Token 15 دقيقة + Refresh 7 أيام مع تدوير؛ إبطال فوري عند تغيير كلمة المرور. |
| كلمات المرور | scrypt (N=16384) بملح 16 بايت لكل مستخدم + `timingSafeEqual`. |
| التفويض | 23 صلاحية × 5 أدوار جاهزة؛ `PermissionsGuard` على مستوى الـ endpoint. |
| عزل الفروع | `x-branch-id` يُتحقق منه مقابل صلاحيات المستخدم (403 لو غير مسموح). |
| المراجعة | `activity_log` لكل فاتورة/حركة/تعديل؛ صفحة سجل العمليات في الإعدادات. |
|确定为输入 | كل المدخلات عبر parameterized queries (لا string interpolation). |

## 6) الأداء

- **فهارس** على كل أعمدة البحث المتكرر (فرع+تاريخ، صنف+مخزن، عميل+تاريخ).
- **ترقيم (LIMIT/OFFSET)** في كل القوائم + حد أقصى للصفحات (200).
- **تجميع في قاعدة البيانات** للتقارير (تجميع يومي/شهري بدل سحب صفوف خام).
- **connection pool** (20 اتصال افتراضيًا) + `pool.query` بدون事务 للقراءات.
- **العميل**: SPA بم assets ثابتة + Service Worker للتخزين المؤقت → تحميل شبه فوري عند تكرار الزيارة.
- **الهدف**: <150ms لقراءة الفاتورة، <250ms لعملية بيع كاملة على الشبكة المحلية.

## 7) خارطة الطريق

| # | المرحلة | الحالة |
|---|---|---|
| 1 | الأساس: مخطط + API + RBAC + نقاط البيع | ✅ |
| 2 | المخزون والخزينة والعملاء والتقارير | ✅ |
| 3 | الموارد البشرية + الإعدادات + سجل العمليات | ✅ |
| 4 | Print Agent محلي (طابعة ESC/POS + درج الكاشير) | ✅ |
| 5 | طابور أوفلاين (IndexedDB + idempotency) | ✅ |
| 6 | إشعارات لحظية للمخزون بين الفروع (SSE) | ✅ |
| 7 | البيع بوحدات متعددة (قطعة/كرتونة) | ✅ |
| 8 | التقسيط (خطط + سداد + تنبيهات) | ✅ |
| 9 | الفوترة الإلكترونية ZATCA (XML + QR + ختم تشفيري + تخليص) | ✅ |
| 10 | اختبار على طابعة حقيقية + بوابة ZATCA التجريبية | ⏳ |
| 11 | تطبيق موبايل أصلي (اختياري) | ⏳ |

## 7.1 تفاصيل الميزات الخمس الأخيرة

**1) Print Agent (`apps/print-agent`)**
- خدمة Node على `127.0.0.1:4100` محمية بـ `x-agent-token`.
- `winspool.drv` P/Invoke للطباعة على طابعة Windows، و TCP 9100 للطابعات الشبكية.
- توليد ESC/POS: محاذاة، غامق، حجم مضاعف، مسافات، قصّ، نبضة درج الكاشير.
- النص العربي يُموّل بـ Windows-1256 (المتوافق مع طابعات Xprinter/Epson الرخيصة).
- هدف `type: "file"` للاختبار بدون طابعة.

**2) وضع أوفلاين (`apps/web/lib/offline.ts`)**
- IndexedDB `wasel-offline/operations` + طابور عمليات بمفتاح idempotency (`clientRequestId`).
- عند فشل الشبكة: الفاتورة تُحفظ محليًا وتُرسل تلقائيًا عند رجوع الاتصال (كل 15 ثانية + حدث `online`).
- استجابات 4xx تُعتبر مرفوضة نهائيًا (لا إعادة محاولة)؛ 5xx والشبكة تُعاد المحاولة.

**3) SSE (`modules/events`)**
- `GET /api/events/inventory` يرسل `text/event-stream` مع heartbeat كل 25 ثانية.
- الأحداث: `stock.changed` · `item.updated` · `invoice.posted`.
- `EventSource` لا يدعم headers → التوكن يمرر كـ `?access_token=` (مدعوم في `JwtAuthGuard`).
- عند تعدد نسخ الـ API: استبدل `EventEmitter` بـ Redis pub/sub.

**4) وحدات متعددة (`item_units`)**
- معامل التحويل = عدد الوحدات الأساسية داخل وحدة البيع (كرتونة = 12 قطعة).
- تغيير الوحدة في السلة يحوّل الكمية ويعيد السعر تلقائيًا، والمخزون يُخصم بالوحدة الأساسية.
- `GET /items/:id` يرجع الوحدات مع أسعارها؛ `POST /items/:id/units` يحفظها.

**5) التقسيط و ZATCA**
- التقسيط: خطة + جدول أقساط مولّد (شهري/أسبوعي) + سداد (قيد دفتر العميل + حركة خزينة) + تقرير المستحقات.
- ZATCA: XML UBL 2.1 حتمي التوليد → hash SHA-256 → ختم ECDSA (P-256, raw r||s) + ختم RSA-SHA256 → QR بترميز TLV (8 وسوم ضريبية / 5 مبسطة) → PNG → إرسال `/invoices/clearance` أو `/invoices/reporting`.
- **مطلوب قبل الإنتاج**: CSID حقيقي من بوابة ZATCA (compliance)، شهادة + مفاتيح، وتطبيق canonicalization (C14N) الرسمي بدل التوليد الحتمي.

## 8) قرارات مؤجلة (لاحقة)

- **منع البيع عند نفاد الرصيد**: حالياً يُسمح به (سلبي) — يحتاج قرار سياسة (يُنفّذ كـ setting).
- **تسعير متعدد الوحدات**: متاح في نقطة البيع، لكن قوائم الأسعار حسب العميل غير مكتملة (`price_lists` جاهزة في المخطط).

## 9) تحديثات الدليل (Epees ERP) والتمثيل المعماري

### 9.1 مبادئ من الدليل إلى WaselERP (مطبقة فعليًا)
1. **الفاتورة المؤقتة (معلقة)**: مسودة → معتمدة → مرحّلة/ملغاة. (تنفيذ: `held_invoices` في POS + states في sales.)
2. **الرد النقدي**: المتبقى يُعاد للعميل (المسدد − المبلغ المدفوع).
3. **القيد المحاسبي**: يُنشأ عند حقل «المرحل» + الصلاحيات (`accounting.post`).
4. **الجرد**: سند → كمية متوقعة → فرق → اعتماد → قيد تسوية.
5. **التقارير**: فلاتر + عرض + طباعة/تصدير.

### 9.2 توسعات معمارية المنفذة (من الدليل إلى الكود)
| الدليل | الوحدة | الأثر المعماري |
|---|---|---|
| P4 (جرد/أذون/تحويل) | `modules/inventory/*` + `common/stock.ts` + `common/posting.ts` | فصل تدفق المخزون عن التسوية. |
| P5 (أسعار/كوبونات/هدايا) | `common/pricing.ts` + `modules/pricing` + `modules/sales/documents` | محرك سعر موحّد. |
| P6 (HR) | `modules/hr/*` + `modules/reports/reports-hr` | وحدة مستقلة. |
| P5.5 (تذكيرات) | `modules/reminders/*` | وحدة صغيرة + جدول. |

### 9.3 ما تبقى من الدليل (خطة مستمرة)
- الربط الحقيقي ببوابات الضرائب (ETA/ZATCA).
- المساعد الذكي/واتساب (P9).
- الأنظمة المتخصصة (P8).
