# سجل الفجوات — ERP-GAP-REGISTER

**التاريخ:** 2026-11-19
**مرجع الترقيم:** كل صف هنا يحمل رقم الصف المقابل في `ERP-COVERAGE-MAP.md §4` (1–32). لا يُضاف بند بلا رقم خريطة.
**نسخة الشجرة:** `unpinned working tree @ 50006ca` — كل التغييرات غير مُودَعة.
**القيود:** لا commit · لا push · لا إنتاج · لا Supabase. كل رقم أدناه من قاعدة PGlite معزولة (5434/5435) وواجهة محلية.

> **قاعدة الإغلاق:** لا يُغلق بند بجملة وصفية. يُغلق فقط بـ (أ) أمر قابل لإعادة التنفيذ، و(ب) رقم حرفي يظهر في مخرجات ذلك الأمر. هذا هو نفس المعيار المستخدم في `ERP-COVERAGE-MAP.md §1`.

---

## 1) ما أُغلق في هذه الدورة (بدليل رقمي)

| الخريطة | المجال | التصنيف السابق | الدليل الذي أغلقه | النتيجة الحرفية |
|---|---|---|---|---|
| 16 | التقسيط | `PARTIAL` | `tools/verify-gap-batch.js` · G-16 | جدول `300.00/300.00/300.01` = `900.01` · دفتر الطرف `900.01` · سداد 500 يُقصّ إلى `300` · Dr خزينة 300 / Cr ذمم 300 · جزئي `100` status `3` متبقي `200` · درج `+400` |
| 17 | الموارد البشرية والمرتبات | `PARTIAL` | نفس السكربت · G-17 | gross `6050.00` · تأمين موظف `715.00` · صاحب عمل `1218.75` · net `5335.00` · استحقاق Dr=Cr `7268.75` · صرف Dr مستحق 5335 / Cr خزينة 5335 |
| 18 | التقارير + xlsx | `PARTIAL` | نفس السكربت · P1/P2 + Smoke | محوري مبيعات `8711.6` = SQL · محوري مخزون `3462.3` = SQL · xlsx حزمة `PK` + اسم `.xlsx` + تقرير مجهول 400 |
| 19 | منشئ التقارير | `PARTIAL` | نفس السكربت · R1/R2 | مجموعة `sales_invoices` · `30` صفًا و`8886.6` = SQL مستقل |
| 29 | مراكز التكلفة (GL-8) | `PARTIAL` | نفس السكربت · G-8/G-2 | قيد 201 · السطور `[5,5]` · SQL 2 سطر · تقرير المركز `123.45/123.45/0` · `require_cost_center` → 400 |
| 30 | العملات الأجنبية (GL-9) | `PARTIAL` | نفس السكربت · G-9 | رأس `USD` بسعر `50.00000000` · `foreign_amount ["10.00","10.00"]` = الأساسي ÷ السعر |
| 11 | تقارير GL (GL-11) | `PARTIAL` | نفس السكربت · G-11 | ميزان `180455.74 = 180455.74` مقابل SQL · P&L `-43319.97` · ميزانية متوازنة · أستاذ CASH `-109018.08` = الميزان |

**حصيلة الحزمة:** `PASS 38 · FAIL 0 · INFO 8` — والانحدار الكامل `606/606` على قاعدة جديدة (5435).

---

## 2) السجل المفتوح (9 بنود)

الحجم تقدير تخطيطي (S ≤ يوم · M 2–4 أيام · L > أسبوع) وليس قياسًا.

| المعرّف | الخريطة | المجال | التصنيف | الموجود فعلًا | الناقص لإغلاق البند | الحجم | يعتمد على |
|---|---|---|---|---|---|---|---|
| `GAP-01` | 4 | سجل التدقيق | `PASS (مغلق نهائيًا)` | typed actions (`invoice.post.*`، `voucher.*`) + `common/audit.ts` بـ`ip` إلزامي + `احتساب صف واحد لكل فعل` | **مغلق نهائيًا:** Part A **8/8** (A4 خارج النطاق، TD-51) · Part B **13/13** (B1..B11 أدلة حرفية `ip_address=127.0.0.1`، B12 `posting.ts` diff=0، B13 115/115 + smoke 606/606) · Part C **10/10** (C1 **مُصحَّح** = count-per-action لا grep؛ C2..C9 COUNT=1 لكل فعل؛ **C8 أُصلح**: منع `invoice.post` مزدوج عند التعديل عبر `if (!editOf)`) ·Regression 115/115 + 606/606. `_reports: GAP01-report-PartA/B/C.md_` | M | لا شيء |
| `GAP-02` | 20 | CRM | `PARTIAL` | Smoke **13** فحصًا: مصادر/عملاء محتملون/أنشطة/تذاكر/تحويل لعميل · معدل الكسب موجود | سكربت مخصص يثبت: سبب الخسارة يمنع الإغلاق بلا سبب · معدل الكسب = `won / (won+lost)` على أرقام مستقلة | M | لا شيء |
| `GAP-03` | 21 | الصيانة | `PASS (مغلق)` | سياسة ضمان مُنفَّذة: مرجع/تواريخ إلزامية، منع تحصيل بلا صلاحية `charge_warranty`+سبب+audit، قيد COGS مستقل عن الدفع (TD-56)، تقرير warranty | **مغلق 14/14** (`GAP03-report.md`): Part A/B/C/D — 13 فحصًا آليًا + 08a/b/c/d بعينات قيود حرفية · `posting.ts` diff=0 · انحدار **115/115 + smoke 606/606**. صلاحيتان جديدتان (55→57). TD-53/54/55/57 مفتوحة (خارجة عن v1). | M | لا شيء |
| `GAP-04` | 22 | ETA (مصر) | `UNVERIFIED` | Smoke **13** فحصًا: UUID v1 · XML UBL 2.1 · QR PNG · hash · رفض فاتورة شراء 400 · QR TLV 1–8 والتوقيع في الكود **بلا فحص آلي** | إرسال حقيقي إلى بوابة الهيئة (بيئة اختبار رسمية) واستلام `accepted` — **يحتاج اعتمادًا خارجيًا** | L | بيانات اعتماد البوابة |
| `GAP-05` | 23 | ZATCA (السعودية) | `UNVERIFIED` | Smoke **5** فحوص: `sandbox` · XML `<Invoice` · hash 44 · QR PNG · مستند مخزّن · الختم بلا فحص | clearance/reporting حقيقي على بيئة ZATCA | L | اعتماد فاتورة إلكترونية سعودي |
| `GAP-06` | 26 | PWA / أوفلاين | `PASS (مغلق نهائيًا)` | `lib/offline.ts` (IndexedDB queue + `clientRequestId`) · `offline` = **0** في Smoke · **GAP06-01..12 PASS** (5450/4010 + GAP06-11/12 + انحدار B1..B5.4/GAP-07/Smoke) | **مغلق نهائيًا** — GAP06-01..12 PASS؛ GAP06-11 (GRN concurrency: rollback clean, received_qty=10 not 20) + GAP06-12 (voucher: 1 journal, 2 gl, 1 ledger) PASS | M | لا شيء |
| `GAP-07` | 27 | النسخ الاحتياطي/الاستعادة | `PASS (مقيّد)` | `POST /api/admin/restore` (`admin.restore_backup`, `confirm:"RESTORE"`, v1) + `restore_log` + ترتيب FK آمن معاملِي — `GAP07-report.md` | GAP07-01..08 **9/9** (5441/4006): جولة كاملة (2/3/6→تعديل→استعادة 2/3/6، TB 350/350 بالقرش) + rollback (04a/04b) + تدقيق؛ B1..B5.4+Integration **115/115** (5442) + smoke **606/606** (5443 نظيف). **شرطان:** TD-44 (عالي، GL-10 غير قابل لإعادة الإثبات) وTD-45 (متوسط). | M | لا شيء |
| `GAP-08` | 28 | المرفقات | `PASS (مقيّد)` | سياسات حجم/عدد قابلة للضبط لكل كيان مدعوم فعليًا + تدقيق PUT — `GAP08-report.md` | GAP08-01..04 **5/5** (413/400) + GAP08-05: B1..B5.4/Integration/Smoke **606/606** على قاعدة نظيفة (GL-10 مرجع 5434؛ قابلية النقل = TD-44). | S | لا شيء |
| `GAP-09` | 31 | الموازنات (GL-10) | `PARTIAL` | GL-10 backend كامل (schema `budgets`/`budget_lines` + 9 endpoints + عرض `v_budget_actual` + تقريرا Budget vs Actual/Alerts) — UI مؤجل | شاشة `/accounting/budgets` (slice منفصل) | S | لا شيء (backend جاهز) |

---

## 3) أولويات الإغلاق

1. **S — فوري:** `GAP-08` (سياسات المرفقات) — أرخص بند وأعلى يقين.
2. **M — قبل أي عرض للعميل:** `GAP-06` (أوفلاين/idempotency server-side) — يمسّ سلامة البيانات المالية. *(GAP-07 أُغلق PASS مقيّدًا بهذه الدورة مع شرطي TD-44/TD-45.)*
3. **M — جودة تشغيل:** `GAP-01` (تدقيق) ثم `GAP-02`/`GAP-03` (CRM/صيانة — تجاريان أكثر منهما ماليين).
4. **L — يحتاج اعتمادًا خارجيًا:** `GAP-04`/`GAP-05` (بوابات الضرائب) — لا تُغلق بالكود وحده.
5. **S — قرار منتج (UI):** `GAP-09` (الموازنات) — backend مكتمل (GL-10 **PASS مُقيَّد** إثباتيًا بسبب TD-44)، الشاشة `/accounting/budgets` مؤجلة.

---

## 4) ما ليس فجوة (لتجنّب الخلط) + ديون إثبات/اختبار

- **الديون التقنية `TD-37`/`TD-38`** ليست فجوات تغطية، ومسجّلة في `docs/ERP-ACCOUNTING-DECISIONS.md §6` — لا تُدرج هنا.
- **TD-44 — عالي (فجوة إثبات، لا تغطية): «GL-10 verification non-reproducible — proof of evidence is single-instance log.»** مرجع 5434 (`CC-VERIFY`) لم يعد متاحًا، و`tools/verify-gl10.js` غير قابل لإعادة التشغيل على بيئة نظيفة (GL10-01 يثبّت `base_tables` مطلقًا فيفشل بعد أي إضافة جدول؛ GL10-11 يعتمد بيانات تاريخية → `NaN`). نتيجة: GL-10 **PASS مُقيَّد** (لقطة إثبات `%TEMP%\gl10-verify-2.txt`، غير قابلة لإعادة الإنتاج) حتى الإغلاق. **الإصلاح المطلوب قبل أي release:** (1) الأداة تُنشئ بيئتها/بياناتها كاملًا داخليًا (لا اعتماد على 5434)؛ (2) GL10-01 يفحص **الفرق** قبل/بعد لا عددًا مطلقًا؛ (3) GL10-11 يُنشئ 5–10 قيود على CC اختباري ولا يقرأها من `gl_entries`؛ (4) معيار الإغلاق = `verify-gl10.js` **12/12 على أي بيئة نظيفة** (migrate-all + seed + الأداة تُنشئ بياناتها). **لا يمنع GAP-06**. مسجّل أيضًا في `docs/ERP-ACCOUNTING-DECISIONS.md §6`.
- **TD-45 — متوسط (دين اختبار/تشغيل، لا تغطية): «Smoke test not idempotent — pollutes periods, requires clean DB.»** تشغيل smoke بعد B1..B5.4 على نفس القاعدة يتلوث (`POST /accounting/periods` تداخل فترة مثل «CN closed») فلا يعمل smoke إلا على قاعدة نظيفة؛ يضر بـ CI/إعادة التشغيل/عرض «606/606». **الإصلاح المطلوب:** smoke يُنشئ فترة اختبار خاصة به (`SMOKE-TEST-{timestamp}`) أو ينظّف فترات الاختبار المميّزة قبل البدء. **معيار الإغلاق:** `smoke-test.js` **606/606** على نفس القاعدة **بعد** B1..B5.4 (بدون reset). **لا يمنع GAP-06**.
- **TD-46 — منخفض (قرار منتج/توافق، لا تغطية): «`clientRequestId` should eventually be required on financial mutations.»** اليوم `clientRequestId` يقبل `null/undefined/فارغ` (توافق خلفي؛ GAP-06 يفرض idempotency عند توفر مفتاح غير فارغ فقط). AGENTS.md §11 يشترط المفتاح للعمليات القابلة للإعادة، لكن الواجهة تقبله اختياريًا. **الإصلاح المستقبلي (v2):** فرض `NOT NULL`/إلزامية على الطفرات المالية (`invoices`, `vouchers`, `purchase_receipts` ثم ما يلزم) بعد ترحيل المستدعين (POS web/apps). **لا يُغلق في GAP-06**؛ مُسجّل للتتبع.
- **TD-47 — منخفض (دين اختبار/تشغيل، لا تغطية): «B5.2/3/4 teardown skips FK cleanup.»** اختبارات B5.2/B5.3/B5.4 تتخطّى تنظيف بياناتها بسبب قيود FK (مثل `ledger_entries.invoice_id_fkey`)، ما يجعل إعادة التشغيل على نفس القاعدة غير حتمي ويؤثر على CI. **الإصلاح:** حذف متسلسل صريح بترتيب FK، أو اعتماد `ON DELETE CASCADE` بحذر (مثل `ledger_entries.invoice_id`) وفق تصميم آمن. **لا يُغلق الآن — لا يعطّل GAP-06/GAP-01**.
- **TD-48 — متوسط (ثقافة/أمنية، لا تغطية): «Repo history contains revoked token.»** الرمز `sbp_oauth_0528cf9fd6732fef458008c841e1c35af9de2d03` موجود في تاريخ Git المتاح على `origin/main` (commits `69e2aa7`/`fa3251f` عبر `apps/api/apply-p5b.js`) — الرمز مفعّل، الملف محذوف من القرص و`.gitignore` محدّث، لكن git يحتفظ بالblobات المرتبطة بالتاريخ. **الإصلاح:** Revoke فوري من Supabase Dashboard + Rotate + verify (curl → 401) + فحص Audit Log + (اختياري مستقبلي) rewrite/force-push. **الإغلاق:** بعد قرار المالك (الأنصح بعدمه الآن).
- **TD-49 — منخفض (هندسة) — ✅ مُغلق في Part B:** كان «No unified activity_log helper». **الإغلاق:** `apps/api/src/common/audit.ts` (`logActivity` بـ`ip: string` إلزامي) + هجرة 9 INSERTs مالية + تحقق `tools/verify-gap01-partB.js` **15/15** بصفوف حرفية `ip_address=127.0.0.1`. راجع `GAP01-report-PartB.md`.
- **TD-50 — منخفض (ربط، لا تغطية): «No documented linkage between activity_log and gl_journals source.»** لا يوجد تحقق موثق يربط كل عملية مالية بـ `source_type`/`source_id` في `gl_journals` ضمن السجل. **الإصلاح:** تحقق/ربط في `postJournal`. **لا يُغلق الآن — لا يعطّل GAP-01**.
- **TD-51 — متوسط (هندسة/منتج، لا تغطية): «`invoiceType=4` (مرتجع شراء) عبر `/sales/invoices` — deprecated / out-of-scope.»** الكود يحمل `INVOICE_POST_ACTION[4] = 'invoice.post.return_purchase'` كنية مستقبلية، لكن مسار `/sales/invoices` (شريحة المبيعات) **لا يجب أن يستقبل** مرتجع شراء؛ endpoint يرفض الآن بـ`400` (fail-closed: «لا يمكن إرجاع سطر بلا حركة مخزون أصلية») قبل الوصول للـlogging. القرار (للمالك): **خارج نطاق GAP-01** — أُسقط من معايير A4 كـ`out-of-scope` (ليس `blocked`؛ لا إصلاح). مرتجع الشراء الصحيح المعماري: **مطالبة مورد + GRN بديل/إشعار دائن** (DEC-PURCH-027). **الإصلاح المستقبلي (B-phase):** إزالة `invoiceType=4` من DTO + مسار `POST /purchases/claims` + حذف `INVOICE_POST_ACTION[4]`. **معيار الإغلاق:** عدم وجود مرجع لـ`invoiceType=4` في `sales.slice.ts` + غياب أي صف `invoice.post.return_purchase` في `activity_log`. **لا يمنع Part B.**
- **TD-52 — متوسط (هندسة، لا تغطية): «Activity_log INSERTs غير مهاجَرة للـhelper — `ip_address` مفقود في عمليات مالية ثانوية.»** Part B هاجر العمليات الحرجة (B2–B11) فقط؛ ما زالت INSERTs مباشرة بلا `ip_address` في: `fixed-assets.slice.ts` (`asset.create/update/depreciate/dispose`) · `bank-recon` · `bank-expenses` · `installments` · `hr` (payroll) · `maintenance` (قد يكون له أثر مالي) · وغيرها. الـ`action` موجود لكن «من أين» مفقود (NULL). **الإصلاح:** هجرة إلى `logActivity` في slice منفصل (**ليس GAP-01**). **معيار الإغلاق:** `grep -rn "INSERT INTO activity_log" apps/api/src --include="*.slice.ts"` = **0** (كل شيء عبر الhelper). **لا يعطّل إغلاق GAP-01** — GAP-01 يغطي العمليات الحرجة فقط.
- **TD-53 — متوسط (منتج/هندسة، لا تغطية): «Warranty eligibility not automated — no invoice/GRN linkage.»** في GAP-03 v1 تُدخل تواريخ الضمان يدويًا؛ لا يوجد ربط `maintenance_tickets` ↔ `purchase_receipts`/`purchase_invoices` يسمح بتحديد الأهلية تلقائيًا من تاريخ الشراء/الموديل/المورد. **الإصلاح (L-size):** بناء الربط ثم قاعدة أهلية تلقائية. **لا يعطّل GAP-03** (المعتمد v1 = سياسة يدوية موثّقة، TD منفصل).
- **TD-54 — متوسط (محاسبة، لا تغطية): «Warranty recovery from supplier not built.»** مطالبة المورد باسترداد تكلفة الضمان (claims) — DEC-PURCH-027 — غير مبنية. GAP-03 يعامل الضمان كتكلفة على **COGS** فقط بلا استرداد ولا حساب وسيط (`warranty_claims` مرفوض في v1 لتجنّب حساب معلّق). **الإصلاح:** مسار claims منفصل بربط `gl_mappings`.
- **TD-55 — منخفض (هندسة، لا تغطية): «X-Forwarded-For not honored in activity_log.»** الصيغة المؤقتة `req.ip ?? socket.remoteAddress ?? 'unknown'` تعطي IP الـproxy خلف Nginx/Cloudflare/Supabase لا IP العميل الحقيقي. أُدرج كـdeviation مقبول في Part B. **الإصلاح:** قراءة `X-Forwarded-For`/`X-Real-IP` مع `trust proxy` عند الحاجة لـreal-client-IP.
- **TD-56 — عالي (محاسبة، أُصلح في GAP-03): «COGS on maintenance tickets conditionally posted on payment.»** في `deliverTicket()` كان قيد `Dr COGS / Cr INVENTORY` لقطع الغيار داخل `if (paid > 0)` — أي تذكرة بلا تحصيل تستهلك مخزونًا بلا قيد. **الإصلاح:** نقل الكتلة خارج الشرط بحيث تُنفَّذ عند `partsCost > 0` بغض النظر عن الدفع (GAP03-08a/08b). مسجّل أيضًا في `docs/ERP-ACCOUNTING-DECISIONS.md §6`.
- **TD-57 — منخفض (هندسة، لا تغطية): «`max_charge` dead field.»** عمود `maintenance_tickets.max_charge` مخزَّن لكن بلا أي تحقق/استخدام في الكود (3 ظهورات: SELECT/INSERT/UPDATE فقط)؛ التكلفة التقديرية الفعلية هي `estimated_cost`. **الإصلاح المستقبلي:** إما تطبيقه كسقف تحصيل أو إزالته. لا يعطّل GAP-03.
- **الإنتاج وSupabase** خارج النطاق بقرار المالك، وليسا «فجوة».
- **`PARTIAL`/`PASS (مقيّد)` ≠ معطّل:** البنود تعمل، والناقص/المقيّد هو إثبات قابل لإعادة الإنتاج أو شرطًا موثقًا — وهذا ما توضّحه الأعمدة والأدلة.
