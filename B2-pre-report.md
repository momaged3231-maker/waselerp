# B2-pre-report — Tests that assume the OLD `invoice type 2` behaviour

**Date:** 2026-11-17
**Phase:** Phase-2 B2 (TD-27 — invoice type 2 → GRNI path)
**Method:** grep of `tools/smoke-test.js` + `apps/api/src` + `apps/api/tests` for `invoiceType: 2` / `invoice_type = 2` and stock/cost assertions.

---

## Grep results — existing tests that create purchase invoices (type 2)

| # | Location | What it does | Assumes old behaviour? |
|---|---|---|---|
| 1 | `tools/smoke-test.js:102-110` | Creates purchase invoice (100×@10 + 100×@5, tax 0) | **YES — line 110**: `purchase updates item cost` asserts `costPrice === 5` (purchase re-prices item). B2 removes cost update on invoice → will FAIL. |
| 2 | `tools/smoke-test.js:140` | `stock reflects purchase and sale` asserts itemA onHand === 97 | **YES** — depends on purchase having added 100 to stock at invoice time. B2: invoice adds no stock → will FAIL (unless a GRN was created; there isn't). |
| 3 | `tools/smoke-test.js:174` | `cancel restores stock` asserts itemA onHand === 100 | **YES** — same dependency: purchase's 100 was reversed by sale cancel. B2 → will FAIL. |
| 4 | `tools/smoke-test.js:221-227` | Purchase invoice 2 boxes @120 → asserts `onHandQty === 24` (box→base conversion via purchase) | **YES** — depends on purchase invoice adding stock. B2 → will FAIL. |
| 5 | `tools/smoke-test.js:229-235` | Sale 1 box → asserts `onHandQty === 12` | **YES (indirect)** — depends on #4's stock existing to sell. |
| 6 | `tools/smoke-test.js:913-923` | Creates supplier + purchase order (orderType 2), converts to purchase invoice | **PARTIAL** — checks only `invoiceId` exists, does NOT assert stock. Likely survives B2, but the converted invoice will now post GRNI (no stock) — fine. |
| 7 | `tools/smoke-test.js:261,786,800` | ZATCA/ETA generation with invoiceType 2 | NO — only checks e-invoice gating, not stock. |

---

## Tests in `apps/api/tests/` (permanent suite)
- `tests/purchases/purchase-receipt.test.ts` — B1 GRN slice only. Creates stock via GRN (applyMovement), not via invoice type 2. **No old-behaviour assumption.** Survives B2 unchanged.

---

## Critical observation

The smoke test's **entire stock-safety narrative** (lines 102-174) is built on the assumption that a purchase invoice adds stock immediately. B2 deliberately breaks that — by design, invoice no longer touches stock; stock comes only from a GRN.

This means smoke tests #1-#5 are not just "assertions to tweak" — their **fixture setup** is invalid under B2:
- After B2, lines 102-109 create a purchase invoice that adds NO stock.
- Line 114's sale of 3 units from itemA then has no stock to draw from (unless `AllowNegativeStock=true`).
- Lines 140, 174, 227, 235 all fail or test the wrong thing.

**To keep these tests meaningful under B2, the fixture must change**: create a GRN (via B1 slice) to bring stock in, THEN the purchase invoice settles GRNI. That is a larger test rewrite than a one-line assertion change.

---

## Decision required (NOT taken unilaterally)

Per B2 brief: "أي اختبار يفترض السلوك القديم — يُعرض للمراجعة قبل التعديل. لا قرار أحادي."

Options for smoke tests #1-#5:
- **(A)** Rewrite fixtures to create a GRN first (via API `POST /purchases/receipts`), then post the purchase invoice against it. Tests then verify the new GRNI path end-to-end. *(Correct, larger change.)*
- **(B)** Change assertions only (e.g. expect costPrice unchanged, onHand=0) — but this destroys the stock-safety coverage (no test then verifies sale decrements stock).
- **(C)** Mark those checks as `// Removed: B2 behavior change` and add a new dedicated B2 test file (parallel to B1's). Keeps smoke green, moves coverage to the new suite.

**My recommendation:** (C) + add B2 tests — remove the 5 stale smoke checks with a clear comment, and rely on the permanent `tests/purchases/purchase-invoice.test.ts` (to be created in B2) for GRNI/PPV/no-stock verification. This mirrors how B1 got its own permanent suite and keeps `npm test` (smoke) green without pretending old behaviour still holds.

**Awaiting your decision before modifying any smoke test.**

---

## B2 implementation (independent of the smoke-test decision)

The API change itself is clear and does not depend on which option is chosen:
- `sales.slice.ts` `create()` type 2: skip `applyMovement` + skip avg-cost update (line 606-608, 871-889).
- `postInvoiceJournal` purchase branch: `Dr GRNI / Dr PPV / Dr VAT Input / Cr AP` with `sourceType: 'purchase_invoice'`.
- `receipt_links` (D-18) from `InvoiceInput` → `purchase_invoice_links`.

**I will implement the API change and the permanent B2 test suite; the smoke-test edits wait for your A/B/C.**
