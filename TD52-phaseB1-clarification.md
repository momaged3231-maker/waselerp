# TD-52 Phase B1 — Clarifications

**التاريخ:** 2026-11-27

## 1) `restoreGAP07` — مصدر `sourceIp`

```
restoreGAP07 source: req.ip (via controller) — مصدر محدد:
apps/api/src/modules/backup/backup.slice.ts:454-456
```

السطر الحرفي:
```ts
const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
const ip = forwarded || req.ip || (req.socket as any)?.remoteAddress || null;
return this.service.restoreGAP07(body, user, ip, ip);
```

**الحكم:** **(أ) req.ip** — IP مُنفِّذ الاستعادة الآن (مع تفضيل `X-Forwarded-For` إن وُجد). ليس من حزمة النسخة الاحتياطية، ولا معلّقاً من caller. ✅ مقبول — **TD-64 يُغلق فورًا** (لا إصلاح مطلوب).

> ملاحظة: نفس القيمة `ip` تُمرَّر للمعاملين `sourceIp` (الذي يُكتب في `restore_log.source_ip`) و`ip` (الذي يُكتب في `activity_log.ip_address`) — كلاهما IP مُنفِّذ الاستعادة، وهو الصحيح محاسبيًا.

## 2) `logActivity.branchId: number | null`

- التوسيع أُدخل حصرًا لأن `backup.export/restore/restoreGAP07` تكتب `branch_id = NULL` (كما في INSERT الأصلي قبل الهجرة).
- **القاعدة المعتمدة:** كل استخدام جديد لـ `branchId: null` خارج `backup.*` ← تصعيد في المراجعة. `null` ليس default، هو استثناء موثّق.
- **TD-63** مسجّل (منخفض) لتتبّع هذا التقييد.
