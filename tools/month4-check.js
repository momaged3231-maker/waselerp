/* Phase E2 — Month-4 Expected vs Actual check (INDEPENDENT of the ops code).
 *
 * Recomputes every expectation from the scenario parameters in
 * tools/pg/pglite-month4/month4-scenario.json (prices, quantities, VAT) and
 * compares against what the system actually booked — GL, ledger, balances.
 *
 * Run: node tools/month4-check.js
 */
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const DB = process.env.M4_DB ?? 'postgres://postgres:postgres@127.0.0.1:5436/wasel_month4';
const BASE = process.env.M4_BASE ?? 'http://127.0.0.1:4280/api';
const sc = JSON.parse(fs.readFileSync(path.join(__dirname, 'pg', 'pglite-month4', 'month4-scenario.json'), 'utf8'));

let failures = 0;
const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const check = (label, ok, detail) => {
  if (ok) console.log(`✅ ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  else { console.log(`❌ ${label}${detail !== undefined ? ' — ' + detail : ''}`); failures += 1; }
};

(async () => {
  const sql = new Client({ connectionString: DB });
  await sql.connect();
  const A = sc.BRANCH_A, B = sc.BRANCH_B;

  // ---------- 1) stock quantities & values per warehouse --------------------
  const { rows: qty } = await sql.query(
    `SELECT w.branch_id AS branch, q.item_id, q.on_hand_qty::numeric qty, q.avg_cost::numeric avg_cost,
            (q.on_hand_qty * q.avg_cost)::numeric value
       FROM item_warehouse_qty q JOIN warehouses w ON w.warehouse_id = q.warehouse_id
      WHERE q.item_id = ANY($1::int[])`, [[sc.itemAId, sc.itemBId]]);
  const q = (branch, itemId) => qty.find((r) => Number(r.branch) === Number(branch) && Number(r.item_id) === Number(itemId));
  const qaLapA = q(A, sc.itemAId), qaKb = q(A, sc.itemBId), qbLapA = q(B, sc.itemAId), qbKb = q(B, sc.itemBId);
  check('M4A: A holds 3 units of M4-LAP-A (10-2-4-1count)', qaLapA && eq2(qaLapA.qty, 3), qaLapA && `qty=${qaLapA.qty} @${qaLapA.avg_cost}`);
  check('M4A: source average cost stayed 800.0000 (no revaluation)', qaLapA && eq2(qaLapA.avg_cost, 800), qaLapA && `avg=${qaLapA.avg_cost}`);
  check('M4A: A holds 4 units of M4-KB (5-2+2-1damage)', qaKb && eq2(qaKb.qty, 4), qaKb && `qty=${qaKb.qty}`);
  check('M4B: B holds 4 units of M4-LAP-A (4-1+1return)', qbLapA && eq2(qbLapA.qty, 4), qbLapA && `qty=${qbLapA.qty}`);
  const totalBooked = Number((qaLapA?.value ?? 0)) + Number((qaKb?.value ?? 0)) + Number((qbLapA?.value ?? 0)) + Number((qbKb?.value ?? 0));
  check('M4: company stock value = 6,400.00 (transfer moved, never created/destroyed)', eq2(totalBooked, sc.expected.invCompany), `total=${totalBooked.toFixed(2)}`);

  // per-branch booking value (the transfer's effect on each side must be exact)
  const bookedA = Number((qaLapA?.value ?? 0)) + Number((qaKb?.value ?? 0));
  const bookedB = Number((qbLapA?.value ?? 0)) + Number((qbKb?.value ?? 0));
  check('M4: branch A booking value = 3,200.00', eq2(bookedA, sc.expected.invA), `A=${bookedA.toFixed(2)}`);
  check('M4: branch B booking value = 3,200.00', eq2(bookedB, sc.expected.invB), `B=${bookedB.toFixed(2)}`);

  // ---------- 2) GL per account per branch ------------------------------------
  const gl = async (mappingKey) => {
    const { rows } = await sql.query(
      `SELECT j.branch_id AS branch, COALESCE(SUM(e.debit - e.credit), 0)::numeric net
         FROM gl_entries e
         JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
         JOIN gl_accounts a ON a.account_id = e.account_id
         JOIN gl_mappings m ON m.account_id = a.account_id AND m.mapping_key = $1
        GROUP BY j.branch_id`, [mappingKey]);
    return Object.fromEntries(rows.map((r) => [Number(r.branch), Number(r.net)]));
  };
  const inv = await gl('INVENTORY');
  check('M4: GL(1104) net debit A = 3,200.00', eq2(Math.abs(inv[A] ?? 0), sc.expected.invA), `A=${(inv[A] ?? 0).toFixed(2)}`);
  check('M4: GL(1104) net debit B = 3,200.00', eq2(Math.abs(inv[B] ?? 0), sc.expected.invB), `B=${(inv[B] ?? 0).toFixed(2)}`);

  const cogs = await gl('COGS');
  check('M4: GL(COGS) A = 1,600.00 (2 × 800)', eq2(cogs[A] ?? 0, sc.expected.cogsA), `A=${(cogs[A] ?? 0).toFixed(2)}`);
  check('M4: GL(COGS) B = 0.00 (800 sale − 800 return)', eq2(cogs[B] ?? 0, sc.expected.cogsB), `B=${(cogs[B] ?? 0).toFixed(2)}`);

  const dmg = await gl('DAMAGE_EXPENSE');
  check('M4: GL(DAMAGE_EXPENSE) A = 200.00', eq2(dmg[A] ?? 0, sc.expected.damageA), `A=${(dmg[A] ?? 0).toFixed(2)}`);

  const varLoss = await gl('INVENTORY_VARIANCE');
  check('M4: GL(INVENTORY_VARIANCE) A = 800.00', eq2(varLoss[A] ?? 0, sc.expected.countLossA), `A=${(varLoss[A] ?? 0).toFixed(2)}`);

  // revenue: account_type 4, credit-minus-debit, per branch
  const { rows: rev } = await sql.query(
    `SELECT j.branch_id AS branch, COALESCE(SUM(e.credit - e.debit), 0)::numeric net
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE a.account_type = 4 GROUP BY j.branch_id`);
  const revMap = Object.fromEntries(rev.map((r) => [Number(r.branch), Number(r.net)]));
  check('M4: revenue A = 3,000.00', eq2(revMap[A] ?? 0, sc.expected.revenueA), `A=${(revMap[A] ?? 0).toFixed(2)}`);
  check('M4: revenue B = 0.00 (1,600 sale − 1,600 return)', eq2(revMap[B] ?? 0, sc.expected.revenueB), `B=${(revMap[B] ?? 0).toFixed(2)}`);

  // VAT: 1105 input (A 1,120 debit) · 2102 output (A 420 credit, B net 0)
  const { rows: vat } = await sql.query(
    `SELECT a.code, j.branch_id AS branch, COALESCE(SUM(e.debit - e.credit), 0)::numeric net
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE a.code IN ('1105', '2102') GROUP BY a.code, j.branch_id`);
  const vatGet = (code, branch) => Number(vat.find((r) => r.code === code && Number(r.branch) === Number(branch))?.net ?? 0);
  check('M4: VAT input A (1105) = 1,120.00', eq2(vatGet('1105', A), sc.expected.vatInputA), `A=${vatGet('1105', A).toFixed(2)}`);
  check('M4: VAT output A (2102) = -420.00 (credit)', eq2(vatGet('2102', A), -sc.expected.vatOutputA), `A=${vatGet('2102', A).toFixed(2)}`);
  check('M4: VAT output B (2102) = 0.00', eq2(vatGet('2102', B), 0), `B=${vatGet('2102', B).toFixed(2)}`);

  // ---------- 3) the clearing account 1108 — company-wide invariant ------------
  const { rows: clear } = await sql.query(
    `SELECT COALESCE(SUM(e.debit - e.credit), 0)::numeric company,
            COALESCE(SUM(CASE WHEN j.branch_id = $1 THEN e.debit - e.credit END), 0)::numeric aside,
            COALESCE(SUM(CASE WHEN j.branch_id = $2 THEN e.debit - e.credit END), 0)::numeric bside
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE a.code = '1108'`, [A, B]);
  const company1108 = Number(clear[0].company);
  check('M4: 1108 clearing nets to 0.00 company-wide (T1 completed, T2 cancelled)', eq2(company1108, 0),
    `company=${company1108.toFixed(2)} (branchA=${Number(clear[0].aside ?? 0).toFixed(2)}, branchB=${Number(clear[0].bside ?? 0).toFixed(2)})`);

  // in-transit value must be zero: every shipment reached a terminal state
  const { rows: transit } = await sql.query(`SELECT COALESCE(SUM(total_value), 0)::numeric v FROM branch_transfers WHERE status = 2`);
  check('M4: no transfers left in transit (status=2 totals 0.00)', eq2(transit[0].v, 0), `inTransit=${transit[0].v}`);

  // ---------- 4) branch-transfer journal counts (source types) -----------------
  const { rows: jcount } = await sql.query(
    `SELECT source_type, COUNT(*)::int n FROM gl_journals
      WHERE source_type IN ('branch_transfer', 'branch_transfer_cancel') GROUP BY source_type`);
  const jMap = Object.fromEntries(jcount.map((r) => [r.source_type, Number(r.n)]));
  check('M4: 3 branch_transfer journals (T1 approve+receive, T2 approve)', (jMap.branch_transfer ?? 0) === 3, JSON.stringify(jMap));
  check('M4: 1 branch_transfer_cancel journal (T2 cancel)', (jMap.branch_transfer_cancel ?? 0) === 1, JSON.stringify(jMap));

  // ---------- 5) RETAINED_EARNINGS unchanged -----------------------------------
  const { rows: retained } = await sql.query(
    `SELECT COALESCE(SUM(e.credit - e.debit), 0)::numeric net
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
       JOIN gl_accounts a ON a.account_id = e.account_id
       JOIN gl_mappings m ON m.account_id = a.account_id
      WHERE m.mapping_key = 'RETAINED_EARNINGS'`);
  check('M4: RETAINED_EARNINGS unchanged by the month (no P&L leakage from transfers)',
    eq2(retained[0].net, sc.retainedBefore), `before=${sc.retainedBefore} after=${retained[0].net}`);

  // ---------- 6) per-branch TB balance + accounting equation --------------------
  for (const [label, branchId] of [['A', A], ['B', B]]) {
    const { rows: tb } = await sql.query(
      `SELECT COALESCE(SUM(e.debit), 0)::numeric d, COALESCE(SUM(e.credit), 0)::numeric c
         FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
        WHERE j.branch_id = $1::int`, [branchId]);
    check(`M4: trial balance branch ${label} balanced (debit == credit)`, eq2(tb[0].d, tb[0].c), `debit=${tb[0].d} credit=${tb[0].c}`);

    const { rows: eqn } = await sql.query(
      `SELECT
         COALESCE(SUM(e.debit - e.credit) FILTER (WHERE a.account_type = 1), 0)::numeric assets,
         COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 2), 0)::numeric liabilities,
         COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 3), 0)::numeric equity,
         COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 4), 0)::numeric revenue,
         COALESCE(SUM(e.debit - e.credit) FILTER (WHERE a.account_type = 5), 0)::numeric expenses
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE j.branch_id = $1::int`, [branchId]);
    const r = eqn[0];
    const pnl = Number(r.revenue) - Number(r.expenses);
    check(`M4: accounting equation branch ${label}: Assets = Liabilities + Equity + (R − X)`,
      eq2(r.assets, Number(r.liabilities) + Number(r.equity) + pnl),
      `A=${Number(r.assets).toFixed(2)} L=${Number(r.liabilities).toFixed(2)} E=${Number(r.equity).toFixed(2)} R−X=${pnl.toFixed(2)}`);
  }

  // ---------- 7) company-wide equation -------------------------------------------
  const { rows: ceqn } = await sql.query(
    `SELECT
       COALESCE(SUM(e.debit - e.credit) FILTER (WHERE a.account_type = 1), 0)::numeric assets,
       COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 2), 0)::numeric liabilities,
       COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 3), 0)::numeric equity,
       COALESCE(SUM(e.credit - e.debit) FILTER (WHERE a.account_type = 4), 0)::numeric revenue,
       COALESCE(SUM(e.debit - e.credit) FILTER (WHERE a.account_type = 5), 0)::numeric expenses
     FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
     JOIN gl_accounts a ON a.account_id = e.account_id`);
  const rc = ceqn[0];
  const pnlC = Number(rc.revenue) - Number(rc.expenses);
  check('M4: accounting equation COMPANY-WIDE holds',
    eq2(rc.assets, Number(rc.liabilities) + Number(rc.equity) + pnlC),
    `A=${Number(rc.assets).toFixed(2)} L=${Number(rc.liabilities).toFixed(2)} E=${Number(rc.equity).toFixed(2)} R−X=${pnlC.toFixed(2)}`);
  console.log(`   company P&L this month: ${pnlC.toFixed(2)} (expected 400.00 = 3,000 rev − 1,600 COGS − 200 damage − 800 count loss)`);

  // ---------- 8) movement ledger checks -------------------------------------------
  const { rows: moves } = await sql.query(
    `SELECT move_type, COUNT(*)::int n, COALESCE(SUM(quantity), 0)::numeric qty
       FROM stock_movements WHERE reference_id = ANY($1::bigint[]) GROUP BY move_type`,
    [[sc.t1, sc.t2, sc.cnt]]);
  const mv = Object.fromEntries(moves.map((r) => [Number(r.move_type), { n: Number(r.n), qty: Number(r.qty) }]));
  // note: movements store SIGNED quantities (out = negative)
  check('M4: T1+T2 ledger — transferOut signed -6 (4+2) · transferIn signed +6 (T1 4 + T2 reversal 2) · 2 movements each',
    mv[6]?.qty === -6 && mv[5]?.qty === 6 && mv[6]?.n === 2 && mv[5]?.n === 2,
    JSON.stringify(mv));
  check('M4: count loss movement — 1 unit (move_type 8) from the count', (mv[8]?.n ?? 0) === 1 && eq2(Math.abs(Number(mv[8]?.qty)), 1), JSON.stringify(mv[8]));

  // ---------- 9) API-level sanity: suspense endpoint company-wide -------------------
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  const suspense = await fetch(`${BASE}/reports/branch-transfers/suspense`, {
    headers: { Authorization: `Bearer ${login.accessToken}`, 'x-branch-id': String(A) },
  }).then((r) => r.json());
  check('M4: API /reports/branch-transfers/suspense — company-wide clearing 0.00 & inTransit 0.00',
    suspense.company && eq2(suspense.company.glClearing, 0) && eq2(suspense.company.inTransitValue, 0) && suspense.company.match === true,
    JSON.stringify(suspense.company));

  await sql.end();
  console.log(failures === 0 ? '\nM4 EXPECTED VS ACTUAL: ALL CHECKS PASSED' : `\nM4 EXPECTED VS ACTUAL: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('M4 CHECK ERROR:', e.message); process.exit(1); });
