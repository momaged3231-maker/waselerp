# Verification Gate — INT-01..05 (before B1)

**Date:** 2026-11-17
**DB:** PGlite wasel (local test)
**Method:** Real queries + real postJournal calls (ts-node test script)

---

## INT results (real numbers)

| # | Test | Result |
|---|---|---|
| INT-01 | 10 accounts `is_control` | 10 rows: 1103/1104/1105/2101/2102/5101/2107 = true; 1109/1110/5114 = false ✅ |
| INT-02 | `postJournal` sourceType='manual' on 2107 | **REJECTED** — "لا يمكن إنشاء قيد يدوي على حساب تحكّمي: GRNI — بضاعة مستلمة غير مفوترة (2107)" ✅ |
| INT-03 | `postJournal` sourceType='grn' on 2107 | **PASSED** — journal_id: 2 ✅ |
| INT-04 | 4 mappings | 4 rows: GRNI→2107, SUPPLIER_ADVANCES→1109, INVENTORY_IN_TRANSIT→1110, PPV→5114 ✅ |
| INT-05a | manual on 1103 (AR) | **REJECTED** — "…ذمم العملاء (مدينون) (1103)" ✅ |
| INT-05b | manual on 5101 (COGS) | **REJECTED** — "…تكلفة المبيعات (5101)" ✅ |

## 50 vs 49 — resolved

The accountant's hypothesis (duplicate 2107) was **disproven**:
- `SELECT account_id, code FROM gl_accounts WHERE code = '2107'` → **1 row** (account_id 75).
- `SELECT code, COUNT(*) ... HAVING COUNT(*) > 1` → **0 duplicate codes** in DB.
- Root cause of 50: seed CHART = **49 accounts** (45 original + 4 new). DB = **50** because of one leftover account `4107 خصومات وغرامات` that exists in DB but not in seed CHART (came from an earlier HR/insurance migration applied to this test DB). `IN_SEED_NOT_DB = []` — all 49 seed accounts present. No design problem; test-DB artifact only.

## INT Gate = PASS ✅

All 5 tests pass with real results. B1 (GRN slice) may proceed.

**No production DB. No commit. No push.**