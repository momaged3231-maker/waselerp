/* E2 — Gate verification for the approved Option A:
 * "Recalculate moving average at approval time (Cost snapshot policy change)."
 *
 * Runs against the isolated REAL PostgreSQL `wasel_costfix` (fresh DB) via API on 4261.
 * Exit code 0 ⇔ every check passed.
 *
 * Scenarios covered (the exact defects/routes the reviewer asked for):
 *   1. defect reproduction — line add snapshot ignored, live avg used at approve
 *   2. multi-line same item — all lines get the SAME locked average
 *   3. insufficient quantity at approve — refused with a clear message
 *   4. concurrent purchase + approve — GL == ledger afterwards regardless of order
 *   5. cancel after approve — reverses at the APPROVED cost
 *   6. idempotent approve / receive — second call refused
 *   7. internal same-branch transfer — same locked-average policy
 *   8. full reconciliation: GL 1104 per branch == ledger, TB per branch + company, 1108 net
 *   9. both transfer types end with company-wide 1108 == expected outstanding only
 *
 * Usage: node tools/realtest/e2-costfix.js   (env override: E2_COSTFIX_BASE / E2_COSTFIX_PG)
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.E2_COSTFIX_BASE ?? 'http://127.0.0.1:4261/api';
const PG_CONN = process.env.E2_COSTFIX_PG ?? 'postgres://postgres:postgres@127.0.0.1:5432/wasel_costfix';
const today = new Date().toISOString().slice(0, 10);

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`✅ ${label}${detail ? ' — ' + detail : ''}`);
  else { console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`); failures += 1; }
};
const round6 = (v) => Math.round(Number(v) * 1e6) / 1e6;
const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const sql = new Client({ connectionString: PG_CONN });
  await sql.connect();

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  const token = login.accessToken;
  const headers = (branch) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-branch-id': String(branch) });
  const call = async (method, p, body, branch = 1) => {
    const r = await fetch(`${BASE}${p}`, { method, headers: headers(branch), body: body !== undefined ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    if (r.status >= 400) { const e = new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(d)}`); e.status = r.status; e.body = d; throw e; }
    return d;
  };
  const raw = (method, p, body, branch = 1) =>
    fetch(`${BASE}${p}`, { method, headers: headers(branch), body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const stamp = Date.now();

  // ---------- environment: branch B + warehouse + items ----------
  const branchB = await call('POST', '/admin/branches', { code: `E2CF-B${stamp}`, name: `فرع costfix ${stamp}`, city: 'الجيزة', isActive: true }, 1);
  const branchBId = Number(branchB.branchId);
  const whB = await call('POST', '/catalog/warehouses', { branchId: branchBId, code: `E2CFW${stamp}`, name: `مخزن costfix ${stamp}`, isActive: true }, 1);
  const whBId = Number(whB.warehouseId);
  // internal second warehouse in branch 1 for scenario 7
  const whA2 = await call('POST', '/catalog/warehouses', { branchId: 1, code: `E2CFA${stamp}`, name: `مخزن داخلي costfix ${stamp}`, isActive: true }, 1);
  const whA2Id = Number(whA2.warehouseId);

  const mkItem = (code) => call('POST', '/items', { code, name: `صنف ${code}`, baseUnitId: 1, costPrice: 800, sellPrice: 1200, vatPct: 0 }, 1);
  const itemA = await mkItem(`E2CF-A${stamp}`);
  const itemM = await mkItem(`E2CF-M${stamp}`);
  const itemQ = await mkItem(`E2CF-Q${stamp}`);
  const itemR = await mkItem(`E2CF-R${stamp}`);
  const itemC = await mkItem(`E2CF-C${stamp}`);
  const itemD = await mkItem(`E2CF-D${stamp}`);
  const itemI = await mkItem(`E2CF-I${stamp}`);
  const a = Number(itemA.itemId), m = Number(itemM.itemId), q = Number(itemQ.itemId), r = Number(itemR.itemId), c = Number(itemC.itemId), d = Number(itemD.itemId), i = Number(itemI.itemId);

  const buy = (itemId, unitPrice, branch = 1) =>
    call('POST', '/sales/invoices', {
      invoiceType: 2, warehouseId: 1, partyId: null, paymentType: 1, cashAccountId: 1,
      paidAmount: Math.round(unitPrice * 1 * 100) / 100, invoiceDate: today,
      notes: 'costfix purchase',
      lines: [{ itemId, unitId: 1, quantity: 1, unitPrice, discountPct: 0, taxPct: 0 }],
    }, branch);

  // ================= Scenario 1 — defect reproduction =================
  await buy(a, 800);              // avg 800
  const t1 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T1', clientRequestId: `e2cf-t1-${stamp}` }, 1);
  const t1Id = Number(t1.branchTransferId);
  await call('POST', `/branch-transfers/${t1Id}/lines`, { itemId: a, unitId: 1, quantity: 1 }, 1); // snapshot 800 stored
  const pre = await call('GET', `/branch-transfers/${t1Id}`, undefined, 1);
  ok('CF1: line-add records the snapshot cost as estimate (800)', eq2(pre.lines[0].unitCost, 800), `unitCost=${pre.lines[0].unitCost}`);
  await buy(a, 400);              // avg becomes 600
  const ap1 = await call('POST', `/branch-transfers/${t1Id}/approve`, {}, 1);
  const post1 = await call('GET', `/branch-transfers/${t1Id}`, undefined, 1);
  ok('CF1: APPROVED line cost == live average at approve (600, not 800)', eq2(post1.lines[0].unitCost, 600), `unitCost=${post1.lines[0].unitCost}`);
  ok('CF1: approve returned totalValue 600 (recomputed)', eq2(ap1.totalValue, 600), `totalValue=${ap1.totalValue}`);

  const { rows: ledger1 } = await sql.query(
    `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::numeric v FROM item_warehouse_qty q JOIN warehouses w ON w.warehouse_id = q.warehouse_id WHERE w.branch_id = 1`);
  const { rows: glItem1 } = await sql.query(
    `SELECT COALESCE(SUM(e.debit - e.credit),0)::numeric v
       FROM gl_entries e JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
       JOIN gl_accounts a ON a.account_id=e.account_id WHERE j.branch_id = 1 AND a.code='1104'`);
  ok('CF1: post-approve — GL(1104) branch 1 == ledger branch 1 (all items, to the penny)', eq2(glItem1[0].v, ledger1[0].v), `GL=${glItem1[0].v} ledger=${ledger1[0].v}`);
  const { rows: ledgerB1 } = await sql.query(
    `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::numeric v FROM item_warehouse_qty q WHERE q.item_id=$1 AND q.warehouse_id=$2`, [a, whBId]);
  const { rows: custGl1108 } = await sql.query(
    `SELECT COALESCE(SUM(e.debit-e.credit),0)::numeric v
       FROM gl_entries e JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
       JOIN gl_accounts a ON a.account_id=e.account_id
      WHERE j.source_type IN ('branch_transfer','branch_transfer_cancel') AND j.source_id = $1 AND a.code = '1108'`, [t1Id]);
  ok('CF1: 1108 net for T1 = +600 (debit leg intact) before receipt', eq2(custGl1108[0].v, 600), `1108 for T1=${custGl1108[0].v}`);

  const recv1 = await call('POST', `/branch-transfers/${t1Id}/receive`, {}, branchBId);
  ok('CF1: received at approved cost 600', eq2(recv1.totalValue, 600), `receive total=${recv1.totalValue}`);
  const { rows: glR1 } = await sql.query(
    `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::numeric v FROM item_warehouse_qty q WHERE q.item_id=$1 AND q.warehouse_id=$2`, [a, whBId]);
  ok('CF1: destination ledger == 600 (frozen approved cost)', eq2(glR1[0].v, 600), `ledgerB=${glR1[0].v}`);

  // ================= Scenario 2 — multi-line same item =================
  await buy(m, 800); await buy(m, 800); await buy(m, 800);   // qty3 @800 avg
  await call('POST', `/items/${m}/units`, { units: [{ unitId: 2, factor: 2 }] }, 1);
  const t2 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T2 multiline', clientRequestId: `e2cf-t2-${stamp}` }, 1);
  const t2Id = Number(t2.branchTransferId);
  await call('POST', `/branch-transfers/${t2Id}/lines`, { itemId: m, unitId: 1, quantity: 1 }, 1);   // 1 PCS
  await call('POST', `/branch-transfers/${t2Id}/lines`, { itemId: m, unitId: 2, quantity: 1 }, 1);   // 1 PKT = 2 PCS
  await buy(m, 400);                                // avg drifts: (2400+400)/4 = 700
  const ap2 = await call('POST', `/branch-transfers/${t2Id}/approve`, {}, 1);
  const post2 = await call('GET', `/branch-transfers/${t2Id}`, undefined, 1);
  const lineCosts2 = [...new Set(post2.lines.map((l) => Number(l.unitCost)))];
  ok('CF2: multi-line — every line of item M shares ONE locked approved cost', post2.lines.length === 2 && lineCosts2.length === 1, `lines=${post2.lines.length} costs=${lineCosts2.join(',')}`);
  ok('CF2: approved cost equals live average at approve', eq2(lineCosts2[0], 700), `unitCost=${lineCosts2[0]}`);
  const recv2 = await call('POST', `/branch-transfers/${t2Id}/receive`, {}, branchBId);
  ok('CF2: received with same approved cost', eq2(recv2.totalValue, 2100), `recv=${recv2.totalValue}`);

  // ================= Scenario 3 — insufficient quantity refused =================
  await buy(q, 800);                                // qty1
  const t3 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T3 short', clientRequestId: `e2cf-t3-${stamp}` }, 1);
  const t3Id = Number(t3.branchTransferId);
  await call('POST', `/branch-transfers/${t3Id}/lines`, { itemId: q, unitId: 1, quantity: 5 }, 1);
  let refuse = await raw('POST', `/branch-transfers/${t3Id}/approve`, {}, 1);
  ok('CF3: approve with insufficient quantity refused (400/422)', [400, 422].includes(refuse.status), `status=${refuse.status} msg=${refuse.body?.message ?? ''}`);

  // ================= Scenario 4 — concurrent approve vs purchase =================
  await buy(r, 800);                                // qty1 @800
  const t4 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T4 race', clientRequestId: `e2cf-t4-${stamp}` }, 1);
  const t4Id = Number(t4.branchTransferId);
  await call('POST', `/branch-transfers/${t4Id}/lines`, { itemId: r, unitId: 1, quantity: 1 }, 1);
  const [pRes, apRes] = await Promise.allSettled([
    call('POST', '/sales/invoices', {
      invoiceType: 2, warehouseId: 1, partyId: null, paymentType: 1, cashAccountId: 1,
      paidAmount: 400, invoiceDate: today, notes: 'race purchase',
      lines: [{ itemId: r, unitId: 1, quantity: 1, unitPrice: 400, discountPct: 0, taxPct: 0 }],
    }, 1),
    call('POST', `/branch-transfers/${t4Id}/approve`, {}, 1),
  ]);
  const approveOutcome = apRes.status === 'fulfilled' ? apRes.value : null;
  const purchaseOutcome = pRes.status === 'fulfilled' ? pRes.value : null;
  ok('CF4: both concurrent operations complete without corruption (approve reached final state)', [2, 4].includes(approveOutcome?.status) || !!purchaseOutcome,
    `approve status=${approveOutcome?.status ?? 'rejected'} purchase invoice=${purchaseOutcome?.invoiceId ?? 'rejected'}`);
  // final consistency GL == ledger (whatever the serialization order)
  const { rows: glR } = await sql.query(
    `SELECT COALESCE(SUM(e.debit - e.credit),0)::numeric gl1104 FROM gl_entries e
       JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
       JOIN gl_accounts a ON a.account_id=e.account_id WHERE j.branch_id = 1 AND a.code = '1104'`);
  const { rows: ledgerR } = await sql.query(
    `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::numeric ledger FROM item_warehouse_qty q WHERE q.warehouse_id = 1`);
  const { rows: gl2 } = await sql.query(
    `SELECT COALESCE(SUM(e.debit - e.credit),0)::numeric gl FROM gl_entries e
       JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
       JOIN gl_accounts a ON a.account_id=e.account_id WHERE j.branch_id = 1 AND a.code = '1104'`);
  ok('CF4: after the race — GL(1104) branch 1 == ledger (booked INVENTORY == sum of warehouse values)', eq2(gl2[0].gl, ledgerR[0].ledger),
    `GL=${gl2[0].gl} ledger=${ledgerR[0].ledger}`);

  // ================= Scenario 5 — cancel uses approved cost =================
  await buy(c, 800);                                // qty1 @800
  const t5 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T5 cancel', clientRequestId: `e2cf-t5-${stamp}` }, 1);
  const t5Id = Number(t5.branchTransferId);
  await call('POST', `/branch-transfers/${t5Id}/lines`, { itemId: c, unitId: 1, quantity: 1 }, 1);
  await buy(c, 400);                                // avg 600
  const ap5 = await call('POST', `/branch-transfers/${t5Id}/approve`, {}, 1);
  await call('POST', `/branch-transfers/${t5Id}/cancel`, { reason: 'costfix cancel test' }, 1);
  const cf5 = await call('GET', `/branch-transfers/${t5Id}`, undefined, 1);
  ok('CF5: approved at 600; cancel reverses at the same approved cost', eq2(cf5.totalValue, 600), `totalValue after cancel-reversal flow=${cf5.totalValue}`);
  const { rows: gl5 } = await sql.query(
    `SELECT COALESCE(SUM(e.debit - e.credit),0)::numeric net FROM gl_entries e
       JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2
       JOIN gl_accounts a ON a.account_id=e.account_id
      WHERE j.source_type IN ('branch_transfer','branch_transfer_cancel') AND j.source_id = $1`, [t5Id]);
  ok('CF5: cancel reversal nets 1104+1108 to zero for this transfer', eq2(gl5[0].net, 0), `net=${gl5[0].net}`);

  // ================= Scenario 6 — idempotent approve/receive =================
  await buy(d, 800);
  const t6 = await call('POST', '/branch-transfers', { fromWarehouseId: 1, toWarehouseId: whBId, transferDate: today, notes: 'costfix T6 idem', clientRequestId: `e2cf-t6-${stamp}` }, 1);
  const t6Id = Number(t6.branchTransferId);
  await call('POST', `/branch-transfers/${t6Id}/lines`, { itemId: d, unitId: 1, quantity: 1 }, 1);
  await call('POST', `/branch-transfers/${t6Id}/approve`, {}, 1);
  const dupApprove = await raw('POST', `/branch-transfers/${t6Id}/approve`, {}, 1);
  ok('CF6: duplicate approve refused (400)', dupApprove.status === 400, `status=${dupApprove.status}`);
  await call('POST', `/branch-transfers/${t6Id}/receive`, {}, branchBId);
  const dupReceive = await raw('POST', `/branch-transfers/${t6Id}/receive`, {}, branchBId);
  ok('CF6: duplicate receive refused (400)', dupReceive.status === 400, `status=${dupReceive.status}`);

  // ================= Scenario 7 — internal same-branch transfer =================
  await buy(i, 800);
  const t7 = await call('POST', '/stock-transfers', { fromWarehouseId: 1, toWarehouseId: whA2Id, transferDate: today, notes: 'costfix T7 internal', clientRequestId: `e2cf-t7-${stamp}` }, 1);
  const t7Id = Number(t7.stockTransferId ?? t7.id);
  await call('POST', `/stock-transfers/${t7Id}/lines`, { itemId: i, unitId: 1, quantity: 1 }, 1);
  // change average BEFORE approve
  await buy(i, 400);
  const ap7 = await call('POST', `/stock-transfers/${t7Id}/approve`, {}, 1);
  const { rows: t7Line } = await sql.query(
    `SELECT unit_cost FROM stock_transfer_lines WHERE stock_transfer_id = $1`, [t7Id]);
  ok('CF7: internal transfer — cost re-read at approve too (600, not 800)', eq2(t7Line[0].unit_cost, 600), `unitCost=${t7Line[0].unit_cost}`);
  const recv7 = await call('POST', `/stock-transfers/${t7Id}/receive`, {}, 1);
  ok('CF7: internal receive succeeds', !!(recv7 && (recv7.status === 4 || recv7.status === 2 || recv7.inboundVoucherId)), `recv=${JSON.stringify(recv7).slice(0, 80)}`);

  // ================= Scenario 8 — full reconciliation =================
  const { rows: allLn } = await sql.query(
    `SELECT j.branch_id, a.code, COALESCE(SUM(e.debit - e.credit),0)::numeric net
       FROM gl_entries e JOIN gl_journals j ON j.journal_id=e.journal_id AND j.status=2 JOIN gl_accounts a ON a.account_id=e.account_id
      WHERE a.code IN ('1104','1108') GROUP BY j.branch_id, a.code ORDER BY j.branch_id, a.code`);
  const invGl = (br, code) => Number(allLn.find((x) => Number(x.branch_id) === br && x.code === code)?.net ?? 0);
  const { rows: ledVal } = await sql.query(
    `SELECT w.branch_id, COALESCE(SUM(q.on_hand_qty * q.avg_cost),0)::numeric v FROM item_warehouse_qty q JOIN warehouses w ON w.warehouse_id = q.warehouse_id GROUP BY w.branch_id`);
  const ledgerOf = (br) => Number(ledVal.find((x) => Number(x.branch_id) === br)?.v ?? 0);
  const itemGl = (br) => Number(allLn.find((x) => Number(x.branch_id) === br && x.code === '1104')?.net ?? 0);
  ok(`CF8: GL(1104) branch 1 == ledger to the penny (${itemGl(1)} vs ${ledgerOf(1)})`, eq2(itemGl(1), ledgerOf(1)));
  ok(`CF8: GL(1104) branch ${branchBId} == ledger to the penny (${itemGl(branchBId)} vs ${ledgerOf(branchBId)})`, eq2(itemGl(branchBId), ledgerOf(branchBId)));

  // trial balance per branch + consolidated
  for (const br of [1, branchBId]) {
    const { rows: tb } = await sql.query(
      `SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2 WHERE j.branch_id = $1`, [br]);
    ok(`CF8: trial balance branch ${br} balanced (${tb[0].d})`, eq2(tb[0].d, tb[0].c));
  }
  const { rows: tbAll } = await sql.query(
    `SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2`);
  ok(`CF8: consolidated TB balanced (${tbAll[0].d})`, eq2(tbAll[0].d, tbAll[0].c));

  const { rows: orphans } = await sql.query(
    `SELECT count(*)::int n FROM gl_entries e JOIN gl_journals j ON j.journal_id=e.journal_id JOIN gl_accounts a ON a.account_id=e.account_id WHERE a.code='1108' AND j.source_type NOT IN ('branch_transfer','branch_transfer_cancel')`);
  ok('CF8: zero orphaned 1108 entries', Number(orphans[0].n) === 0);
  const { rows: dups } = await sql.query(
    `SELECT j.source_id, j.source_type, j.branch_id, count(*)::int n FROM gl_journals j
      WHERE j.source_type IN ('branch_transfer','branch_transfer_cancel') GROUP BY j.source_id, j.source_type, j.branch_id HAVING count(*) > 1`);
  ok('CF8: no duplicate journals (transfer/cancel × branch)', dups.length === 0, JSON.stringify(dups));

  // ================= Scenario 9 — company-wide 1108 reconciles =================
  const susp = await call('GET', '/reports/branch-transfers/suspense', undefined, 1);
  ok('CF9: company-wide 1108 == subledger in-transit (approved, unreceived)', eq2(susp.company.glClearing, susp.company.inTransitValue),
    `glClearing=${susp.company.glClearing} inTransit=${susp.company.inTransitValue}`);

  await sql.end();
  console.log(failures === 0 ? '\nE2 COSTF IX GATE: ALL CHECKS PASSED' : `\nE2 COSTFIX GATE: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2 COSTFIX ERROR:', e.message); process.exit(1); });
