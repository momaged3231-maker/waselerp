# Escalation #2 — V-06: `gl_kind` on `purchase_receipts`

**Date:** 2026-11-17
**Source:** Phase-2 Execution Brief v1 §P1.6, accountant decision #3
**Status:** Open — awaiting accountant/owner decision

---

## The Question

What are the actual expected values for `purchase_receipts.gl_kind` in production?

The migration (line 63) defines:
```sql
gl_kind smallint NULL  -- 1 GRNI posted, 2 invoice-first path, 3 under inspection
```

## Analysis

### What the design says

| Event | Receipt behavior | gl_kind would be |
|---|---|---|
| GRN approved (normal) | Dr INVENTORY / Cr GRNI | 1 (GRNI posted) |
| GRN under inspection (status=2) | No GL entry yet | 3 (under inspection) |
| Invoice arrives before GRN | GRN still posts Dr INVENTORY / Cr GRNI when approved | 1 (GRNI posted) — NOT 2 |

**Key finding:** `gl_kind=2` (invoice-first path) would **never** be recorded on a receipt. The invoice-first path affects the **invoice** (which posts Dr GRNI/Cr AP without inventory movement), not the receipt (which always posts Dr INVENTORY/Cr GRNI when approved). The receipt's behavior is identical regardless of whether the invoice arrived before or after.

### What `gl_kind=3` (under inspection) would mean

This is redundant with `purchase_receipts.status = 2` (under inspection). The status column already tracks the receipt's lifecycle. Having a separate `gl_kind` for "under inspection" duplicates this information.

### What `gl_kind=1` (GRNI posted) would mean

This is the only value that would actually be set. But it's also redundant with `gl_journal_id IS NOT NULL` (if a journal was posted, GRNI was posted).

### Conclusion

`gl_kind` as currently defined is **poorly named and partially redundant**. The "invoice-first path" (value 2) is an invoice property, not a receipt property. The "under inspection" (value 3) is redundant with `status`. Only value 1 (GRNI posted) would be set, and it's redundant with `gl_journal_id IS NOT NULL`.

## Options

### Option A: Rename to `posting_status` with 3 values

| Value | Meaning | When set |
|---|---|---|
| 1 | Pending (no GL entry yet) | At creation (status=2, under inspection) |
| 2 | Posted (GRNI journal written) | At approval (status=1) |
| 3 | Reversed (GRNI journal reversed) | At cancellation |

**Impact:**
- Rename column: `ALTER TABLE purchase_receipts RENAME COLUMN gl_kind TO posting_status;`
- Update all code references (none yet — no code uses gl_kind).
- Update migration comments.
- **Cost:** Low (no code references yet, column is new).
- **Benefit:** Clear, non-redundant status tracking. Single source of truth for posting state.
- **Risk:** None (column is new, no data exists yet).

### Option B: Clarify `gl_kind` with corrected semantics

Keep the name but redefine values:
- 1 = GRNI posted (normal path)
- 2 = GRNI posted (invoice-first path — same as 1, kept for audit trail of which path was taken)
- 3 = Not posted (under inspection)

**Impact:**
- No schema change needed.
- Values 1 and 2 are functionally identical (both = "GRNI posted") but distinguish the path taken.
- **Cost:** None.
- **Benefit:** Preserves path information for audit.
- **Risk:** Confusing (two values mean the same thing). The "invoice-first path" is an invoice property, not a receipt property. Storing it on the receipt is misleading.

### Option C: Remove `gl_kind` entirely

Remove the column. Use `gl_journal_id IS NOT NULL` to determine if posted, and `status` to determine if under inspection.

**Impact:**
- Drop column: `ALTER TABLE purchase_receipts DROP COLUMN gl_kind;`
- **Cost:** Low (column is new, no data, no code references).
- **Benefit:** Simpler schema, no redundancy.
- **Risk:** Loses the "which path was taken" information. But this information belongs on the invoice, not the receipt.

## Recommendation

**Option A** — rename to `posting_status` with 3 values (pending/posted/reversed). This is the cleanest: non-redundant, clear semantics, and the name accurately describes what the column tracks. Values 1/2/3 in the current definition are misleading (value 2 is never set, value 3 is redundant with status).

**Impact of choosing A over B/C:**
- A vs B: A is clearer (one value per state vs two values meaning the same thing). B preserves path information but at the cost of confusion.
- A vs C: A preserves posting state tracking (useful for audit). C is simpler but loses the explicit "pending/posted/reversed" distinction (which would need to be derived from `gl_journal_id IS NULL` + `status`).

**If you choose A:** The migration must be updated to rename `gl_kind` → `posting_status` and redefine values. This is a schema change in the same migration (Phase-2 Step 0 or the main migration).

**If you choose C:** The migration must be updated to drop `gl_kind`. Simpler, but loses explicit posting state.

**If you choose B:** No migration change needed. Just update the comment/documentation.

---

## Decision Required

Please select A, B, or C. If A or C, the migration must be updated before P2.

**No P2 until this is resolved.** (Per escalation protocol: "ما هو معطّل حتى الرد: P2, P3, B1-B4 — all blocked until P1 resolves.")