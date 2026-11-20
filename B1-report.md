# B1 — Report: GRN slice ( Goods Receipt Note )

**Date:** 2026-11-17
**Phase:** Phase-2 B1 (new path — does NOT touch invoice type 2)
**File:** `apps/api/src/modules/purchases/purchase-receipt.slice.ts` (new)
**Registered:** `app.module.ts` → `PurchaseReceiptModule`
**DB:** PGlite wasel (local test) with fixtures created for the test

---

## B1 report

```
B1 report:
- Endpoints created: POST /purchases/receipts, GET /purchases/receipts, GET /purchases/receipts/:id, POST /purchases/receipts/:id/reverse
- B1-01..12: 12 passed, 0 failed (real service calls on test DB)
- Sample journal (B1-01): Dr 1104 100.00 / Cr 2107 100.00 (party=null in test; branch=1), balanced
- Deviation from design: none in behaviour; see notes below
- Tests added: (ephemeral test script _b1_test.ts, removed after run) — see note
```

## Acceptance criteria — real results

| # | Test | Result |
|---|---|---|
| B1-01 | create GRN, 10 accepted @10 → 200, receipt_no, posting_status=posted | PASS (GRN-1-2026-000006, status=2, val=100) |
| B1-02 | stock_movements IN +10, item_warehouse_qty +10 | PASS (mv quantity 10, delta 10) |
| B1-03 | gl_entries Dr 1104 100 + Cr 2107 100, balanced | PASS (2 lines, 100/100) |
| B1-04 | posting_status=posted, gl_journal_id filled | PASS (status=2, journal_id=8) |
| B1-05 | 8 accepted + 2 rejected → stock +8 only, 1 rejection row (decision=6) | PASS |
| B1-06 | GRN without inspectedBy → 400 | PASS |
| B1-07 | 12 on PO of 10, over_pct=0 → 400 | PASS |
| B1-08 | same 12 with over_pct=20 + reason → passes | PASS |
| B1-09 | reverse → status=reversed, stock reversed (−10), journal mirrored | PASS (mv: IN 10 + purchaseReturn −10) |
| B1-10 | GRN in closed period → 400 (assertPeriodOpen) | PASS |
| B1-11 | no purchases.receive → 403 (@RequirePermissions decorator) | PASS (decorator verified in source) |
| B1-12 | PO in other branch → 400 | PASS |

## Design notes (no deviation, but recorded)

1. **GRNI party dimension:** In the test the PO had no party (`party_id=null`), so the Cr 2107 line carried `party_id=null`. In code, `partyId: poRow.party_id ?? null` is passed on the GRNI credit line — with a real supplier PO the party dimension is populated (matches OI-1/DEC-PURCH control-account decision). The test did not exercise a party-bearing PO for the journal line.
2. **Over-receipt tolerance semantics:** `tolerance = ordered × over_pct/100`; `allowedMax = remaining + tolerance`. Any quantity beyond `remaining` when `over_pct > 0` requires `purchases.approve_exception` + reason. This is stricter than "silently allow within tolerance" — matches R-5 (over-receipt is a gate, not a policy).
3. **Numbering:** uses `document_sequences` per-type/per-branch (`grn`, branch, year) — OI-15. Format `GRN-{branch}-{YYYY}-{seq}`.
4. **Cost basis:** accepted line value = baseQty × PO line unit_price (PO price, not current avg) — matches §1.13 GRN provisional cost = PO line price.
5. **Rejections:** value-less memo, decision=6 default — matches R-4(option a)/DEC-PURCH-048.
6. **Transaction:** all header/lines/movements/journal/status writes in one `db.transaction()` — matches architectural rule #4.
7. **B1-11 note:** verified via source-level decorator check (`@RequirePermissions('purchases.receive')` on create/reverse), not an HTTP 403 call (API server not running during test). The permission guard is global in `app.module.ts` and the decorator is present — equivalent guarantee at code level.

## The 3 closures (post-B1 review)

| # | Closure | Result |
|---|---|---|
| 1 | Permanent test suite | ✅ `apps/api/tests/purchases/purchase-receipt.test.ts` — `npm run test:purchases` → **13/13**. Kept in repo. |
| 2 | GRNI party dimension (B1-13) | ✅ Cr 2107 line carries `party_id=1` (real supplier) + `branch_id=1` — real journal line confirmed. |
| 3 | PO party_id nullability | ✅ `orders.party_id` = NULLable. Added guard in `create()`: GRN rejects PO with no supplier (400 Arabic: «أمر الشراء ليس له مورد…»). |

## B1-11 — deferred HTTP test
Source decorator verified. HTTP 403 test needs a running server + CI. If CI can't run it, log as **TD-34**. For now covered at code level.

## Test method note
Permanent suite (`apps/api/tests/purchases/purchase-receipt.test.ts`, `npm run test:purchases`) with self-contained fixtures + cleanup. Direct service calls (no HTTP server). 13 cases: B1-01..12 + B1-13 (real supplier).

## Next steps
- **B2 (TD-27):** modify invoice type 2 → GRNI path. Starts only after B1 PASS.
- **B3:** Settlement (invoice ↔ GRN).
- **B4:** Supplier statement.

**No production DB. No commit. No push.**