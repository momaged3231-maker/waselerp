# E2 — Inter-Branch Transfer — Delivery & Evidence Report

**Decision baseline:** E6 approved (`62fe031`), E2 authorized 2026-11-16 (Option B + accounting conditions)
**Commit:** `947d31e` — `feat(e2): inter-branch stock transfer — independent slice, clearing account 1108`
**Status:** implemented and fully verified on **isolated test environments only** — **awaiting independent accounting review**
**Not authorized:** production · E4 · integrated reversal after receipt · production seed/migration

---

## 1. Scope delivered

| Area | Delivered |
|---|---|
| Independent slice | `apps/api/src/modules/inventory/branch-transfer.slice.ts` — `branch_transfers` / `branch_transfer_lines` (additive tables, partial-unique `client_request_id`). **`stock-transfer.slice.ts` untouched** (frozen) |
| Migration | `db/migrations/2026-11-18-e2-branch-transfer.sql` — 2 tables + `gl_accounts` 1108 + `gl_mappings` BRANCH_TRANSFER_CLEARING (idempotent, additive-only) |
| Ordering proof | `migrate-all` executed on a brand-new PostgreSQL 18.6 database `wasel_orderbyguard`: `schema.postgres.sql → …2026-11-16-e6-period-closing → 2026-11-16-e6-review-closing → 2026-11-16-print-agents → 2026-11-17-e6-signoff → 2026-11-18-e2-branch-transfer` — **proven, not assumed** (then the guard DB was dropped) |
| Accounting policy (approved) | issue: **Dr 1108 / Cr 1104** in SOURCE branch; receive: **Dr 1104 / Cr 1108** in DESTINATION branch, **same cost**, zero P&L/retained-earnings effect; clearing nets to company-wide **ZERO** |
| Clearing account | **`1108` — «مخزون بين الفروع — حساب وسيط»** (account_type=1, under the 110-family) + mapping **`BRANCH_TRANSFER_CLEARING`** |
| Permissions | `transfer.interbranch.view` / `transfer.interbranch.manage` / `transfer.interbranch.cancel` — never auto-granted from `stock.manage`; StoreKeeper gets view+manage only; Accountant gets view only; cashier 403; Administrator via PERMISSIONS map |
| Cancellation | allowed only **pre-receipt (status 2)**: atomic undo of outbound movement + issue journal, mandatory reason, audit row, FOR UPDATE + status guard (double cancel impossible). After receipt (status 4): **refused (400) Arabic** — «يلزم مستند عكس متكامل (غير متاح في هذه النسخة)» |
| Period checks | `is_closed` and `manual_lock` checked for **both** branches at create/approve/receive/cancel |
| Scope isolation | list = current branch only; details: foreign branch → **404**; approve/receive possible only from the correct side; receive from source forbidden (403) |
| Idempotency | `clientRequestId` **mandatory**; duplicate returns the original document; duplicate approve/receive/cancel refused (status guard + FOR UPDATE); **real PostgreSQL race test** |
| UI | `/warehouses/branch-transfers` + tab "تحويل بين فروع" in `/warehouses` hub; list/details/create/approve/receive/cancel/delete-draft; A5 **إذن تحويل بين فروع** printable with two signature lines (المسلّم / المستلم); in-transit (status 2) highlighted; **no manual cost fields** |
| Reports | `GET /reports/branch-transfers` (documents) · `GET /reports/branch-transfers/suspense` — **company-wide** 1108 (glClearing vs in-transit value, per-branch breakdown) · XLSX export dataset `branch-transfers` |
| Delete guard | `branchTransfers` added to `DELETE_SCREENS` (Settings → الحذف toggle; fails open like all keys; server enforces) |

## 2. Verification evidence

### 2.1 Smoke (isolated PGlite `wasel_e6rev`, fresh after `e6-review-reset`)
```
594/594 checks passed   (19 E2 checks + accountant view-only + double-approve; regression: E1/E3/E5/E6 sections all green)
```
- create without clientRequestId → 400 · duplicate → same document · cashier receive → 403 · source-side receive → 403 · **accountant list 200, create/approve/receive/cancel all 403** · duplicate approve → 400 · clearing company-wide 0.00 · cancel after receipt → 400 · third branch → 404 · cancel pre-receipt → status 5 · stock restored exactly (63 → 63)

### 2.2 Real PostgreSQL 18.6 concurrency (`wasel_signoff`, port 5432, API 4270) — 24/24
- Scenario A: three concurrent `receive` on one transfer → **exactly one** 201, two 400; destination stock +30 exactly; source stock −30 exactly; exactly two journals (approve + one receive); exactly one transferIn movement; one audit row; **1108 = 0 company-wide**; TB balanced
- Scenario B: three concurrent `cancel` → **exactly one** 201, two 400; exactly one reversal movement/journal/audit
- Scenario C: destination period **administratively locked** → receive refused (400); unlock → receive succeeds (201)
- Scenario D: destination period **`is_closed`** → receive refused (400, Arabic message naming the locked branch); reopen → succeeds
- Trial balance balanced after all races (Dr=Cr=4,950.00)

### 2.3 Two-branch month simulation (`wasel_month4`, PGlite 5436, API 4280) — Expected vs Actual, independent recomputation
Purchase in A → transfer to B → sale in B → return in B → cancel T2 pre-receive → damage in A → stock count in A (1 unit short).
**All checks passed:**
```
inventory: A = 3,200.00 (3×800 LAP + 4×200 KB) · B = 3,200.00 (4×800 LAP) · company = 6,400.00 (moving the goods created/destroyed nothing)
GL: INVENTORY A=3,200.00, B=3,200.00 · COGS A=1,600.00, B=0.00 (800 sale−800 return)
DAMAGE_EXPENSE A=200.00 (voucher type 3) · INVENTORY_VARIANCE A=800.00 (count loss) · REVENUE A=3,000.00, B=0.00
VAT: input A 1,120.00 · output A −420.00 · output B 0.00
1108 company-wide = 0.00 (T1 completed, T2 cancelled) · in-transit value = 0.00
Journals: branch_transfer = 3 (T1 approve+receive, T2 approve) · branch_transfer_cancel = 1
RETAINED_EARNINGS unchanged (0 → 0) — zero P&L leakage from transfers
TB balanced per branch (A 20,140.00 · B 8,448.00) · accounting equation A = L + E + (R−X) per branch and company-wide
movement ledger: out-signed −6 (4+2), in-signed +6 (4 + cancel reversal 2) · countLoss move_type 8 (1 unit)
company P&L this month = 400.00 — exactly Expected (3,000 − 1,600 − 200 − 800)
API /reports/branch-transfers/suspense → company.match = true
```
Scenario + independent verifier: `tools/month4-ops.js` · `tools/month4-check.js` (no shared logic with the ops path; GL/TB read straight from the DB).

### 2.4 Build & UI
- `npm run build` (API) ✓ · `npm run web:build` ✓ — static export includes `/warehouses` (15.5 kB) and `/warehouses/branch-transfers` (323 B)
- XLSX export `branch-transfers` verified live: HTTP 200, base64 PK\x03\x04 (valid workbook)
- Screen renders the document flow; all API paths it uses were exercised green. **Manual browser walk-through (login → create → approve → switch branch → receive → print A5) was NOT run in this environment** — see Open points

### 2.5 Notes / observations
- **Per-branch 1108 is structurally ±half** (A carries the debit leg, B the credit leg): the approved two-journal design can never settle per-branch — the invariant is **company-wide zero**, which is what the report and gate assert. In-flight value (status 2) is always visible via the suspense report and the screen badges.
- On the `wasel_signoff` database (seeded long before E2), the new permissions were applied by re-running `seed.ts` (additive upserts only; no data changed). Fresh environments get them automatically.
- PGlite showed an unexplained identity gap on `branches.branch_id` (next id 34 on a fresh reset). Audit log and data are clean; sequence gaps are harmless. Flagged for transparency, no action required.
- `journal_type = 8` used for the transfer journals — consistent with the existing in-branch transfer precedent; nothing in the close-month logic filters on this type (it discriminates by `source_type`).

## 3. Explicitly NOT done (by decision)
- Post-receipt integrated reversal workflow (cancel after `status = 4`) — **hard-refused with Arabic message**, separate approval required
- Production / Supabase — **not touched**; `wasel` not migrated or seeded by this work
- E4 — not authorized
- Multi-currency valuation for in-transit goods — out of scope
- Automated fork of a branch's warehouses (creation is explicit per transfer)

## 4. Sign-off gate

| Item | Result |
|---|---|
| Migration additive & order-proven (fresh PostgreSQL) | ✅ |
| Independent slice, no re-use/modification of `stock-transfer` flow | ✅ |
| Clearing account design approved & documented (1108) | ✅ |
| Double-entry balanced, per-branch TB balanced, company equation | ✅ (M4) |
| Clearing nets to zero company-wide after complete/cancel | ✅ (smoke, real-PG, M4) |
| Period locks (accounting + administrative) enforced, both branches | ✅ (real-PG D & C; smoke) |
| Idempotency & concurrency (create/approve/receive/cancel) | ✅ (real-PG A/B; smoke) |
| Permissions per role + branch scope isolation | ✅ (smoke 594/594) |
| Regression E1/E3/E5/E6 | ✅ (fresh smoke sections green) |
| UI (approved path `/warehouses/branch-transfers`) | ✅ build; ⚠ browser walk-through pending |
| Independent accounting review | ⬅ **STOP — awaiting review** |

**Decision:** implementation complete, evidence collected, committed as `947d31e`. **No deployment.** Awaiting the independent accounting review verdict before any merge/push/production step.
