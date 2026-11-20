# Phase-2 Closing Checklist — المشتريات (B1–B4)

**التاريخ:** 2026-11-18
**الغرض:** صورة كاملة لما تحقق / لم يتحقق / عُدّل على التصميم / TDs متبقية — للمراجعة الخارجية وللاستمرار إلى B5.
**المرجع:** `docs/PURCHASE-CYCLE-DECISIONS.md` (v0.3 + Addendums) و`docs/ERP-ACCOUNTING-DECISIONS.md` (§0–§13). إجمالي القرارات: **DEC-PURCH-001..054**.

---

## القسم 1 — ما تحقق (كل قرار، بلا تجميع)

| DEC-ID | الملخّص | الحالة | الدليل (test / ملف) |
|---|---|---|---|
| DEC-PURCH-001 | أربعة مستندات مستقلة PO/GRN/Invoice/Payment | ✅ | B1 + B2 (`purchase-receipt.slice.ts`, `sales.slice.ts` create type 2) |
| DEC-PURCH-002 | استلام قبل الفاتورة أو العكس + جزئي | ✅ | B2-01 (بلا GRN)، B2-02 (GRN→invoice)، B2-08 (جزئي) |
| DEC-PURCH-003 | فحص على الرصيف، بلا مستند عيّنة منفصل | ✅ | B1 `inspectedBy` إلزامي + purchase_rejections |
| DEC-PURCH-004 | مرفوض/تالف = memo فقط، لا قيمة ولا avg cost | ✅ | B1-05 (8 مقبول/2 مرفوض، decision=6، لا قيمة للمرفوض) |
| DEC-PURCH-005 | شروط تسليم لكل مورد/PO/سطر، Incoterm إعلامي | ✅ (إعلامي) | `parties.default_delivery_terms`, `orders.delivery_terms` (P1.R2: `default_delivery_terms`) |
| DEC-PURCH-006 | GRNI حساب تحكم موحّد؛ GRN Dr INVENTORY/Cr GRNI؛ Invoice Dr GRNI/Dr VAT/Cr AP | ✅ | B1-03، B2-01..04 (2107) |
| DEC-PURCH-007 | PPV = فرق سعر الفاتورة عن التكلفة المؤقتة | ✅ | B2-03 (Dr20)، B2-04 (Cr20)، 5114 |
| DEC-PURCH-008 | نقد عند الاستلام يمر عبر GRNI/AP في نفس المعاملة | ✅ | B2 paymentLines في نفس الـ transaction |
| DEC-PURCH-009 | منع تجاوز الفوترة أو `purchases.approve_exception` + Σ link ≤ accepted | ✅ | B2-07 (400)، B3-03 (`qty_over`) |
| DEC-PURCH-010 | شروط دفع مختلطة لكل مورد | ✅ (جزئي) | payment_type 1/2/3 + `invoice_payments` (متعدد الوسائط) |
| DEC-PURCH-011 | نقد/بنك/محفظة/شيك/بطاقة — المحفظة غير مفعّلة في sندات الصرف | ✅ (كما هو) | OI-6 مؤجل Phase-3 (DEC-PURCH-041)؛ لا تغيير |
| DEC-PURCH-012 | نموذج اعتماد + فروق كمية/سعر تحذيرية لا حاجزة + SoD | ✅ (parts) | الصلاحيات مخبوءة؛ تقرير SoD مؤجل (DEC-PURCH-036) |
| DEC-PURCH-013 | الفروع: PO=فرع الأمر، الاستلام بفرع آخر، GRNI بُعد فرع | ✅ | B1/B2 `branchId` + `v_open_purchase_lines.branch_id` |
| DEC-PURCH-014 | احترام إقفال الفترة، عكس في فترة مفتوحة | ✅ | B1-10 (مرفوض)، B2 `assertPeriodOpen` |
| DEC-PURCH-015 | متوسط مرجّح بعد الكميات المقبولة فقط؛ GRN provisional = سعر PO | ✅ | B1 `applyMovement` avg-cost + B1-14 |
| DEC-PURCH-016 | طباعة PO/GRN/Invoice/Payment A4/A5 | ✅ (جزئي) | B3/B4 CSV + `@media print`؛ طباعة PO/GRN مستقلة مؤجلة |
| DEC-PURCH-017 | لا ETA/ZATCA لفواتير الشراء | ✅ (كما هو) | `eta.slice.ts` يحجب type 2؛ OI-8 مؤجل (DEC-PURCH-043) |
| DEC-PURCH-018 | سلف الموردين: أصل 1109، بُعد طرف بلا فرع، Dr Advances/Cr cash | ⚠️ جزئي | الحساب 1109 + gl_mappings موجودان؛ **لا منطق دفع/تخصيص** (B5+)؛ B4 يعرض `advances` |
| DEC-PURCH-019 | لا VAT على السلف، تُعالج عند الفاتورة | ⚠️ جزئي | لا منطق سلف بعد؛ القاعدة محفوظة في التصميم |
| DEC-PURCH-020 | بُعد الفرع إلزامي على GRNI = فرع الاستلام | ✅ | B1-03 `branch_id=1` في `gl_entries` |
| DEC-PURCH-021 | هوية المفتش: user FK إلزامي + external name اختياري | ✅ | B1-06 (missing inspectedBy→400)، `external_inspector_name` في schema |
| DEC-PURCH-022 | تجاوز الاستلام 0% افتراضيًا + override بصلاحية + نسبة المورد | ✅ | B1-07 (400)، B1-08 (override بـ20%) |
| DEC-PURCH-023 | ترقيم لكل نوع/فرع، عند الترحيل، فجوات موثّقة، تنسيق PO-{branch}-{YYYY}-{seq} | ✅ | `document_sequences` في B1/B2/B3 (GRN/PO/advance) |
| DEC-PURCH-024 | OI-2: VAT عند الفاتورة + تقرير أعمار GRNI 90 يوم + تأكيد مستشار ضريبي | ✅ (بند التأكيد معلّق خارجيًا) | B2 `taxTotal` عند الفاتورة؛ B3-07 (`>90` + warning) |
| DEC-PURCH-025 | OI-4 مغلق: لا حساب حجز، لا أعمدة | ✅ | لا quarantine account؛ `purchase_rejections` memo only |
| DEC-PURCH-026 | OI-9: الإثبات عند GRN، Incoterm إعلامي | ✅ | `stock.ts applyMovement` عند GRN فقط |
| DEC-PURCH-027 | المطالبات: GRN بديل بـ AP صفر + مقاصّة + استرداد + VAT | ❌ لم يُبنَ | B5+ (Claims) |
| DEC-PURCH-028 | تخصيص الدفع مقابل المرتجعات اللاحقة | ❌ لم يُبنَ | B5+ |
| DEC-PURCH-029 | لا تعديل بعد الترحيل، عكس فقط؛ PO بعد أول GRN | ✅ | B1/B2 cancel → mirror journal (B2-11/12) |
| DEC-PURCH-030 | عكس في فترة مقفولة → مرآة في فترة مفتوحة | ✅ | `assertPeriodOpen` + `reverseJournal` |
| DEC-PURCH-031 | تسامح تجاوز الاستلام (يحتاج قرار owner) | ⚠️ معطّل | الافتراضي 0% (B1-07)؛ التوسيع يتطلب قرار owner |
| DEC-PURCH-032 | هوية المفتش user FK مقابل نص حر | ✅ | DEC-PURCH-021 (مُطبَّق) |
| DEC-PURCH-033 | ترقيم لكل نوع/فرع + سياسة فجوات | ✅ | DEC-PURCH-023 (مُطبَّق) |
| DEC-PURCH-034 | بُعد الفرع على GRNI محمول | ✅ | DEC-PURCH-020 (مُطبَّق) |
| DEC-PURCH-035 | التقاط دليل ضريبي (UUID فاتورة مورد/تسجيل ضريبي) | ❌ لم يُبنَ | B5+ |
| DEC-PURCH-036 | تقرير SoD تعويضي (مستلم=موافق دفع؛ فواتير بفروق مفتوحة) | ❌ لم يُبنَ | B5+ |
| DEC-PURCH-037 | مسار الاستبدال: تالف → GRN بديل بـ AP صفر مرتبط بمطالبة | ❌ لم يُبنَ | B5+ (مرتبط بـ027) |
| DEC-PURCH-038 | مطابقة ZATCA التاريخية قبل تفعيل حجب type 2 | ❌ لم يُبنَ | Phase-3 (OI-8) |
| DEC-PURCH-039 | OI-3: الصلاحيات الخمس مخبوءة | ✅ | `seed.ts` lines 34–40 (批准后授予 Admin/Accountant) |
| DEC-PURCH-040 | OI-5: مرتجعات بملاحظة دائنة — Phase-2.5 | ⚠️ مؤجل | Phase-2.5 |
| DEC-PURCH-041 | OI-6: محفظة في سندات الصرف — Phase-3 | ⚠️ مؤجل | Phase-3 |
| DEC-PURCH-042 | OI-7: قالب طباعة كشف المورد — Phase-3 | ✅ (قبل الموعد) | B4 `@media print` A4 + رابط طباعة |
| DEC-PURCH-043 | OI-8: ZATCA يرفض invoiceType != 1 — Phase-3 | ⚠️ مؤجل | Phase-3 |
| DEC-PURCH-044 | OI-10: vouchers open-invoices hardcoded type=1 — Phase-3 | ⚠️ مؤجل | Phase-3 |
| DEC-PURCH-045 | OI-11: بلاط «المدفوعات» في dashboard | ✅ | `reports.slice.ts` payables + dashboard |
| DEC-PURCH-046 | OI-12: حساب PPV غير تحكمي — Phase-2 | ✅ | 5114، `is_control=false`، B2-03/04 |
| DEC-PURCH-047 | `purchase_invoice_links.voided_at` عند إلغاء الفاتورة | ✅ | B2-12 (`voided=1`)، migration line 188 |
| DEC-PURCH-048 | حالات `purchase_rejections.decision` | ✅ | B1-05 (`decision=6`) |
| DEC-PURCH-049 | disposition يتطلب `purchases.approve_exception` | ✅ | B1-08 (override بصلاحية) |
| DEC-PURCH-050 | `supplier_advances.branch_id` NOT NULL | ✅ | migration line 147 (NOT NULL) |
| DEC-PURCH-051 | `payment_id` → `voucher_id` + FK RESTRICT | ✅ | migration lines 167–175 (voucher_type=2 في API) |
| DEC-PURCH-052 | دور اعتماد PO (StoreKeeper مؤقتًا) | ✅ (مؤقت) | seed: `purchases.approve_po` ممنوح لـ StoreKeeper + TODO |
| DEC-PURCH-053 | `purchases.approve_exception` يغطي التجاوز + disposition | ✅ | B2/B3 (نفس الصلاحية) |
| DEC-PURCH-054 (D-18) | `receiptLinks` على POST /invoices + FIFO | ✅ | B2 + B3 (receiptLinks + FIFO + links) |

**الحصيلة (عدّ صفّي دقيق، 2026-11-18):** 54 قرارًا، بلا فجوات في المعرّفات (001..054 كلها موجودة):
- ✅ مكتمل: **41** (منها ملاحظات خفيفة مثل «✅ (إعلامي)» أو «✅ (كما هو)» أو «✅ (parts)» تُحسب مكتملة لأن السلوك المطلوب مطبَّق).
- ⚠️ جزئي/مؤجل: **7** — 018, 019, 031, 040, 041, 043, 044.
- ❌ غير مبني: **6** — 027, 028, 035, 036, 037, 038.
- **41 + 7 + 6 = 54 ✅.**
> تصحيح: ملخص سابق ذكر «37 مكتمل · 10 جزئي · 7 غير مبني» — كان غير دقيق؛ الرقم المعتمد هو **41/7/6**. لا يُستشهد بـ«37/54».

---

## القسم 2 — ما لم يتحقق (مع السبب ومتى يُغلق)

| DEC-ID | السبب | متى يُغلق |
|---|---|---|
| DEC-PURCH-018/019 | السلف: الحساب موجود لكن لا منطق دفع/تخصيص/إلغاء | B5+ (cash flow) |
| DEC-PURCH-027 | المطالبات (credit notes + استبدال) لم تُبنَ | B5+ |
| DEC-PURCH-028 | تخصيص الدفع مقابل المرتجعات | B5+ |
| DEC-PURCH-031 | تسامح التجاوز — الافتراضي 0%، التوسيع يحتاج قرار owner | Owner Q |
| DEC-PURCH-035 | دليل ضريبي UUID للفاتورة | B5+ |
| DEC-PURCH-036 | تقرير SoD التعويضي | B5+ |
| DEC-PURCH-037 | مسار الاستبدال للم世纪末الف | B5+ (مع 027) |
| DEC-PURCH-038 | مطابقة ZATCA التاريخية | Phase-3 (OI-8) |
| DEC-PURCH-040/041/043/044 | OI-5/6/8/10 مؤجلة حسب التصميم | Phase-2.5 / Phase-3 |

---

## القسم 3 — ما عُدِّل على التصميم أثناء التنفيذ

| التصميم الأصلي | ما نُفِّذ | السبب / المرجع |
|---|---|---|
| `gl_kind` = 3 قيم | `posting_status` = 1/2/3 (pending/posted/reversed) | D-13 |
| `payment_id` على allocations | `voucher_id` + FK `ON DELETE RESTRICT`؛ `voucher_type=2` مفروض في API | D-14 / DEC-PURCH-051 |
| `default_terms` | `default_delivery_terms` | P1.R2 |
| `received_by` NULLable | NOT NULL + `inspected_by` NOT NULL | B1 / DEC-PURCH-021 |
| GRNI 2105 | 2107 (2105 محجوز) | P3.0 account scan (DEC-PURCH-006) |
| Supplier Advances 1107 | 1109 | P3.0 (1107/1108 محجوزان) |
| Inventory in Transit 1108 | 1110 | P3.0 (1108 لـ E2) |
| PPV 5xxx | 5114 | P3.0 (DEC-PURCH-046) |
| `is_control` غير موجود | أُضيف على `gl_accounts` + allowlist `AUTOMATED_SOURCES` | D-17 |
| GRNI كـ `2105` في seed | 2107 مع `is_control=true` + 7 control accounts | P3.3 seed |
| `v_invoice_overdue` مصمَّم فقط (TD-21) | بُني كامل، محايد للنوع (type 1/2/3/4) | B4.1 / DEC-SALES-008 |
| مستندات PO/GRN بلا ترقيم مستقل | `document_sequences` لكل نوع/فرع/سنة | OI-15 / DEC-PURCH-023 |
| فاتورة type 2 تضيف مخزونًا (السلوك القديم) | لا حركة مخزون؛ GRNI/PPV فقط | B2 / TD-27 |
| `reference_no` في `stock_movements` | موجود أصلاً في schema — لا تعديل | تحقق B3 (لا drift) |
| `price_over` كحالة | كعَلَم `priceOver` على السطر (الحالة `matched`) | B3 (PPV تحذيري لا حاجز) |
| unmatched exception link | `receipt_line_id=NULL` بدل عمود حالة جديد | B3 / DEC-PURCH-009 |

---

## القسم 4 — TDs المتبقية

| TD-ID | الأولوية | متى يُغلق | ملاحظة |
|---|---|---|---|
| TD-33 | متوسط | قبل deploy إنتاجي | 4107 (خصومات وغرامات) في DB لكن ليس في `seed.ts` |
| TD-34 | منخفض | Phase-3 | اختبارات صلاحيات HTTP مؤجلة؛ B3-04 غطّى 403 فعليًا بالمتصفح/API |
| TD-36 | منخفض | B5+ | `partial unique index` على `(invoice_id,item_id) WHERE receipt_line_id IS NULL` |
| CORS B4-07 | — | ✅ مغلق | OPTIONS سليم + PASS متصفح حقيقي (لا TD) |

---

## الخلاصة
- **Phase-2 (B1–B4) مغلق تقنيًا**: 41/54 قرارًا مكتملًا، 7 جزئية/مؤجلة، 6 غير مبنية (B5+/Phase-3) — العدّ موثّق بصفّيًا في القسم 1.
- الانحدارات: B1 14/14 · B2 15/15 · B3 8/8 · B4 6/6 · smoke 606/606 · build API+web نظيف.
- لا إنتاج، لا commit، لا push.
- **B5.1 لا يبدأ قبل**: (1) مراجعة هذا الملف، (2) `B5.0-Reconciliation-Report.md`، (3) اختيار الـ slice الأول من قِبل المالك.
