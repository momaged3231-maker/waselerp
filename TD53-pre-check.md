# TD-53/54 — Pre-check (Supplier Claims & Allocation — DEC-PURCH-027/028)

**التاريخ:** 2026-11-27 · **لا كود، لا قرارات، لا migrations.** 8 إجابات حرفية (file:line / SQL).

---

## 1) `supplier_claims` table

`db/migrations/2026-11-17-purchases-cycle.sql:121-139`:
```
claim_id bigint PK · party_id int FK parties · receipt_id bigint FK purchase_receipts (NULL)
invoice_id bigint FK invoices (NULL) · branch_id int FK branches · claim_no varchar(40) UNIQUE(branch_id,claim_no)
claim_type smallint DEFAULT 1   -- 1 shortage, 2 damaged, 3 wrong item, 4 price variance, 5 over-shipment, 6 other
claimed_qty numeric NULL · claim_amount numeric(18,2) NOT NULL
status smallint DEFAULT 1       -- 1 open, 2 debit note issued, 3 credit received, 4 replacement, 5 written off, 6 closed
settlement smallint NULL · notes text · created_at
```
**`receipt_id` مربوط** ✅ · `claim_type` not enum (smallint + تعليق) · `status` و`settlement` smallint.

## 2) `purchase_rejections` ↔ `supplier_claims`

- `purchase_rejections` (`migration:103-116`): `line_id FK purchase_receipt_lines` · `rejected_qty` · `reason` · `decision smallint` (1 replace, 2 discount, **3 return+claim**, 4 scrap, 5 pending, 6 default) · `decided_by/at`.
- **لا FK مباشر** من `purchase_rejections` إلى `supplier_claims`. الربط سببي عبر `decision=3` (return+claim) + `receipt_id` في الـ claim. **حدثان مختلفان**: الـ rejection سجل فحص على السطر، والـ claim كيان مالي منفصل.

## 3) claims endpoints — **غير موجودة**

`apps/api/src/modules/purchases/*.ts` endpoints: `purchase-match` (match/exception/GRNI-aging/GRN-variance) · `purchase-receipt` (list/get/create/reverse) · `supplier-statement` (statement).
**لا `POST /purchases/claims` · لا `GET /purchases/claims`.** لا يوجد كود `INSERT INTO supplier_claims` في أي slice — الجدول **موجود لكن غير مستخدم** (مخطط فقط). لا توجد طريقة لإنشاء claim حاليًا.

## 4) `Claim Receivable` account — **غير موجود** (TD-67)

`grep Claim Receivable|claim_receivable` = **0 نتائج** في `apps/api/src` و`db`. شجرة الحسابات (`seed.ts:169-190`) تملك `VAT_INPUT 1105`, `GRNI 2107`, `SUPPLIER_ADVANCES 1109`, `PPV` — لكن **لا Claim Receivable**. يُنشأ في `apps/api/src/cli/seed.ts` (+ gl_mapping `CLAIM_RECEIVABLE`) — TD-67 يُغلق في TD-53/54.

## 5) VAT على claims / CN

- `posting.ts:456`: `vatKey = isSale || isSalesReturn || isCreditNote ? 'VAT_OUTPUT' : 'VAT_INPUT'` — الـ **credit note يستخدم VAT_OUTPUT** (sales CN)، لا عكس VAT Input تلقائيًا.
- `seed.ts:171`: `VAT Input` = `1105` موجود.
- **لا منطق عكس VAT Input عند CN من مورد.** أي CN Supplier يتطلب قيدًا يدويًا عبر `postJournal` — لا يُعكس تلقائيًا. DEC-PURCH-027(v2) مسار (ب) يوجب عكس VAT Input → **يُبنى صراحةً في TD-53/54**.

## 6) Replacement GRN حاليًا

`purchase-receipt.slice.ts` → `POST /purchases/receipts` ينشئ GRN عادي: `Dr INVENTORY / Cr GRNI` (`posting.ts:471,523-532`) بـ `party_id` من الـ PO. **لا يوجد مسار «replacement بـ AP صفر»**، ولا ربط بـ claim (لأن claims غير مستخدمة). DEC-PURCH-027(v2) مسار (أ) `Dr Inventory / Cr Claim Receivable` **جديد بالكامل** — لم يكن موجودًا.

## 7) `supplier_advances` credit من AP سالب

- الجدول `migration:144+` موجود (`party_id`, `branch_id`, `status 1 open / 2 partial`).
- الحساب `1109` + `SUPPLIER_ADVANCES` في seed (`seed.ts:174`).
- **لا كود `INSERT INTO supplier_advances` في أي slice** — يُقرأ فقط في `supplier-statement.slice.ts:101`. لا توجد آلية لتحويل رصيد AP سالب إلى advance حاليًا. DEC-PURCH-028(v2) (`Cr AP / Dr Supplier Advances`) **جديد**.

## 8) audit_log actions

`grep supplier.claim|claim.create|claim.settle` في `apps/api/src` = **0 نتائج**. لا توجد actions للclaims. بعد هجرة TD-52 كل INSERT يمر عبر `logActivity` → ستُضاف `supplier.claim.create` و`supplier.claim.settle` بنفس النمط (ip إلزامي).

---

## خلاصة الحالة (واقع فقط)

| العنصر | الحالة |
|---|---|
| `supplier_claims` table | ✅ موجود (مخطط فقط، بلا استخدام) |
| `purchase_rejections` | ✅ موجود، `decision=3` = return+claim، بلا FK للـ claims |
| claims endpoints | ❌ غير موجودة |
| Claim Receivable account | ❌ غير موجود (TD-67) |
| VAT عكس تلقائي على CN مورد | ❌ غير موجود |
| Replacement GRN بـClaim | ❌ غير موجود |
| AP سالب → Supplier Advance credit | ❌ غير موجود |
| audit actions للclaims | ❌ غير موجودة |

**الاستنتاج:** TD-53/54 يبني **من الصفر** فوق جدول موجود — لا يصلح كودًا قائمًا. الـ6 ❌ في §2 (`027,028,035,036,037,038`) كلها فعلًا غير مبنية. لا عائق بنيوي (الجداول الأساسية + الحسابات موجودة عدا Claim Receivable). `posting.ts` سيستخدم `postJournal` القائم — **لا يُلمس** (حسب التزامك).

**TD-68 (drift) مُجاب:** DEC-PURCH الصحيح = **54** (001..054). §10 كتب 48 قبل Addendum v1.1 (047..051) وv1.2 (052..054) — الفرق 6.
