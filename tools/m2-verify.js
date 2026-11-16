/* M2/M3-E6 final independent verification: TB, equation, retained earnings, GL control totals. */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5435, user: 'postgres', password: 'postgres', database: 'wasel_month2' });
  await c.connect();
  const q = (s, p = []) => c.query(s, p).then((r) => r.rows);
  const eq = (label, a, b) => console.log(`${Math.abs(Number(a) - Number(b)) < 0.01 ? 'PASS' : 'FAIL'}  ${label}  (a=${a} b=${b})`);

  const tb = await q(`SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM (
      SELECT SUM(e.debit) AS debit, SUM(e.credit) AS credit
        FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id JOIN gl_journals j ON j.journal_id = e.journal_id
       WHERE j.status = 2 GROUP BY a.account_id HAVING SUM(e.debit) <> SUM(e.credit) OR SUM(e.debit) <> 0) x`);
  console.log('TB totals (balanced when equal):', JSON.stringify(tb[0]));

  const sums = await q(`SELECT
      COALESCE(SUM(CASE WHEN a.account_type = 1 THEN e.debit - e.credit ELSE 0 END), 0) assets,
      COALESCE(SUM(CASE WHEN a.account_type = 2 THEN e.credit - e.debit ELSE 0 END), 0) liabilities,
      COALESCE(SUM(CASE WHEN a.account_type = 3 THEN e.credit - e.debit ELSE 0 END), 0) equity,
      COALESCE(SUM(CASE WHEN a.account_type = 4 THEN e.credit - e.debit ELSE 0 END), 0) revenue,
      COALESCE(SUM(CASE WHEN a.account_type = 5 THEN e.debit - e.credit ELSE 0 END), 0) expense
    FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id JOIN gl_journals j ON j.journal_id = e.journal_id
   WHERE j.status = 2`);
  const s = sums[0];
  console.log('ledger aggregates:', JSON.stringify(s));
  const A = Number(s.assets), L = Number(s.liabilities), E = Number(s.equity);
  const net = Number(s.revenue) - Number(s.expense);
  console.log(`A = L + E + (R-X): ${A.toFixed(2)} = ${L.toFixed(2)} + ${E.toFixed(2)} + ${net.toFixed(2)} -> ${Math.abs(A - (L + E + net)) < 0.01 ? 'PASS exact' : 'FAIL'}`);

  const ret = await q(`SELECT COALESCE(SUM(e.credit - e.debit), 0) retained FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id JOIN gl_journals j ON j.journal_id = e.journal_id WHERE a.code = '3103' AND j.status = 2`);
  console.log('retained earnings 3103:', ret[0].retained);

  const closes = await q(`SELECT p.period_id, p.name, p.net_income::numeric ni, p.closing_entry_id FROM periods p WHERE p.is_closed = true ORDER BY p.period_id`);
  console.log('closed periods:', JSON.stringify(closes, null, 1));
  const countJ = await q(`SELECT COUNT(*)::int n FROM gl_journals WHERE source_type = 'period_close'`);
  console.log('period_close journals:', countJ[0].n);
  const tbSums = await q(`SELECT COALESCE(SUM(total_debit),0) d, COALESCE(SUM(total_credit),0) c FROM gl_journals WHERE status = 2`);
  console.log('all posted journals Dr/Cr:', JSON.stringify(tbSums[0]));
  await c.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
