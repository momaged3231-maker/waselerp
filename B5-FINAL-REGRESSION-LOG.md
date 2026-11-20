# سجل الانحدار النهائي الموحّد — B5.1 / B5.2 / B5.3

**التاريخ:** 2026-11-18
**الغرض:** سجل تشغيل واحد يثبت ترتيب التنفيذ للإغلاق النهائي، دون خلط نتائج التشغيلات القديمة.
**القيد التنفيذي:** لا commit · لا push · لا إنتاج · لا Supabase. PGlite محلي فقط.

---

## ترتيب التنفيذ الفعلي (آخر تشغيل — مصدر كل الأرقام النهائية)

| # | الخطوة | الأمر / الإجراء | النتيجة الحرفية |
|---|---|---|---|
| 1 | إيقاف البيئة السابقة | إيقاف `dist/main.js` و`tools/pg/pglite/server.js` | `stopped …` |
| 2 | قاعدة نظيفة | إعادة تسمية `tools/pg/pglite/data` إلى `data.bak.*` | `data renamed` |
| 3 | تشغيل PGlite | `node tools/pg/pglite/server.js` | `[pglite] listening on 127.0.0.1:5432` |
| 4 | المخطط + كل الهجرات | `DATABASE_URL=…/postgres node tools/pg/migrate-all.js postgres` | `migrations/2026-11-18-b5.4-sales-credit-note.sql ... OK` · `migrations/2026-11-18-e2-branch-transfer.sql ... OK` · `[migrate] all applied` |
| 5 | البذور | `npx ts-node --transpile-only src/cli/seed.ts` | `[seed] done { permissions: 51, roles: 5, users: 1, branches: 1 }` |
| 6 | بذور التعريفات | `node tools/pg/seed-reference.js postgres` | `[seed-ref] done` |
| 7 | تحقق القاعدة | `SELECT …` | `migrations=54 · perms=51 · invoices=0 · acct5115=1 · acct4108=1 · cncol=1` |
| 8 | API | `$env:DATABASE_URL=…/postgres; node dist/main.js` | `WaselERP API listening on http://localhost:4000/api` |
| 9 | B1 | `npm run test:purchases` | `RESULT: 14/14 passed` |
| 10 | B2 | `npm run test:purchases-invoice` | `RESULT: 15/15 passed` |
| 11 | B3 | `npm run test:purchases-match` | `RESULT: 8/8 passed` |
| 12 | B4 | `npm run test:purchases-statement` | `RESULT: 6/6 passed` |
| 13 | B5.1 | `npm run test:credit-limit` | `RESULT: 16/16 passed` |
| 14 | B5.2 | `npm run test:sales-return` | `RESULT: 17/17 passed` |
| 15 | **Smoke** | `node tools/smoke-test.js` | `606/606 checks passed` |
| 16 | B5.3 (بعد التصحيح المحاسبي) | `npm run test:sales-return-extra` | `RESULT: 9/9 passed` — B5.3-06 يثبت `1104=24 5115=24 wrong=0 mv=10@8.0000` |
| 17 | تحقق محاسبي مستقل للهدية | سيناريو مؤقت على القاعدة | `ACC_CHECK2 {"gl1104_delta":24,"movement_ledger_value":24,"subsidiary_value_delta":24, ...}` — ثلاثة أطراف متطابقة |
| 18 | B5.4 | `npm run test:sales-credit-note` | `RESULT: 24/24 passed` — `4108=50 2102=7.5 1103=57.5` · `stock n=0` · `cogs=0` · سقف بلا ضريبة `المتبقي=800/500` · تزامن `statuses=[201,400]` |

---

## لماذا Smoke قبل B5.3؟

مجموعات B5.2 وB5.3 وB5.4 تترك بيانات متبقية (حذف الاختبار النهائي يتخطى بسبب FK `ledger_entries.invoice_id`)؛ لذلك شُغّل الـ smoke **قبل** B5.3/B5.4 على نفس القاعدة النظيفة لضمان أن نتيجة `606/606` غير متأثرة ببيانات هذه الشرائح. كل الخطوات على **نفس** القاعدة التي أُنشئت في الخطوة 2 — لا تشغيل قديم مخلوط.

---

## النتائج النهائية المعتمدة

| المجموعة | النتيجة |
|---|---|
| B1 | 14/14 |
| B2 | 15/15 |
| B3 | 8/8 |
| B4 | 6/6 |
| B5.1 | 16/16 |
| B5.2 | **17/17** (16 معيارًا — 15/15 نتيجة تاريخية قبل B5.2-15/16) |
| B5.3 | **9/9** |
| B5.4 | **24/24** |
| Integration (Paid→CN) | **6/6** (`npm run test:sales-integration`) |
| smoke | **606/606** |

**الحكم: الانحدار النهائي أخضر بالكامل على قاعدة نظيفة واحدة. الشرائح B5.1 وB5.2 وB5.3 وB5.4 مغلقة.**

---

## ملاحظة على أرقام B5.2 في التقارير القديمة
- `15/15` و«15 فحصًا لـ14 معيارًا» كانت نتيجة **قبل** إضافة B5.2-15 (multi-line COGS) وB5.2-16 (VAT).
- النسخة النهائية: **16 معيارًا / 17 فحصًا / 17/17**. لا تُستخدم الأرقام القديمة كنتيجة إغلاق.

## ملاحظة على أرقام B5.1 في التقارير القديمة
- `50 migration` كانت صحيحة **وقت B5.1**، و`52` قبل تصحيح الهدية، و`53` بعده. العدد النهائي المعتمد بعد B5.4 هو **54** (أُضيفت B5.2 وB5.3 و`b5.3-gift-gl` و`b5.4-sales-credit-note`).

## ملاحظة على تشغيلات سابقة (غير معتمدة)
- في تشغيل سابق (52 migration) ظهر `8/9` في B5.3 بسبب تضارب `source_id` بين قيد `reversal` من smoke ورقم الهدية؛ صُحّح فحص الاختبار بتقييد `source_type`.
- في ذلك التشغيل أيضًا ظهر انحراف `+24` في قيمة الهدية المشتقة؛ عولج بقرار المالك وإضافة `Dr 1104 / Cr 5115`. **كلتا النتيجتين من تشغيلات سابقة — لا تُخلط بالسجل النهائي أعلاه.**
