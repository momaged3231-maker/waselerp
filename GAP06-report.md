# GAP-06 — Offline / PWA Idempotency (Server-side) — Verification Report

**الحالة:** **PASS (GAP06-01..10 مُثبتة)** — تنفيذ خادمي لـ idempotency على الطفرات المالية المستهدفة (بدون UI / بدون Service Worker / بدون مزامنة متعددة الأجهزة / بدون حل تعارضات).  
**التاريخ:** 2026-11-20  
**البيئة:** محلية معزولة (PGlite + API مضمَّن) — لا commit · لا push · لا إنتاج · لا Supabase.  
**مرجع GAP:** `ERP-GAP-REGISTER.md` — GAP-06 (خريطة 26، M، Go).  
**الديون المرتبطة:** TD-44 (عالي، إثبات GL-10 غير قابل لإعادة الإنتاج) · TD-45 (متوسط، smoke غير idempotent) · **TD-46 (منخفض، مُسجَّل هذه الدورة)**.

---

## 1) الملخص التنفيذي (للمالك)

| البند | النتيجة |
|---|---|
| GAP06-01..09 (التحقق الآلي على بيئة نظيفة 5450/4010) | **10/10 PASS** (01..09 + 10 مُسجَّلة؛ 10 منفذة انحداريًا أدناه) |
| GAP06-02/03/04/05 (تكرار نفس `clientRequestId`) | صف واحد لكل حالة · الاستجابة الثانية **200** مع `duplicate:true` ونفس المعرّف |
| GAP06-06 (مفاتيح مختلفة لنفس البيانات) | **صفان** (التكرار المتعمّد مسموح) |
| GAP06-07 (طابور أوفلاين 3→flush) | **3 صفوف** (لا 6) |
| GAP06-08 (إعادة محاولة بعد مهلة) | **صف واحد**، إعادة المحاولة **200** بنفس المعرّف |
| GAP06-09 (تزامن) | طلبان متزامنان بنفس المفتاح ⇒ **صف واحد**، الحالات **201+200**، `duplicate:true` على 200، **لا 500** |
| GAP06-10 الانحدار B1..B5.4 (قاعدة نظيفة 5452) | **115/115 PASS** (14+15+8+6+16+17+9+24+6) |
| GAP06-10 انحدار GAP-07 core (5453/4013) | **9/9 PASS** |
| GAP06-10 انحدار smoke (5455/4015) | **606/606 PASS** |
| `posting.ts` (ضمن GAP-06) | **0 سطر** تغيير (الفرق `121+/12-` الموجود = **سابق E2/E6/D-17**، لم يُمس) |

---

## 2) النطاق وما لا يشمله

**ضمن النطاق (منفَّذ):** idempotency خادمي لـ `POST /sales/invoices` (كل الأنواع بما فيها type=3)، `POST /purchases/invoices` (نفس مسار الإنشاء)، `POST /accounting/vouchers`، `POST /purchases/receipts`؛ ترحيل مخطط؛ نمط ذري؛ حالات HTTP للتكرار؛ دليل تزامن/طابور/إعادة محاولة؛ انحدارات مطلوبة.  
**خارج النطاق (لم يُنفَّذ):** UI أوفلاين/Service Worker، مؤشرات أوفلاين، حل تعارضات، مزامنة متعددة الأجهزة، فرض `clientRequestId` إلزاميًا NOT NULL (TD-46)، TD-44/TD-45، أي تعديل على `posting.ts`.

---

## 3) GAP06-01 — فحص ما قبل الكود (حرفي مُوثَّق)

**الأمر:** `git grep -rn "clientRequestId\|client_request_id" -- apps/api/src`  
**النتيجة (قبل التنفيذ):** استخدامات فقط في `apps/api/src/modules/inventory/branch-transfer.slice.ts` و`apps/api/src/modules/sales/sales.slice.ts` (فواتير). لا وجود في `vouchers` ولا `purchases/receipts`.

**المخطط/القيود (قبل التنفيذ):**
- `invoices` (`db/schema.postgres.sql:333,340`): `client_request_id varchar(64)` + `UNIQUE INDEX ux_invoices_client_request ON invoices(client_request_id) WHERE client_request_id IS NOT NULL`. فحص/إدراج جزئي موجود في `sales.slice.ts` (SELECT عند وجود المفتاح → `{invoiceId, duplicate:true}`، إدراج `client_request_id`) لكن حالة التكرار كانت **201** (افتراضي POST) وليس **200**، ومعرض لسباق نظري.
- `vouchers` (`db/schema.postgres.sql:909+`, `UNIQUE(branch_id,voucher_no)`): **لا** `client_request_id`، لا فهرس فريد عليه.
- `purchase_receipts` (`db/migrations/2026-11-17-purchases-cycle.sql`, `UNIQUE(branch_id,receipt_no)`): **لا** `client_request_id`، لا فهرس فريد عليه.

**السياسة المعتمدة (قبل الكود):** `null`/`undefined`/سلسلة فارغة بعد `trim()` ⇒ لا مفتاح (إنشاء طبيعي، توافق خلفي). مفتاح غير فارغ ⇒ idempotency خادمي (صف واحد لنفس المفتاح، 200+نفس المعرّف عند التكرار)، تخزين مقصوص، UNIQUE جزئي `WHERE client_request_id IS NOT NULL`، ومعالجة تعارض القيد بإرجاع 200 للمستند الموجود.

**دليل المخطط بعد الترحيل (من GAP06-01 الآلي):**
```json
{
  "invoices": "ux_invoices_client_request",
  "vouchers_col": "client_request_id",
  "vouchers_idx": "ux_vouchers_client_request",
  "pr_col": "client_request_id",
  "pr_idx": "ux_purchase_receipts_client_request"
}
```

---

## 4) الترحيل (Migrations)

| الملف | المحتوى |
|---|---|
| `db/migrations/2026-11-20-gap06-idempotency.sql` | `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS client_request_id varchar(64);` + `CREATE UNIQUE INDEX IF NOT EXISTS ux_vouchers_client_request ON vouchers(client_request_id) WHERE client_request_id IS NOT NULL;` + نفس الشيء لـ `purchase_receipts` (`ux_purchase_receipts_client_request`). آمن لإعادة التشغيل. `invoices` يعتمد على `ux_invoices_client_request` القائم. |

---

## 5) نقاط النهاية المعدّلة + النمط الذري + حالة HTTP

| الهدف | الملف/المسار | ما الذي تغيّر |
|---|---|---|
| الفواتير (بيع/شراء/مرتجع بيع type=3/مرتجع شراء…) | `apps/api/src/modules/sales/sales.slice.ts` — `POST /sales/invoices`, `POST /purchases/invoices` → `SalesService.create` | تطبيع `clientRequestId` (trim أو null)؛ **مسار سريع** قراءة عند وجود المفتاح تُعيد المستند الأصلي `duplicate:true` (لتجاوز تحقق يعتمد على حالة متغيّرة بعد الالتزام، مثل مخزون/رصيد/حد ائتمان)؛ إدراج `client_request_id`؛ **حارس سباق ذري**: التقاط `23505` على `ux_invoices_client_request` داخل/إثر المعاملة → إعادة قراءة المستند وإرجاع `duplicate:true`؛ المتحكمات تُعيد **`res.status(200)`** عند `duplicate` عبر `@Res({ passthrough: true })` (وإلا 201). |
| سندات محاسبية (قبض/صرف) | `apps/api/src/modules/accounting/accounting.slice.ts` — `POST /accounting/vouchers` → `createVoucher` | عمود/فهرس عبر الترحيل؛ تطبيع + مسار سريع قراءة؛ إدراج `client_request_id`؛ التقاط `23505` على `ux_vouchers_client_request` → إعادة قراءة `{voucherId,voucherNo,journalId,duplicate:true}`؛ المتحكم يضبط **200** عند التكرار. |
| محاضر استلام مشتريات (GRN) | `apps/api/src/modules/purchases/purchase-receipt.slice.ts` — `POST /purchases/receipts` → `create` | عمود/فهرس عبر الترحيل؛ تطبيع + مسار سريع قراءة (حاسم: يتجاوز فحص «تجاوز المتبقي من أمر الشراء» الذي يعتمد على `delivered_qty` المتغيّر بعد أول استلام ملتزم)؛ إدراج `client_request_id`؛ التقاط `23505` على `ux_purchase_receipts_client_request` → إعادة قراءة `{receiptId,receiptNo,postingStatus,journalId,duplicate:true}`؛ المتحكم يضبط **200** عند التكرار. |

**النمط الذري:** لا اعتماد وحيد على SELECT-ثم-INSERT. الحارس الحاسم = **UNIQUE (23505) على فهرس `client_request_id`** مع إعادة قراءة خارج/بعد أثر المعاملة وإرجاع 200. أُضيف **مسار سريع قراءة** (مسموح به: «احتياطي لتقليل الرحلات» + ضروري لتجاوز تحقق يعتمد على حالة مُلتزَم بها في إعادة المحاولة بعد نجاح أول طلب)؛ السباق المتزامن يبقى محميًا بـ catch-UNIQUE (201 للفائز، 200 للخاسر بعد التعارض).

---

## 6) نتائج GAP06-01..10 (حرفية)

**بيئة التحقق الأساسي:** PGlite 5450 / DB `postgres` (مُرحَّل + مُبذور) / API 4010 — `tools/verify-gap06.js` (`$env:TEMP\gap06-verify.txt`).  
**تشغيل:** `API_BASE=http://127.0.0.1:4010/api PGHOST=127.0.0.1 PGPORT=5450 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres node tools/verify-gap06.js`

| المعيار | النتيجة | الدليل (فعلي) |
|---|---|---|
| GAP06-01 | **PASS** | الأعمدة/الفهارس موجودة (انظر §3). |
| GAP06-02 | **PASS** | `POST /sales/invoices` type=1، مفتاح واحد مرتين: `{s1:201,s2:200,id1:15,id2:15,dup:true,rows:1}`. |
| GAP06-03 | **PASS** | `POST /sales/invoices` type=3 (مرتجع بيع) مرتين: `{s1:201,s2:200,id1:17,id2:17,dup:true,rows:1}`. |
| GAP06-04 | **PASS** | `POST /accounting/vouchers` مرتين: `{s1:201,s2:200,id1:3,id2:3,dup:true,rows:1}`. |
| GAP06-05 | **PASS** | `POST /purchases/receipts` مرتين (نفس مفتاح، نفس حمولة GRN على أمر شراء مُستهلك جزئيًا بالطلب الأول): `{s1:201,s2:200,id1:4,id2:4,dup:true,rows:1}` — المسار السريع يتجاوز فشل «تجاوز المتبقي». |
| GAP06-06 | **PASS** | مفتاحان مختلفان لنفس بيانات الفاتورة: `{s1:201,s2:201,id1:18,id2:19,rows:2}`. |
| GAP06-07 | **PASS** | طابور أوفلاين مُحاكًى 3 طلبات (3 مفاتيح) → flush: `{statuses:[201,201,201],rows:3,ids:["20","21","22"]}`. |
| GAP06-08 | **PASS** | «انتهاء مهلة» على العميل + إعادة إرسال بنفس المفتاح: `{s1:201,s2:200,id1:23,id2:23,rows:1}`. |
| GAP06-09 | **PASS** | تزامن `Promise.all` (طلبان متزامنان، نفس المفتاح): `{a:{s:201,id:24}, b:{s:200,id:24,dup:true}, rows:1}` ⇒ حالات **201+200**، نفس المعرّف، `duplicate:true` على 200، **لا 500**. |
| GAP06-10 | **PASS** | انحدار منفصل (انظر §7). |

**ملخص السكربت:** `TOTAL: 10 PASS, 0 FAIL, 10 checks`.

---

## 7) GAP06-10 — الانحدار (قواعد نظيفة منفصلة)

| الحزمة | البيئة (معزولة/نظيفة) | النتيجة |
|---|---|---|
| B1 `test:purchases` | DB نظيفة 5452 (migrate+seed) | **14/14 PASS** |
| B2 `test:purchases-invoice` | DB نظيفة 5452 | **15/15 PASS** |
| B3 `test:purchases-match` (API_BASE 4012) | DB 5452 + API 4012 | **8/8 PASS** |
| B4 `test:purchases-statement` (API_BASE 4012) | DB 5452 + API 4012 | **6/6 PASS** |
| B5.1 `test:credit-limit` (API_BASE 4012) | DB 5452 + API 4012 | **16/16 PASS** |
| B5.2 `test:sales-return` (API_BASE 4012) | DB 5452 + API 4012 | **17/17 PASS** (تنظيف اختباري FK متخطًّى من السكربت؛ كل التأكيدات نجحت) |
| B5.3 `test:sales-return-extra` (API_BASE 4012) | DB 5452 + API 4012 | **9/9 PASS** (تنظيف FK متخطًّى) |
| B5.4 `test:sales-credit-note` (API_BASE 4012) | DB 5452 + API 4012 | **24/24 PASS** (تنظيف FK متخطًّى) |
| Integration `test:sales-integration` (API_BASE 4012) | DB 5452 + API 4012 | **6/6 PASS** |
| **مجموع B1..B5.4** | — | **115/115 PASS** |
| GAP-07 core `tools/verify-gap07.js` | DB نظيفة 5453 + API 4013 | **9/9 PASS** (GAP07-01..08 بما فيها round-trip 2/3/6→تعديل→استعادة 2/3/6، TB 350/350، rollback 04a/04b، تدقيق restore_log) |
| Smoke `tools/smoke-test.js` | DB نظيفة 5455 + API 4015 | **606/606 checks passed** |

**ملاحظات الانحدار:** إعادة تشغيل B3/B4/B5.1–B5.4/Integration تمت مع توفير `API_BASE` (بعض هذه السكربتات تجري استدعاءات HTTP). سطور «cleanup skipped: …ledger_entries_invoice_id_fkey» في B5.2/3/4 هي تنظيف بيانات اختبار (teardown) وليست فشل تأكيدات؛ نتائج السكربتات كانت `17/17, 9/9, 24/24` وخرج نهائي نظيف لـ Integration/البقية.

---

## 8) `posting.ts` — تحقق «0 diff ضمن GAP-06»

- `git diff --stat -- apps/api/src/common/posting.ts` ⇒ `133 +++++++++++++++++++++++++++++++++++++----` / `1 file changed, 121 insertions(+), 12 deletions(-)` — **فرق سابق للعمل E2/E6/D-17** (موجود قبل GAP-06 ولم يُعدّل في هذه الشريحة).
- لا أي تعديل في منطق الترحيل/`postJournal` ضمن GAP-06. **الالتزام:** `posting.ts` diff attributable to GAP-06 = **0 سطر**.

---

## 9) TD-46 (مُسجَّل)

**TD-46 — منخفض (قرار منتج/توافق):** «`clientRequestId` should eventually be required on financial mutations.» اليوم يقبل `null/undefined/فارغ` (توافق خلفي؛ GAP-06 يفرض idempotency عند توفر مفتاح غير فارغ). AGENTS.md §11 يشترط المفتاح للعمليات القابلة للإعادة. **v2:** فرض NOT NULL/إلزامية على `invoices`/`vouchers`/`purchase_receipts` (وما يلزم) بعد ترحيل المستدعين (POS web/apps). **لا يُغلق في GAP-06.**  
**مُسجَّل في:** `ERP-GAP-REGISTER.md §4` و`docs/ERP-ACCOUNTING-DECISIONS.md §6`.

---

## 10) الانحرافات والملاحظات

| البند | الملاحظة |
|---|---|
| نمط إعادة المحاولة بعد التزام سابق | أُضيف **مسار سريع قراءة** (قبل منطق يغيّر حالة مُلتزَم بها) إضافةً إلى حارس `23505`؛ هذا **لا يُنشئ سباق SELECT-ثم-INSERT** كحارس وحيد — التعارض المتزامن ما زال يُحسم بـ UNIQUE. ضروري لـ GAP06-05 (استهلاك كميات PO). |
| B5.2/B5.3/B5.4 teardown | تحذير تنظيف FK (`ledger_entries_invoice_id_fkey`) من سكربتات الاختبار؛ **لا** فشل تأكيدات (17/17, 9/9, 24/24). |
| `posting.ts` | diff شجري سابق (121+/12-) — خارج GAP-06. |
| حالة الملفات غير المُودَعة | الشجرة تحتوي تعديلات/ملفات غير مُودَعة سابقة؛ GAP-06 يضيف الترحيل والسكربت والتعديلات المذكورة أعلاه (انظر `git status`). |

---

## 11) الملفات المتأثرة (GAP-06)

**جديد:** `db/migrations/2026-11-20-gap06-idempotency.sql`, `tools/verify-gap06.js`, `GAP06-report.md`  
**معدّل (تنفيذ GAP-06):** `apps/api/src/modules/sales/sales.slice.ts`, `apps/api/src/modules/accounting/accounting.slice.ts`, `apps/api/src/modules/purchases/purchase-receipt.slice.ts`  
**معدّل (سجلات):** `ERP-GAP-REGISTER.md` (§4 TD-44 تصعيد/TD-45+TD-46)، `docs/ERP-ACCOUNTING-DECISIONS.md` (TD-44/TD-45/TD-46)  
**غير مُعدّل ضمن GAP-06:** `apps/api/src/common/posting.ts` (0 سطر GAP-06)

---

## 12) الخلاصة

GAP-06 **PASS** وفق المعايير 01–10: الأعمدة/الفهارس مُثبتة، idempotency ذري (UNIQUE 23505 + مسار سريع آمن لإعادة المحاولة) على الفواتير/السندات/محاضر الاستلام مع **200 + `duplicate:true` + نفس المعرّف** عند التكرار، تزامن **201+200 بلا 500**، وطابور 3→3، وانحدار **B1..B5.4 = 115/115** + **GAP-07 = 9/9** + **smoke = 606/606** على قواعد نظيفة منفصلة. **لا Go لـ GAP-01 قبل اعتبار GAP-06 PASS** (وهذا التقرير يُقدّم أدلة PASS). TD-46 مُسجَّل؛ `posting.ts` بلا تغيير GAP-06.
