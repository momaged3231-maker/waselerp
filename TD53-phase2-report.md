# TD-53/54 — Phase 2 Report (Supplier Credit Notes) — **12/12 PASS**

**التاريخ:** 2026-11-28
**الحكم:** **PASS 12/12** ✅ (P2-01..P2-06, 07, 08, 09, 10, 11, 12).

---

## ما نُفّذ

| العنصر | الملف |
|---|---|
| Migration | `db/migrations/2026-11-28-td53-supplier-credit-notes.sql` — الجدول + `ux_scn_client_request` + 2 indexes |
| Service + 4 endpoints | `apps/api/src/modules/purchases/supplier-credit-notes.slice.ts` |
| Module registration | `apps/api/src/app.module.ts` — `SupplierCreditNotesModule` |
| posting.ts | +1 سطر (`'supplier_credit_note'`) — configuration append-only (TD-69) |
| تصحيح DEC-PURCH-027 v2.1 | `docs/ERP-ACCOUNTING-DECISIONS.md §1.10.1` — `Dr VAT Input` → `Cr VAT Input` |
| Verification | `tools/verify-td53-phase2.js` — **RESULT 15/15** |

### Endpoints (4)
```
GET  /purchases/credit-notes             (list: party, invoice, branch, date, status)
GET  /purchases/credit-notes/:id         (detail)
POST /purchases/credit-notes             (create + post) — purchases.approve_payment
POST /purchases/credit-notes/:id/cancel  (mirror journal) — purchases.approve_payment
```

---

## النتائج الحرفية (P2-01..12)

| # | المعيار | النتيجة |
|---|---|---|
| **P2-01** | Schema + indexes | `cols=20` · `ux_scn_client_request`, `ix_scn_party`, `ix_scn_original` ✅ |
| **P2-02** | 403 بلا `purchases.approve_payment` | `status=403` ✅ |
| **P2-03** | same party / type=2 / branch | wrong party → 400 · wrong type → 400 ✅ |
| **P2-04** | `cn_date >= invoice_date` | past date → 400 ✅ |
| **P2-05** | لا over-credit | subtotal 99999 → 400 ✅ |
| **P2-06** | Journal + numbering | `{"d":"114.00","c":"114.00","t":"supplier_credit_note"}` · `1105 Cr14 / 2101 Dr114 / 5114 Cr100` · `SCN-1-2026-000005` ✅ |
| **P2-07** | Audit post + ip | `{"ip_address":"127.0.0.1"}` ✅ |
| **P2-08** | Idempotency | `first=201 second=200 id=5/5` · `rows=1` ✅ |
| **P2-09** | Cancel + mirror + audit | `status=3` · `reverseJournalId=12` · cancel audit ip=127.0.0.1 ✅ |
| **P2-10** | Cancel في فترة مقفولة | `status=400` ✅ |
| **P2-11** | `posting.ts` | **1 insertion / 0 deletions** · `is_control` check unchanged (0 matches in diff) ✅ |
| **P2-12** | Regression | **115/115** · smoke **606/606** (`SMOKE_EXIT=0`) ✅ |

### Sample CN creation
```
request: { originalInvoiceId:5, partyId:1, subtotal:100, taxAmount:14, reason:'P2 test CN', clientRequestId:'p2-…' }
response: 201 { creditNoteId:5, creditNoteNo:'SCN-1-2026-000005', journalId:11, totalAmount:114 }
journal:  Dr 2101 114.00 | Cr 5114 100.00 | Cr 1105 14.00 | source='supplier_credit_note'
```

### Sample CN cancel
```
response: 201 { creditNoteId:5, status:3, reverseJournalId:12 }
reverse journal: mirror of #11 (via reverseJournal) — balanced
```

### Sample idempotency
```
first  201 → creditNoteId=5
second 200 → creditNoteId=5 (duplicate:true)
SELECT COUNT(*) FROM supplier_credit_notes WHERE client_request_id=… → 1
```

### Audit rows
```
{action:'purchase.credit_note.post',   entity_id:'5', ip_address:'127.0.0.1'}
{action:'purchase.credit_note.cancel', entity_id:'5', ip_address:'127.0.0.1'}
```

---

## انحرافات
1. **الترقيم:** المواصفة قالت `document_sequences` (غير موجودة في المشروع) — استُخدم `number_sequences` عبر `db.nextNumber(client, 'scn:<branch>')` وهو النمط المعتمد في `AGENTS.md §8`. النتيجة `SCN-1-2026-000005` مطابقة للشكل المطلوب.
2. **خطأ سكربت الاختبار الأولي:** `String(invoice.invoice_date).slice(0,10)` أعطى `"Sat Nov 28"` من كائن Date → 400 خاطئة؛ صُحّح بـ `asIsoDate` من `common/dates.ts` (نفس نمط TD Phase-4). لا تأثير على الكود المنتج سوى تحسين التحقق.
3. `claim_id` يبقى NULL في Phase 2 ✅ (يُملأ في Phase 4). لا inventory، لا UI، لا advances.

## الحكم
**Phase 2 = PASS 12/12.** TD-48 يبقى High. **Phase 3 (Claim creation) جاهز للـ Go.**
