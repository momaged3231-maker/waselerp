/* E6 FINAL SIGN-OFF — Section 2: REAL PostgreSQL concurrency test.
 *
 * Runs against the isolated `wasel_signoff` database on the REAL local
 * PostgreSQL 18.6 cluster (port 5432) — NOT PGlite — via the API on port 4270.
 *
 * Steps:
 *   1) create a fresh bounded period (June 2029) — no dues exist in this DB
 *   2) post one revenue journal into it
 *   3) fire THREE concurrent POST close-month requests
 *   4) verify in the database:
 *      - exactly ONE closing journal (source_type = 'period_close')
 *      - periods.is_closed = true, closing_entry_id = that journal
 *      - RETAINED_EARNINGS (3103) moved by exactly the net income — once
 *      - all journals in the period are posted & balanced
 *      - trial balance balances
 *   5) re-close -> HTTP 400 with the Arabic refusal message
 *   6) activity_log holds exactly one 'period.close' for the period
 *
 * Usage: node tools/realtest/e6-concurrency.js  (env can override via PG_CONN/BASE)
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.E6_CONCURRENCY_BASE ?? 'http://127.0.0.1:4270/api';
const PG_CONN = process.env.E6_CONCURRENCY_PG ?? 'postgres://postgres:postgres@127.0.0.1:5432/wasel_signoff';
const FROM = process.env.E6_CONCURRENCY_FROM ?? '2029-06-01';
const TO = process.env.E6_CONCURRENCY_TO ?? '2029-06-30';
const MID = FROM.slice(0, 8) + '15';
const stamp = Date.now();

const log = (label, value) => console.log(`${label}: ${value}`);
const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const sql = new Client({ connectionString: PG_CONN });
  await sql.connect();

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  if (!login.accessToken) throw new Error('login failed: ' + JSON.stringify(login));
  const token = login.accessToken;
  const branchId = login.activeBranchId;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-branch-id': String(branchId) };
  const call = async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    if (!r.ok) { const e = new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(d)}`); e.status = r.status; e.body = d; throw e; }
    return d;
  };
  const raw = async (method, p) => {
    const r = await fetch(`${BASE}${p}`, { method, headers });
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: r.status, body: d };
  };

  // 1) fresh period
  const period = await call('POST', '/accounting/periods', { name: `فترة تزامن التوقيع ${stamp}`, startDate: FROM, endDate: TO });
  const periodId = Number(period.periodId ?? period.id);
  log('created period', `${periodId} (${FROM}..${TO})`);

  // resolve cash/revenue account ids by code (robust to seed variations) BEFORE posting
  const { rows: acctCodes } = await sql.query(`SELECT account_id, code FROM gl_accounts WHERE code IN ('1101','4101')`);
  const idByCode = Object.fromEntries(acctCodes.map((r) => [r.code, Number(r.account_id)]));
  log('gl codes', JSON.stringify(idByCode));

  // 2) revenue journal inside the period
  const journal = await call('POST', '/accounting/journals', {
    description: `إيرادات اختبار التزامن ${stamp}`, journalDate: MID, post: true,
    lines: [
      { accountId: idByCode['1101'], debit: 1000, description: 'نقدية' },
      { accountId: idByCode['4101'], credit: 1000, description: 'إيرادات' },
    ],
  });
  log('posted revenue journal', JSON.stringify(journal).slice(0, 120));

  const retainedBefore = await sql.query(`SELECT COALESCE(SUM(e.credit - e.debit),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '3103'`);
  log('RETAINED 3103 before close', retainedBefore.rows[0].net);

  // 3) three concurrent close requests
  const t0 = Date.now();
  const results = await Promise.allSettled([1, 2, 3].map(() => fetch(`${BASE}/accounting/periods/${periodId}/close-month`, {
    method: 'POST', headers, body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))));
  const elapsed = Date.now() - t0;
  const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
  log('three concurrent close-month statuses', statuses.join(', '));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') log(`close attempt #${i + 1} status=${r.value.status}`, JSON.stringify(r.value.body).slice(0, 160));
    else log(`close attempt #${i + 1}`, `REJECTED: ${r.reason}`);
  });
  log('elapsed ms', String(elapsed));

  const successes = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
  const conflicts = results.filter((r) => r.status === 'fulfilled' && r.value.status !== 201);
  log('successful closes', String(successes.length));
  log('refused closes', String(conflicts.length));

  // 4) DB verification
  const closeJournals = await sql.query(
    `SELECT journal_id, total_debit, total_credit FROM gl_journals WHERE period_id = $1::int AND source_type = 'period_close'`, [periodId]);
  log('period_close journals', String(closeJournals.rows.length));

  const periodRow = await sql.query(`SELECT is_closed, closing_entry_id, net_income, closed_by FROM periods WHERE period_id = $1::int`, [periodId]);
  log('period row', JSON.stringify(periodRow.rows[0]));

  const periodJournals = await sql.query(`SELECT j.journal_id, j.status, j.source_type, j.total_debit, j.total_credit FROM gl_journals j WHERE j.period_id = $1::int ORDER BY j.journal_id`, [periodId]);
  log('journals in period', JSON.stringify(periodJournals.rows.map((r) => ({ id: r.journal_id, src: r.source_type, status: r.status, dr: r.total_debit, cr: r.total_credit }))));

  const retainedAfter = await sql.query(`SELECT COALESCE(SUM(e.credit - e.debit),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '3103'`);
  log('RETAINED 3103 after close', retainedAfter.rows[0].net);
  const retainedDelta = Number(retainedAfter.rows[0].net) - Number(retainedBefore.rows[0].net);
  log('RETAINED delta applied exactly once', eq2(retainedDelta, 1000) ? `YES (+${retainedDelta})` : `NO (delta=${retainedDelta})`);

  // TB balance from API
  const tb = await fetch(`${BASE}/accounting/reports/trial-balance`, { headers }).then((r) => r.json());
  log('trial balance balanced', String(tb.balanced));

  // 5) re-close -> Arabic 400
  const reclose = await fetch(`${BASE}/accounting/periods/${periodId}/close-month`, { method: 'POST', headers, body: JSON.stringify({}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  log('re-close status', String(reclose.status));
  log('re-close message', String(reclose.body?.message ?? ''));

  // 6) activity_log exactly one period.close
  const audit = await sql.query(`SELECT COUNT(*)::int n FROM activity_log WHERE action = 'period.close' AND entity_id = $1::text`, [String(periodId)]);
  log("activity_log 'period.close' rows for the period", String(audit.rows[0].n));

  const checks = [
    ['exactly one closing journal created', closeJournals.rows.length === 1],
    ['one and only one close succeeded (201)', successes.length === 1],
    ['other two closes refused with 400', conflicts.length === 2 && conflicts.every((r) => r.value.status === 400)],
    ['period is closed with closing_entry_id set', periodRow.rows[0].is_closed === true && !!periodRow.rows[0].closing_entry_id],
    ['closing_entry_id equals the period_close journal', Number(periodRow.rows[0].closing_entry_id) === Number(closeJournals.rows[0]?.journal_id)],
    ['net_income recorded = 1000.00', eq2(periodRow.rows[0].net_income, 1000)],
    ['RETAINED moved by exactly +1000.00', eq2(retainedDelta, 1000)],
    ['all journals in period posted and balanced', periodJournals.rows.every((j) => j.status === 2 && eq2(j.total_debit, j.total_credit))],
    ['trial balance balanced', tb.balanced === true],
    ['re-close refused 400 with Arabic message', reclose.status === 400 && String(reclose.body?.message ?? '').includes('مقفلة')],
    ["activity_log has exactly one 'period.close'", audit.rows[0].n === 1],
  ];
  console.log('\n=================================');
  console.log('CONCURRENCY TEST (real PostgreSQL 18.6, DB wasel_signoff)');
  console.log('=================================');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\nRESULT: ${checks.length - failed}/${checks.length} checks passed`);
  await sql.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
