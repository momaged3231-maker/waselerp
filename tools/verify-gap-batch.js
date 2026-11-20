/*
 * Verification batch for the "implemented without evidence" domains.
 *   node tools/verify-gap-batch.js
 *
 * Target: an ISOLATED API + database (default 4001 / 5434).
 *   API_BASE=http://127.0.0.1:4001/api PGPORT=5434 node tools/verify-gap-batch.js
 *
 * Every check prints the literal expected/actual values. Nothing is asserted
 * without a number taken from the API or from an independent SQL query.
 */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4001/api';
const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5434),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

let token = '';
let branchId = 0;
const results = [];
let db;

function record(id, title, expected, actual, pass) {
  results.push({ id, title, expected, actual, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${id} ${title}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`);
}

function info(id, title, value) {
  results.push({ id, title, expected: '—', actual: value, pass: true, info: true });
  console.log(`[INFO] ${id} ${title} = ${JSON.stringify(value)}`);
}

async function call(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId) headers['x-branch-id'] = String(branchId);
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

(async () => {
  db = new Client(DB);
  await db.connect();

  // ---------------------------------------------------------------- login
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  if (!login.ok) throw new Error(`login failed ${login.status} ${JSON.stringify(login.data)}`);
  token = login.data.token ?? login.data.accessToken;
  branchId = Number(login.data.activeBranchId ?? login.data.user?.defaultBranchId ?? 0);
  info('S0', 'login', { branchId, hasToken: !!token });

  const mappings = (await call('GET', '/accounting/mappings')).data ?? [];
  const mapId = (key) => Number((mappings.find((m) => m.mappingKey === key) ?? {}).accountId ?? 0);
  const cashId = mapId('CASH');
  const otherIncomeId = mapId('OTHER_INCOME');
  info('S0', 'mapping accounts', { CASH: cashId, OTHER_INCOME: otherIncomeId });

  // ================================================================ GL-8
  // Cost centre on a posted manual journal: does the entry keep it, and does
  // the cost-centre report pick it up?
  let costCenters = (await call('GET', '/accounting/cost-centers')).data ?? [];
  let cc = costCenters.find((row) => row.code === 'CC-VERIFY');
  if (!cc) {
    const created = await call('POST', '/accounting/cost-centers', { code: 'CC-VERIFY', name: 'مركز تحقق GL-8' });
    if (!created.ok) throw new Error(`cost centre create failed ${created.status} ${JSON.stringify(created.data)}`);
    costCenters = (await call('GET', '/accounting/cost-centers')).data ?? [];
    cc = costCenters.find((row) => row.code === 'CC-VERIFY');
  }
  const ccId = Number(cc.costCenterId);
  info('G1', 'cost centre', { costCenterId: ccId, code: cc.code, entryCountBefore: cc.entryCount });

  // Baseline before the probe, so the check is a delta and the script stays
  // re-runnable against the same database.
  const ccBefore = (await call('GET', '/accounting/reports/cost-centers?from=2026-11-01&to=2026-11-30')).data ?? {};
  const ccBaseRow = (ccBefore.lines ?? []).find((row) => Number(row.costCenterId) === ccId) ?? { debit: 0, credit: 0 };

  const journal = await call('POST', '/accounting/journals', {
    description: 'VERIFY GL-8 cost centre',
    journalDate: '2026-11-10',
    lines: [
      { accountId: cashId, debit: 123.45, description: 'dr', costCenterId: ccId },
      { accountId: otherIncomeId, credit: 123.45, description: 'cr', costCenterId: ccId },
    ],
  });
  record('G1', 'manual journal with costCenterId accepted', 201, journal.status, journal.status === 201);
  const journalId = Number(journal.data?.journalId ?? 0);

  const detail = (await call('GET', `/accounting/journals/${journalId}`)).data ?? {};
  const detailLines = detail.lines ?? [];
  record('G1', 'journal lines keep costCenterId',
    [ccId, ccId], detailLines.map((l) => Number(l.costCenterId ?? 0)),
    detailLines.length === 2 && detailLines.every((l) => Number(l.costCenterId) === ccId));

  const dbCc = await db.query('SELECT COUNT(*)::int AS n FROM gl_entries WHERE journal_id = $1::bigint AND cost_center_id = $2::int', [journalId, ccId]);
  record('G1', 'SQL: entries carrying the cost centre', 2, dbCc.rows[0].n, dbCc.rows[0].n === 2);

  const ccReport = (await call('GET', '/accounting/reports/cost-centers?from=2026-11-01&to=2026-11-30')).data ?? {};
  const ccRow = (ccReport.lines ?? []).find((row) => Number(row.costCenterId) === ccId) ?? {};
  const ccDelta = {
    debit: round2(Number(ccRow.debit || 0) - Number(ccBaseRow.debit || 0)),
    credit: round2(Number(ccRow.credit || 0) - Number(ccBaseRow.credit || 0)),
    net: round2(Number(ccRow.net || 0) - Number(ccBaseRow.net || 0)),
  };
  record('G1', 'cost-centre report picks up the new entry (delta)',
    { debit: 123.45, credit: 123.45, net: 0 }, ccDelta,
    ccDelta.debit === 123.45 && ccDelta.credit === 123.45 && ccDelta.net === 0);

  // G2: `require_cost_center` is a stored flag — is it enforced anywhere?
  const before = (await call('GET', `/accounting/accounts/${cashId}`)).data ?? {};
  await call('PUT', `/accounting/accounts/${cashId}`, { requireCostCenter: true });
  const enforced = await call('POST', '/accounting/journals', {
    description: 'VERIFY GL-8 require_cost_center probe',
    journalDate: '2026-11-10',
    lines: [
      { accountId: cashId, debit: 10, description: 'dr without cost centre' },
      { accountId: otherIncomeId, credit: 10, description: 'cr' },
    ],
  });
  await call('PUT', `/accounting/accounts/${cashId}`, { requireCostCenter: !!before.requireCostCenter });
  record('G2', 'require_cost_center blocks a line without a cost centre', 400, enforced.status, enforced.status === 400);
  info('G2', 'require_cost_center restored to', !!before.requireCostCenter);

  // ================================================================ GL-9
  // Foreign currency: the schema has currency_code / exchange_rate /
  // foreign_amount on the journal and its entries. Is there a write path?
  const fx = await call('POST', '/accounting/journals', {
    description: 'VERIFY GL-9 foreign currency',
    journalDate: '2026-11-10',
    currencyCode: 'USD',
    exchangeRate: 50,
    lines: [
      { accountId: cashId, debit: 500, description: 'dr 10 USD @50' },
      { accountId: otherIncomeId, credit: 500, description: 'cr 10 USD @50' },
    ],
  });
  const fxId = Number(fx.data?.journalId ?? 0);
  const fxRow = (await db.query(
    'SELECT currency_code, exchange_rate::text AS rate FROM gl_journals WHERE journal_id = $1::bigint',
    [fxId],
  )).rows[0] ?? {};
  const fxEntries = (await db.query(
    'SELECT currency_code, foreign_amount::text AS foreign_amount, exchange_rate::text AS rate FROM gl_entries WHERE journal_id = $1::bigint ORDER BY line_no',
    [fxId],
  )).rows;
  record('G9', 'currencyCode/exchangeRate reach the journal header',
    { currency_code: 'USD', rate: '50' },
    { currency_code: fxRow.currency_code, rate: fxRow.rate },
    fxRow.currency_code === 'USD' && Number(fxRow.rate) === 50);
  record('G9', 'foreign_amount equals the foreign value (debit / rate)',
    ['10.00', '10.00'],
    fxEntries.map((e) => e.foreign_amount),
    fxEntries.every((e) => Number(e.foreign_amount) === 10));

  // ============================================================== GL-11
  const from = '2026-01-01';
  const to = '2026-12-31';
  const tb = (await call('GET', `/accounting/reports/trial-balance?from=${from}&to=${to}`)).data ?? {};
  record('G11', 'trial balance is internally balanced', true, tb.balanced, tb.balanced === true);

  // The trial balance is a *balance* report: each account is collapsed to one
  // net figure and shown on its own side. So the independent SQL must also
  // collapse per account before summing, not sum the gross debit/credit columns.
  const sqlTb = (await db.query(
    `WITH per_account AS (
       SELECT e.account_id,
              COALESCE(SUM(e.debit), 0)  AS d,
              COALESCE(SUM(e.credit), 0) AS c
         FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id
        WHERE j.status = 2 AND ($1::int = 0 OR j.branch_id = $1::int)
          AND j.journal_date BETWEEN $2::date AND $3::date
        GROUP BY e.account_id)
     SELECT COALESCE(SUM(GREATEST(d - c, 0)), 0)::text AS d,
            COALESCE(SUM(GREATEST(c - d, 0)), 0)::text AS c
       FROM per_account`,
    [branchId, from, to],
  )).rows[0];
  record('G11', 'trial balance totals equal independent SQL',
    { debit: round2(sqlTb.d), credit: round2(sqlTb.c) },
    { debit: round2(tb.totalDebit), credit: round2(tb.totalCredit) },
    round2(tb.totalDebit) === round2(sqlTb.d) && round2(tb.totalCredit) === round2(sqlTb.c));

  const pl = (await call('GET', `/accounting/reports/profit-loss?from=${from}&to=${to}`)).data ?? {};
  const rev = (pl.revenue ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const exp = (pl.expense ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  record('G11', 'profit & loss: net = revenue - expense',
    round2(rev - exp), round2(pl.netProfit ?? pl.net ?? NaN),
    Math.abs(round2(rev - exp) - round2(pl.netProfit ?? pl.net ?? NaN)) < 0.01);

  const bs = (await call('GET', `/accounting/reports/balance-sheet?asOf=${to}`)).data ?? {};
  const assets = round2(bs.totalAssets ?? 0);
  const liab = round2(bs.totalLiabilities ?? 0);
  const eq = round2(bs.totalEquity ?? 0);
  const profit = round2(bs.profit ?? 0);
  record('G11', 'balance sheet: assets = liabilities + equity + profit',
    assets, round2(bs.totalLiabilitiesAndEquity ?? 0),
    Math.abs(assets - round2(bs.totalLiabilitiesAndEquity ?? 0)) < 0.01 && bs.balanced === true);
  info('G11', 'balance sheet figures', { assets, liabilities: liab, equity: eq, profit, balanced: bs.balanced });

  // The balance sheet is as-of (no lower bound) while the P&L is from `from`,
  // so any P&L movement dated before `from` shows up in one and not the other.
  // Quantify it instead of leaving an unexplained difference.
  const preFrom = (await db.query(
    `SELECT COALESCE(SUM(e.credit - e.debit), 0)::text AS v
       FROM gl_entries e
       JOIN gl_journals j ON j.journal_id = e.journal_id
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE j.status = 2 AND ($1::int = 0 OR j.branch_id = $1::int)
        AND j.journal_date < $2::date
        AND a.account_type IN (4, 5)`,
    [branchId, from],
  )).rows[0].v;
  info('G11', 'P&L movement dated before the P&L window (explains balance-sheet profit)',
    { beforeWindow: round2(preFrom), pnlNet: round2(pl.netProfit), bsProfit: profit });
  record('G11', 'balance-sheet profit = P&L net + P&L movement before the window',
    round2(Number(pl.netProfit) + Number(preFrom)), profit,
    Math.abs(round2(Number(pl.netProfit) + Number(preFrom)) - profit) < 0.01);

  const gl = (await call('GET', `/accounting/reports/general-ledger?accountId=${cashId}&from=${from}&to=${to}`)).data ?? {};
  const glNet = round2((gl.lines ?? []).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0));
  const tbCash = round2(((tb.lines ?? []).find((l) => Number(l.accountId) === cashId) ?? {}).balance ?? 0);
  record('G11', 'general ledger for CASH agrees with the trial balance',
    tbCash, glNet, Math.abs(tbCash - glNet) < 0.01);

  // ============================================================== pivot
  const pivot = (await call('GET', `/reports/pivot/sales?from=${from}&to=${to}`)).data ?? {};
  const pivotSum = round2((pivot.items ?? []).reduce(
    (s, item) => s + Object.values(item.months ?? {}).reduce((x, v) => x + Number(v || 0), 0), 0));
  const sqlPivot = (await db.query(
    `SELECT COALESCE(SUM(l.line_total),0)::text AS v
       FROM invoice_lines l JOIN invoices i ON i.invoice_id = l.invoice_id
      WHERE i.invoice_type = 1 AND i.status = 2 AND ($1::int = 0 OR i.branch_id = $1::int)
        AND i.invoice_date BETWEEN $2::date AND $3::date`,
    [branchId, from, to],
  )).rows[0].v;
  record('P1', 'sales pivot total equals independent SQL',
    round2(sqlPivot), pivotSum, Math.abs(round2(sqlPivot) - pivotSum) < 0.01);

  const stockPivot = (await call('GET', '/reports/pivot/stock')).data ?? {};
  const stockSum = round2((stockPivot.categories ?? []).reduce(
    (s, cat) => s + Object.values(cat.values ?? {}).reduce((x, v) => x + Number(v || 0), 0), 0));
  const sqlStock = (await db.query(
    `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::text AS v
       FROM item_warehouse_qty q JOIN items i ON i.item_id = q.item_id AND q.unit_id = i.base_unit_id
       JOIN warehouses w ON w.warehouse_id = q.warehouse_id
      WHERE ($1::int = 0 OR w.branch_id = $1::int)`,
    [branchId],
  )).rows[0].v;
  record('P2', 'stock pivot total equals independent SQL',
    round2(sqlStock), stockSum, Math.abs(round2(sqlStock) - stockSum) < 0.01);

  // ==================================================== report builder
  const datasets = (await call('GET', '/reports/builder/datasets')).data ?? [];
  record('R1', 'report builder exposes sales_invoices',
    true, datasets.some((d) => (d.key ?? d.dataset) === 'sales_invoices'),
    datasets.some((d) => (d.key ?? d.dataset) === 'sales_invoices'));

  const run = await call('POST', '/reports/builder/run', {
    dataset: 'sales_invoices',
    columns: ['invoiceNo', 'totalAmount'],
    from,
    to,
    limit: 2000,
  });
  const runRows = run.data?.rows ?? [];
  const runSum = round2(runRows.reduce((s, r) => s + Number(r.totalAmount || 0), 0));
  const sqlRun = (await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(i.total_amount),0)::text AS v
       FROM invoices i
      WHERE i.invoice_type = 1 AND i.status <> 3 AND i.branch_id = $1::int
        AND i.invoice_date >= $2::date
        AND i.invoice_date <= ($3::date + interval '1 day' - interval '1 second')`,
    [branchId, from, to],
  )).rows[0];
  record('R2', 'builder row count equals independent SQL',
    sqlRun.n, runRows.length, runRows.length === sqlRun.n);
  record('R2', 'builder total equals independent SQL',
    round2(sqlRun.v), runSum, Math.abs(round2(sqlRun.v) - runSum) < 0.01);

  // ============================================================== G-16
  // Installments: plan → schedule (floor + remainder on the last line) →
  // payment capped at the remaining amount → GL + drawer.
  const cashAccounts = (await call('GET', '/treasury/accounts')).data ?? [];
  const cashAccount = cashAccounts.find((row) => Number(row.type) === 1 && row.isActive !== false);
  if (!cashAccount) throw new Error('G-16/G-17 need an active cash account');
  const cashAccountId = Number(cashAccount.cashAccountId);
  const cashGlId = Number(cashAccount.glAccountId);
  const arId = mapId('AR');
  const cashBalanceBefore = round2(cashAccount.balance);
  info('S0', 'cash drawer + AR mapping', { cashAccountId, cashGlId, arId, balance: cashBalanceBefore });

  const plan = await call('POST', '/installments/plans', {
    partyId: 1,
    title: 'VERIFY G-16 تقسيط',
    totalAmount: 1000.01,
    downPayment: 100,
    installmentCount: 3,
    frequency: 1,
    startDate: '2026-12-01',
  });
  record('G16', 'installment plan accepted', 201, plan.status, plan.status === 201);
  const planId = Number(plan.data?.planId ?? 0);
  const planNo = plan.data?.planNo;

  const planDetail = (await call('GET', `/installments/plans/${planId}`)).data ?? {};
  const schedule = planDetail.schedule ?? [];
  const amounts = schedule.map((row) => round2(row.amount));
  record('G16', 'schedule = 300.00 / 300.00 / 300.01 (last line absorbs the remainder)',
    [300, 300, 300.01], amounts,
    amounts.length === 3 && amounts[0] === 300 && amounts[1] === 300 && amounts[2] === 300.01);
  record('G16', 'schedule total = financed amount (1000.01 - 100.00)',
    900.01, round2(amounts.reduce((sum, value) => sum + value, 0)),
    round2(amounts.reduce((sum, value) => sum + value, 0)) === 900.01);

  const planLedger = (await db.query(
    'SELECT direction, entry_type, amount::text AS amount FROM ledger_entries WHERE reference_no = $1::text',
    [planNo],
  )).rows;
  record('G16', 'financed amount is booked on the party ledger',
    { rows: 1, direction: 1, entryType: 1, amount: '900.01' },
    planLedger.length
      ? { rows: planLedger.length, direction: Number(planLedger[0].direction), entryType: Number(planLedger[0].entry_type), amount: planLedger[0].amount }
      : null,
    planLedger.length === 1 && Number(planLedger[0].direction) === 1
      && Number(planLedger[0].entry_type) === 1 && Number(planLedger[0].amount) === 900.01);

  const firstLine = schedule[0] ?? {};
  const capped = await call('POST', `/installments/schedule/${firstLine.scheduleId}/pay`, {
    amount: 500, paidDate: '2026-12-10', cashAccountId,
  });
  record('G16', 'paying 500.00 against a 300.00 line is capped at 300.00',
    { paid: 300, remaining: 0 },
    { paid: round2(capped.data?.paid), remaining: round2(capped.data?.remaining) },
    round2(capped.data?.paid) === 300 && round2(capped.data?.remaining) === 0);

  const firstJournal = (await db.query(
    `SELECT e.account_id, e.debit::text AS debit, e.credit::text AS credit
       FROM gl_journals j JOIN gl_entries e ON e.journal_id = j.journal_id
      WHERE j.source_type = 'installment' AND j.source_id = $1::bigint
      ORDER BY e.line_no`,
    [firstLine.scheduleId],
  )).rows;
  const firstDebit = round2(firstJournal.reduce((sum, row) => sum + Number(row.debit), 0));
  const firstCredit = round2(firstJournal.reduce((sum, row) => sum + Number(row.credit), 0));
  const firstDebitAccount = Number((firstJournal.find((row) => Number(row.debit) > 0) ?? {}).account_id);
  const firstCreditAccount = Number((firstJournal.find((row) => Number(row.credit) > 0) ?? {}).account_id);
  record('G16', 'payment posts Dr cash 300.00 / Cr receivable 300.00',
    { debit: 300, credit: 300, debitAccount: cashGlId, creditAccount: arId },
    { debit: firstDebit, credit: firstCredit, debitAccount: firstDebitAccount, creditAccount: firstCreditAccount },
    firstDebit === 300 && firstCredit === 300
      && firstDebitAccount === cashGlId && firstCreditAccount === arId);

  const secondLine = schedule[1] ?? {};
  const partial = await call('POST', `/installments/schedule/${secondLine.scheduleId}/pay`, {
    amount: 100, paidDate: '2026-12-11', cashAccountId,
  });
  const partialRow = (await db.query(
    'SELECT paid_amount::text AS paid, status FROM installment_schedule WHERE installment_schedule_id = $1::bigint',
    [secondLine.scheduleId],
  )).rows[0] ?? {};
  record('G16', 'partial payment keeps the line open (paid 100.00, status 3)',
    { paid: '100.00', status: 3 },
    { paid: partialRow.paid, status: Number(partialRow.status) },
    Number(partialRow.paid) === 100 && Number(partialRow.status) === 3);
  record('G16', 'partial payment leaves 200.00 on the line',
    200, round2(partial.data?.remaining), round2(partial.data?.remaining) === 200);

  const cashReceipts = (await db.query(
    `SELECT direction, amount::text AS amount FROM cash_transactions
      WHERE cash_account_id = $1::int AND description = $2::text ORDER BY cash_transaction_id`,
    [cashAccountId, `سداد قسط - ${planNo}`],
  )).rows;
  record('G16', 'two receipts reach the drawer (300.00 + 100.00)',
    ['300.00', '100.00'], cashReceipts.map((row) => row.amount),
    cashReceipts.length === 2 && Number(cashReceipts[0].amount) === 300 && Number(cashReceipts[1].amount) === 100);

  const cashBalanceAfter = round2(
    ((await call('GET', '/treasury/accounts')).data ?? [])
      .find((row) => Number(row.cashAccountId) === cashAccountId)?.balance);
  record('G16', 'drawer balance rises by exactly 400.00',
    round2(cashBalanceBefore + 400), cashBalanceAfter,
    round2(cashBalanceAfter - cashBalanceBefore) === 400);

  // ============================================================== G-17
  // Payroll: overtime + insurance on the clamped insurable wage, then the
  // accrual journal and the payment journal.
  const payrollMonth = '2026-12';
  const probeEmployee = 'VERIFY-PAYROLL';
  const payrollSettingKeys = ['InsuranceEmployeePct', 'InsuranceEmployerPct', 'InsuranceInsurableMin', 'InsuranceInsurableMax'];

  const savedSettings = (await db.query(
    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1::text[])',
    [payrollSettingKeys],
  )).rows;
  const savedEmployees = (await db.query(
    'SELECT employee_id, is_active FROM employees WHERE employee_id IN (1, 2) ORDER BY employee_id',
  )).rows;

  // Removes every artifact of the probe employee so the scenario is re-runnable.
  const purgeProbe = async () => {
    const probeRows = (await db.query('SELECT employee_id FROM employees WHERE name = $1::text', [probeEmployee])).rows;
    for (const probe of probeRows) {
      const employeeId = Number(probe.employee_id);
      const pays = (await db.query(
        'SELECT salary_pay_id, gl_journal_id, payment_journal_id FROM salary_pays WHERE employee_id = $1::int',
        [employeeId],
      )).rows;
      const payIds = pays.map((pay) => Number(pay.salary_pay_id));
      const journalIds = pays.flatMap((pay) => [pay.gl_journal_id, pay.payment_journal_id])
        .filter((id) => id !== null && id !== undefined).map(Number);
      if (payIds.length) {
        await db.query('DELETE FROM advance_deductions WHERE salary_pay_id = ANY($1::bigint[])', [payIds]);
        await db.query('DELETE FROM salary_pay_lines WHERE salary_pay_id = ANY($1::bigint[])', [payIds]);
        await db.query('DELETE FROM salary_pays WHERE salary_pay_id = ANY($1::bigint[])', [payIds]);
      }
      if (journalIds.length) {
        await db.query('DELETE FROM gl_entries WHERE journal_id = ANY($1::bigint[])', [journalIds]);
        await db.query('DELETE FROM gl_journals WHERE journal_id = ANY($1::bigint[])', [journalIds]);
      }
      await db.query('DELETE FROM attendances WHERE employee_id = $1::int', [employeeId]);
      await db.query('DELETE FROM employees WHERE employee_id = $1::int', [employeeId]);
    }
  };

  try {
    await purgeProbe();
    await db.query("UPDATE app_settings SET setting_value = '11' WHERE setting_key = 'InsuranceEmployeePct'");
    await db.query("UPDATE app_settings SET setting_value = '18.75' WHERE setting_key = 'InsuranceEmployerPct'");
    await db.query("UPDATE app_settings SET setting_value = '6500' WHERE setting_key = 'InsuranceInsurableMin'");
    await db.query("UPDATE app_settings SET setting_value = '7000' WHERE setting_key = 'InsuranceInsurableMax'");
    await db.query('UPDATE employees SET is_active = false WHERE employee_id IN (1, 2)');

    const employee = await call('POST', '/hr/employees', {
      name: probeEmployee, basicSalary: 6000, allowances: 0, deductions: 0, hireDate: '2026-01-01',
    });
    if (!employee.ok) throw new Error(`probe employee create failed ${employee.status} ${JSON.stringify(employee.data)}`);
    const employeeId = Number(employee.data?.employeeId);

    await call('POST', '/hr/attendance', {
      employeeId, workDate: '2026-12-05', status: 1, overtimeMinutes: 120,
    });

    const generated = await call('POST', '/hr/payroll/generate', { periodMonth: payrollMonth });
    record('G17', 'payroll generation accepted', 201, generated.status, generated.status === 201);
    info('G17', 'generation summary', generated.data);

    const payroll = (await db.query(
      `SELECT salary_pay_id, gross_pay::text AS gross, net_pay::text AS net,
              overtime_amount::text AS overtime, insurance_employee::text AS insurance_employee,
              insurance_employer::text AS insurance_employer, deductions::text AS deductions,
              unpaid_leave_days::text AS unpaid_days, status, gl_journal_id
         FROM salary_pays WHERE employee_id = $1::int AND period_month = $2::date`,
      [employeeId, `${payrollMonth}-01`],
    )).rows[0] ?? {};
    record('G17', 'gross = basic 6000 + overtime 50 (120 min @ 25/hour)', '6050.00', payroll.gross,
      Number(payroll.gross) === 6050);
    record('G17', 'employee insurance = 11% of the clamped insurable wage 6500', '715.00', payroll.insurance_employee,
      Number(payroll.insurance_employee) === 715);
    record('G17', 'employer insurance = 18.75% of 6500', '1218.75', payroll.insurance_employer,
      Number(payroll.insurance_employer) === 1218.75);
    record('G17', 'net = 6050.00 - 715.00 employee insurance', '5335.00', payroll.net,
      Number(payroll.net) === 5335);

    const salaryPayId = Number(payroll.salary_pay_id);
    const accrual = (await db.query(
      `SELECT e.account_id, e.debit::text AS debit, e.credit::text AS credit
         FROM gl_entries e WHERE e.journal_id = $1::bigint ORDER BY e.line_no`,
      [Number(payroll.gl_journal_id)],
    )).rows;
    const accrualDebit = round2(accrual.reduce((sum, row) => sum + Number(row.debit), 0));
    const accrualCredit = round2(accrual.reduce((sum, row) => sum + Number(row.credit), 0));
    record('G17', 'accrual journal balanced: Dr 7268.75 = Cr 7268.75',
      { debit: 7268.75, credit: 7268.75 }, { debit: accrualDebit, credit: accrualCredit },
      accrualDebit === 7268.75 && accrualCredit === 7268.75);

    const byAccount = (id) => accrual.find((row) => Number(row.account_id) === id) ?? { debit: '0', credit: '0' };
    const salaryExpense = byAccount(mapId('SALARY_EXPENSE'));
    const salaryPayable = byAccount(mapId('SALARY_PAYABLE'));
    const insurancePayable = byAccount(mapId('INSURANCE_PAYABLE'));
    record('G17', 'accrual: Dr salary expense 7268.75 · Cr payable 5335.00 · Cr insurance 1933.75',
      { debitExpense: '7268.75', creditPayable: '5335.00', creditInsurance: '1933.75' },
      {
        debitExpense: round2(salaryExpense.debit),
        creditPayable: round2(salaryPayable.credit),
        creditInsurance: round2(insurancePayable.credit),
      },
      Number(salaryExpense.debit) === 7268.75 && Number(salaryPayable.credit) === 5335
        && Number(insurancePayable.credit) === 1933.75);

    const payment = await call('POST', '/hr/payroll/pay', {
      periodMonth: payrollMonth, cashAccountId, salaryPayIds: [salaryPayId],
    });
    record('G17', 'payroll payment accepted', 201, payment.status, payment.status === 201);
    record('G17', 'payment total equals net pay', 5335, round2(payment.data?.total),
      round2(payment.data?.total) === 5335);

    const paidRow = (await db.query(
      'SELECT status, payment_journal_id FROM salary_pays WHERE salary_pay_id = $1::bigint',
      [salaryPayId],
    )).rows[0] ?? {};
    const paymentJournal = (await db.query(
      `SELECT e.account_id, e.debit::text AS debit, e.credit::text AS credit
         FROM gl_entries e WHERE e.journal_id = $1::bigint ORDER BY e.line_no`,
      [Number(paidRow.payment_journal_id)],
    )).rows;
    const payDebit = round2(paymentJournal.reduce((sum, row) => sum + Number(row.debit), 0));
    const payCredit = round2(paymentJournal.reduce((sum, row) => sum + Number(row.credit), 0));
    const payDebitAccount = Number((paymentJournal.find((row) => Number(row.debit) > 0) ?? {}).account_id);
    const payCreditAccount = Number((paymentJournal.find((row) => Number(row.credit) > 0) ?? {}).account_id);
    record('G17', 'payment journal: Dr payable 5335.00 / Cr cash 5335.00',
      { status: 2, debit: 5335, credit: 5335, debitAccount: mapId('SALARY_PAYABLE'), creditAccount: cashGlId },
      { status: Number(paidRow.status), debit: payDebit, credit: payCredit, debitAccount: payDebitAccount, creditAccount: payCreditAccount },
      Number(paidRow.status) === 2 && payDebit === 5335 && payCredit === 5335
        && payDebitAccount === mapId('SALARY_PAYABLE') && payCreditAccount === cashGlId);
  } finally {
    await purgeProbe();
    for (const row of savedSettings) {
      await db.query('UPDATE app_settings SET setting_value = $2 WHERE setting_key = $1::text',
        [row.setting_key, row.setting_value]);
    }
    for (const row of savedEmployees) {
      await db.query('UPDATE employees SET is_active = $2 WHERE employee_id = $1::int',
        [Number(row.employee_id), !!row.is_active]);
    }
  }

  // =============================================================== summary
  const failed = results.filter((r) => !r.pass);
  const passed = results.filter((r) => r.pass && !r.info);
  console.log('\n================ RESULT ================');
  console.log(`PASS ${passed.length} · FAIL ${failed.length} · INFO ${results.filter((r) => r.info).length}`);
  if (failed.length) console.log('failed ids: ' + failed.map((r) => r.id).join(', '));
  await db.end();
  process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
  console.error('ERROR:', error.message);
  try { await db?.end(); } catch {}
  process.exit(1);
});
