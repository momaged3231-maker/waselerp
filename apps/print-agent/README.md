# وكيل الطباعة — Wasel Print Agent

خدمة محلية تشتغل على **جهاز الكاشير** عشان تتحكم في طابعة الفواتير الحرارية (ESC/POS) ودرج الكاشير — المتصفح لوحده مش يقدر يعمل ده.

## التشغيل

```powershell
cd apps\print-agent
npm install
$env:WASEL_AGENT_TOKEN = 'ضع-كلمة-سر-قوية'   # كلمة سر الوكيل
node server.js
```

بيشتغل على `http://127.0.0.1:4100` (loopback فقط — مش مكشوف على الشبكة).

## التثبيت كخدمة Windows (تشغيل تلقائي)

بدل ما تفتح تيرمنال كل يوم، سجّل الوكيل كـ **Scheduled Task** بيشتغل مع الويندوز ويعيد التشغيل نفسه لو وقع:

```powershell
# PowerShell كـ Administrator
cd apps\print-agent
.\install-service.ps1 -Token "ضع-كلمة-سر-قوية" -DefaultPrinter "POS-80C"
```

- الأمر بيكتب `agent.env` (التوكن + المنفذ) ويسجّل مهمة اسمها `WaselPrintAgent` تشتغل كـ `SYSTEM` عند بدء التشغيل.
- لو عايزها تشتغل بحساب كاشير معيّن (مفيد لو الطابعة شبكة أو محتاج بروفايل المستخدم):
  `.\install-service.ps1 -Token "..." -User "SERVER-PC\cashier"` (تشتغل عند تسجيل دخول هذا المستخدم).
- السجلات في `apps\print-agent\agent.log`، واللانشر بيحاول كل 5 ثوانٍ لو العملية خرجت.
- إلغاء التثبيت: `.\install-service.ps1 -Uninstall`.
- بعد التثبيت لازم تعيد بناء الويب بالتوكن:
  ```powershell
  # apps/web/.env.local
  NEXT_PUBLIC_AGENT_BASE=http://127.0.0.1:4100
  NEXT_PUBLIC_AGENT_TOKEN=نفس-التوكن
  npm run web:build
  ```
- الحالة: `Invoke-RestMethod http://127.0.0.1:4100/health` — وللتحقق من المهمة: `Get-ScheduledTaskInfo WaselPrintAgent`.

### ملاحظة مهمة عن الطابعات المشتركة (SMB)

المهمة الافتراضية بتشتغل بحساب `SYSTEM` (من غير كلمة سر — مناسبة للطابعات المحلية USB). الطابعات المشتركة عبر الشبكة زي `\\SERVER-PC\EPSON TM-T20II` بترجع **Win32 error 5 (Access denied)** لأن `SYSTEM` مش عنده بيانات اعتماد للسيرفر. الحلول:

1. **المفضّل**: استخدم طباعة TCP مباشرة — أضف الطابعة في `agent-config.json`:
   ```jsonc
   { "networkPrinters": [{ "type": "network", "name": "EPSON", "host": "192.168.1.50", "port": 9100 }] }
   ```
   وابعت `printer: { "type": "network", "name": "EPSON" }` في الطلب (الوكيل بيتصل TCP 9100 مباشرة من غير أي مشاركة ويندوز).
2. أو ثبّت المهمة بحساب المستخدم: `.\install-service.ps1 -Token "..." -User "SERVER-PC\cashier"` مع التأكد إن الحساب عامل اتصال دائم للمشاركة (`net use \\SERVER-PC\EPSON /persistent:yes`).
3. أو استخدم طابعة محلية USB على جهاز الكاشير نفسه.

## ربطه بالبرنامج (من كاشير آخر)


الويب بيبعت للوكيل على `http://127.0.0.1:4100`، فالمتصفح لازم يكون **على نفس جهاز الكاشير** (أو استخدم وكيل على كل جهاز). لو الوكيل مش موجود، البرنامج بي fallback لطباعة المتصفح.

لتعيين عنوان مختلف (مثلاً وكيل على السيرفر):
```bash
NEXT_PUBLIC_AGENT_BASE=http://127.0.0.1:4100
NEXT_PUBLIC_AGENT_TOKEN=نفس-الكلمة
```

## الـ API

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/health` | حالة الوكيل (لا يحتاج توكن) |
| GET | `/printers` | الطابعات المتاحة (Windows + الشبكة) |
| GET/POST | `/config` | إعداد الطابعة الافتراضية والشبكة |
| POST | `/print` | طباعة فاتورة (بنيت ESC/POS) |
| POST | `/kitchen-ticket` | طباعة تذكرة مطبخ (بدون أسعار) |
| POST | `/open-drawer` | فتح درج الكاشير (نبضة ESC/POS) |

كل الطلبات (عدا `/health`) تحتاج هيدر `x-agent-token`.

### إعداد الطابعة

```jsonc
// POST /config
{
  "defaultPrinter": "EPSON TM-T20",      // طابعة Windows بالاسم
  "autoOpenDrawer": true,                 // فتح الدرج بعد كل إيصال
  "paperWidth": 42,                       // 42 حرف (80mm) أو 32 (58mm)
  "networkPrinters": [
    { "type": "network", "name": "المخزن", "host": "192.168.1.50", "port": 9100 }
  ]
}
```

## العربية

الطابعات الحرارية الرخيصة (Xprinter / Epson) مش بتدعم Arabic Unicode، فالكيل بيموّل النص بـ **Windows-1256** (أبسط ترميز عربي متوافق مع أغلب الطابعات) — وده اللي بيشتغل في المحلات المصرية فعليًا. لو طابعتك بتدعم Unicode مباشرة، غيّر `encodeText` في `server.js` لـ `Buffer.from(text, 'utf8')`.

## مقاسات الورق: حراري 80/58 مم مقابل A4/A5

الوكيل بيطبع **ESC/POS** فقط — مناسب للطابعات الحرارية (80mm/58mm) وتذاكر المطبخ. **مينفعش تبعت ESC/POS لطابعة ليزر A4** (هتطبع رموز غريبة).

- إيصال حراري: من الإعدادات ← `ReceiptPaperSize = thermal80` (42 حرف) أو `thermal58` (32 حرف). الوكيل بياخد العرض من `paperWidth` في `agent-config.json` أو من `width` في الطلب.
- فاتورة A4/A5: من الإعدادات اختار `A4` أو `A5` → الواجهة تستخدم **طباعة المتصفح** مع `@page` (هوية الشركة + الشعار + الجدول الكامل)، مش الوكيل. سيب الطابعة الليزر كطابعة افتراضية في الويندوز.
- تذكرة المطبخ الحرارية: `POST /kitchen-ticket` مع `printer` أو `KitchenPrinterName` من إعدادات النظام.

## اختبار ميداني على طابعات حقيقية (2026-11-14)

تم اختبار الوكيل فعليًا على الجهاز:

| الطابعة | النوع | النتيجة |
|---|---|---|
| `POS-80C` | حرارية USB (Xprinter-compatible) | ✅ job اتسلّم للـ spooler وطُبع الإيصال |
| `\\SERVER-PC\EPSON TM-T20II Receipt` | Epson حرارية مشتركة | ✅ job اتسلّم للـ spooler وطُبع الإيصال |
| `EPSON L3210 Series` | A4 inkjet | تُستخدم عبر طباعة المتصفح (A4/A5) |

> ملاحظة: إصلاح مهم في `printer.ps1` — `StartDocPrinter` كان بيتمرّر له `pDocInfo = NULL` فيفشل بـ `StartDocPrinter failed`. دلوقتي بيتبني `DOC_INFO_1` بـ `pDatatype = 'RAW'` ورسائل الخطأ بتوضّح Win32 error code.

## اختبار بدون طابعة

```powershell
node tools\print-agent-test.js
```
بيكتب الـ ESC/POS في ملف `receipt-test.bin` وبيطبع الـ hex أول البايتات + النص مفكوك — للتأكد إن التوليد سليم من غير ما يكون عندك طابعة.

## ملاحظات

- الطباعة على طابعة Windows تتم عن طريق `winspool.drv` (P/Invoke داخل `printer.ps1`).
- الطابعات الشبكية (TCP 9100) بُعت لها raw مباشرة.
- `autoOpenDrawer` بيفتح الدرج بعد الطباعة (ESC `p`).
- لو الطابعة Windows مش موجودة باسمها، استخدم `/printers` عشان تشوف الأسماء المتاحة.
