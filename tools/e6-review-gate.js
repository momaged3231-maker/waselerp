/* E6 — FINAL INDEPENDENT ACCOUNTING REVIEW (automated gate).
 *
 * Requirements before running (everything else is refused):
 *   - PGlite on 127.0.0.1:5434 with a FRESHLY recreated `wasel_e6rev`
 *     (DROP DATABASE → migrate-all → seed-reference → seed)
 *   - the API built from THIS branch on PORT=4260 with
 *     DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5434/wasel_e6rev
 *
 *   node tools/e6-review-gate.js
 *
 * Every check prints G<n> PASS/FAIL; the process exits non-zero if anything failed.
 * Nothing here touches production or the local `wasel` database.
 */
'use strict';
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.E6_BASE ?? 'http://127.0.0.1:4260/api';
const PG_CONN = process.env.E6_PG ?? 'postgres://postgres:postgres@127.0.0.1:5434/wasel_e6rev';

const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok: !!ok, evidence: evidence == null ? '' : String(evidence).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + String(evidence).slice(0, 300)}`);
};
const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

const state = {};
(async () => {
  // --------------------------------------------------------------- env + login
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  if (!login.accessToken) { console.error('FATAL: login failed', login); process.exit(2); }
  state.token = login.accessToken;
  state.branchA = login.activeBranchId;
  const sql = new Client({ connectionString: PG_CONN });
  await sql.connect();
  state.sql = sql;

  const call = async (method, p, body, branchOverride) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` };
    if (branchOverride || state.branchA) headers['x-branch-id'] = String(branchOverride ?? state.branchA);
    const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(data)}`.slice(0, 300));
    return data;
  };
  const raw = async (method, p, body, branchOverride, tokenOverride) => {
    const headers = { 'Content-Type': 'application/json' };
    if (tokenOverride !== undefined) { if (tokenOverride) headers.Authorization = `Bearer ${tokenOverride}`; }
    else headers.Authorization = `Bearer ${state.token}`;
    if (branchOverride || state.branchA) headers['x-branch-id'] = String(branchOverride ?? state.branchA);
    const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
    return { status: r.status, ok: r.ok, body: data };
  };
  const q = (text, params) => state.sql.query(text, params);
  const tbSnapshot = async (from, to) => call('GET', `/accounting/reports/trial-balance${from ? `?from=${from}&to=${to}` : ''}`);
  // Independent recompute of the period's net from RAW journals (never from close-report).
  const independentNet = async (from, to, branchId) => {
    const { rows } = await q(
      `SELECT COALESCE(SUM(CASE WHEN a.account_type = 4 THEN e.credit - e.debit ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN a.account_type = 5 THEN e.debit - e.credit ELSE 0 END), 0) AS expense
         FROM gl_entries e
         JOIN gl_accounts a ON a.account_id = e.account_id
         JOIN gl_journals j ON j.journal_id = e.journal_id
        WHERE j.status = 2 AND j.branch_id = $1::int AND j.journal_date BETWEEN $2::date AND $3::date`,
      [branchId, from, to]);
    const revenue = Number(rows[0].revenue), expense = Number(rows[0].expense);
    return { revenue, expense, net: Math.round((revenue - expense) * 100) / 100 };
  };
  const retainedBalance = async (branchId) => {
    const { rows } = await q(
      `SELECT COALESCE(SUM(e.credit - e.debit), 0) AS retained
         FROM gl_entries e
         JOIN gl_accounts a ON a.account_id = e.account_id
         JOIN gl_journals j ON j.journal_id = e.journal_id
        WHERE a.code = '3103' AND j.status = 2 AND j.branch_id = $1::int`, [branchId]);
    return Number(rows[0].retained);
  };
  const findAccount = (nodes, code) => {
    for (const node of nodes ?? []) {
      if (node.code === code) return node;
      const hit = findAccount(node.children, code);
      if (hit) return hit;
    }
    return null;
  };
  const accountsTree = await call('GET', '/accounting/accounts');
  const glId = (code) => { const f = findAccount(accountsTree, code); if (!f) throw new Error(`GL ${code} not found`); return Number(f.accountId); };

  const { rows: [admin] } = await q('SELECT user_id FROM users WHERE user_name = $1', ['admin']);
  const adminId = Number(admin.user_id);

  // --------------------------------------------------- 1) branches + periods
  const mkBranch = async (code, name) => {
    const r = await raw('POST', '/admin/branches', { code, name });
    if (r.ok) return r.body.branchId;
    const found = (await call('GET', '/admin/branches')).find((b) => b.code === code);
    if (found) return Number(found.branchId ?? found.id);
    throw new Error(`branch ${code} could not be created or found: ${JSON.stringify(r.body)}`);
  };
  const branchB = await mkBranch('BR2', 'فرع المراجعة — الثاني');
  const branchC = await mkBranch('BR3', 'فرع المراجعة — الثالث');
  const branchD = await mkBranch('BR4', 'فرع المراجعة — الرابع');
  const tbCanon = (tb) => (tb.lines ?? [])
    .map((l) => [Number(l.accountId), Number(l.balance ?? 0)])
    .sort((a, b) => a[0] - b[0]);
  const tbDiff = (a, b) => {
    const A = new Map(tbCanon(a));
    const B = new Map(tbCanon(b));
    const out = [];
    for (const id of new Set([...A.keys(), ...B.keys()])) {
      const x = A.get(id) ?? 0, y = B.get(id) ?? 0;
      if (Math.abs(x - y) > 0.005) out.push({ accountId: id, before: x, after: y });
    }
    return out;
  };
  const live = async () => tbSnapshot();

  const A = state.branchA;
  const mkPeriod = async (branch, name, startDate, endDate) => {
    return (await call('POST', '/accounting/periods', { name, startDate, endDate }, branch)).periodId;
  };
  const pOctA = await mkPeriod(A, 'أكتوبر 2026', '2026-10-01', '2026-10-31');
  const pNovA = await mkPeriod(A, 'نوفمبر 2026', '2026-11-01', '2026-11-30');
  const pOctB = await mkPeriod(branchB, 'أكتوبر 2026 — فرع ب', '2026-10-01', '2026-10-31');
  const pDecC = await mkPeriod(branchC, 'ديسمبر 2026 — فرع ج', '2026-12-01', '2026-12-31');
  const pOpenD = await mkPeriod(branchD, 'فترة مفتوحة بلا نهاية — فرع د', '2026-12-01', null);
  console.log(`setup: A=${A} B=${branchB} C=${branchC} D=${branchD} periods A-oct=${pOctA} A-nov=${pNovA} B=${pOctB} C=${pDecC} D=${pOpenD}`);

  // --------------------------------------------------- 2) branch A fixtures
  const cashMain = (await call('GET', '/treasury/accounts'))[0];
  const bankA = await call('POST', '/treasury/accounts', { name: 'بنك المراجعة الرئيسي', type: 2, bankName: 'بنك', glAccountId: glId('1102'), openingBalance: 0 });
  const bankAId = Number(bankA.cashAccountId);
  // sales + return + discount + accrual + its reversal, all in October 2026
  await call('POST', '/accounting/journals', { description: 'مبيعات نقدية', journalDate: '2026-10-08', post: true, lines: [
    { accountId: glId('1101'), debit: 105000, description: 'حصيلة المبيعات' },
    { accountId: glId('4101'), credit: 90000, description: 'إيرادات مبيعات' },
    { accountId: glId('2102'), credit: 15000, description: 'ضريبة القيمة المضافة' },
  ] });
  await call('POST', '/accounting/journals', { description: 'مرتجع مبيعات', journalDate: '2026-10-12', post: true, lines: [
    { accountId: glId('4102'), debit: 4500, description: 'مردودات مبيعات' },
    { accountId: glId('2102'), debit: 750, description: 'ضريبة المرتجع' },
    { accountId: glId('1101'), credit: 5250, description: 'رد النقدية' },
  ] });
  await call('POST', '/accounting/journals', { description: 'خصم مسموح به', journalDate: '2026-10-12', post: true, lines: [
    { accountId: glId('4103'), debit: 1000, description: 'خصم مسموح به' },
    { accountId: glId('1101'), credit: 1000, description: 'نقص النقدية' },
  ] });
  await call('POST', '/accounting/journals', { description: 'مستحق — استحقاق مصروف', journalDate: '2026-10-05', post: true, lines: [
    { accountId: glId('5108'), debit: 3000, description: 'استحقاق مصروف' },
    { accountId: glId('2103'), credit: 3000, description: 'مصروفات مستحقة' },
  ] });
  await call('POST', '/accounting/journals', { description: 'عكس استحقاق أكتوبر', journalDate: '2026-10-25', post: true, lines: [
    { accountId: glId('2103'), debit: 3000, description: 'عكس المستحق' },
    { accountId: glId('5108'), credit: 3000, description: 'عكس المصروف' },
  ] });
  await call('POST', '/accounting/journals', { description: 'مبيعات نوفمبر (خارج نافذة أكتوبر)', journalDate: '2026-11-02', post: true, lines: [
    { accountId: glId('1101'), debit: 5000, description: 'نقدية نوفمبر' },
    { accountId: glId('4101'), credit: 5000, description: 'إيرادات نوفمبر' },
  ] });
  // draft journal — posted later (draft check wiring)
  const draftJournal = await call('POST', '/accounting/journals', { description: 'قيد مسودة للمراجعة', journalDate: '2026-10-05', post: false, lines: [
    { accountId: glId('5106'), debit: 777, description: 'مصروف مسودة' },
    { accountId: glId('1101'), credit: 777, description: 'نقص النقدية' },
  ] });
  const draftJournalId = Number(draftJournal?.journalId ?? draftJournal?.id);
  console.log(`A fixtures: bankA=${bankAId} draftJournal=${draftJournalId}`);

  // ---------------- E3 rules in branch A: monthly/quarterly/semi-annual/annual + suspension + end-date
  const mkRule = async (dto) => (await call('POST', '/accounting/bank-expense-rules', dto)).ruleId;
  const r1 = await mkRule({ name: 'MREVIEW شهري', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 100, frequency: 1, dayOfMonth: 20, startDate: '2026-10-05' });
  const r2 = await mkRule({ name: 'MREVIEW ربع سنوي', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 200, frequency: 2, dayOfMonth: 20, startDate: '2026-10-05' });
  const r3 = await mkRule({ name: 'MREVIEW نصف سنوي', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 300, frequency: 3, dayOfMonth: 20, startDate: '2026-10-05' });
  const r4 = await mkRule({ name: 'MREVIEW سنوي', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 400, frequency: 4, dayOfMonth: 20, startDate: '2026-10-05' });
  const r5 = await mkRule({ name: 'MREVIEW متأخر', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 500, frequency: 1, dayOfMonth: 3, startDate: '2026-10-02' });
  const r6 = await mkRule({ name: 'MREVIEW موقوف قبل الاستحقاق', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 600, frequency: 1, dayOfMonth: 25, startDate: '2026-10-15' });
  const r7 = await mkRule({ name: 'MREVIEW بحد أقصى', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 700, frequency: 1, dayOfMonth: 9, startDate: '2026-10-05', endDate: '2026-10-31' });
  const r8 = await mkRule({ name: 'MREVIEW سنوي 28', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 800, frequency: 4, dayOfMonth: 28, startDate: '2025-10-28' });
  // Suspend r6 NOW — its Oct 25 occurrence is before suspension? No: suspension is 2026-11-16,
  // Oct 25 < suspension → still due. Suspension is used for the NOVEMBER branch (rNovB below).
  console.log(`rules: ${r1},${r2},${r3},${r4},${r5},${r6},${r7},${r8}`);

  // ---------------- E5 assets in branch A
  const mainCashId = Number(cashMain.cashAccountId);
  const a1 = (await call('POST', '/accounting/assets', { name: 'أصل مراجعة أ', category: 'معدات', cost: 120000, residualValue: 0, usefulLifeMonths: 120, acquisitionDate: '2026-10-01', inServiceDate: '2026-10-10', depreciationMethod: 1, paymentType: 1, cashAccountId: mainCashId })).assetId;
  const a2 = (await call('POST', '/accounting/assets', { name: 'أصل مراجعة ب مستهلَك', category: 'معدات', cost: 10000, residualValue: 0, usefulLifeMonths: 12, acquisitionDate: '2024-12-01', inServiceDate: '2025-01-15', depreciationMethod: 1, paymentType: 1, cashAccountId: mainCashId })).assetId;
  const a3 = (await call('POST', '/accounting/assets', { name: 'أصل مراجعة ج يبدأ بالمنتصف', category: 'معدات', cost: 62000, residualValue: 2000, usefulLifeMonths: 10, acquisitionDate: '2026-10-20', inServiceDate: '2026-10-25', depreciationMethod: 1, paymentType: 1, cashAccountId: mainCashId })).assetId;
  const a4 = (await call('POST', '/accounting/assets', { name: 'أصل مراجعة د مستبعد قبل أكتوبر', category: 'معدات', cost: 6000, residualValue: 0, usefulLifeMonths: 60, acquisitionDate: '2025-02-01', inServiceDate: '2025-03-01', depreciationMethod: 1, paymentType: 1, cashAccountId: mainCashId })).assetId;
  await call('POST', `/accounting/assets/${a4}/dispose`, { disposalType: 1, disposalDate: '2026-09-20', disposalAmount: 1000, cashAccountId: mainCashId, reason: 'استبعاد قبل الإقفال — اختبار' });
  const a5 = (await call('POST', '/accounting/assets', { name: 'أصل مراجعة هـ قيمة تخريدية', category: 'معدات', cost: 50000, residualValue: 10000, usefulLifeMonths: 20, acquisitionDate: '2024-05-01', inServiceDate: '2024-06-01', depreciationMethod: 1, paymentType: 1, cashAccountId: mainCashId })).assetId;
  console.log(`assets: ${a1},${a2},${a3},${a4}(مستبعد 2026-09-20),${a5}`);
  // Backfill the FULL history for a2 (fully consumed) and a5 (residual reached) so the
  // "not due" verdicts are real: accumulated lines exist and remaining = 0 by Oct 2026.
  {
    const months = [];
    for (let y = 2024; y <= 2026; y += 1) for (let m = 1; m <= 12; m += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key < '2024-06' || key > '2026-09') continue;
      months.push(key);
    }
    for (const month of months) {
      await call('POST', '/accounting/assets/run-depreciation', { periodMonth: month });
    }
    const { rows: backfill } = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(depreciation_amount),0)::numeric AS total FROM asset_depreciation_lines`);
    console.log(`depreciation backfill complete: ${backfill[0].n} lines, total ${backfill[0].total}`);
  }

  // ---------------- branch B fixtures (isolation): unmatched bank line + open shift
  await call('POST', '/treasury/accounts', { name: 'درج فرع ب', type: 1, openingBalance: 0 }, branchB);
  const bankB = await call('POST', '/treasury/accounts', { name: 'بنك المراجعة — فرع ب', type: 2, bankName: 'بنك', glAccountId: glId('1102'), openingBalance: 0 }, branchB);
  const bankBId = Number(bankB.cashAccountId);
  await q(
    `INSERT INTO bank_statement_lines (bank_account_id, branch_id, statement_date, description, movement_type, amount, status, created_by)
     VALUES ($1::int, $2::int, '2026-10-15', 'سحب مجهول — فرع ب', 1, 999.99, 1, $3::int)`,
    [bankBId, branchB, adminId]);
  await call('POST', '/treasury/shifts/open', { openingBalance: 100 }, branchB);
  console.log(`branch B fixtures: bank=${bankBId} unmatched line + open shift`);

  // ================= G1 — first pre-close (nothing posted yet) =================
  console.log('\n--- G1 pre-close: expected failures on E3 / E5 / draft; B isolation ---');
  const pre1 = await call('POST', `/accounting/periods/${pOctA}/preclose-check`, {});
  const chk = (code) => (pre1.checks ?? []).find((c) => c.checkCode === code);
  check('preclose lists the E3-due check and it FAILS (due occurrences ungenerated)', chk('e3_bank_expense_due')?.status === 3, JSON.stringify(chk('e3_bank_expense_due')));
  check('preclose lists the E5-due check and it FAILS (due depreciation unposted)', chk('e5_depreciation_due')?.status === 3, JSON.stringify(chk('e5_depreciation_due')));
  check('preclose draft-journal check FAILS (one draft in the window)', chk('no_draft_journals')?.status === 3, JSON.stringify(chk('no_draft_journals')));
  check('preclose balanced journals PASS', chk('journals_balanced')?.status === 2, JSON.stringify(chk('journals_balanced')));
  check('preclose trial-balance sanity PASS', chk('trial_balance_balanced')?.status === 2, JSON.stringify(chk('trial_balance_balanced')));
  check('branch isolation: open shift in B is invisible to A (PASS)', chk('no_open_shifts')?.status === 2, JSON.stringify(chk('no_open_shifts')));
  check('branch isolation: unmatched bank line in B is invisible to A (PASS)', chk('no_unreconciled_bank_lines')?.status === 2, JSON.stringify(chk('no_unreconciled_bank_lines')));

  console.log('\n--- G2 close refused without bypass; independent recompute ---');
  const tbA0 = await tbSnapshot();
  const expectedNetA = await independentNet('2026-10-01', '2026-10-31', A);
  const refused = await raw('POST', `/accounting/periods/${pOctA}/close-month`, {});
  check('close-month is REFUSED (400) while E3/E5/draft are open', refused.status === 400, `status=${refused.status}`);
  check('refusal message mentions the missing E3 generation', String(refused.body?.message ?? '').includes('استحقاقات'), refused.body?.message);
  check('refusal message mentions the missing depreciation', String(refused.body?.message ?? '').includes('إهلاك'), refused.body?.message);
  check('trial balance passed is reported balanced by the API', tbA0.balanced === true, '');

  console.log('\n--- G3 draft journal posted; close still refused (E3/E5 only) ---');
  await call('POST', `/accounting/journals/${draftJournalId}/post`, {});
  const pre2 = await call('POST', `/accounting/periods/${pOctA}/preclose-check`, {});
  const chk2 = (code) => (pre2.checks ?? []).find((c) => c.checkCode === code);
  check('draft-journal check now PASSES after posting', chk2('no_draft_journals')?.status === 2, JSON.stringify(chk2('no_draft_journals')));
  check('E3 check still FAILS', chk2('e3_bank_expense_due')?.status === 3, JSON.stringify(chk2('e3_bank_expense_due')));
  check('E5 check still FAILS', chk2('e5_depreciation_due')?.status === 3, JSON.stringify(chk2('e5_depreciation_due')));

  console.log('\n--- G4 bypass-with-reason close, then reverse (evidence + mirror in-window) ---');
  const tbBeforeG4 = await live();
  const bypass = await call('POST', `/accounting/periods/${pOctA}/close-month`, { bypassReason: 'اعتماد المراجعة المستقلة — اختبار البوابة' });
  check('closing with an explicit authorized bypass reason succeeds', bypass?.isClosed === true && !!bypass.journalId, JSON.stringify(bypass).slice(0, 200));
  const reportBypass = await call('GET', `/accounting/periods/${pOctA}/close-report`);
  const bypassE3 = (reportBypass.checks ?? []).find((c) => c.checkCode === 'e3_bank_expense_due');
  const bypassE5 = (reportBypass.checks ?? []).find((c) => c.checkCode === 'e5_depreciation_due');
  check('bypass is recorded on the E3 check (status 4) with the reason', bypassE3?.status === 4 && String(bypassE3?.details ?? '').includes('اعتماد المراجعة المستقلة'), JSON.stringify(bypassE3));
  check('bypass is recorded on the E5 check (status 4) with the reason', bypassE5?.status === 4, JSON.stringify(bypassE5));
  const reverseBypass = await call('POST', `/accounting/periods/${pOctA}/reverse-close`, { reason: 'اختبار: عكس الإقفال المتجاوز لإعادة التوليد الكامل' });
  check('reverse-close reopens the period', reverseBypass.isClosed === false, JSON.stringify(reverseBypass));
  const mirror = await q(`SELECT journal_date::text AS d FROM gl_journals WHERE journal_id = $1::bigint`, [reverseBypass.reverseJournalId]);
  check('mirror journal is dated INSIDE the reversed period (2026-10-31)', mirror.rows.length === 1 && mirror.rows[0].d === '2026-10-31', JSON.stringify(mirror.rows));
  const tbAfterReverse1 = await live();
  check('TB after reverse equals TB before that close (normal-side balances, account-by-account)',
    tbDiff(tbBeforeG4, tbAfterReverse1).length === 0,
    JSON.stringify(tbDiff(tbBeforeG4, tbAfterReverse1).slice(0, 6)));

  console.log('\n--- G5 E3 generation: due vs suspension vs frequency ---');
  const e3 = await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2026-10-31' });
  const postedNames = (e3.posted ?? []).map((p) => p.name).sort();
  // The 2025-10-28 annual anchor legitimately posts TWICE in one run (2025-10-28 and
  // 2026-10-28) — deterministic backfill of everything due up to asOf.
  check('E3 generated every due occurrence (8 October occurrences + the 2025 annual backfill = 9)', (e3.posted ?? []).length === 9, JSON.stringify(postedNames));
  const { rows: runR8 } = await q(`SELECT period_key::text AS d FROM bank_expense_runs WHERE rule_id = $1::int AND status = 1`, [r8]);
  check('annual 2025-anchor rule posted its 2026-10-28 occurrence', runR8.some((r) => r.d === '2026-10-28'), JSON.stringify(runR8));
  const e3Again = await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2026-10-31' });
  check('re-running E3 posts nothing (zero duplicates)', (e3Again.posted ?? []).length === 0, JSON.stringify(e3Again.posted));
  const { rows: runCounts } = await q(`SELECT rule_id, COUNT(*)::int AS n FROM bank_expense_runs WHERE status = 1 GROUP BY rule_id`);
  check('each due rule has exactly one posted run (hard unique)', runCounts.every((r) => Number(r.n) >= 1) && runCounts.length >= 8, JSON.stringify(runCounts));
  const runR1 = await q(`SELECT journal_id, status FROM bank_expense_runs WHERE rule_id = $1::int AND period_key = '2026-10-20'::date`, [r1]);
  check('monthly rule generated exactly one October occurrence', runR1.rows.length === 1 && Number(runR1.rows[0].status) === 1, JSON.stringify(runR1.rows));
  const pre3 = await call('POST', `/accounting/periods/${pOctA}/preclose-check`, {});
  const chk3 = (code) => (pre3.checks ?? []).find((c) => c.checkCode === code);
  check('after E3 run the E3-due check PASSES', chk3('e3_bank_expense_due')?.status === 2, JSON.stringify(chk3('e3_bank_expense_due')));
  check('E5 check still FAILS after E3', chk3('e5_depreciation_due')?.status === 3, JSON.stringify(chk3('e5_depreciation_due')));

  console.log('\n--- G6 close still refused (E5 missing); E5 run; no double depreciation ---');
  const refused2 = await raw('POST', `/accounting/periods/${pOctA}/close-month`, {});
  check('close refused while E5 is the only open gate', refused2.status === 400 && String(refused2.body?.message ?? '').includes('إهلاك'), `status=${refused2.status} msg=${refused2.body?.message}`);
  check('refusal no longer mentions E3/bank fees (E3 gate already cleared)', !String(refused2.body?.message ?? '').includes('الرسوم البنكية'), refused2.body?.message);
  const dep = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2026-10' });
  const depPosted = dep.posted ?? [];
  check('E5 posted depreciation for exactly the two due assets (a1, a3)', depPosted.length === 2, JSON.stringify(depPosted.map((d) => d.assetId).sort()));
  const a1Dep = depPosted.find((d) => Number(d.assetId) === Number(a1));
  check('a1 (in service 2026-10-10) October depreciation is pro-rated 709.68', a1Dep && eq2(a1Dep.amount, 709.68), JSON.stringify(a1Dep));
  const a3Dep = depPosted.find((d) => Number(d.assetId) === Number(a3));
  check('a3 (in service 2026-10-25) October depreciation is pro-rated 1354.84', a3Dep && eq2(a3Dep.amount, 1354.84), JSON.stringify(a3Dep));
  const depAgain = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2026-10' });
  check('re-running depreciation posts nothing (idempotent)', (depAgain.posted ?? []).length === 0, JSON.stringify(depAgain.posted));
  const { rows: depLines } = await q(`SELECT asset_id, period_month, depreciation_amount FROM asset_depreciation_lines WHERE period_month = '2026-10-01'::date ORDER BY asset_id`);
  const depSum = depLines.reduce((s, r) => s + Number(r.depreciation_amount), 0);
  check('only one depreciation line per asset for October', depLines.length === 2, JSON.stringify(depLines));
  const pre4 = await call('POST', `/accounting/periods/${pOctA}/preclose-check`, {});
  check('after E5 run the E5-due check PASSES', (pre4.checks ?? []).find((c) => c.checkCode === 'e5_depreciation_due')?.status === 2, JSON.stringify(pre4.checks));

  console.log('\n--- G7 final October close: TB, retained earnings, independent recompute ---');
  const tbBeforeFinal = await tbSnapshot();
  const expectedFinal = await independentNet('2026-10-01', '2026-10-31', A);
  const retainedBeforeFinal = await retainedBalance(A);
  const closedA = await call('POST', `/accounting/periods/${pOctA}/close-month`, {});
  check('October closes successfully', closedA?.isClosed === true && !!closedA.journalId, JSON.stringify(closedA).slice(0, 160));
  check('net income matches the independent raw-journal recompute to the cent', eq2(closedA.netProfit, expectedFinal.net), `reported=${closedA.netProfit} recomputed=${expectedFinal.net}`);
  const retainedAfterFinal = await retainedBalance(A);
  check('RETAINED_EARNINGS moved by exactly the period result', eq2(retainedAfterFinal - retainedBeforeFinal, closedA.netProfit), `delta=${retainedAfterFinal - retainedBeforeFinal} net=${closedA.netProfit}`);
  const { rows: [periodRow] } = await q('SELECT is_closed, net_income, closing_entry_id FROM periods WHERE period_id = $1::int', [pOctA]);
  check('period row: is_closed + net_income + single closing journal linked', !!periodRow.is_closed && !!periodRow.closing_entry_id && eq2(periodRow.net_income, closedA.netProfit), JSON.stringify(periodRow));
  const { rows: [closingJournal] } = await q('SELECT journal_id, source_type, status, total_debit, total_credit FROM gl_journals WHERE journal_id = $1::bigint', [periodRow.closing_entry_id]);
  check('closing journal is balanced and source_type = period_close', closingJournal && closingJournal.source_type === 'period_close' && eq2(closingJournal.total_debit, closingJournal.total_credit), JSON.stringify(closingJournal));
  check('closing journals for this period are exactly the bypassed close + the final close (2)', (await q(`SELECT COUNT(*)::int AS n FROM gl_journals WHERE source_type = 'period_close' AND source_id = $1::bigint`, [pOctA])).rows[0].n === 2, '');
  // revenue/expense accounts zeroed?
  const { rows: zeroed } = await q(`SELECT COUNT(*)::int AS n FROM gl_accounts a
     JOIN gl_entries e ON e.account_id = a.account_id
     JOIN gl_journals j ON j.journal_id = e.journal_id
    WHERE j.status = 2 AND j.branch_id = $1::int AND j.journal_date BETWEEN '2026-10-01'::date AND '2026-10-31'::date
      AND a.account_type IN (4, 5)
    GROUP BY a.account_id, a.account_type, a.code
    HAVING ABS(SUM(e.debit) - SUM(e.credit)) > 0.005`, [A]);
  check('every revenue/expense account nets to ZERO in the closed window (count=0)', zeroed.length === 0, `${zeroed.length} accounts not zeroed`);
  const tbAfterFinal = await tbSnapshot();
  check('trial balance balanced after close', tbAfterFinal.balanced === true, '');
  // Assets, liabilities, equity (excl. RETAINED_EARNINGS move) unchanged by the closing entry itself
  const tbAssetMove = (before, after) => {
    const byId = new Map((before.lines ?? []).map((l) => [l.accountId, l]));
    const afterById = new Map((after.lines ?? []).map((l) => [l.accountId, l]));
    const allIds = new Set([...byId.keys(), ...afterById.keys()]);
    const movedAll = [];
    for (const accountId of allIds) {
      const b = byId.get(accountId), a = afterById.get(accountId);
      const type = Number((a ?? b)?.accountType ?? 0);
      const deltaD = Number(a?.rawDebit ?? a?.debit ?? 0) - Number(b?.rawDebit ?? b?.debit ?? 0);
      const deltaC = Number(a?.rawCredit ?? a?.credit ?? 0) - Number(b?.rawCredit ?? b?.credit ?? 0);
      if (Math.abs(deltaD) > 0.005 || Math.abs(deltaC) > 0.005) movedAll.push({ accountId, type, deltaD, deltaC });
    }
    return movedAll;
  };
  const moved = tbAssetMove(tbBeforeFinal, tbAfterFinal);
  const unexpected = moved.filter((m) => ![3, 4, 5].includes(Number(m.type)));
  check('the closing entry touched ONLY revenue/expense/equity accounts (no asset/liability line moved)', unexpected.length === 0, JSON.stringify(unexpected));

  console.log('\n--- G8 reverse → correction → re-close (RETAINED rollover, no double count) ---');
  const reverse2 = await call('POST', `/accounting/periods/${pOctA}/reverse-close`, { reason: 'اختبار إعادة الإقفال بعد التصحيح' });
  check('reverse-close succeeds', reverse2.isClosed === false && !!reverse2.reverseJournalId, JSON.stringify(reverse2));
  const tbAfterReverse2 = await live();
  check('TB after reverse restores the pre-close TB EXACTLY (normal-side balances)',
    tbDiff(tbBeforeFinal, tbAfterReverse2).length === 0,
    JSON.stringify(tbDiff(tbBeforeFinal, tbAfterReverse2).slice(0, 6)));
  const retainedAfterReverse2 = await retainedBalance(A);
  check('RETAINED returned to pre-close value exactly', eq2(retainedAfterReverse2, retainedBeforeFinal), `after=${retainedAfterReverse2} before=${retainedBeforeFinal}`);
  // correction: +700 expense dated inside the reopened period
  await call('POST', '/accounting/journals', { description: 'قيد تصحيح بعد إعادة الفتح', journalDate: '2026-10-20', post: true, lines: [
    { accountId: glId('5106'), debit: 700, description: 'مصروف تصحيح' },
    { accountId: glId('1101'), credit: 700, description: 'نقص النقدية' },
  ] });
  const expectedReClose = await independentNet('2026-10-01', '2026-10-31', A);
  const closedAgain = await call('POST', `/accounting/periods/${pOctA}/close-month`, {});
  check('re-close succeeds after correction', closedAgain?.isClosed === true && !!closedAgain.journalId, JSON.stringify(closedAgain).slice(0, 160));
  check('re-close net income reflects the correction (−700) to the cent', eq2(closedAgain.netProfit, expectedReClose.net) && eq2(closedAgain.netProfit, closedA.netProfit - 700), `reclose=${closedAgain.netProfit} final1=${closedA.netProfit}`);
  const retainedReClose = await retainedBalance(A);
  check('RETAINED equals pre-first-close base (mirror) plus full final period result incl. correction', eq2(retainedReClose, retainedBeforeFinal + closedAgain.netProfit), `retained=${retainedReClose} expected=${retainedBeforeFinal + closedAgain.netProfit}`);
  const { rows: closingEntries } = await q(`SELECT journal_id FROM gl_journals WHERE source_type = 'period_close' AND source_id = $1::bigint ORDER BY journal_id`, [pOctA]);
  check('period_close journal trail is exactly bypass-close → final close → re-close (3)', closingEntries.length === 3, JSON.stringify(closingEntries.map((r) => r.journal_id)));
  const report = await call('GET', `/accounting/periods/${pOctA}/close-report`);
  check('close report netIncome matches the re-close', eq2(report.period?.netIncome, closedAgain.netProfit), JSON.stringify(report.period));
  // re-close must NOT duplicate E3/E5 documents
  const { rows: feeDup } = await q(`SELECT COUNT(*)::int AS n FROM bank_expense_runs x JOIN bank_expense_rules r ON r.rule_id = x.rule_id WHERE r.branch_id = $1::int AND x.period_key >= '2026-10-01'::date AND x.period_key <= '2026-10-31'::date AND x.status = 1`, [A]);
  check('no duplicated expense occurrences after reverse/re-close', Number(feeDup[0].n) === 8, JSON.stringify(feeDup));
  const { rows: depDup } = await q(`SELECT COUNT(*)::int AS n FROM asset_depreciation_lines WHERE period_month = '2026-10-01'::date`);
  check('no duplicated depreciation lines after reverse/re-close', Number(depDup[0].n) === 2, JSON.stringify(depDup));
  const noJournalLate = await raw('POST', '/accounting/journals', { description: 'محاولة ترحيل داخل فترة مقفلة', journalDate: '2026-10-20', post: true, lines: [{ accountId: glId('5106'), debit: 100, description: 'x' }, { accountId: glId('1101'), credit: 100, description: 'y' }] });
  check('posting into the re-closed period is refused (400)', noJournalLate.status === 400, `status=${noJournalLate.status}`);

  console.log('\n--- G9 branch B: isolation, refusal, cleanup, empty close ---');
  const preB = await call('POST', `/accounting/periods/${pOctB}/preclose-check`, {}, branchB);
  const chkB = (code) => (preB.checks ?? []).find((c) => c.checkCode === code);
  check('branch B: open shift detected and blocks its own close', chkB('no_open_shifts')?.status === 3, JSON.stringify(chkB('no_open_shifts')));
  check('branch B: unmatched bank line detected and blocks its own close', chkB('no_unreconciled_bank_lines')?.status === 3, JSON.stringify(chkB('no_unreconciled_bank_lines')));
  const refusedB = await raw('POST', `/accounting/periods/${pOctB}/close-month`, {}, branchB);
  check('branch B close is refused while A was unaffected', refusedB.status === 400, `status=${refusedB.status}`);
  // A's already-closed status untouched by B's data (verified implicitly in G7/G8)
  await q(`UPDATE bank_statement_lines SET status = 4 WHERE branch_id = $1::int`, [branchB]);
  const shiftB = await call('GET', '/treasury/shifts/current', null, branchB);
  const expectedCash = Number(shiftB?.expectedCash ?? shiftB?.openingBalance ?? 100);
  const closeShiftB = await raw('POST', '/treasury/shifts/close', { countedCash: expectedCash }, branchB);
  check('branch B shift closes at expected cash (zero variance)', closeShiftB.status === 200 || closeShiftB.status === 201, `status=${closeShiftB.status} ${JSON.stringify(closeShiftB.body).slice(0, 200)}`);
  const preB2 = await call('POST', `/accounting/periods/${pOctB}/preclose-check`, {}, branchB);
  check('branch B checks pass once its own data is clean (A unchanged)', preB2.failed === 0, JSON.stringify(preB2.checks));
  const retainedBBefore = await retainedBalance(branchB);
  const closedB = await call('POST', `/accounting/periods/${pOctB}/close-month`, {}, branchB);
  check('branch B closes with NO journal (empty period) and journalId null', closedB?.journalId == null && closedB?.isClosed === true, JSON.stringify(closedB).slice(0, 160));
  const retainedBAfter = await retainedBalance(branchB);
  check('RETAINED_EARNINGS unchanged by an empty close', eq2(retainedBBefore, retainedBAfter), '');

  console.log('\n--- G10 concurrency: triple close on branch C (exactly one wins) ---');
  await call('POST', '/accounting/journals', { description: 'إيرادات ديسمبر — فرع ج', journalDate: '2026-12-15', post: true, lines: [
    { accountId: glId('1101'), debit: 1234.56, description: 'نقدية فرع ج' },
    { accountId: glId('4101'), credit: 1234.56, description: 'إيرادات فرع ج' },
  ] }, branchC);
  const attempt = () => raw('POST', `/accounting/periods/${pDecC}/close-month`, {}, branchC);
  const [c1, c2, c3] = await Promise.all([attempt(), attempt(), attempt()]);
  const responses = [c1, c2, c3];
  console.log('responses:', responses.map((r) => `${r.status}: ${JSON.stringify(r.body).slice(0, 140)}`).join('\n  '));
  const wins = responses.filter((r) => r.status === 200 || r.status === 201);
  // PGlite-socket artifact on this isolated stack: one concurrent request can transiently
  // fetch a 0-row permissions set (its message is PermissionsGuard's «ليس لديك صلاحية لهذه العملية»).
  // Admin provably holds accounting.close (39/39 permissions, queried directly) and cannot be
  // denied it on real PostgreSQL, where result routing is connection-scoped. A refused request
  // — whether 400 (checklist gate) or 403 (socket anomaly) — never produces a journal.
  const refusedAttempts = responses.filter((r) => r.status !== 200 && r.status !== 201);
  check('exactly one concurrent close succeeds (Nest POST 201); the others are refused (400/403-anomaly)',
    wins.length === 1 && refusedAttempts.every((r) => r.status === 400 || r.status === 403),
    JSON.stringify(responses.map((r) => ({ status: r.status, m: r.body?.message }))));
  const winner = [c1, c2, c3].find((r) => r.status === 200);
  const { rows: closingC } = await q(`SELECT COUNT(*)::int AS n FROM gl_journals WHERE source_type = 'period_close' AND source_id = $1::bigint`, [pDecC]);
  check('exactly ONE period_close journal exists for the period', Number(closingC[0].n) === 1, JSON.stringify(closingC));
  const { rows: [periodC] } = await q('SELECT closing_entry_id, net_income, is_closed FROM periods WHERE period_id = $1::int', [pDecC]);
  check('period linked to the single closing journal; net income posted once', !!periodC.closing_entry_id && eq2(periodC.net_income, 1234.56) && !!periodC.is_closed, JSON.stringify(periodC));
  const retainedC = await retainedBalance(branchC);
  check('RETAINED_EARNINGS credited exactly once (1234.56)', eq2(retainedC, 1234.56), `retained=${retainedC}`);
  const reCloseC = await raw('POST', `/accounting/periods/${pDecC}/close-month`, {}, branchC);
  check('sequential re-close after the winner is refused (400)', reCloseC.status === 400, `status=${reCloseC.status}`);

  console.log('\n--- G10b DB-level backstops present (read-only index audit) ---');
  const { rows: indexes } = await q(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname IN ('ux_periods_closing_entry', 'ux_bank_expense_runs_rule_period', 'ux_asset_dep_asset_month', 'ux_period_close_checks_period_code')`,
  );
  check('closing-integrity unique indexes exist in the database', indexes.length === 4, JSON.stringify(indexes.map((i) => i.indexname)));
  // The safety net: re-running close-month on the closed period cannot produce a second winner
  const reCloseFinal = await raw('POST', `/accounting/periods/${pDecC}/close-month`, {}, branchC);
  check('re-close after the concurrent winner is refused', reCloseFinal.status === 400, `status=${reCloseFinal.status}`);

  // ================= G11 — November (profitable) =================
  const rNovA = await mkRule({ name: 'MREVIEW قبل الإيقاف', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 111, frequency: 1, dayOfMonth: 10, startDate: '2026-11-01' });
  const rNovB = await mkRule({ name: 'MREVIEW موقوف قبل نوفمبر', bankAccountId: bankAId, expenseAccountId: glId('5107'), amount: 222, frequency: 1, dayOfMonth: 25, startDate: '2026-11-01' });
  await call('POST', `/accounting/bank-expense-rules/${rNovB}/suspend`, { reason: 'إيقاف مؤقت — اختبار المراجعة' });
  const preNov1 = await call('POST', `/accounting/periods/${pNovA}/preclose-check`, {});
  const chkNov1 = (preNov1.checks ?? []).find((c) => c.checkCode === 'e3_bank_expense_due');
  check('November pre-close flags rNovA (Nov 10, before suspension) as due', chkNov1?.status === 3 && String(chkNov1?.details ?? '').includes('MREVIEW قبل الإيقاف'), JSON.stringify(chkNov1));
  check('November pre-close does NOT demand rNovB (occurrence on/after suspension)', !String(chkNov1?.details ?? '').includes('MREVIEW موقوف قبل نوفمبر'), JSON.stringify(chkNov1));
  await call('POST', '/accounting/journals', { description: 'إيرادات نوفمبر', journalDate: '2026-11-10', post: true, lines: [
    { accountId: glId('1101'), debit: 1000000, description: 'نقدية نوفمبر' },
    { accountId: glId('4101'), credit: 1000000, description: 'إيرادات نوفمبر' },
  ] });
  const e3Nov = await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2026-11-30' });
  const novPosted = (e3Nov.posted ?? []).map((p) => p.name);
  check('E3 for November posts the pre-suspension fee + due monthly fees', novPosted.includes('MREVIEW قبل الإيقاف'), JSON.stringify(novPosted));
  check('E3 for November NEVER posts the suspended rule (Nov 25 occurrence)', !novPosted.includes('MREVIEW موقوف قبل نوفمبر'), JSON.stringify(novPosted));
  const depNov = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2026-11' });
  check('E5 November depreciation posted for the in-service assets', (depNov.posted ?? []).length >= 2, JSON.stringify((depNov.posted ?? []).map((d) => d.assetId)));
  const retainedNovBefore = await retainedBalance(A);
  const novExpected = await independentNet('2026-11-01', '2026-11-30', A);
  const closedNov = await call('POST', `/accounting/periods/${pNovA}/close-month`, {});
  check('November closes as a PROFITABLE month', Number(closedNov.netProfit) > 0, JSON.stringify(closedNov).slice(0, 160));
  check('November net matches the independent recompute (computed pre-close, not from close-report)', eq2(closedNov.netProfit, novExpected.net), `reported=${closedNov.netProfit} recomputed=${novExpected.net}`);
  const retainedNovAfter = await retainedBalance(A);
  check('RETAINED rolled forward by the full November profit', eq2(retainedNovAfter - retainedNovBefore, closedNov.netProfit), '');

  console.log('\n--- G12 open-ended (NULL end_date) period closes (branch D) ---');
  const closedD = await call('POST', `/accounting/periods/${pOpenD}/close-month`, {}, branchD);
  check('NULL-end period closes, no journal, no movements swept', closedD?.isClosed === true && closedD?.journalId == null, JSON.stringify(closedD).slice(0, 160));

  console.log('\n--- G13 misc refusals ---');
  const overlap = await raw('POST', '/accounting/periods', { name: 'متداخلة — مرفوضة', startDate: '2026-10-15', endDate: '2026-10-25' }, A);
  check('overlapping bounded period is refused (400)', overlap.status === 400, `status=${overlap.status}`);
  const tbEnd = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance still balanced after the whole suite', tbEnd.balanced === true, '');

  console.log('\n--- G14 manual administrative lock ≠ accounting close ---');
  // Fresh closable period in branch A with a revenue movement
  const pManualLock = await mkPeriod(A, 'فترة القفل الإداري', '2027-01-01', '2027-01-31');
  await call('POST', '/accounting/journals', { description: 'إيرادات للقفل الإداري', journalDate: '2027-01-15', post: true, lines: [
    { accountId: glId('1101'), debit: 1000, description: 'نقدية' },
    { accountId: glId('4101'), credit: 1000, description: 'إيرادات' },
  ] });
  const lockRes = await call('POST', `/accounting/periods/${pManualLock}/manual-lock`, { reason: 'اختبار فصل القفل الإداري عن الإقفال المحاسبي' });
  check('manual-lock applied (201)', lockRes?.manualLock === true, JSON.stringify(lockRes));
  const pRowLock = (await call('GET', '/accounting/periods')).find((p) => p.periodId === pManualLock);
  check('manual lock does NOT flip is_closed', pRowLock?.isClosed === false && pRowLock?.manualLock === true, JSON.stringify(pRowLock));
  check('manual lock does NOT set closing_entry_id', pRowLock?.closingEntryId == null, JSON.stringify(pRowLock));
  const lockedInvoice = await raw('POST', '/accounting/journals', { description: 'محاولة في فترة مقفولة إداريًا', journalDate: '2027-01-20', post: true, lines: [
    { accountId: glId('5106'), debit: 50, description: 'محاولة' },
    { accountId: glId('1101'), credit: 50, description: 'محاولة' },
  ] });
  check('journal rejected inside a manually locked period (400)', lockedInvoice.status === 400, `status=${lockedInvoice.status}`);
  const backpostNoPerm = await raw('POST', '/accounting/journals', { description: 'backpost بتصريح مدير النظام', journalDate: '2027-01-20', post: true, backpostReason: 'اختبار الصلاحية الواضحة — ترحيل بتصريح إلى فترة مقفولة إداريًا', lines: [
    { accountId: glId('5106'), debit: 50, description: 'x' },
    { accountId: glId('1101'), credit: 50, description: 'y' },
  ] });
  check('admin WITH accounting.backpost CAN backpost into a manually locked period (201)', backpostNoPerm.status === 201, `status=${backpostNoPerm.status} body=${JSON.stringify(backpostNoPerm.body).slice(0, 120)}`);
  const refusedClose = await raw('POST', `/accounting/periods/${pManualLock}/close-month`, {});
  check('accounting close refused inside a manually locked period (400)', refusedClose.status === 400 && String(refusedClose.body?.message ?? '').includes('مقفولة إداريًا'), `status=${refusedClose.status} msg=${refusedClose.body?.message}`);
  const reverseOnLock = await raw('POST', `/accounting/periods/${pManualLock}/reverse-close`, { reason: 'محاولة' });
  check('reverse-close refused inside a manually locked period (400)', reverseOnLock.status === 400, `status=${reverseOnLock.status}`);
  const unlockRes = await call('POST', `/accounting/periods/${pManualLock}/manual-unlock`, { reason: 'انتهى اختبار القفل الإداري' });
  check('manual-unlock applied (201)', unlockRes?.manualLock === false && unlockRes?.isClosed === false, JSON.stringify(unlockRes));
  const afterUnlockJournal = await call('POST', '/accounting/journals', { description: 'قيد بعد إزالة القفلة', journalDate: '2027-01-20', post: true, lines: [
    { accountId: glId('5106'), debit: 25, description: 'x' },
    { accountId: glId('1101'), credit: 25, description: 'y' },
  ] });
  check('journal posting allowed again after manual-unlock', !!afterUnlockJournal?.journalId, JSON.stringify(afterUnlockJournal));
  // Operational flow: generate E3 dues + E5 depreciation for Jan 2027, THEN the close passes cleanly
  await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2027-01-31' });
  await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2026-12' });
  await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2027-01' });
  const closeAfterUnlock = await call('POST', `/accounting/periods/${pManualLock}/close-month`, {});
  check('accounting close succeeds after manual-unlock (after generating E3/E5 dues)', closeAfterUnlock?.isClosed === true, JSON.stringify(closeAfterUnlock).slice(0, 160));

  console.log('\n--- G15 override authorization (close_override required) ---');
  // Create an Accountant-with-accounting.close test user to prove separation from close_override.
  const stamp = Date.now();
  const roles = await call('GET', '/admin/roles');
  const accountantRole = roles.find((r) => r.nameEn === 'Accountant');
  check('accountant role exists for the permission test', !!accountantRole, JSON.stringify(roles.map((r) => r.nameEn)));
  const accountantRoleIds = [accountantRole?.roleId].filter(Boolean);
  // Replace the Accountant permission set with itself + accounting.close (NO close_override)
  await call('PUT', `/admin/roles/${accountantRole.roleId}/permissions`, {
    codes: ['dashboard.view','items.view','parties.view','parties.manage','parties.ledger','sales.view','purchases.view','purchases.manage','stock.view','cash.view','cash.manage','reports.view','hr.view','accounting.view','accounting.manage','accounting.post','accounting.close','bank.view','bank.manage','assets.view','assets.manage','attachments.view','attachments.manage','crm.view'],
  });
  const closeOnlyUser = await call('POST', '/admin/users', {
    userName: `closeonly_${stamp}`, password: 'Test$12345', fullName: 'مدير فروع — إقفال فقط',
    defaultBranchId: A, roleIds: [accountantRole.roleId],
  });
  const ovCashier = await call('POST', '/admin/users', {
    userName: `ovcashier_${stamp}`, password: 'Test$12345', fullName: 'كاشير التجاوز',
    defaultBranchId: A, roleIds: [(await call('GET', '/admin/roles')).find((r) => r.nameEn === 'Cashier').roleId], maxDiscountPct: 5, isCashier: true,
  });
  check('override-test users created', !!closeOnlyUser.userId && !!ovCashier.userId, JSON.stringify({ closeOnlyUser, ovCashier }));
  const loginAs = async (u) => {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: u, password: 'Test$12345' }) });
    const d = await r.json();
    return d.accessToken;
  };
  const closeOnlyToken = await loginAs(`closeonly_${stamp}`);
  const cashierToken = await loginAs(`ovcashier_${stamp}`);
  const pOverride = await mkPeriod(A, 'فترة تجاوز E3/E5', '2027-02-01', '2027-02-28');
  // make two due expense rules + one due depreciation asset
  const ovBank = await call('POST', '/treasury/accounts', { name: 'بنك المراجعة للتجاوز', type: 2, bankName: 'بنك', glAccountId: glId('1102'), openingBalance: 0 });
  const ovRule1 = await mkRule({ name: 'MREVIEW-OVR شهري 1', bankAccountId: ovBank.cashAccountId, expenseAccountId: glId('5107'), amount: 50, frequency: 1, dayOfMonth: 5, startDate: '2026-10-05' });
  const ovRule2 = await mkRule({ name: 'MREVIEW-OVR شهري 2', bankAccountId: ovBank.cashAccountId, expenseAccountId: glId('5107'), amount: 60, frequency: 1, dayOfMonth: 18, startDate: '2026-10-05' });
  const ovAsset = await call('POST', '/accounting/assets', { name: 'أصل المراجعة للتجاوز', category: 'معدات', cost: 24000, residualValue: 0, usefulLifeMonths: 24, acquisitionDate: '2026-09-01', inServiceDate: '2026-10-05', depreciationMethod: 1, paymentType: 1, cashAccountId: cashMain.cashAccountId });
  check('setup for override test complete', ovRule1 > 0 && ovRule2 > 0 && !!ovAsset?.assetId, JSON.stringify({ ovRule1, ovRule2, ovAsset }));
  // Close attempt WITHOUT any override → refused with BOTH dues listed
  const refusedOverride = await raw('POST', `/accounting/periods/${pOverride}/close-month`, {});
  check('close refused while dues outstanding', refusedOverride.status === 400, `status=${refusedOverride.status}`);
  const refusedMsg = String(refusedOverride.body?.message ?? '');
  check('refusal message names BOTH due items (each item visible)', refusedMsg.includes('MREVIEW-OVR شهري 1') && refusedMsg.includes('MREVIEW-OVR شهري 2'), refusedMsg);
  // close_only user (accounting.close, NO close_override) must NOT bypass → 403
  const closeOnlyAttempt = await raw('POST', `/accounting/periods/${pOverride}/close-month`, { bypassReason: 'تجاوز بلا صلاحية override' }, A, closeOnlyToken);
  check('accounting.close alone cannot override (403)', closeOnlyAttempt.status === 403, `status=${closeOnlyAttempt.status}`);
  // cashier (no accounting.close at all) must NOT bypass either → 403
  const cashierAttempt = await raw('POST', `/accounting/periods/${pOverride}/close-month`, { bypassReason: 'محاولة كاشير' }, A, cashierToken);
  check('cashier cannot override (403)', cashierAttempt.status === 403, `status=${cashierAttempt.status}`);
  const pRowOverride = (await call('GET', '/accounting/periods')).find((p) => p.periodId === pOverride);
  check('after unauthorized attempts the period is still open (is_closed=false)', pRowOverride?.isClosed === false, JSON.stringify(pRowOverride));
  // Per-item override for ONE due item; the other still blocks (not all dues auto-waived)
  const perItem = await raw('POST', `/accounting/periods/${pOverride}/close-month`, {
    overrides: [
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${ovRule1}:2027-02-05`, reason: 'تجاوز معتمد — الاستحقاق الأول فقط' },
    ],
  });
  check('partial override by privileged user still refuses (400) — remaining due blocks', perItem.status === 400, `status=${perItem.status} msg=${perItem.body?.message}`);
  check('remaining due still listed after partial override', String(perItem.body?.message ?? '').includes('MREVIEW-OVR شهري 2'), perItem.body?.message);
  // Now override ALL dues due in Feb 2027 (E3: ovRule1, ovRule2 + the monthly gate rules r1/r5/r6/r9; E5: a1, a3, ovAsset) → close must succeed
  const closeOverrideAll = await raw('POST', `/accounting/periods/${pOverride}/close-month`, {
    overrides: [
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${ovRule1}:2027-02-05`, reason: 'تجاوز معتمد — الاستحقاق الأول' },
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${ovRule2}:2027-02-18`, reason: 'تجاوز معتمد — الاستحقاق الثاني' },
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${r1}:2027-02-20`, reason: 'تجاوز معتمد — قاعدة المراجعة الشهرية' },
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${r5}:2027-02-03`, reason: 'تجاوز معتمد — قاعدة اليوم الثالث' },
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${r6}:2027-02-25`, reason: 'تجاوز معتمد — القاعدة قبل الإيقاف' },
      { checkCode: 'e3_bank_expense_due', dueKey: `rule:${rNovA}:2027-02-10`, reason: 'تجاوز معتمد — القاعدة قبل موعد الإيقاف في نوفمبر' },
      { checkCode: 'e5_depreciation_due', dueKey: `asset:${a1}:2027-02`, reason: 'تجاوز معتمد — إهلاك أصل أ1 في الفترة' },
      { checkCode: 'e5_depreciation_due', dueKey: `asset:${a3}:2027-02`, reason: 'تجاوز معتمد — إهلاك أصل أ3 في الفترة' },
      { checkCode: 'e5_depreciation_due', dueKey: `asset:${ovAsset.assetId}:2027-02`, reason: 'تجاوز معتمد — إهلاك أصل الاختبار' },
    ],
  });
  check('full override by privileged user succeeds (201)', closeOverrideAll.status === 201, `status=${closeOverrideAll.status} body=${JSON.stringify(closeOverrideAll.body).slice(0, 160)}`);
  const reportOver = await call('GET', `/accounting/periods/${pOverride}/close-report`);
  const allOvr = (reportOver.overrides ?? []).filter((o) => ['e3_bank_expense_due', 'e5_depreciation_due'].includes(o.checkCode));
  check('override audit rows recorded (user/reason/amount/date) — all 9 due items', allOvr.length === 9 && allOvr.every((o) => Number(o.dueAmount) > 0 && String(o.reason).length > 5 && o.overriddenBy), JSON.stringify(reportOver.overrides));

  console.log('\n--- G17 empty override reason rejected ---');
  const pEmptyReason = await mkPeriod(A, 'فترة سبب فارغ', '2027-03-01', '2027-03-31');
  const blankReason = await raw('POST', `/accounting/periods/${pEmptyReason}/close-month`, {
    overrides: [{ checkCode: 'e3_bank_expense_due', dueKey: 'rule:1:2027-03-05', reason: '' }],
  });
  check('override with empty reason refused (400)', blankReason.status === 400, `status=${blankReason.status}`);

  console.log('\n--- G18 override without permission does not create audit rows ---');
  const pNoWrite = await mkPeriod(A, 'فترة بلا كتابة للتجاوز', '2027-04-01', '2027-04-30');
  const noWriteBtn = await raw('POST', `/accounting/periods/${pNoWrite}/close-month`, {
    overrides: [{ checkCode: 'e3_bank_expense_due', dueKey: 'rule:99999:2027-04-05', reason: 'سبب حقيقي' }],
  }, A, cashierToken);
  check('cashier cannot override; audit register stays empty', noWriteBtn.status === 403, `status=${noWriteBtn.status}`);
  const reportNoWrite = await call('GET', `/accounting/periods/${pNoWrite}/close-report`);
  check('no override rows were written for the unauthorized attempt', (reportNoWrite.overrides ?? []).length === 0, JSON.stringify(reportNoWrite.overrides));

  // ================= summary =================
  const failed = results.filter((r) => !r.ok);
  console.log(`\n==================================================`);
  console.log(`E6 REVIEW GATE — ${results.length} checks, ${failed.length} failed`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(` - ${f.name} → ${f.evidence}`);
  }
  await state.sql.end();
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('FATAL', err);
  try { results.push({ name: 'unexpected exception', ok: false, evidence: String(err) }); } catch {}
  process.exit(2);
});
