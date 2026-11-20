# تقرير «إضافة الزمن لكل مستند» — TIME-ROLLOUT

**التاريخ:** 2026-11-18 · **الطلب:** «أي حاجة بتتعمل في تاريخ هنحط ليها زمن كمان» — يبدأ بالفواتير.
**الحالة:** منفّذ ومُتحقَّق منه محليًا (PGlite + API 4000 + web 3000) — **بلا commit / بلا push / بلا إنتاج / بلا Supabase**.

---

## 1) القاعدة المعتمدة (لا تكسر دلالة التاريخ المحاسبي)

| نوع العمود | المعروض | المصدر |
|---|---|---|
| `timestamptz` (invoice_date, cash transaction_date, stock movement move_date …) | تاريخ + ساعة:دقيقة:ثانية | العمود نفسه، معروضًا في منطقة العرض |
| `date` (journal_date, voucher_date, run_date …) | تاريخ العمل + ساعة:دقيقة:ثانية | التاريخ من العمود، والساعة من `created_at` (وقت التسجيل) |
| صفوف قديمة `invoice_date = 00:00:00Z` | تاريخ + ساعة التسجيل | `formatDocumentDateTime` يسقط تلقائيًا إلى `created_at` |

- **لم يُمسّ أي تاريخ محاسبي**: `journal_date` يظل `date` فقط؛ الـ POS يرسل `invoiceDate` (لحظة كاملة) + `businessDate` (`YYYY-MM-DD`) والفترة/القيد تُحسب من `businessDate`.
- تعديل فاتورة بلا تاريخ جديد يعيد استخدام `editedInvoice.invoice_date` بدل «اليوم».

## 2) العيب الحقيقي الذي اكتُشف وأُصلح

`formatCalendarDate` كان يقتطع `YYYY-MM-DD` حرفيًا من قيمة عمود `date`، لكن node-pg يرسل منتصف ليل القاهرة كـ `2026-11-17T22:00:00.000Z` → كان يعرض **17/11** بدل **18/11**.

- **بعد الإصلاح:** القيم اللحظية تُقرأ في منطقة العرض، والقيم `YYYY-MM-DD` النقية تُقرأ حرفيًا.
- **الدليل من الشاشة:** القيد `JV-2026-000009` (`journal_date = 2026-11-17T22:00:00.000Z`) ظهر `١٨‏/١١‏/٢٠٢٦ ٢٢:٤٩:٤٢` — اليوم صحيح والساعة من `created_at`.

## 3) ما شملته الدورة

**API — إضافة `created_at AS "createdAt"`:** الفواتير (قائمة/تفاصيل) · القيود · السندات · حركات الخزينة · إذون الشراء · مسيرات المطابقة البنكية · أذون المخازن.
**API — أعلام دلالة:** كشف حساب المورد `date_has_time` (`true` فواتير/دفعات مقدمة، `false` GRNI).

**الواجهة (عرض `HH:mm:ss`):** الفواتير · القيود · السندات · الخزينة · حركة/عمليات/جرد/تحويل/أذون المخازن · التحويل بين الفروع · المستندات · سجل العمليات + CSV · آخر دخول للمستخدمين · CRM · التذكيرات · المرفقات · الحركات البنكية + CSV · تقرير أذون/حركة المخازن · بحث السيريال · ZATCA · تشغيلات رسوم البنك · كشف المورد · المطابقة البنكية · تذاكر الصيانة · وقت السيرفر · إيصال POS.
**التصدير CSV/XLSX:** `YYYY-MM-DD HH:mm:ss` بأرقام لاتينية عبر `formatStampForExport`.
**وكيل الطباعة:** `التاريخ: 18/11/2026، 22:55:03` — `ar-EG-u-nu-latn` لأن windows-1256 لا يرمّز الأرقام العربية-الهندية (كانت تُطبع `??`).

## 4) الأدلة الحرفية

### 4.1 إنشاء فاتورة بلحظة كاملة (API حي)

```
payload_invoiceDate = 2026-11-18T21:04:58.978Z
payload_businessDate = 2026-11-18
invoice_status = 201
invoice_body = {"invoiceId":75,"invoiceNo":"S-2026-000034",...}
detail_invoiceDate = 2026-11-18T21:04:58.978Z
detail_createdAt = 2026-11-18T21:04:59.028Z
```

### 4.2 القيد الناتج ظل تاريخًا فقط

```
invoice_id = 34 · invoice_no = S-2026-000002
invoice_date = 2026-11-18T21:53:47.000Z
created_at   = 2026-11-18T20:49:42.652Z

journal_id = 34 · journal_no = JV-2026-000009
journal_date = 2026-11-17T22:00:00.000Z   ← منتصف ليل 18 نوفمبر بالقاهرة (DATE)
created_at   = 2026-11-18T20:49:42.652Z
source_type  = invoice · source_id = 34 · status = 2
```

### 4.3 الشاشات (نص مقروء من DOM، بلا أخطاء كونسول)

**`/invoices`:**

| الفاتورة | التاريخ المعروض |
|---|---|
| S-2026-000002 | `١٨‏/١١‏/٢٠٢٦، ٢٣:٥٣:٤٧` |
| S-2026-000034 (الجديدة) | `١٨‏/١١‏/٢٠٢٦، ٢٣:٠٤:٥٨` |
| S-2026-000033 | `١٨‏/١١‏/٢٠٢٦، ٢٣:٠٤:٣٦` |

**`/accounting/journals`:**

| القيد | التاريخ + وقت التسجيل |
|---|---|
| JV-2026-000009 | `١٨‏/١١‏/٢٠٢٦ ٢٢:٤٩:٤٢` |
| JV-2026-000130 | `٣١‏/١٢‏/٢٠٢٦ ٢٣:٠٤:٣٢` |

`console errors = []` على `/invoices` و`/accounting/journals` و`/pos`.

### 4.4 الـ API يغذّي الشاشات بالوقت

```
journal_first = {"journalNo":"JV-2026-000009","journalDate":"2026-11-17T22:00:00.000Z","createdAt":"2026-11-18T20:49:42.652Z"}
invoice_first = {"invoiceNo":"S-2026-000002","invoiceDate":"2026-11-18T21:53:47.000Z","createdAt":"2026-11-18T20:49:42.652Z"}
cash_tx_first = {"transactionDate":"2026-11-18T20:18:24.132Z","createdAt":"2026-11-18T20:18:24.132Z"}
statement_ap_first = {"date":"2026-11-18T21:04:29.485Z","date_has_time":true,...}
run_first = {"runNo":"BR-2026-000001","runDate":"2026-11-17T22:00:00.000Z","createdAt":"2026-11-18T21:04:30.268Z"}
```

> القيم أعلاه سُجّلت **قبل** الإصلاح الجذري في §7؛ `journalDate` صار بعد الإصلاح `"2026-12-31"` نصًا تقويميًا لا لحظة. القيم اللحظية (`invoiceDate`/`createdAt`) بقيت كما هي.

### 4.5 الطباعة

```
التاريخ: 18‏/11‏/2026، 22:55:03
```

## 5) الاختبارات

| الأمر | النتيجة |
|---|---|
| `npm test` — قاعدة معزولة نظيفة (PGlite 5434 + API 4001) | **606/606 checks passed** |
| `npm run test:print` | ناجح — التاريخ بالساعة والثانية |
| `npm run api:build` | ناجح |
| `npm run web:build` | ناجح — 34 مسارًا |

> التشغيل المعتمد للانحدار تم على قاعدة **جديدة** (`tools/pg/pglite/smoke-parser`، 54 migration + seed) حتى لا تتلوث النتيجة ببيانات ديمو سابقة. تشغيل على قاعدة الديمو القديمة توقف عند فحصين بسبب حالة سابقة (مرتب مُرحّل لنفس الشهر + رصيد 1108 متبقٍ من جولات سابقة) وليس بسبب تغيير المحلل.

## 6) الملفات

- `apps/web/lib/time.tsx` (المُنسّقات + `isoCalendarDate`/`isoClock`/`formatStampForExport`/`localTodayIso`)
- `apps/api/src/modules/sales/sales.slice.ts` · `accounting/accounting.slice.ts` · `treasury/treasury.slice.ts` · `parties/parties.slice.ts` · `sales/documents.slice.ts` · `bank-recon/bank-recon.slice.ts` · `purchases/supplier-statement.slice.ts`
- `apps/web/app/{invoices,pos,treasury,documents,crm,reminders,maintenance}/page.tsx` · `app/accounting/{journals,vouchers,bank-recon,bank-expenses}/page.tsx`
- `apps/web/components/screens/{VouchersReportScreen,BankTransactionsScreen,BranchTransferScreen,InventoryScreen,SerialSearchScreen,ServerSettingsScreen,StockCountScreen,StockReportScreen,StockTransferScreen,StockVoucherScreen,UsersSettingsScreen,ZatcaSettingsScreen,AuditScreen}.tsx`
- `apps/print-agent/server.js`

**لم يُنفَّذ:** أي تغيير على دلالة التواريخ المحاسبية · أي commit/push/نشر.

---

## 7) الإصلاح الجذري لأعمدة `date` (شرط المالك 2)

### العيب

`node-pg` كان يحوّل أي عمود `date` إلى `Date` عند **منتصف ليل المنطقة الزمنية للسيرفر**، ثم يُسلسله JSON كلحظة (`2026-11-17T22:00:00.000Z` لـ 18 نوفمبر بالقاهرة). أي عميل في منطقة مختلفة — أو أي كود يقتطع `YYYY-MM-DD` من اللحظة (UTC) — يعرض **يومًا خطأ**. المشكلة لم تكن في الفواتير فقط: كل عمود `date` في النظام كان معرّضًا لها.

### التغيير

`apps/api/src/common/database/database.service.ts`:

```ts
types.setTypeParser(20, (value: string) => Number(value));   // bigint (قائم)

// date يبقى تقويمًا (`YYYY-MM-DD`) — لا يُحوَّل للحظة
types.setTypeParser(1082, (value: string) => value);
```

### الدليل من الـ API بعد إعادة البناء والتشغيل (4000)

```
GET /accounting/journals
journalDate = "2026-12-31"                    ← DATE نصًا تقويميًا
createdAt   = "2026-11-18T21:04:32.991Z"      ← timestamptz لحظة كاملة

GET /accounting/vouchers
voucherDate = "2026-11-18" · createdAt = "2026-11-18T21:04:18.924Z"

GET /installments/due
dueDate = "2026-03-15"

GET /accounting/periods
startDate = "2026-09-01" · endDate = "2026-09-30"

GET /sales/invoices
invoiceDate = "2026-11-18T21:53:47.000Z" · createdAt = "2026-11-18T20:49:42.652Z"
```

`invoice_date` عمود `timestamptz` فبقي لحظة كاملة — **دلالة التاريخ المحاسبي لم تتغير**، والفصل بين النوعين صار صريحًا في الحمولة نفسها.

### الشاشات بعد الإصلاح (نص DOM)

| الشاشة | الصف | المعروض |
|---|---|---|
| `/invoices` | S-2026-000059 (أُنشئت 2026-11-18T22:32:03Z) | `١٩‏/١١‏/٢٠٢٦، ٠٠:٣٢:٠٣` — لحظة القاهرة، صحيحة |
| `/accounting/journals` | JV-2026-000173 (`journal_date = 2026-12-31`) | `٣١‏/١٢‏/٢٠٢٦ ٠٠:٣٢:٠٠` — التاريخ حرفي والساعة من `created_at` |
| `/hr` (الحضور) | `workDate = 2026-11-17` | `١٧‏/١١‏/٢٠٢٦` — بلا انزياح يوم |

`console errors = []` في الثلاثة.

---

## 8) تدقيق `invoice_date > created_at` (شرط المالك 1)

### الاستعلام

```sql
select 'invoices' as tbl, count(*)::int as total,
       count(*) filter (where invoice_date > created_at + interval '5 minutes')::int as ahead
  from invoices
union all select 'cash_transactions', count(*)::int,
       count(*) filter (where transaction_date > created_at + interval '5 minutes')::int
  from cash_transactions
union all select 'stock_movements', count(*)::int,
       count(*) filter (where move_date > created_at + interval '5 minutes')::int
  from stock_movements
union all select 'stock_operations', count(*)::int,
       count(*) filter (where operation_date > created_at + interval '5 minutes')::int
  from stock_operations;
```

### النتيجة — قاعدة الديمو (5432)، بعد تشغيل الانحدار (78 فاتورة)

| الجدول | الإجمالي | `> created_at + 5m` |
|---|---|---|
| invoices | 78 | **1** |
| cash_transactions | 50 | 0 |
| stock_movements | 118 | 0 |
| stock_operations | 2 | 0 |

الصف الشاذ الوحيد:

```
invoice_no   = S-2026-000002
invoice_date = 2026-11-18T21:53:47.000Z
created_at   = 2026-11-18T20:49:42.652Z
lead         = 1h 4m 4.348s
```

هذه **فاتورة الإثبات الاصطناعية** المذكورة في §4.2: أُنشئت ببند زمني مكتوب يدويًا (`21:53:47Z`) قبل تعديل `created_at` في نفس الاختبار — ليست ناتجة عن ساعة POS. بعد إضافة 30 فاتورة جديدة في تشغيل الانحدار بقيت **واحدة فقط** شاذة، أي أن المسار الطبيعي لا يسبق وقت التسجيل.

### النتيجة — القاعدة المعزولة النظيفة (5434) بعد 606/606

| الجدول | الإجمالي | `> created_at + 5m` |
|---|---|---|
| invoices | 38 | **0** |
| cash_transactions | 27 | 0 |
| stock_movements | 59 | 0 |
| stock_operations | 1 | 0 |

```
outliers = []
max(invoice_date - created_at) = 0
```

**الحكم:** لا يوجد عيب فرق ساعة في مسار البيع. المسار الطبيعي `invoiceTimestamp()` يجمع تاريخ العمل المختار مع ساعة الجهاز الحالية، فيكون `invoice_date ≈ created_at` (فرق 49.6ms في فاتورة الإثبات S-2026-000034: `21:04:58.978Z` مقابل `21:04:59.028Z`). البند مغلق: **بيانات اختبار اصطناعية، وليست انحراف ساعة** — والفحص أصبح قابلًا لإعادة التنفيذ في أي وقت بالأمر أعلاه.

---

## 9) تدقيق استخدام دوال عرض التاريخ (شرط المالك 2)

### `formatCalendarDate`

| الموضع | الاستخدام |
|---|---|
| `apps/web/lib/time.tsx` | التعريف |
| `apps/web/lib/time.tsx` → `formatDateWithRecordedTime` | **المستهلك الوحيد** لعمود `date` + ساعة التسجيل |
| `apps/web/app/purchases/supplier-statement/page.tsx` | كشف المورد (يستخدمها مباشرة) |

لا توجد نسخة قديمة أخرى من الدالة في المشروع (بحث `formatCalendarDate` = 4 نتائج: تعريف + استدعاء داخلي + استيراد + استدعاء).

### `formatDate` / `formatDateOnly`

- `formatDate` صار له فرعان: قيمة `YYYY-MM-DD` نقية → تُنسَّق حرفيًا بـ UTC (لا انزياح)، ولحظة كاملة → تُنسَّق في `timeZone` أو منطقة الجهاز.
- `formatDateOnly` لم يبقَ له منطق خاص — **يُفوّض** إلى `formatDate` (مصدر واحد).
- 12 موضعًا يستخدمون `formatDate(...)` مباشرة (التقسيط، الموارد البشرية، المطابقة البنكية، تقرير الصلاحية…) كلها تستفيد من الفرع الحرفي تلقائيًا.

### الشاشات التي تقتطع `.slice(0, 10)` من قيمة تاريخ

`hr` (workDate/hireDate) · `accounting/periods` (start/end) · `maintenance` (expectedDelivery) · `accounting/bank-expenses` (periodKey) · `accounting/assets` (disposalDate إدخال) · `stock-count` / `stock-transfer` / `stock-voucher` · `checks` / `securities` (dueDate) · `expiry` · `audit` (اسم ملف) — كلها كانت ستقتطع اليوم من لحظة UTC؛ الآن تستقبل `YYYY-MM-DD` نصًا فتصبح العملية آمنة بلا تعديل كل شاشة.

### دليل الشاشة

`/hr` → الحضور: الصف `workDate = 2026-11-17` ظهر `١٧‏/١١‏/٢٠٢٦` (المنطقة المعروضة `Africa/Cairo`)، بلا خطأ كونسول.

### ملاحظة غير حاجزة

`AttachmentsPanel` يعرض `created_at` (لحظة، وليس عمود `date`) بمنطقة الجهاز بدل `DisplayTimezone`؛ لا يمسّ دلالة التاريخ، ويمكن توحيده لاحقًا إن طُلب.

---

## 10) دليل الكونسول الحرفي (طلب المالك: «أول 3 أسطر» بدل الوصف)

**طريقة القياس:** فتح الصفحة في المتصفح → الانتظار حتى ظهور نص الصف الفعلي (وليس عنوان الصفحة) → قراءة console بمستوى `debug` وبحد 500 رسالة → قراءة أول نداءات `/api/` مع حالتها.

**النتيجة الحرفية:** لا توجد «3 أسطر» لأن الكونسول **فارغ تمامًا** — `messages = 0` في الصفحات الثلاث (وليس فقط صفر أخطاء):

```
/invoices              console messages = 0   (level=debug, limit=500)
/accounting/journals   console messages = 0   (level=debug, limit=500)
/hr                    console messages = 0   (level=debug, limit=500)
```

**بديل حرفي عن الأسطر (نداءات الشبكة + النص المعروض):**

| الصفحة | أول 3 نداءات API | استجابات ≥300 | النص المقروء من DOM | قيمة القاعدة |
|---|---|---|---|---|
| `/invoices` | `GET /api/settings/features` **200** · `GET /api/settings/time-display` **200** · `GET /api/sales/invoices?type=1&pageSize=100` **200** | 0 | `S-2026-000059  مبيعات  ١٩‏/١١‏/٢٠٢٦، ٠٠:٣٢:٠٣  عميل نقدي  الفرع الرئيسي  ١٠٥٫٠٠ ج.م` | `invoice_date = created_at = 2026-11-18 22:32:03.128+00` |
| `/accounting/journals` | `GET /api/settings/features` **200** · `GET /api/settings/time-display` **200** · `GET /api/accounting/journals?limit=200` **200** | 0 | `JV-2026-000173  ٣١‏/١٢‏/٢٠٢٦ ٠٠:٣٢:٠٠  إقفال  قيد إقفال السنة 2026  ٦٢٬٢٨٤٫٣٩ ج.م  مرحّل` | `journal_date = 2026-12-31` (date) · `created_at = 2026-11-18 22:32:00.175+00` |
| `/hr` (تبويب الحضور والانصراف) | `GET /api/settings/features` **200** · `GET /api/hr/departments` **200** · `GET /api/hr/components` **200** | 0 | `أمين مخزن الجرد  ١٧‏/١١‏/٢٠٢٦  —  —  حاضر  0  0` | `work_date = 2026-11-17` (date) |

الدلالة: `١٩/١١/٢٠٢٦ ٠٠:٣٢` = `2026-11-18 22:32Z` في `Africa/Cairo` (UTC+2) — أي أن التحويل يستخدم `DisplayTimezone` فعلًا؛ و`JV-2026-000173` يعرض **تاريخ العمل ٣١/١٢** مع **ساعة التسجيل ٠٠:٣٢** (فصل الدلالات محفوظ)؛ و`/hr` يعرض عمود `date` **بلا ساعة** إطلاقًا.

---

## 11) تصنيف «القيود داخل فترات مقفولة» (بند مفتوح من مسح سلامة GL)

المسح أعطى 9 قيود تاريخها يقع داخل فترة `is_closed = true`. السؤال: هل هي ترحيل لاحق للإقفال (backposting) — وهو عيب — أم مستندات سابقة للإقفال + قيود الإقفال/العكس نفسها؟

**الاستعلام:**

```sql
select j.journal_no, j.journal_date::text as jd, j.source_type,
       p.name as period, j.created_at::text as journal_created_at,
       p.closed_at::text as period_closed_at,
       (j.created_at > p.closed_at) as posted_after_close
from gl_journals j
join periods p on j.journal_date between p.start_date and p.end_date
where p.is_closed = true
order by j.journal_id;
```

**النتيجة (القاعدة المعزولة 5434 — 140 قيدًا):**

| القيد | التاريخ | المصدر | created_at | closed_at | بعد الإقفال؟ |
|---|---|---|---|---|---|
| JV-2026-000130 | 2026-05-15 | invoice | 22:35:44.894 | 22:35:45.035 | لا |
| JV-2026-000131 | 2026-05-31 | period_close (قيد الإقفال) | 22:35:45.035 | 22:35:45.035 | لا |
| JV-2026-000132 | 2026-08-15 | bank_expense | 22:35:45.262 | 22:35:45.953 | لا |
| JV-2026-000133 | 2026-08-01 | fixed_asset | 22:35:45.292 | 22:35:45.953 | لا |
| JV-2026-000134 | 2026-08-31 | asset_depreciation | 22:35:45.325 | 22:35:45.953 | لا |
| JV-2026-000135 | 2026-08-10 | invoice | 22:35:45.359 | 22:35:45.953 | لا |
| JV-2026-000136 | 2026-08-31 | period_close | 22:35:45.514 | 22:35:45.953 | لا |
| JV-2026-000137 | 2026-08-31 | reversal (عكس الإقفال) | 22:35:45.842 | 22:35:45.953 | لا |
| JV-2026-000138 | 2026-08-31 | period_close (إعادة الإقفال) | 22:35:45.953 | 22:35:45.953 | لا |

**فحص الحسم:**

```sql
select count(*)::int as backposted_after_close
from gl_journals j
join periods p on j.journal_date between p.start_date and p.end_date
where p.is_closed = true and p.closed_at is not null and j.created_at > p.closed_at;
-- [ { "backposted_after_close": 0 } ]
```

**الحكم:** `PASS` — **صفر ترحيل بعد الإقفال**. التسعة كلها (أ) مستندات رُحّلت قبل الإقفال ثم أُقفلت الفترة بعدها، أو (ب) قيد الإقفال/عكسه/إعادة الإقفال نفسه الواقع في آخر يوم من الفترة. هذا هو السلوك الصحيح: إقفال الفترة لا يُخرج مستنداتها، والفحص الصحيح ليس «هل القيد داخل فترة مقفولة؟» بل «هل أُنشئ بعد `closed_at`؟» — والجواب صفر.

---

## 12) اختبار الطباعة بعد إصلاح parser

```
> node tools/print-agent-test.js
health: {"ok":true,"agent":"wasel-print-agent","version":"1.0.0","port":4100}
print: 200 {"ok":true,"bytes":987,"copies":1}
hidden receipt omits totals + party: true
kitchen-ticket: 200 {"ok":true,"bytes":511,"copies":1}
kitchen ticket built (no prices): true
bytes: 987
has ESC @ (init): true
has GS v 0 (cut): true
التاريخ: 19‏/11‏/2026، 00:40:11
exit=0
```

إصلاح `types.setTypeParser(1082)` لا يمسّ مسار الطباعة (الوكيل يستقبل `invoiceDate` كلحظة ISO كاملة)، والنتيجة تؤكد ذلك: 4 تأكيدات صحيحة و`exit=0`، وسطر التاريخ في الإيصال مطبوع بالثانية.

