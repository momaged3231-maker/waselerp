# E4 Read-Only Gap Audit — WaselERP

**Date:** 2026-11-16 · **Mode:** READ-ONLY (no code, tests, migrations, schema, config or docs modified · no commits · no production/Supabase · no destructive DB commands)
**Subject:** Customer Statements (E4) — specification review + implementation gap analysis
**Bottom line:** **NOT READY for implementation. READY for owner POLICY DECISIONS.** Nothing in the repository implements E4, and the only E4 specification on file is a design-stage, notifications-only document that does not specify the ledger/AR reconciliation machinery a statement of account requires.

---

## 1. Repository identity and HEAD evidence

| Item | Evidence |
|---|---|
| Branch | `main` |
| HEAD | `2862732b3d13f74989a50e90a259fb460b72ec4d` |
| `git cat-file -t 2862732` | `commit` |
| `git merge-base --is-ancestor 2862732 HEAD` | exit **0** (HEAD IS 2862732) |
| `git status --short` | only `?? .agents/` and `?? .opencode/` (untracked tool dirs) |
| E2 signoff present | `docs/E2-COST-FIX-VERIFICATION.md` (+AGENTS.md D41/D42, log: `d10781f`, `2862732`) |
| Latest E4-related commits | none — `--grep=E4` returns documentation commits only (`86?` listing shows specs/reports); the last commits are all E2 sign-off / fix / verification |
| E4-keyword code search (`statement_templates`, `statement_triggers`, `statement_log`, `statement_unsubscriptions`, `customer-statements`) | **0 matches** in `apps/` and **0 matches** in `db/` (schema + `db/migrations/`) |
| E4 docs present | `docs/E4-CUSTOMER-STATEMENTS.md` (only), referenced from `docs/ERP-PHASE3-SPECS.md`, `docs/ERP-FULL-MONTH-AUDIT-REPORT.md`, `docs/EEYES-STEPS.md` (phase ordering context only) |

The production specification/docs were read but treated as **input to this audit, not as truth**. No database was touched.

---

## 2. E4 specification inventory

### 2.1 The only E4 spec: `docs/E4-CUSTOMER-STATEMENTS.md` (185 lines — design only)

**Status as printed in the document:**
> «**الحالة:** تصميم فقط — غير مُنفّذة في الكود بالكامل (الإشعارات بضاعة في النظام محدودة جدًا)»
> «**الأولوية:** متوسطة · **التعقيد:** متوسطة · **الأثر المحاسبي:** صفري (لا قيود) — **الأثر العملائي:** منهجي»

**Target feature as written:** automatic **customer statement notifications** («إشعارات استحقاق العميل») — NOT an account statement report. Proposed:

| Aspect | Spec content |
|---|---|
| Goal | (1) compute AR open-balance per customer ("AR debit (open balance) of كل عميل") (2) send periodically (nightly/weekly/monthly) (3) multi-channel Email + WhatsApp Business/`wa.me` (4) track sent ("هل يدفع أم يستلم?") (5) block/notify at credit limit (pointing to a future phase E7 — explicitly out of scope now) |
| Tables proposed | `statement_templates`, `statement_triggers` (min_overdue_days / max_overdue_days / min_amount / min_credit_limit_usage_pct / trigger_frequency / next_run_at), `statement_log` (per-party × sent_at × status incl. bounce/unsubscribe), `statement_unsubscriptions`; `parties.unsubscribed_statement` / `parties.statement_reported_at` also named (doc is internally inconsistent: §2 mentions party columns, §3 defines `statement_unsubscriptions`) |
| Scheduler | daily cron ~03:00 Cairo, `node-cron` worker or `pg_cron` |
| API | `GET /customer-statements`, `POST …/preview/{party_id}`, `POST …/run-now`, `GET …/log?party_id=`, `POST …/unsubscribe`, `POST …/templates/:id`, `GET …/config` |
| RBAC | المدير/المدير التنفيذي create templates/triggers/unsubscribe · المحاسب sees log only · الكاشير none · مدير النظام soft-deletes logs |
| Validation rules | unsubscribe honored; Egyptian mobile format `+20 1…`; 7-day resend cooldown per template; no sensitive card data; default Arabic templates; date/Hijri locale claim; blocked when `periods.is_closed = true`; "لا تُرسل إن AR balance < min_amount" |
| Accounting impact | **zero — «لا قيود»**; optional dunning fees formula (Dr 5107 / Cr 1106) documented but explicitly NOT required |
| Zero-implementation disclaimer | states even "I will not run SMTP in this build; only in test environment" (§11) |

**Spec internal defects/ambiguities found by this audit:**
1. Refers to table `voucher_allocations` — **does not exist** in schema; the actual table is **`invoice_allocations`** (`db/schema.postgres.sql`).
2. Refers to permission/design for "Dunning fees" (Dr 5107/Cr 1106) — 5107 exists (bank expenses/manual) but no voucher type/flow posts it either; spec itself says optional, not for this phase.
3. "AR open balance per customer" — **never defines** the data source: party subledger `ledger_entries` or GL `1103`? Both exist and can diverge; the spec assumes they are interchangeable.
4. "الفرع المغلق: لا تُرسل إن periods.is_closed = true في الفروعالياً" — undefined per-branch vs per-company semantics; the scheduler platform is unspecified (single instance assumed).
5. WhatsApp channel = "wa.me deep link opened in browser/user action" — **not automated delivery**; if chosen, the trigger→delivery loop is manual and `statement_log` can never be credited/marked sent server-side (violates §6 rule 1 'لا ترسل لعميل طلب إلغاء' verification, unless verification UI is built at send time).
6. 7-day cooldown and "do not resend within 7 days" — contradicts trigger_frequency=1 (daily) unless cooldown wins silently; unspecified precedence.
7. No PDF/preview/print export of a customer statement is specified **at all** — the spec is notifications-only; it does not even propose a printable "كشف حساب العميل" artifact for the customer or collector.
8. No ageing, no date-range, no brought-forward/opening balance treatment defined (notification interest: only current AR open balance).
9. No statement of supplier (payable side) scope — nothing in doc about suppliers.
10. §1 goal 1 explicitly: "AR debit (open balance) of كل عميل" — but under current subledger semantics (`ledger_entries.direction`: 1 = they owe us / we owe them increases; 2 = decreases), suppliers' AR-debit mirrors automatically by sign — spec never disambiguates customers vs both-type parties in trigger matching.
11. `reminder`/CRM belong to *other* phases; referenced as dependencies only.
12. "pg_cron" — not installed/provisioned; no scheduler exists anywhere in codebase (verified: no cron import in `apps/api/src`).
13. Env: no SMTP env vars consumed anywhere in API (`grep SMTP_` = 0 matches), so even preview/run-now cannot send without new configuration.

### 2.2 E4 phase context and ordering
- `docs/ERP-PHASE3-SPECS.md`: E4 = «إشعارات استحقاق العميل» · priority متوسطة · depends on CRM/reminders/vouchers; ordering E1→E6→E2→E5→E3→E4; E4 estimate tied to finishing dependencies; no accounting impact.
- `docs/ERP-FULL-MONTH-AUDIT-REPORT.md`: E4 never implemented. E3-AUTO-BANK-EXPENSES-REPORT.md: «المرحلة التالية: E6 → E2 → E4».
- AGENTS.md §6 ordering: E4 next after E2/E5/E3/E6 — still not in remaining-items list as delivered.
- **No phase report authorizes or implements E4.** The task's premise ("review E4 requirements and existing specifications") matches reality: spec exists; implementation does not.

### 2.3 Classification of collected requirements
| Kind | Items |
|---|---|
| **Explicit requirements** (in doc) | automatic due computation, periodic send (daily cron 03:00 Cairo), email + WhatsApp channels, unsubscribe honor, 7-day cooldown, no sensitive data, Arabic default, no send when AR < min_amount, log per party, admin-only trigger config, AR-based targeting |
| **Existing documented decisions (owner-approved, recorded)** | none specific to E4 (only later phase-order decisions and the general "notifications are out of scope" stance of earlier phases; Ezees coverage matrix page 41 — "إشعارات/بوابة عملاء" listed but **never delivered**, marked غير منفذ) |
| **Unapproved assumptions in the spec** | wa.me-deep-link instead of Business API, 03:00 Cairo schedule, 7-day cooldown precedence, AR trigger source = invoice data ("statement_triggers تبني على بيانات الفاتورة" per ERP-PHASE3-SPECS.md L40), `pg_cron`/`node-cron`, "hijri dates", Dunning optional fees, `statement_log` retention/soft-delete, exclusion of ETA/ZATCA |
| **Other-phase requirements inside the doc** | credit-limit hard block ("إنها E7 بعد ذلك — ليست هذه المرة" — out of E4), CRM idle-customer reporting (P9 tooling), unsubscribe from WEB view (a UI feature not scoped elsewhere) |

**Spec completeness verdict: NO COMPLETE E4 SPECIFICATION EXISTS.** Do not invent — every section below flags policy decisions where the spec is silent.

---

## 3. Current implementation map (actual code, verified by reading — not by filenames)

### 3.1 Subledger (the candidate statement source)

| # | Artifact | Finding |
|---|---|---|
| A | `db/schema.postgres.sql` — table `ledger_entries` | columns: `branch_id`, `party_id`, `entry_date timestamptz`, `direction smallint (1 debit/allow increase, 2 credit/decrease)`, `entry_type smallint (1 invoice, 2 payment, 3 return, 4 opening, 5 adjustment)`, `amount numeric(18,2)`, `invoice_id`, `cash_account_id`, `reference_no`, `created_by`, `created_at`. Index `ix_ledger_party_date (party_id, entry_date)`. No status column — every entry is "posted". |
| B | `parties` table | `branch_id` **nullable**; `opening_balance numeric(18,2)` DEFAULT 0; `credit_limit`, `party_type (1 customer,2 supplier,3 both)`. |
| C | `GET /parties/:id/statement` (`parties.slice.ts:134`) | permission `parties.ledger`; query = `ledger_entries LEFT JOIN invoices … WHERE party_id = $1 ORDER BY l.entry_date, l.ledger_entry_id`; **no branch filter · no date filter · no pagination · no posted/approved distinctions · no party-type check**; running = `Number(party.openingBalance ?? 0)` + Σ(direction==1 ? +amount : −amount); returns `{ party, lines, closingBalance }`; lines carry no branch column into the response. |
| D | `GET /parties/:id` (`parties.slice.ts:64`) | includes `balance = COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE -amount END), party.opening_balance)` — note **COALESCE**: if any ledger entry exists, opening_balance is IGNORED. Also `ledger` (last 200, DESC). Same absence of branch/date/posted filters. |
| E | `GET /parties` (list) | balance formula same; pagination exists (`page`, `pageSize` ≤ 200); ORDER BY `p.name` **no deterministic tie-breaker**. |
| F | `GET /parties/opening-balances` + `POST /parties/opening-balances` (`parties.slice.ts:297/317`) | Lists balances + type=4 counts; posting: `entry_type=4` with `direction = sign(amount)`, `branch_id = current branch`, `entry_date = dto.date` (validated YYYY-MM-DD), writes **one balanced journal** AR/AP legs + RETAINED_EARNINGS equity plug (**journalType = 2 — schema comment defines 2 = sales / 7 = opening — misclassification**), `autoBalance:false`, then **zeroes `parties.opening_balance`**; skips parties that already have a type=4 row (idempotent by skip — silent); requires `parties.manage`; posts `activity_log`. |
| G | Reports (`reports.slice.ts`) | `GET /reports/party-balances` (RequireAny `reports.view|parties.ledger`): balance = NULL-safe COALESCE(SUM, opening_balance); branch filter is **`p.branch_id OR p.branch_id IS NULL`** (wrong axis — ignores `ledger_entries.branch_id`); `HAVING … <> 0` drops opening-only parties. `GET /reports/debt-aging`: customers-type only; **no opening_balance fallback at all**; 4 aging buckets relative to CUR_DATE (no "not yet due"/"current" bucket); branch filter same party-axis. Dashboard receivables/payables: **`l.branch_id = $1`** (correct axis) — three screens, three different rules. |
| H | Sales posting (`sales.slice.ts:881`) | invoice creation: `if (partyId && remaining !== 0)` — **cash portion never creates a ledger entry** (correct by design); `direction = (sales"\|"purchase-return"\|invoiceType∈{1,4} ? 1 : 2)`; `entry_type=1`; **`entry_date = now()`** — NOT the invoice date (journal posts with `journalDate = invoiceDate`) → **subledger date ≠ GL date**. |
| I | Sales return (`invoiceType = 3`) | same path — direction 2, `entry_date = now()`. |
| J | Invoice edit (`sales.slice.ts:1078`) and cancel (`:1311`) | mirror reversal: `SELECT … CASE WHEN direction=1 THEN 2 ELSE 1 END, 5, amount … WHERE invoice_id = $1 AND entry_type <> 5` — entry_type=5 (adjustment); **entry_date = now()**; cancel sets `status=3, is_posted=false`; concurrent double-cancel serialized by `FOR UPDATE` on the invoice row. |
| K | Vouchers (`accounting.slice.ts:542` — create; `:643` — cancel) | create: ledger direction=2 `entry_type=2` credit, **`entry_date = COALESCE(dto.voucherDate, CURRENT_DATE)` ✓ document date**; GL journal one line-set (Dr cash/bank, Cr AR/AP). Cancel: reversal direction=1 `entry_type=5` **entry_date=now()** (not voucherDate); voucher journal set `status=3, posted_at=NULL` (voided, not reversed); allocations released → `paid_amount` restored BEFORE ledger reversal (no double release — invoice rows locked). |
| L | Allocations (`invoice_allocations` + `invoice_payments`) | settled via `VouchersService` — amount ≤ remaining; invoice same party; same type; invoice not cancelled; NO ledger entries created; NO GL entries created; invoice `paid_amount` moves. **Unallocated receipts DO reduce party balance at voucher creation** (correct). |
| M | Checks (`accounting.slice.ts:732/818`, `checks.slice.ts`) | check creation → entry_type=2 direction?; check bounce/return → reversal entry_type=2 **no entry_date column (defaults now())** — date always today, even for backdated check movements. |
| N | Installments (`installments.slice.ts:110/148`) | plan creation: entry_type=1 debit **now()**; schedule payment: **no entry_date → now()** — even when `paidDate` provided (cash side honors paidDate; subledger doesn't) — inconsistent. |
| O | Posting engine (`common/posting.ts`) | `postJournal` asserts `assertPeriodOpen` (closed/manually-locked periods 400 unless `accounting.backpost` + reason); status 2 = posted (posted_at=now()), status 1 = draft. `reverseJournal` creates mirror journal. Subledger has **NO period/assert check** — backdated documents post to ledger without period gate; backdated invoices (rare) post subledger at now(). |
| P | Opening-balance journal | journalType=2 (sales — should be 7 per schema comment), sourceType `opening_balance`, one journal AR debit/AP credit legs + RETAINED_EARNINGS plug (zero when AR total == AP total), `autoBalance:false`. |
| Q | RBAC (`common/security.ts` + `cli/seed.ts`) | permissions incl. `parties.view`, `parties.manage`, **`parties.ledger` («كشوف الحسابات»)** — unassigned granularity beyond view/manage; accountant & storekeeper & manager get it (Manager role); no statement-specific permission exists; ETA/ZATCA permissions separate. |
| R | Audit | opening balances → `activity_log`; party delete → blocked by FK scan (`countReferencingRows` includes ledger_entries) ✓; vouchers/journals → usual journals trace. No statement-specific audit until built (N/A). |

### 3.2 What exists for the statement UI
- **No web page renders `/parties/:id/statement`** — grep `id/statement` in `apps/web` = only accounting general-ledger page (unrelated report with date filters).
- Parties detail tab (`PartiesScreen.tsx`) — list/CRUD only; no ledger tab, no statement, no print/export.
- No invoice-statement endpoint under sales (`/invoices/:id` view exists; no print for statements).
- Export: generic `/reports/xlsx` exists, but party statement is not exposed to it.
- PDF/print: nothing statement-specific (ESC/POS agent excluded by design).

### 3.3 Subledger vs AR control (relationship map)
```
parties ──< ledger_entries (subledger, always "posted", tenancy = branch_id)
                 │  direction=1 debit, 2 credit; entry_type 1..5
                 ▼
  running balance (statement) = party.opening_balance + Σ per entry   [parties.slice.ts:140]

GL: 1103 (AR, mapping 'AR', type 1) ← gl_entries ← gl_journals (status 2)
    posted from invoices (sales.slice.ts via postJournal), vouchers, openings, checks, installments, adjustments
No code path compares ledger_entries Σ to 1103 Σ. No reconciliation report. No assert at close (E6 checks only journal balance/TB).
```

**Cross-branch leak axes (three different answers in three screens):**
1. `statement()` — NO branch scoping: reads **all branches** of the party.
2. POS credit-limit check (`sales.slice.ts:431`) — NO branch scoping: AR exposure is company-wide.
3. `partyBalances` / `debt-aging` — filter by **PARTY home branch** (`p.branch_id = $2 OR p.branch_id IS NULL`), ignoring entry branch entirely.
4. Dashboard receivables — filter by **ENTRY branch** (`l.branch_id = $1`).

A shared customer (`branch_id` = NULL or multi-branch) therefore shows one balance on the dashboard and another in the aging, and yet another on the statement. **There is no approved definition of "customer AR for branch B" anywhere in code or docs.**

### 3.4 Failure-mode inventory (evidence-backed, current code)
| # | Mode | Status today |
|---|---|---|
| 1 | Duplicate opening balance | Type=4 re-run is **skipped** (parties.slice.ts:328 `alreadyOpen`). But `statement()` uses `party.opening_balance + Σledger` → if column nonzero AND type=4 entries had been posted by another route (or data imported pre-tool), **double-count**. findOne/list/reports use `COALESCE(SUM, column)` → in the same dataset they show **different** numbers. **Inconsistent conventions.** |
| 2 | Missing ledger entries | Paid portion of invoices (by design); cash sales returns (`remaining=0`, by design); **vouchers→allocations fine**; **installments payment uses now() not paidDate** (date, not count); **installment plan debit uses now()**; **invoice entry date ≠ invoice date** (temporal, same rows exist but debits/credits carry wrong dates). |
| 3 | Duplicate ledger entries | No partial unique index. Mitigated only by status guards (`status=3` blocks double-cancel; FOR UPDATE serializes). Editing an invoice reverses & reposts — a prior version's reversal can never be issued twice (entry_type=5 excluded by callee). |
| 4 | Wrong debit/credit direction | Vouchers/receipts/payments direction=2 always; opening sign(dir) at post; sales dir by type; reversals mirror via CASE — within spec semantics. **No evidence of a wrong-direction write.** |
| 5 | Wrong running balance | `statement()` ORDER BY entry_date ASC — but `entry_date` is timestamptz with `now()` for many flows while others carry dates; same-day ordering falls back to `ledger_entry_id` (good tie-breaker ✓ present: `ORDER BY l.entry_date, l.ledger_entry_id`). The bigger defect: running balance **starts from column `parties.opening_balance`** — combined with type=4 entries reading (zeroed column), consistent ONLY if every opening was posted via the tool. |
| 6 | Branch leakage | `statement()`/POS check/aging/party-balances — documented in §3.1/3.3 (**3 different axis rules; none approved**). |
| 7 | Date-boundary errors | GL has `journal_date` = document date; subledger often `now()` (invoices, reversals, checks, installments) — a statement printed today for "as of last Tuesday" cannot be reconstructed reliably; backdated invoices land on today. |
| 8 | Unlinked/orphan entries | `invoice_id` nullable; opening/manual entries have no source document; `reference_no` free text; reversal entries linked via invoice_id ✓ for invoices, **not linked** for vouchers/checks/installments (reference text only). |
| 9 | Subledger vs AR-control divergence | **Never measured or reconciled anywhere.** Known divergences: (a) entry dates vs journal dates (same docs, different days) — a month-end cutoff report differs; (b) RETAINED_EARNINGS plug for opening AR−AP asymmetry; (c) vouchers with `voucherDate` for subledger vs `postJournal` journalDate = same COALESCE? (createVoucher calls postJournal with journalDate = voucherDate? — verified in code path for createVoucher: `postJournal({... journalDate: dto.voucherDate ?? undefined …})` — match ✓ for vouchers; mismatch persists for invoices). |
| 10 | Closed-period behavior | Subledger unaffected at all (no period check); vouchers backdated OK even into locked periods (but GL journal goes through `assertPeriodOpen` → voucher creation FAILS in locked period — subledger never sees the attempt) — behavior consistent-ish; reversals at now() bypass nothing since subledger has no lock concept. E6 backpost rules only guard GL. |

---

## 4. Gap analysis (Requirement | Implementation | Evidence | Gap | Severity | Class | Accounting impact | Recommended resolution | Owner approval?)

Legend classes: V-verified = implemented & code-reviewed only (never executed in tests); P = partially implemented; M = missing; D = defective; U = unknown.

| # | Requirement (E4 doc / accounting expectation) | Existing implementation | Exact evidence | Gap | Sev. | Class | Accounting impact | Recommended resolution | Owner approval |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Customer statement notifications (send AR open balance to customer) | Nothing | 0 matches `statement_*` in `apps/`,`db/` | Entire feature absent | **Critical (spec goal)** | M | None (zero-impact design, but collections impact: AR aging invisible to debtors) | Decide scope: (a) E4-notification automation only, or (b) account statement + PDF + then notifications; do not build before (b) exists | **Required** |
| 2 | "AR debit (open balance)" — definition & source | Subledger exists; AR-control exists; nothing compares them | `parties.ledger_entries` vs GL `1103`; §3.1A/H/I; posting.ts | Undefined source of truth for the trigger & for the statement body; two parallel ledgers can diverge (dates, plug account) | **High** | P | Wrong-amounts collection notices → customer disputes; audit failure | Owner decision: statement = subledger brought forward GL-reconciled, or GL-derived report; mandate a reconciliation assertion | **Required** |
| 3 | Statement endpoint (customer/supplier ledger view) | `/parties/:id/statement` | parties.slice.ts:134 | No branch filter, no date range, no brought-forward, unpaginated (unbounded), same endpoint serves customers & suppliers mixed semantics, no sign convention documented | **High** | P | AR control risk; unreconcilable report; performance at scale | Add parameters `from/to/branchMode(current"\|"all"\|selected)` + min/max guards; define sign convention (see §5.4) | **Required** |
| 4 | Subledger integrity — running balance from opening | Mixed conventions | statement uses `party.openingBalance`; findOne/list/reports COALESCE(SUM, col) | Inconsistent balance computation across screens — same customer shows 3 different balances | **High** | D | Disputes; reconciliation impossible without manual mapping | One canonical balance function; opening_balance handled once (either column or type=4, never both) | **Required** |
| 5 | Branch scope of customer AR | Three conflicting axes | §3.3 items 1–4 | Shared-customer AR ambiguous between current branch & company & party-home | **High** | D/U | Consolidated statements wrong per branch; POS limits applied on different exposure than branch expects | Choose: branch-filtered default with explicit "consolidated" opt-in, or company-wide default — owner decides | **Required** |
| 6 | Opening balance posting (tools) | Implemented: entry_type=4 + balanced journal + zeroing column | parties.slice.ts:316–390 | GL journal misclassified `journalType=2` (sales) — schema says `7=opening`; plug = RETAINED_EARNINGS; no unset/edit after post; opening effective date NOT enforced vs periods (journalDate unvalidated vs closed period? — postJournal asserts it ✓, so blocked ✓ good) | Medium | P/D | Report classification distortion; equity plug ≠ legal capital policy | Fix type to 7 (or document), decide plug account (opening-equity vs RE 3103) | **Required** |
| 7 | Aging/overdue report (E4 dependency for dunning) | `/reports/debt-aging` | reports.slice.ts:317 | Opening balances excluded; buckets relative to today only (no as-of); party-home branch filter; `HAVING > 0` hides zero-net but open-debit customers? (not exactly — sum>0 hides net-zero only — ok); supplier aging missing | Medium | P | Dunning targets wrong customers; early-warning absent | Extend: opening fallback, `asOf` param, both party types, current branch axis (or per #5) | **Required** |
| 8 | Same-day deterministic ordering | Present on subledger, absent part elsewhere | parties.slice.ts:145 `ORDER BY l.entry_date, l.ledger_entry_id` | OK for statement; parties list ORDER BY name without tie-breaker; vouchers allocation ordering not deterministic | Low | V | Cosmetic/race display | Add `, party_id` tie-breaker | Not required |
| 9 | Idempotency on statement-affecting ops | Invoices: client_request_id unique; voucher: serial; opening: skip-existing; reversal: entry_type≠5 guard; cancel: FOR UPDATE | sales.slice.ts: 884 reversal guard; accounting cancel flow | Reasonable — but statement read itself non-transactional (no snapshot read → torn state possible under concurrent posting) | Medium | P | Statement during concurrent posting shows pre-commit/partial? (READ COMMITTED per statement → mix) | Use `REPEATABLE READ` or read-time lock; document | Not required |
| 10 | Posted vs all entries | Subledger has no status flag; GL journals status=2 vs draft=1 both invisible to subledger | posting.ts postJournal; no status in ledger_entries | Draft manual journals never touch subledger anyway (subledger fed by documents) — equivalent effect, undocumented | Low | U | Acceptable | Document equivalence | Not required |
| 11 | Unallocated receipts & advances | Reduce balance at voucher; allocations separate | accounting.slice.ts: voucher path | Advances reduce AR immediately — no "unapplied credit" bucket in reporting; advance visible only as negative/credit balance in scalar | Medium | P | Customer sees credit not applied; collection actions misleading | Add "unapplied credits" KPI/filter (list reports) | **Required** |
| 12 | Returns & credit notes | Sales return = type 3 invoice, direction 2, parity with reversal | sales.slice.ts inverse | Cash returns with `remaining==0` produce no subledger trace → AR unchanged ✓ correct; report can't distinguish return vs receipt without joining type | Low | V | OK | Keep; expose `entryType` in API response (already exposed ✓) | Not required |
| 13 | Reversals consistency | Mirror entries type 5 both flows | sales slice J; voucher cancel K | Reversal `entry_date = now()` on voucher/invoice reversal — ledger shows two dates for one economic event (original doc date vs reversal date) | High (for statements) | D | Statement can't be reproduced as-of; date-range opening balance off | Reversal entry date = original document reference date where available (or linked `reverses_id`) — owner policy | **Required** |
| 14 | Cross-branch statements | No support | C/D/E above | Statement is company-wide unintentionally — leaks other branches' data to branch users with parties.ledger | **High** | D | Data exposure across branch scope (RID: user from branch B sees branch A transactions of shared customer) | Default: current branch entries only; consolidated flag explicit; enforce `x-branch-id` membership (`user_branches`) | **Required** |
| 15 | RBAC granularity | parties.ledger covers all | seed; security.ts | No send/unsubscribe/log permissions exist yet (spec proposes them?) — fine until built; **no statement print permission separate from parties.ledger** | Low | M | Over-broad once notifications ship | Define permissions when scope decided | **Required** (with E4 build) |
| 16 | Export (Excel) | Generic `/reports/xlsx` | reports builder | Customer statement not exposed | Medium | M | Collectors can't take statement offline | Expose statement dataset | Not required |
| 17 | Print (A5/A4/thermal) | None for statements | apps/web = 0 statement pages | Paper unavailable for in-person collection — very common requirement | Medium | M | Field collection blocked | Print layout + checklist (company identity, signatures) | **Required** |
| 18 | Reconciliation harness subledger↔GL-AR | None | 0 tooling in tools/ (grep «1103» reconcile = 0; E6 checks TB only) | Month-end close blind-spot; E6 close could pass with AR subledger 1 piastre off | **High** | M | Financial statements unreliable; audit qualified opinion risk | Owner-mandated automated assertion/report at close (E6 gate extension) | **Required** |
| 19 | Closed-period handling | Subledger ignores periods ✓ by design; GL backpost per `accounting.backpost` | common/posting.ts; ebook sign-off | OK concept-wise; backdated reversal not blocked (allowed) — dates mix; documented | Low | U | Policy ambiguity | Owner decision: should statement show reversal at doc date? | **Required** |
| 20 | Currency / FX | EGP only ✓ (ledger no currency col) | schema | No multi-currency — fine for Egypt scope | Low | V | None today | Defer | Not required |
| 21 | Subledger↔GL date alignment for invoices | **Mismatch** — entry now() vs journal invoiceDate | sales create path | Date-boundary defect (same rows as #13 class D) | **Medium/High** | D | Month-cut statements misstate "as at" balances | Pass `invoiceDate` into ledger insert (mirrors GL rule) | Not required |
| 22 | Statement in supplier (AP) side | Endpoint serves any party_type | C above | No separate AP statement definition or sign flip docs | Low | U | Ops confusion | Same endpoint, documented sign per party_type (policy §5.4) | **Required** |
| 23 | Zero-`is_posted` invoices / draft invoices | Draft invoices: status≠2 → GL none; subledger: entry created at creation regardless?? | sales invoice create always posts subledger entry — including **draft?** Invoices always status=2 at creation in this codebase (no draft invoice feature in sales flow) | N/A — equivalent | Low | U | — | Document | Not required |
| 24 | `parties.opening_balance` legacy column | Zeroed by tool; still read as COALESCE fallback | F above | Dead-ish column retained (bypass: none — create/update DTOs don't accept it ✓) | Low | V | None | Keep zeroed; consider migration to drop (future phase) | Not required |

**Count: 24 requirements classified — 1 Critical · 6 High · 7 Medium · 7 Low · scope classes: M=7 · P=7 · D=5 · V/U/other rest. Full E4 (notifications) is Missing.**

---

## 5. Proposed accounting policy — options and recommendations (NOT APPROVED DECISIONS — every item below = decision request)

Each item: **Options → Recommendation (marked) → Awaiting owner decision.**

### 5.1 Statement scope (branch visibility)
- **Options:** (A) current branch entries only; (B) branch selected by user (`x-branch-id` ∈ user's branches); (C) single branch via param; (D) consolidated company-wide; (E) per-branch columns inside one consolidated sheet.
- **Recommendation:** (B) default = current branch; (D) only with `scope=consolidated` AND permission `parties.ledger` + explicit branch-membership check — **owner decision #1.**

### 5.2 Opening balance treatment & effective date
- **Options:** (A) effective as of tool date (posted date); (B) effective as of user-entered date (current behavior); (C) effective as of a company-wide cutover date; (D) zero column & explicit `as-of` in every report.
- **Recommendation:** (B) as implemented + **statement opening always displayed as "رصيد افتتاحي" line, dated the ledger entry date, at the top of the range** — **owner decision #2.**

### 5.3 Posted vs approved vs all transactions in statements
- **Options:** (A) all subledger entries; (B) exclude draft/voided flows; (C) mirror GL: posted only (status=2).
- **Recommendation:** (A) — subledger has a single status (posted documents); GL voids vouchers (status=3) but ledger keeps mirror — treat as equivalent; unapproved manual journals never reach the subledger by construction. **owner decision #3.**

### 5.4 Debit/credit presentation & sign convention
- **Options:** (A) single scalar (current): + = they owe us, − = we owe them; (B) two columns (مدين/دائن); (C) signed per party_type (supplier balance flipped to positive = we owe them).
- **Recommendation:** (C) with headers «له علينا / علينا له» — or at minimum A + labeled direction column — **owner decision #4.** (Suppliers must read positive as payable, else UX is wrong half the time.)

### 5.5 Returns, receipts, allocations, reversals
- **Options:** (A) mirror entries (current, keep history — reversal as separate row); (B) net in-table view (exclude reversed pairs); (C) mirror + mark link (`reversal_of`).
- **Recommendation:** (A) + link column — **owner decision #5** (note: (B) breaks audit trail).

### 5.6 Unallocated receipts & customer advances (supplier deposits)
- **Options:** (A) reduce AR immediately (current) — advance visible only as negative balance; (B) hold in dedicated advance/suspense bucket (GL 1106?) until applied; (C) `unappliedCredit` list separate from AR.
- **Recommendation:** (A) now + (C) as reporting KPI; (B) only if owner wants reclassification entries (touching GL) — **owner decision #6.**

### 5.7 Date-range opening (brought forward, "رصيد مرحّل")
- **Options:** (A) no BF row — statement shows entity-old rows only (current impl leaks full history into any date range — actually current statement has NO date filter at all); (B) BF computed = party.opening_balance(current zero) + Σ entries before `from`; show as one synthetic row «رصيد مرحّل (قبل from)» with correct sign; (C) no BF row; user derives by `closing at from−1`.
- **Recommendation:** (B) — **owner decision #7.**

### 5.8 Cross-branch customer transactions
- **Options:** (A) block with 400 (subledger has single branch); (B) include tagged with branch code column; (C) consolidated-mode only.
- **Recommendation:** branch-filtered by default; consolidated explicitly tagged per row (branch_id shown) — **owner decision #8.**

### 5.9 Reconciliation against AR control account (1103)
- **Options:** (A) none — informational only; (B) monthly assertion report (subledger vs 1103 per branch) at E6 close; (C) hard assert — E6 close fails if Δ≠0.
- **Recommendation:** (B) now, (C) once divergences (§3.4 #7) are fixed; **owner decision #9.**

### 5.10 Closed periods & backdated documents
- **Options:** (A) statements show everything; (B) entries in closed periods shown read-only (current: yes — ledger always visible, no lock concept — fine); (C) journal reversals of closed-period documents get backpost rules (GL-controlled ✓) — keep.
- **Recommendation:** (B)/(C) status-quo preserved; backdated subledger writes already possible; reversals at now() **flagged for §5.7 date-policy decision** — **owner decision #10.**

### 5.11 Currency and rounding
- **Options:** (A) EGP fixed; (B) multi-currency statement lines; (C) rounding = 2dp everywhere (current).
- **Recommendation:** (A)+(C) — **owner decision #11** (expected trivially YES for Egypt).

### 5.12 Export / print scope
- **Options:** (A) screen-only JSON (current); (B) Excel export; (C) PDF/print A5/A4 (company identity, Arabic, signature lines, "لطفاً نوقع باسم الشركة" for collections); (D) WhatsApp/-email delivery of the PDF (E4 decision).
- **Recommendation:** (B) then (C); (D) only after E4 scope decision — **owner decision #12.**

---

## 6. Proposed test matrix (read-only design — NOT RUN; each expects independent values)

Prereq fixtures (isolated env): 2 branches (1, 2); 4 parties: P0 (clean, 0), P1 (customer), P2 (supplier), P3 (both-type); one warehouse each; items; chart-mapping AR/AP/RE 3103 intact; staff user + branch-limited user.

| # | Test | Initial state | Action | Expected ledger entries | Expected running balance | Expected GL effect | Expected API/UI |
|---|---|---|---|---|---|---|---|
| T1 | Zero-balance customer | P0, none | GET statement | 0 lines | 0.00, closing 0.00 | none | 200; body party + empty lines; closingBalance 0 |
| T2 | Opening debit balance | P1 fresh | open-balance tool: +500 | **1 entry type=4 dir=1 amt 500 date=X** | running shows «رصيد افتتاحي 500» | Dr 1103 500 / Cr 3103 500, journalType expected **7** (fix pending) | 200; closing 500 |
| T3 | Opening credit balance (supplier w/ positive meaning) | P2 fresh | open tool: −800 (negative) | type=4 dir=2 amt 800 | BF −800 (with §5.4 (C) flip: AP display +800) | Dr 3103 800 / Cr 2101 800 | 200; consistent signs per policy |
| T4 | Cash sale invoice 100 (P1) | P0; item stock 10 | sell qty1 unitPrice 100, full cash | **NO entry** (remaining=0) | unchanged | Dr 1104 100 / Cr 4101 100 | 200 POS OK |
| T5 | Credit sale invoice 115 (P1, tax 15) | item stock 10 | credit sale, remaining=115 | **1 entry type=1 dir=1 amt 115 date=**policy date (`journal?` date today; **expected date = invoiceDate under #13 fix; now() today otherwise — test SHOULD accept either after fix decision**) | 615 | Dr 1103 115 / Cr 4101/2102 as mapped | 200; statement shows invoice line |
| T6 | Partial receipt 40 (P1) | after T5 | voucher type=1 amount=40, no allocation | **1 entry type=2 dir=2 amt 40** | 575 | Dr 1104 40 / Cr 1103 40 | 200; balance 575 |
| T7 | Full receipt 75 (P1) | after T6 | voucher 75 | type=2 dir=2 75 | 500 | Dr 1104 75 / Cr 1103 75 | 200 |
| T8 | Allocated receipt | T5 unpaid + voucher 115 alloc to T5-invoice | voucher 115 allocation→invoice | entry type=2 115 (once, at voucher) | 485 (balance −115 from 500+115+… recount) — **independent calc**: balance = 115(T5) − 40 − 75 = 0 if same-voucher sequence; adjust per fixture plan — expected stated as formula: `115 − 40 − 75`  per ordered ops | Dr 1104 115 / Cr 1103 115; invoice paid_amount 115 status → paid | UI: invoice shows مدفوع fully |
| T9 | Unallocated receipt (advance) | P1 zero | voucher 200 to P1, no allocations | type=2 200 | **−200 (customer advance)** | Dr 1104 200 / Cr 1103 200 | 200; UI flags "advance" badge (after build) |
| T10 | Sales return 15 (P1) | after T5 unpaid 115 | type-3 invoice return 15 | **1 entry type=1 dir=2 amt 15** (direction 2 for return) date=policy | 485- … formula `115 − 40 − 75 − 15` = −15?? — fix per fixture (use clean: fresh P1, T5-like, return more than remainder impossible? — allowed if invoice open) | Dr 4101 15 / Cr 1103 15 (return mirrors) | statement shows SR- line |
| T11 | Invoice cancel (T5-equivalent) | open invoice 115 P1 | cancel via UI | **2 entries: original 1 dir=1 115 **+** mirror 1 dir=2 115 (entry_type=5)** | net 0.00 | journal status→3 (or mirror) | 200; statement shows both rows net 0; GL no 1103 effect |
| T12 | Receipt cancel | T6 exists | cancel voucher | **1 reversal type=5 dir=1 amt 40** | back to pre-T6 | journal status→3; invoice paid_amount restored if allocated | statement shows receipt + reversal rows |
| T13 | Same-day ordering | P1: entries created same date from invoice + voucher | GET statement | order: `ORDER BY entry_date ASC, ledger_entry_id ASC` | deterministic | n/a | API bytewise-stable across runs |
| T14 | Date-range with BF | entries pre-T1 + T5 | GET `?from=+7d` | BF row synthetic = closing(at from−1) + period rows | matches independent Σ | n/a | closing equals GL-comparability check per #5.9 |
| T15 | Empty date range | — | `from>today+1y` | 0 rows, BF = current closing | BF equals full-range closing | n/a | 200 empty |
| T16 | >200 transactions | P1 250 entries | statement | 250 rows, no LIMIT | O(n) read | n/a | 200 (watch timeout) |
| T17 | Cross-branch shared customer | P1 (branch NULL) posts in branch 1 & 2 | statement default | branch-filtered only (or per policy #5.1); consolidated shows both tagged | per-policy | n/a | 200 |
| T18 | Unauthorized user for another branch | branch-scoped user attempts branch 2 statement w/ consolidated | GET consolidated | 403; no data leak (entries from branch 2 hidden) | n/a | n/a | 403 |
| T19 | Party-type validation | voucher type=2 vs customer-only path | mismatch attempt | 400 «نوع الفاتورة غير متوافق»/«لا يمكن إدراج عميل هنا» | unchanged | unchanged | 400 |
| T20 | Closed period (current month close) | P1 open | backdate invoice to closed month | **GL refuses 400**; subledger: invoice fails before ledger insert (creation blocked ✓) | unchanged | no journal; no 1103 | 400 «الفترة مقفلة» |
| T21 | Duplicate requests (double-submit) | P1 | resubmit same clientRequestId | **no second entry** (unique constraint → replay) | unchanged | no double 1103 | 200 replay body identical |
| T22 | Concurrent posting vs statement read | T5 posting thread + statement read | read during | statement consistent snapshot OR blocks — either per policy #10 | n/a | n/a | stable output or retry |
| T23 | Subledger vs AR control (T-2..T-22 aggregated) | after full flow | query both sides | Σ(subledger customers) == GL Σ(1103 by branch) **Δ = 0.00 totals** — **in isolated test env only; not production** | n/a | assertion report | diff printed; expected 0.00 |
| T24 | Unallocated voucher + allocation later | T8-style with split allocations (2 invoices) | alloc → both | one entry per voucher (not per allocation); alloc updates paid_amount each | per formula | per allocation GL? none (alloc no GL — correct) | UI shows both invoices partially/fully paid |

**Independent-value rule:** every expected figure above derived from minimal fixtures listed in the row (quantities × documented invoice/voucher semantics) — **never** copied from current code behavior (the code itself is the suspect — e.g. T5/T11/T21 deliberately treat code behavior as NOT acceptable expected output).

**DB-write requirement:** T2–T24 mutate data/schema. **NOT EXECUTED — separate authorization required** (isolated environment only: e.g., `wasel_e4test` PGlite + API on another port; production forbidden).

---

## 7. Files likely affected by a future E4 implementation (NOT modified)

| Layer | Files |
|---|---|
| Schema/migrations | new `db/migrations/2026-…-e4-customer-statements.sql` — `statement_templates`, `statement_triggers`, `statement_log`, `statement_unsubscriptions` (+ check constraints, indexes `(party_id, sent_at)`) |
| API module | `apps/api/src/modules/customer-statements/*` (new vertical slice — **not** inside parties slice); scheduler/`common/scheduler.ts` (new) |
| Parties subsystem | `parties.slice.ts` — statement endpoint: branch/date/BF/pagination/scope params; fix `statement()` opening convention; add `unsubscribed` reach; extend reports slice (aging as-of, both types, BF fallback) |
| Sales/treasury/checks/installments writers | same ledger writer sites — date fixes (invoice/reversal/check/installment dates honor document date) |
| Posting engine | no changes required (posting.ts covers GL; subledger unaffected) |
| Reports | extend `/reports/debt-aging`, add `/reports/customer-statement` dataset; XLSX exposure |
| Web | new pages `/customers/[id]/statement` (preview/print/export), notification center tab, sidebar entry + AccountingNav |
| RBAC/seed | `cli/seed.ts` + `common/security.ts` — new permissions `statements.view/manage/send`, `statements.trigger`, unsubscribe rights |
| Infra | SMTP env wiring; WhatsApp deep-link or Business API; cron (`node-cron` or OS Task Scheduler) — decide scheduler platform (§2.2) |
| Tests/tools | `tools/smoke-test.js` section; `tools/e4-statement-test.js` (new) on isolated env; Month-simulation regression |

---

## 8. Explicit items requiring owner decisions

1. **Scope split** — E4-A: notification automation alone (spec as written); E4-B: customer account statement (balance + print/export/Excel) as a standalone deliverable; E4-C: statement + notifications together; E4-D: deferral (E4 stays unbuilt; document as backlog).
2. **Statement data source** — subledger (with GL reconciliation assert) vs GL-derived vs dual.
3. **Branch scope axis** — current branch default / consolidated / both modes with permission gate (see #5).
4. **Opening-balance conventions** — column vs type=4 uniqueness; statement opening row; BF row semantics (§5.7).
5. **Date policy** — invoice entry date = invoiceDate fix; reversal entries date = original doc date vs today; installment/check dates.
6. **Aging** — include opening; as-of date param; supplier aging;
7. **Dunning fees** — any GL posting (Dr 5107/Cr 1106) — spec says optional; approve/decline.
8. **WhatsApp channel semantics** — wa.me manual (not automatable, §2.1-5) vs Business Cloud API (account, templates, cost, compliance) vs none.
9. **Notification content** — exact fields (AR open balance, oldest due, phone, no invoice links, no payment URLs) & language/locale.
10. **Cron platform & time** — 03:00 Cairo? worker on API host? `pg_cron` requires extension ownership — approve.
11. **Unsubscribe & compliance** — mandatory unsubscribe link/email header; honor parties flag; retention of statement_log (GDPR-ish).
12. **Reconciliation gate at E6 close** — hard vs soft assert subledger↔1103 (see #5.9).
13. **Supplier statements** — include AP in scope or customers only.
14. **RBAC** — accountant view-only vs send rights; collector role?
15. **Print/export before notifications?** — PDF/A5/A4 statement as independent deliverable.

---

## 9. Accounting risks (severity-ordered)

1. **Unverified AR truth** — subledger vs GL 1103 never compared → chance of systemic drift (entry dates differ; opening plug route differs). **High.**
2. **Statement correctness for backdated/cancelled docs** — invoice/reversal dates (`now()`) vs document dates; a "as of" statement is wrong even though live closing equals. **High.**
3. **Branch leak** — users with `parties.ledger` see all branches; no scope filter exists — RID/permission-scope violation. **High.**
4. **Balance inconsistency across screens** — COALESCE-vs-SUM-start opening conventions differ → same customer, three numbers. **High.**
5. **Opening-balance equity plug** — RETAINED_EARNINGS used as opening plug — distorts retained earnings; should be a dedicated opening equity/capital account. **Medium.**
6. **Aging excludes opening** — dunning starts after tool run only. **Medium.**
7. **Orphaned reversal lines** — statement mirror rows unlinked (vouchers/checks/installments have no `invoice_id`) — reconciliation by hand required. **Medium.**
8. **Idempotency gaps in reads** — statement read not snapshot-isolated. **Low.**
9. **Type misclass (opening journal type=2)** — classification noise. **Low.**
10. **advance = negative AR** — no unapplied-credit policy → collections confusion. **Low–Medium.**

---

## 10. Final recommendation

**NOT READY FOR IMPLEMENTATION. READY FOR POLICY DECISIONS.**

Reasons, concretely:
- The only E4 spec (`docs/E4-CUSTOMER-STATEMENTS.md`) covers **notifications only** and is marked «تصميم فقط»; it does not specify statement content, branch scope, date semantics, opening balances, aging, print/export, or reconciliation — the substance this audit was chartered to test.
- Zero implementation exists: no `statement_*` tables, no module, no route, no web page, no scheduler, no SMTP config, no WhatsApp integration, no AR-vs-subledger assertion.
- The code that *would* feed a statement exists but is **internally inconsistent** (three balance axes, COALESCE vs SUM conventions, `now()` entry dates vs GL document dates, no period lock on the subledger, unverified subledger↔GL-AR).
- Approving any E4 build now would encode contested accounting policy into a customer-facing artifact (disputes, RID leakage, unreconcilable AR).

**Proposed decision sequence for the owner:**
1. Decide scope (#8-1 E4-A/B/C/D) and statement data source (#8-2) and branch axis (#8-3).
2. Approve the 12 policy items in §5 (target ≤ 2 sessions).
3. Mandate remediation of gaps #3, #4, #5, #13/#21 (statement endpoint fixes + BF row + date alignment) — small, mechanical, isolated.
4. Re-audit this file after decisions; only then issue implementation authorization with its own acceptance gate (T1–T24 on isolated env; `npm test`; no production).

**Explicit stops:** no code changes, no migrations, no commits, no E4 build, no production/Supabase access, per authorization. All verification above is via static code/schema inspection only — **zero database contact**; any test execution (T1–T24) requires separate owner approval and an isolated environment.
