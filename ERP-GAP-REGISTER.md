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
| `GAP-02` | 20 | CRM | `PASS (مغلق)` | إلزام سبب الخسارة بطبقتين (API 400 + DB CHECK) · audit `crm.lead.lost`/`.lost_reason.edit`/`.stage.change` بـIP · `winRate` شفاف داخل `/crm/summary` | **مغلق 8/8** (`GAP02-report.md`): 7 فحوص آلية + 08 regression 115/115 + 606/606 + CRM 13/13 · `posting.ts` diff=0 · pre-check قبل CHECK = 0 صف مخالف (لا backfill). TD-59 مفتوح. | M | لا شيء |
| `GAP-03` | 21 | الصيانة | `PASS (مغلق)` | سياسة ضمان مُنفَّذة: مرجع/تواريخ إلزامية، منع تحصيل بلا صلاحية `charge_warranty`+سبب+audit، قيد COGS مستقل عن الدفع (TD-56)، تقرير warranty | **مغلق 14/14** (`GAP03-report.md`): Part A/B/C/D — 13 فحصًا آليًا + 08a/b/c/d بعينات قيود حرفية · `posting.ts` diff=0 · انحدار **115/115 + smoke 606/606**. صلاحيتان جديدتان (55→57). TD-53/54/55/57 مفتوحة (خارجة عن v1). | M | لا شيء |
| `GAP-04` | 22 | ETA (مصر) | `UNVERIFIED` | Smoke **13** فحصًا: UUID v1 · XML UBL 2.1 · QR PNG · hash · رفض فاتورة شراء 400 · QR TLV 1–8 والتوقيع في الكود **بلا فحص آلي** | إرسال حقيقي إلى بوابة الهيئة (بيئة اختبار رسمية) واستلام `accepted` — **يحتاج اعتمادًا خارجيًا** | L | بيانات اعتماد البوابة |
| `GAP-05` | 23 | ZATCA (السعودية) | `UNVERIFIED` | Smoke **5** فحوص: `sandbox` · XML `<Invoice` · hash 44 · QR PNG · مستند مخزّن · الختم بلا فحص | clearance/reporting حقيقي على بيئة ZATCA | L | اعتماد فاتورة إلكترونية سعودي |
| `GAP-06` | 26 | PWA / أوفلاين | `PASS (مغلق نهائيًا)` | `lib/offline.ts` (IndexedDB queue + `clientRequestId`) · `offline` = **0** في Smoke · **GAP06-01..12 PASS** (5450/4010 + GAP06-11/12 + انحدار B1..B5.4/GAP-07/Smoke) | **مغلق نهائيًا** — GAP06-01..12 PASS؛ GAP06-11 (GRN concurrency: rollback clean, received_qty=10 not 20) + GAP06-12 (voucher: 1 journal, 2 gl, 1 ledger) PASS | M | لا شيء |
| `GAP-07` | 27 | النسخ الاحتياطي/الاستعادة | `PASS` | `POST /api/admin/restore` (`admin.restore_backup`, `confirm:"RESTORE"`, v1) + `restore_log` + ترتيب FK آمن معاملِي — `GAP07-report.md` | GAP07-01..08 **9/9** (5441/4006): جولة كاملة (2/3/6→تعديل→استعادة 2/3/6، TB 350/350 بالقرش) + rollback (04a/04b) + تدقيق؛ B1..B5.4+Integration **115/115** (5442) + smoke **606/606** (5443 نظيف). **TD-45 أُغلق** (`TD45-report.md`: B1..B5.4 ← smoke على نفس القاعدة = 606/606 + standalone 606/606). | M | لا شيء |
| `GAP-08` | 28 | المرفقات | `PASS` | سياسات حجم/عدد قابلة للضبط لكل كيان مدعوم فعليًا + تدقيق PUT — `GAP08-report.md` | GAP08-01..04 **5/5** (413/400) + GAP08-05: B1..B5.4/Integration/Smoke **606/606** على قاعدة نظيفة. **TD-44 أُغلق** (`verify-gl10.js` 12/12 على بيئة نظيفة + 12/12 idempotent — `TD44-report.md`). | S | لا شيء |
| `GAP-09` | 31 | الموازنات (GL-10) | `deferred (owner decision)` | GL-10 backend كامل (schema `budgets`/`budget_lines` + 9 endpoints + عرض `v_budget_actual` + تقريرا Budget vs Actual/Alerts) — UI مؤجل | **مؤجل بقرار المالك 2026-11-25:** لا مستخدم حالي يستخدم الموازنات؛ الواجهة تُبنى عند أول طلب فعلي بحسب احتياج المستخدم. أُضيف كـbacklog في `ERP-ROADMAP.md`. | S | قرار مالك (طلب مستخدم فعلي) |

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
- **TD-44 — عالي — ✅ مُغلق 2026-11-25:** كان «GL-10 verification non-reproducible». **الإغلاق:** `tools/verify-gl10.js` ذاتي التأسيس بالكامل (ينشئ مستخدميه/حساباته/مركز التكلفة `CC-TD44-TEST` ويقيس فروقًا قبل/بعد) · `base_tables` وكل القيم التاريخية (5434/CC-VERIFY/137) أُزيلت (grep = 0) · **12/12** على بيئة نظيفة + **12/12** مجددًا على نفس البيئة · smoke 606/606 · `posting.ts` diff=0. راجع `TD44-report.md`. GL-10/GAP-07/GAP-08 انتقلوا إلى PASS.
- **TD-45 — متوسط — ✅ مُغلق 2026-11-25:** كان «Smoke test not idempotent — pollutes periods, requires clean DB». **الإغلاق:** `ensurePeriod()` يعيد استخدام فترات `SMOKE ...` ويفتحها مجددًا · فترة القفل نُقلت إلى 2021 لتجنّب `CN closed` · مراجع/تواريخ وحساب GL بنك E1 فريدة لكل تشغيل · تنظيف الوردية · E2 بفحص فرق · payroll بشهر غير مقفول/غير مستخدم · نطاق ملخص الحضور مستقل. **التحقق:** B1..B5.4 **115/115** ثم smoke على **نفس القاعدة** = **606/606**، وsmoke منفرد = **606/606** · `posting.ts` diff=0. `TD45-report.md`.
- **TD-46 — منخفض (قرار منتج/توافق، لا تغطية): «`clientRequestId` should eventually be required on financial mutations.»** اليوم `clientRequestId` يقبل `null/undefined/فارغ` (توافق خلفي؛ GAP-06 يفرض idempotency عند توفر مفتاح غير فارغ فقط). AGENTS.md §11 يشترط المفتاح للعمليات القابلة للإعادة، لكن الواجهة تقبله اختياريًا. **الإصلاح المستقبلي (v2):** فرض `NOT NULL`/إلزامية على الطفرات المالية (`invoices`, `vouchers`, `purchase_receipts` ثم ما يلزم) بعد ترحيل المستدعين (POS web/apps). **لا يُغلق في GAP-06**؛ مُسجّل للتتبع.
- **TD-47 — منخفض (دين اختبار/تشغيل، لا تغطية): «B5.2/3/4 teardown skips FK cleanup.»** اختبارات B5.2/B5.3/B5.4 تتخطّى تنظيف بياناتها بسبب قيود FK (مثل `ledger_entries.invoice_id_fkey`)، ما يجعل إعادة التشغيل على نفس القاعدة غير حتمي ويؤثر على CI. **الإصلاح:** حذف متسلسل صريح بترتيب FK، أو اعتماد `ON DELETE CASCADE` بحذر (مثل `ledger_entries.invoice_id`) وفق تصميم آمن. **لا يُغلق الآن — لا يعطّل GAP-06/GAP-01**.
- **TD-48 — متوسط (ثقافة/أمنية، لا تغطية): «Repo history contains revoked token.»** الرمز `sbp_oauth_0528cf9fd6732fef458008c841e1c35af9de2d03` موجود في تاريخ Git المتاح على `origin/main` (commits `69e2aa7`/`fa3251f` عبر `apps/api/apply-p5b.js`) — الرمز مفعّل، الملف محذوف من القرص و`.gitignore` محدّث، لكن git يحتفظ بالblobات المرتبطة بالتاريخ. **الإصلاح:** Revoke فوري من Supabase Dashboard + Rotate + verify (curl → 401) + فحص Audit Log + (اختياري مستقبلي) rewrite/force-push. **الإغلاق:** بعد قرار المالك (الأنصح بعدمه الآن).
- **TD-49 — منخفض (هندسة) — ✅ مُغلق في Part B:** كان «No unified activity_log helper». **الإغلاق:** `apps/api/src/common/audit.ts` (`logActivity` بـ`ip: string` إلزامي) + هجرة 9 INSERTs مالية + تحقق `tools/verify-gap01-partB.js` **15/15** بصفوف حرفية `ip_address=127.0.0.1`. راجع `GAP01-report-PartB.md`.
- **TD-50 — منخفض (ربط، لا تغطية): «No documented linkage between activity_log and gl_journals source.»** لا يوجد تحقق موثق يربط كل عملية مالية بـ `source_type`/`source_id` في `gl_journals` ضمن السجل. **الإصلاح:** تحقق/ربط في `postJournal`. **لا يُغلق الآن — لا يعطّل GAP-01**.
- **TD-51 — متوسط (هندسة/منتج، لا تغطية): «`invoiceType=4` (مرتجع شراء) عبر `/sales/invoices` — deprecated / out-of-scope.»** الكود يحمل `INVOICE_POST_ACTION[4] = 'invoice.post.return_purchase'` كنية مستقبلية، لكن مسار `/sales/invoices` (شريحة المبيعات) **لا يجب أن يستقبل** مرتجع شراء؛ endpoint يرفض الآن بـ`400` (fail-closed: «لا يمكن إرجاع سطر بلا حركة مخزون أصلية») قبل الوصول للـlogging. القرار (للمالك): **خارج نطاق GAP-01** — أُسقط من معايير A4 كـ`out-of-scope` (ليس `blocked`؛ لا إصلاح). مرتجع الشراء الصحيح المعماري: **مطالبة مورد + GRN بديل/إشعار دائن** (DEC-PURCH-027). **الإصلاح المستقبلي (B-phase):** إزالة `invoiceType=4` من DTO + مسار `POST /purchases/claims` + حذف `INVOICE_POST_ACTION[4]`. **معيار الإغلاق:** عدم وجود مرجع لـ`invoiceType=4` في `sales.slice.ts` + غياب أي صف `invoice.post.return_purchase` في `activity_log`. **لا يمنع Part B.**
- **TD-52 — متوسط — ✅ مُغلق 2026-11-27:** كان «Activity_log INSERTs غير مهاجَرة للـhelper». **الإغلاق:** Phase B1 (27 INSERT) + B2 (13) + B3 (12) = 52 slice INSERTs كلها هاجرت إلى `logActivity` مع `ip` إلزامي · بوابتان: `grep *.slice.ts` = **0** و`grep *.ts` = **3** (audit.ts + posting.ts×2 — TD-62 يبقى مباشرًا بقرار المالك) · regression 115/115 + 606/606 · `posting.ts` diff=0. `TD52-audit.md` + `TD52-phaseB{1,2,3}-report.md`.
- **TD-53 — متوسط (منتج/هندسة، لا تغطية): «Warranty eligibility not automated — no invoice/GRN linkage.»** في GAP-03 v1 تُدخل تواريخ الضمان يدويًا؛ لا يوجد ربط `maintenance_tickets` ↔ `purchase_receipts`/`purchase_invoices` يسمح بتحديد الأهلية تلقائيًا من تاريخ الشراء/الموديل/المورد. **الإصلاح (L-size):** بناء الربط ثم قاعدة أهلية تلقائية. **لا يعطّل GAP-03** (المعتمد v1 = سياسة يدوية موثّقة، TD منفصل).
- **TD-54 — متوسط (محاسبة، لا تغطية): «Warranty recovery from supplier not built.»** مطالبة المورد باسترداد تكلفة الضمان (claims) — DEC-PURCH-027 — غير مبنية. GAP-03 يعامل الضمان كتكلفة على **COGS** فقط بلا استرداد ولا حساب وسيط (`warranty_claims` مرفوض في v1 لتجنّب حساب معلّق). **الإصلاح:** مسار claims منفصل بربط `gl_mappings`.
- **TD-55 — منخفض (هندسة، لا تغطية): «X-Forwarded-For not honored in activity_log.»** الصيغة المؤقتة `req.ip ?? socket.remoteAddress ?? 'unknown'` تعطي IP الـproxy خلف Nginx/Cloudflare/Supabase لا IP العميل الحقيقي. أُدرج كـdeviation مقبول في Part B. **الإصلاح:** قراءة `X-Forwarded-For`/`X-Real-IP` مع `trust proxy` عند الحاجة لـreal-client-IP.
- **TD-56 — عالي (محاسبة، أُصلح في GAP-03): «COGS on maintenance tickets conditionally posted on payment.»** في `deliverTicket()` كان قيد `Dr COGS / Cr INVENTORY` لقطع الغيار داخل `if (paid > 0)` — أي تذكرة بلا تحصيل تستهلك مخزونًا بلا قيد. **الإصلاح:** نقل الكتلة خارج الشرط بحيث تُنفَّذ عند `partsCost > 0` بغض النظر عن الدفع (GAP03-08a/08b). مسجّل أيضًا في `docs/ERP-ACCOUNTING-DECISIONS.md §6`.
- **TD-57 — منخفض (هندسة، لا تغطية): «`max_charge` dead field.»** عمود `maintenance_tickets.max_charge` مخزَّن لكن بلا أي تحقق/استخدام في الكود (3 ظهورات: SELECT/INSERT/UPDATE فقط)؛ التكلفة التقديرية الفعلية هي `estimated_cost`. **الإصلاح المستقبلي:** إما تطبيقه كسقف تحصيل أو إزالته. لا يعطّل GAP-03.
- **TD-58 — منخفض (قابلية تقرير، لا تغطية): «Expired-warranty override not distinguishable in `activity_log.action».»** تجاوز مدة الضمان وتحصيل ضمان عادي يستخدمان نفس الـ action `maintenance.warranty_charge_override`؛ المميّز الوحيد هو نص `details` — لذا استعلام «كم تذكرة ضمان منتهية تم تجاوزها هذا الشهر؟» لا يُميّزهما. **الإصلاح المستقبلي:** action منفصل (مثلاً `maintenance.warranty_expiry_override`) أو عمود `override_kind` عند الحاجة لتقرير مؤرخ. لا يعطّل GAP-03.
- **TD-61 — متوسط → ✅ مُغلق فورًا 2026-11-25 (احتمال أ):** كان «smoke 605/605 على DB مستعملة — فحص مشروط واحد لم يُنفَّذ». **التوضيح:** الفحص `second warehouse created for transfer test` في `tools/smoke-test.js:1665` محاط بـ `if (!whB)` (سطر 1660) — يُنفَّذ فقط عند إنشاء مخزن ثانٍ. على DB مستعملة يوجد مخزن ثانٍ مسبقًا in traversed path، فيُتخطى الفحص. **الحكم:** (أ) — فحص «إذا وُجد X»، سليم. `606/606` على DB نظيفة هو المعيار الصحيح؛ `605/605` على DB مستعملة = كل فحص نُفِّذ نجح. TD-45 مغلق نهائيًا.
- **TD-62 — منخفض (هندسة، لا تغطية): «`period.backpost` activity_log INSERT bypasses helper — IP not captured.»** في `common/posting.ts` INSERT مباشر لحظة الترحيل بأولوية `accounting.backpost`؛ `posting.ts` لا يعرف `req.ip` (يُستدعى من خدمات متعددة). **القرار:** إبقاء مباشر (حسب توجيه المالك في TD-52) — يُسجَّل للتبع فقط، لا يُغلق GAP-01.
- **TD-63 — منخفض (هندسة، لا تغطية): «`logActivity.branchId` nullable — استثناءات مشروعة.»** توسيع النوع إلى `number | null` لحالتين مشروعيتين: `backup.*` (كيان قاعدة البيانات) و`catalog/items.*` (الأصناف معرَّفة شركة-مستوى: `item.components`, `item.bulk_price`, `item.import`). **القاعدة المُحدَّثة 2026-11-27:** أي استخدام جديد لـ `null` خارج هاتين المجموعتين ← تصعيد في المراجعة؛ `null` استثناء موثّق لا default. `TD52-phaseB3-clarification.md`.
- **TD-64 — متوسط → ✅ مُغلق فورًا (احتمال أ): «`restoreGAP07` ip source.»** التوضيح: `backup.slice.ts:454-456` يأخذ `ip` من `X-Forwarded-For ?? req.ip ?? socket.remoteAddress` (IP مُنفِّذ الاستعادة الآن) ويمرّره إلى `sourceIp` و`ip` معًا. ليس من حزمة النسخة. `TD52-phaseB1-clarification.md`.
- **TD-65 — منخفض (إثبات، لا تغطية): «`item.components` و`order.move` هاجرا في B3 بلا sample row.»** 10/12 عينة مباشرة + 2/12 بنمط متطابق مع بقية الهجرة. **الإغلاق:** اختبار يدوي واحد لكل منهما مع `req.ip` (لا يعطّل TD-52 — الثغرة إثباتية لا وظيفية).
- **TD-66 — منخفض (توثيق، لا تغطية): «`branch_transfer` activity_log branchId semantics.»** موثَّق: `approve` = from_branch_id (الفرع المصدر يقرر الإرسال) · `receive` = to_branch_id (الفرع المستلم يستلم) · `cancel` = from_branch_id (مصدر النية). قرار تفسيري صحيح من B3. `TD52-phaseB3-clarification.md`.
- **TD-67 — متوسط — ✅ مُغلق في Phase 1 (P1-01):** `2108 ذمم مطالبات الموردين` (أصل، party+branch) + `gl_mappings.SUPPLIER_CLAIM_RECEIVABLE` + seed متطابق.
- **TD-68 — منخفض — ✅ مُغلق:** العدد الصحيح **54** (001..054) — §10 كتب 48 قبل Addendum (لا drift).
- **TD-69 — منخفض (مبدأ): «AUTOMATED_SOURCES configuration append-only, posting.ts logic immutable.»** كل TD جديد يُدخل `source_type` يتضمن تحديث allowlist صريح. مُطبَّق في TD-53/54 P1-05 revised (2 insertions، 0 deletions، default-deny سليم). `POSTING-CONFIG-RULE.md`.
- **TD-59 — منخفض (تحليل، لا تغطية): «CRM: no `closed_at` timestamp — win rate by close-date not possible; cohort-based (`created_at`) only.»** `crm_leads` لا يسجّل وقت الإغلاق؛ `GET /crm/summary?from=&to=` يفلتر على `created_at` (كوهورت). **الإصلاح المستقبلي:** عمود `closed_at` + backfill عند الحاجة لتقارير معدل كسب حسب تاريخ الإغلاق. لا يعطّل GAP-02.
- **TD-60 — منخفض (هندسة اختبار، لا تغطية): «Other verify-* tools may have similar historical dependencies — audit when next touched.»** بعد إغلاق TD-44 صار `verify-gl10.js` ذاتي التأسيس؛ أدوات `verify-gap07.js`/`verify-gap08.js` (وغيرها) قد تعتمد على بيانات/معرفات تاريخية. تُراجَع عند التعديل التالي لها. لا يُغلق الآن.
- **الإنتاج وSupabase** خارج النطاق بقرار المالك، وليسا «فجوة».
- **`PARTIAL`/`PASS (مقيّد)` ≠ معطّل:** البنود تعمل، والناقص/المقيّد هو إثبات قابل لإعادة الإنتاج أو شرطًا موثقًا — وهذا ما توضّحه الأعمدة والأدلة.
