# Ezees → WaselERP Migration Tool (idempotent, trial)

أداة ترحيل تجريبية من استخراج Ezees (CSV) إلى WaselERP (PostgreSQL).  
**الحالة:** قابلة للتشغيل على البيانات المستخرجة المتاحة (`extracted-2026-11-15`) مع **codebook مقترح غير مُعتمد** — يجب اعتماد القرارات محاسبيًا قبل أي ترحيل إنتاجي.

## المتطلبات قبل التنفيذ الإنتاجي (قرارات مفتوحة)
1. **المصدر المعتمد:** هذه النسخة (Feb 2026) أم القاعدة الحية الأحدث؟ (الأداة تقبل أي مجلد استخراج بنفس بنية `_manifest.json` + CSV).
2. **تثبيت codebook نهائي:** تأكيد خرائط `invoice_type`, `payment_type`, `SupCust.SupCust_Type`, `tb_ItemOperations.OP_Type` (الإشارة/المعنى), `Cash.action_type`, `SupCust_Accounts.Description`.
3. **الفواتير التاريخية:** نقل رؤوس فقط (سطر تجميعي) أم قيود/أرصدة افتتاحية فقط.
4. **أساس أرصدة المخزون:** `tb_ItemOperations` بخريطة معتمدة أم `Items_evaluation` أم جرد فعلي.
5. **أساس أرصدة الأطراف:** `SupCust_Accounts` (افتتاحي/صافي) أم تسوية محاسبية.
6. **الوحدات المتعددة والتجميع/BOM:** تحويل Big/Mid/Unit4/5 و`IsGrouped`.
7. **النطاق:** الفروع/المخازن/الصناديق والمستخدمون وكلمات المرور/الأدوار.

راجع التحليل الكامل: `docs/EZEES-BACKUP-ANALYSIS.md` و`tools/migrate-ezees/codebook.proposed.json`.

## ما تنفذه الأداة (حسب الخيارات)
- إنشاء جدول خرائط `ezees_migration_map (source_table, source_id, target_table, target_id, meta, migrated_at)` لضمان **idempotency** (`ON CONFLICT`/تخطي الموجود).
- استيراد بيانات أساسية: الفروع، المخازن، الحسابات النقدية، التصنيفات، الوحدات، الأطراف (عملاء/موردون)، الأصناف (+ وحدة أساس).
- (اختياري/قابل للتفعيل) أرصدة افتتاحية: مخزون من `Items_evaluation` أو مشتق مبسط، أرصدة أطراف افتتاحية من `SupCust_Accounts`، أرصدة خزائن افتتاحية من `Cash` type 0 — **تتطلب مراجعة محاسبية**.
- **لا تنقل أسرار** (`Settings` SMS/SMTP) ولا كلمات مرور المستخدمين.

## الاستخراج من المصدر المعتمد
- هذه الأداة تستهلك CSVs مستخرجة (نفس أعمدة/أسماء ملفات `_manifest.json`). لاستخراج من قاعدة SQL Server معتمدة (حية): نفّذ تصدير CSV لكل الجداول المطلوبة بنفس الأسماء/الرؤوس ثم مرّر المجلد عبر `--source`.
- إن توفرت أداة استخراج المشروع لاحقًا، استخدمها لإنتاج المجلد ثم شغّل الترحيل عليه.

## التشغيل

```bash
# جاف (تحليل + تحقق من الملفات والمفاتيح دون كتابة)
node tools/migrate-ezees/migrate.js --source "D:\New folder (2)\extracted-2026-11-15" --dry-run

# تنفيذ فعلي (يتطلب DB جاهزة ومُهيأة بنفس إعدادات tools/pg)
$env:PGHOST='127.0.0.1'; $env:PGPORT='5432'; $env:PGDATABASE='wasel'; $env:PGUSER='postgres'; $env:PGPASSWORD='postgres'
node tools/migrate-ezees/migrate.js --source "D:\New folder (2)\extracted-2026-11-15" --phases master
node tools/migrate-ezees/migrate.js --source "D:\New folder (2)\extracted-2026-11-15" --phases opening-stock,opening-parties,opening-cash
```

خيارات:
- `--source <dir>`: مجلد الاستخراج (افتراضي: `extracted-2026-11-15` بجوار المستودع أو المسار المطلق).
- `--dry-run`: لا يكتب في DB، يطبع الملخص وما سيُنفذ.
- `--phases a,b,c`: `master` (افتراضي) ، `opening-stock` ، `opening-parties` ، `opening-cash` ، `all`.
- `--codebook <file>`: ملف codebook JSON (افتراضي: `codebook.proposed.json`).
- `--limit N`: حد أعلى للسجلات لكل جدول (للتجربة السريعة).
- `--report <file>`: كتابة تقرير JSON للنتيجة.

## idempotency
- كل سجل يربط بمفتاح `(ezees:<table>, <id>)` في `ezees_migration_map`. إعادة التشغيل تتخطى المُرحّل وتحدّث التقرير بعدد المتخطى.
- يُنصح بالتشغيل على قاعدة اختبار/نسخة أولًا ومقارنة الأعداد والمجاميع والعينات (انظر خطة التحقق في `docs/EZEES-BACKUP-ANALYSIS.md`).

## مخرجات التجربة
- الملخص على stdout + تقرير JSON اختياري: أعداد مقروءة/مُدرجة/متخطاة/أخطاء لكل مرحلة.