# E2 — Independent Accounting Review — Evidence Dossier

**Reviewer note:** this dossier was produced on a **fresh, isolated, REAL PostgreSQL 18.6** environment created for this review (`wasel_e2review`, port 5432, API on 4272). It is not production, not `wasel_signoff`, not `wasel_month2/4`, and does not touch any approved E1/E3/E5/E6 code. No production/Supabase access was used. E4 was not started.

**Migration order verified on this database:** `schema.postgres.sql → … 2026-11-16-e6-period-closing → … 2026-11-16-e6-review-closing → … 2026-11-16-print-agents → 2026-11-17-e6-signoff → 2026-11-18-e2-branch-transfer` — all OK, then seed (permissions: 45).

**Transfer numbering** (all created in branch 1 الفرع الرئيسي → branch 2 فرع المراجعة E2):
`BT-1-2-2026-000001` (T1) · `…000002` (T2) · `…000003` (T3 draft) · `…000004` (T4) · `…000006` (T6)

---

## A. Critical — In-Transit Accounting — PASS

### A.1 Setup (for exact reproducibility)
```sql
SELECT item_warehouse_qty — before any transfer (item 1, purchased 10 × 800):
 warehouse_id | on_hand_qty | avg_cost | (on_hand_qty*avg_cost) value
     1        | 10.000000   | 800.0000 | 8000.000...
GL net per branch (posted, j.status=2):
  1101 cash  0.00 Dr / 9,120.00 Cr
  1104 INVENTORY 8,000.00 Dr
  1105 VAT input 1,120.00 Dr
Consolidated TB: 9,120.00 = 9,120.00 ✓ · zero type 3/4/5 rows ✓
```

### A.2 Approve without receipt — raw evidence
T1 = 10×800 = **8,000.00**. Draft `BT-1-2-2026-000001` → lines → **approve**
(voucher 1 + journal **#2**, branch 1, source_type=`branch_transfer`, source_id=1, status 2):

```sql
-- 1) Source warehouse decreases (must be 0):
SELECT on_hand_qty FROM item_warehouse_qty WHERE item_id=1 AND warehouse_id=1 → 0.000000  ✓

-- 2) Destination untouched (no row / all zero):
--    warehouse 2 has NO iwq row for item 1 yet ✓

-- 3) GL 1104 per branch:
SELECT j.branch_id, COALESCE(SUM(e.debit-e.credit),0) net
FROM gl_entries e JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
JOIN gl_accounts a ON a.account_id=e.account_id WHERE a.code='1104' GROUP BY j.branch_id;
   branch 1: 0.00   branch 2: (no rows)            ✓

-- 4) 1108 per branch and company:
SELECT j.branch_id, COALESCE(SUM(e.debit-e.credit),0) net … WHERE a.code='1108' GROUP BY j.branch_id;
   branch 1: +8,000.00   branch 2: (no rows)
SELECT COALESCE(SUM(e.debit-e.credit),0)::numeric company FROM … WHERE a.code='1108';
   company: 8,000.00                               ✓ (debit balance == goods in transit)

-- 5) In-transit report (endpoint):
GET /reports/branch-transfers/suspense  →  glClearing=8000, inTransitValue=8000, match=true
GET /reports/branch-transfers?status=2  →  exactly BT-1-2-2026-000001, value 8,000.00, 1 line
In-transit XLSX export OK (PK\x03\x04).

-- 6) Journal #2 line items (balanced, branch-scoped):
line 1: 1108 Dr 8,000.00  |  line 2: 1104 Cr 8,000.00  ✓

-- 7) Type 3/4/5 entries: NONE (no revenue/COGS/expense/RETAINED moved)  ✓

-- 8) TB: branch 1 17,120.00=17,120.00 ✓ · branch 2 0=0 ✓ · consolidated 17,120.00=17,120.00 ✓

-- 9) Movement ledger:
stock_movement 1: purchase +10 @800 ref P-2026-000001
stock_movement 2: transferOut −10 @800 ref BT-1-2-2026-000001  ✓
```
**Reviewer's direct instruction honoured:** an unreceived transfer is NOT asserted to be zero;
1108 **= 8,000** exactly while goods are in transit. Reconciliation happens at completion/cancellation.

### A.3 Receive T1 — raw evidence
Receive from branch 2 → status **4** · inbound voucher 2 · journal **#3** (branch 2, source_id=1, status 2):

```sql
line 1: 1104 Dr 8,000.00 | line 2: 1108 Cr 8,000.00  ✓ (identical amount to journal 2)

-- Ledger per branch after receive:
Branch 1 wh 1: on_hand 0 @ 800 (value 0.00)  ·  Branch 2 wh 2: on_hand 10 @ 800 (value 8,000.00)
-- GL after receive:
1104 branch 1: 0.00 · branch 2: +8,000.00            ← branch ledgers == branch GL, exactly
1108 branch 1: +8,000.00 · branch 2: −8,000.00 · company: **0.00**  ✓
Journals: exactly ONE per branch for this transfer (#2, #3) — no duplicates
Movements: exactly ONE in each branch (#2 out, #3 in) — no duplicates
TB branch 2: 8,000.00=8,000.00 ✓ · consolidated: 25,120.00=25,120.00 ✓
P&L/RETAINED: zero entries from the transfer ✓
```

### A.4 Second transfer cancelled pre-receipt (T2 = 2 units = 1,600)
Purchase #2 (restock 10 @ 800) → T2 draft → add line (unitCost 800) → **approve** (voucher 3, journal **#5**, branch 1):
`Dr 1108 1,600 / Cr 1104 1,600` → then **cancel** (reason held) → status **5**, journal **#6**
(source_type `branch_transfer_cancel`, source_id 2, branch 1):

```sql
journal 6: line 1 1104 Dr 1,600.00 | line 2 1108 Cr 1,600.00  ← exact mirror of #5
stock_movement 5: transferOut −2 @800 ref BT-1-2-2026-000002
stock_movement 6: transferIn  +2 @800 ref BT-1-2-2026-000002  (reversal)
warehouse A immediately after cancel: on_hand 10 @ 800 · value 8,000.00  ← ORIGINAL source inventory restored
   (snapshot taken before T4 was subsequently issued; final state after T4 is 9 units — see iwq dump in §D)
GL after cancel: 1104 A = 8,000.00 · 1104 B = 8,000.00 (T1 unaffected)
                  1108 company = 0.00                           ← both transfers fully settled
```

---

## B. Cost Snapshot — **CRITICAL FINDING (defect proven) — reported separately, NO code change made**

### B.1 What the implementation does (verified in source)
| Point | Code | Behaviour |
|---|---|---|
| `addLine` (branch-transfer.slice.ts, ~line 306) | `const unitCost = (await getWarehouseCost(client, itemId, Number(header.from_warehouse_id))) \|\| Number(item.rows[0].cost_price ?? 0);` | **`unit_cost` frozen at line-add time** from the source warehouse avg cost; stored with the line |
| `updateLine` | quantity/notes only | cost never re-read |
| `approve` (~line 416) | `const unitCost = Number(line.unit_cost ?? 0);` | books journals/movements/total_value from the **frozen line cost** |
| `receive` (~line 530) | `const unitCost = Number(line.unit_cost ?? 0);` | destination books at **the same frozen cost** (no re-valuation) ✓ consistent with §3.1 |
| `applyMovement` (common/stock.ts, ~lines 121–131) | `avg_cost = CASE WHEN $4 > 0 AND $5 > 0 THEN ((q*avg + $4*$5)/(q+$4)) ELSE avg_cost END` | **outbound movements never change avg_cost** — ledger value leaves at qty × avg, regardless of the frozen journal cost |

The same-branch StockTransferService follows the **identical** frozen-at-line-add pattern (`getWarehouseCost` at add-line, `Number(line.unit_cost ?? 0)` at approve), verified in source. The behaviour is **intentional at the product level** (the P4-3 rule: cost always from source warehouse moving average, manual override refused — message implemented in both modules) — **but the consequence below is NOT documented anywhere and breaks the GL↔ledger identity this codebase itself relies on.**

### B.2 Executed scenario (real DB, branch 1)
Item `E2R-COST-B` (item_id=2): purchase **1 × 800** → create T6 draft → add line (qty 1) → **line stores `unit_cost = 800.0000`** (query: `branch_transfer_lines` shows 800.0000 / lineValue 800) →
purchase **1 × 400** → warehouse avg becomes **600.0000** (proven) →
**approve T6**:
```
warehouse A after p2: on_hand 2 @ avg 600.0000 (value 1,200)
approve T6 → status 2, journal #10 (branch 1): Dr 1108 800.00 / Cr 1104 800.00
stock_movement #10 (T6): transferOut −1 @ **800.0000**  ← frozen cost used
warehouse A after issue: on_hand **1** @ avg **600.0000** · value **600.0000**
```
### B.3 Expected vs Actual (after approve)
| Measure | ledger (item_warehouse_qty) | GL (journal lines) | Δ |
|---|---|---|---|
| branch 1 inventory value | `1 × 600 = 600.00` (+ other items 7,200.00 = **7,800.00** total ledger) | `17,200 purchases − 800 issued − 8,000 (T1)… = **7,600.00**` | **GL < ledger by 200.00 exactly** |
| journal for the issue | — | Cr 1104 **800.00** | 200 more than ledger relief |

(control group — item 1 and all previously-verified flows reconcile **to the penny** because avg never drifted between line-add and approve)

### B.4 Received state (frozen cost everywhere, consistent internally)
```
journal #41 (branch 2, source_id 6): line 1 1104 Dr 800.00 | line 2 1108 Cr 800.00
stock_movement #41: transferIn +1 @ **800.0000**
warehouse B: 1 @ 800.00 (value 800.00)  ·  GL 1104 B = 8,800.00 (T1 8,000 + T6 800)  ✓ ledger == GL
GL 1104 branch 1 remains 200.00 understated vs ledger forever (no self-healing flow exists)
```
Journal IDs and movements: T6 = journal **#10** (A), journal **#41** (B) · movements **#10** (out), **#41** (in).
Company-wide 1108 after T6 receive: **800.00** (T4 still outstanding) — matches subledger and suspense report.

### B.5 Ruling requested from reviewer (explicitly NOT acted on)
1. **Defect**: whenever the source warehouse moving-average changes between line-add and approve, the GL books the frozen cost while the ledger keeps the live average — **GL ≠ warehouse ledger** (violates the invariant used by month2/month4 proofs and E2's own checks). It does **not** touch P&L (all entries hit 1104/1108 only) and does **not** impair balance sheet equality, but it is a real control failure in booked inventory.
2. Options (choose one; no change made yet):
   a. **Re-read the source moving average at approve** inside the same transaction (update the lines' unit_cost + recompute total value + post at that cost). GL↔ledger aligned by construction; all downstream artifacts unchanged in shape. **(recommended)**
   b. Keep frozen-at-line-add **documented as explicit policy** and correct the reconciliation expectation for this case (GL≠ledger tolerated, with a reconciliation entry); not recommended — it weakens every downstream reconciliation permanently.
   c. Keep frozen cost but change `applyMovement` outbound path to decrement ledger **value** by qty × frozen cost (matches GL, breaks weighted-average semantics of the ledger — not recommended without owner decision).
3. Whichever option wins, **the same fix (or the same documented exception) must be applied to the same-branch StockTransferService**, which shares the identical behaviour — otherwise the two paths diverge in policy.

---

## C. Clearing Reconciliation (after completion + cancellation + one draft + two in-transit)

### Transfers matrix (raw):
```
id | no               | status | total   | out_v | out_j | in_v | in_j
 1 | BT-1-2-2026-000001 | 4 (completed) | 8,000.00 | 1 | 2 | 2 | 3
 2 | BT-1-2-2026-000002 | 5 (cancelled) | 1,600.00 | 3 | 5 | - | - (cancel journal 6)
 3 | BT-1-2-2026-000003 | 1 (draft)     | 800.00   | - | - | - | -
 4 | BT-1-2-2026-000004 | 2 (in transit)| 800.00   | 4 | 7 | - | -
 6 | BT-1-2-2026-000006 | 4 (completed) | 800.00   | 5 | 10 | 38 | 41
```
(`voucher` = outbound/inbound stock voucher IDs; `journal` = issue journal; cancel journal **#6** is recorded in `branch_transfers` only via status + activity_log — mirror of source_type `branch_transfer_cancel`.)

### Per transfer — GL clearing (raw, CASE-filtered):
```
transfer 1 (status 4): net 1108 = 0.00 (debit 8,000.00 / credit 8,000.00) · journals: 2 (1 per branch) · movements: 2 (net 0)
transfer 2 (status 5): net 1108 = 0.00 (debit 1,600.00 / credit 1,600.00) · journals: 2 (approve + cancel) · movements: 2 (net 0)
transfer 3 (status 1): net 1108 = 0.00 (no journals) · movements: 0  ✓ draft books nothing
transfer 4 (status 2): net 1108 = +800.00 (debit 800.00 / credit 0.00) · journals: 1 · movements: 1
transfer 6 (status 4): net 1108 = 0.00 (debit 800.00 / credit 800.00) · journals: 2 · movements: 2
```
### Company reconciliation (raw):
```sql
GL 1108 branch 1 = **+9,600** · branch 2 = **−8,800** · company = **+800** (T4 outstanding only)
In-transit subledger (status=2): 800.00  →  *** GL clearing == subledger EXACTLY ***
Orphaned 1108 entries (source_type not branch_transfer*): 0
Dangling 1108 entries (source_id without branch_transfers row): 0
Completed transfers with open in-transit balance: 0
Cancelled transfers with open in-transit balance: 0
Journals per transfer per branch: exactly 1 (no duplicates anywhere)
```
### Suspense endpoint after all operations:
`glClearing=800, inTransitValue=800, match=true` (T4 is the only outstanding shipment).

**Completed and cancelled transfers both settle to exactly zero. The only open balance is the deliberately outstanding T4 (800.00).**

---

## D. Deliverable index

| Item | Where |
|---|---|
| Exact SQL queries used | Inline in §A/§B/§C above (executed verbatim via `tools/pg/q.js`) |
| Journal IDs | #2 (T1 issue, branch 1) · #3 (T1 receive, branch 2) · #5 (T2 issue) · #6 (T2 cancel) · #10 (T6 issue, frozen 800) · #41 (T6 receive) |
| Movement IDs | #1 purchase P-1 · #2 T1 out · #3 T1 in · #5 T2 out · #6 T2 reversal · #10 T6 out · #41 T6 in |
| Transfer IDs & statuses | T1=1 (4) · T2=2 (5) · T3=3 (1, draft, never approved, books nothing) · T4=4 (2, outstanding 800) · T6=6 (4) |
| Per-branch balances | GL 1104: A **7,600.00** (ledger **7,800.00** → Δ **−200.00**, §B) · B **8,800.00** = ledger ✓ · 1108: A **+9,600** / B **−8,800** / company **+800** = subledger |
| Cost timing answer | `unit_cost` is **frozen at line-add** (`getWarehouseCost` at addLine). It is NOT re-read at approve, NOT re-read at receive, and NOT re-evaluated on line edits. The frozen cost flows into movement unit_cost, both journals, voucher lines, and the in-transit value. **The transfer always moves at the line-add snapshot cost.** |
| Finding status | **§B is a proven defect. Reported separately. No code changed by this review. Commit hash: none (no changes exist to commit).** |
| Decision required from reviewer | §B.5 option (a / b / c) — plus whether to also adjust the same-branch StockTransferService. |

**Environment:** fresh isolated REAL PostgreSQL 18.6 `wasel_e2review` (kept alive for reviewer access; drop with `DROP DATABASE wasel_e2review` when done). API on port 4272 (`apps/api/dist/main.js`, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/wasel_e2review`).

---

## What passed (and did not need any code change)
A (in-transit accounting, receipt, cancellation), C (clearing reconciliation), per-branch and consolidated trial balances, branch/ledger/GL consistency for all flows other than the §B cost-drift case, P&L/RETAINED isolation, zero duplicate journals/movements, no orphaned clearing entries, and the migration ordering on a fresh database.

**Stopping here per instruction. No E4 work. No production action. Evidence awaits the independent review decision on §B.**
