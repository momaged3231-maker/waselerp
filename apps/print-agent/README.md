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
