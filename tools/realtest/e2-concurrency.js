/* E2 — Inter-Branch Transfer: REAL PostgreSQL concurrency test.
 *
 * Runs against the isolated `wasel_signoff` database on REAL local PostgreSQL
 * 18.6 (port 5432) via the API on port 4270 — NOT PGlite.
 *
 * Scenario A — receive race:
 *   approve a transfer A -> B, then fire THREE concurrent POST receive
 *   (destination branch context). Exactly ONE may succeed; the other two
 *   must be refused with 400 Arabic messages. Verifies in the database:
 *     - status = 4, exactly one inbound voucher, exactly one receive journal
 *     - destination stock increased by exactly the transferred quantity
 *     - source stock decreased once (approve) — never twice
 *     - 1108 clearing nets to ZERO company-wide
 *     - exactly one 'stock.branch_transfer.receive' in activity_log
 *
 * Scenario B — cancel race:
 *   issue a second transfer A -> B, then fire THREE concurrent POST cancel
 *   (source branch context). Exactly ONE may succeed. Verifies reversal
 *   movements/journals are unique, status = 5, clearing still nets to zero.
 *
 * Scenario C — administrative lock:
 *   issue a third transfer, then lock the DESTINATION branch period
 *   (manual-lock) and fire a receive — it must be refused with 400.
 *   Unlock, receive → succeeds.
 *
 * Usage: node tools/realtest/e2-concurrency.js
 * (override via E2_BASE / E2_PG)
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.E2_BASE ?? 'http://127.0.0.1:4270/api';
const PG_CONN = process.env.E2_PG ?? 'postgres://postgres:postgres@127.0.0.1:5432/wasel_signoff';

const log = (label, value) => console.log(`${label}: ${value}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`✅ ${label}${detail ? ' — ' + detail : ''}`);
  else { console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`); failures += 1; }
};

(async () => {
  const sql = new Client({ connectionString: PG_CONN });
  await sql.connect();

  const stamp = Date.now();

  // ---- auth ------------------------------------------------------------
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
  }).then((r) => r.json());
  if (!login.accessToken) throw new Error('login failed: ' + JSON.stringify(login));
  const token = login.accessToken;
  const branchA = Number(login.activeBranchId);          // الفرع الرئيسي
  const headersA = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-branch-id': String(branchA) };
  const headersB = (b) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-branch-id': String(b) });

  const callRaw = async (method, p, body, headers) => {
    const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { status: r.status, body: d };
  };
  const call = async (method, p, body, headers) => {
    const r = await callRaw(method, p, body, headers);
    if (r.status >= 400) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  // ---- fresh branch B + warehouse + item + source stock -----------------
  const branchB = await call('POST', '/admin/branches', { code: `E2R${stamp}`, name: `فرع اختبار E2 ${stamp}`, city: 'القاهرة', isActive: true }, headersA);
  const branchBId = Number(branchB.branchId);
  check('E2R: branch B created', branchBId > 0, `id=${branchBId}`);

  const whB = await call('POST', '/catalog/warehouses', { branchId: branchBId, code: `E2RW${stamp}`, name: `مخزن E2R ${stamp}`, isActive: true }, headersA);
  const whBId = Number(whB.warehouseId);
  check('E2R: warehouse created in branch B', whBId > 0, `id=${whBId}`);

  const item = await call('POST', '/items', { code: `E2R-ITEM-${stamp}`, name: `صنف اختبار E2 ${stamp}`, baseUnitId: 1, costPrice: 10, sellPrice: 15, vatPct: 14 }, headersA);
  const itemId = Number(item.itemId);
  check('E2R: item created', itemId > 0, `id=${itemId}`);

  const { rows: srcRows } = await sql.query(
    `SELECT warehouse_id FROM warehouses WHERE branch_id = $1::int AND is_active ORDER BY is_default DESC, warehouse_id LIMIT 1`, [branchA]);
  const srcWh = Number(srcRows[0].warehouse_id);
  // seed 100 units @ 5.00 avg cost at the SOURCE warehouse
  await sql.query(
    `INSERT INTO item_warehouse_qty (item_id, warehouse_id, unit_id, on_hand_qty, avg_cost, last_move_at)
     VALUES ($1::int, $2::int, 1, 100, 5, now())
     ON CONFLICT (item_id, warehouse_id, unit_id) DO UPDATE SET on_hand_qty = item_warehouse_qty.on_hand_qty + 100`,
    [itemId, srcWh]);
  log('source stock seeded', `item=${itemId} wh=${srcWh} qty=100 @5.00`);

  // helper: create + approve a transfer A -> B
  async function issueTransfer(qty, tag) {
    const bt = await call('POST', '/branch-transfers', {
      fromWarehouseId: srcWh, toWarehouseId: whBId,
      transferDate: new Date().toISOString().slice(0, 10),
      clientRequestId: `e2r-${tag}-${stamp}`, notes: `E2 realtest ${tag}`,
    }, headersA);
    const btId = Number(bt.branchTransferId);
    await call('POST', `/branch-transfers/${btId}/lines`, { itemId, unitId: 1, quantity: qty }, headersA);
    await call('POST', `/branch-transfers/${btId}/approve`, {}, headersA);
    return btId;
  }

  // ================= Scenario A — receive race =================
  const id1 = await issueTransfer(30, 'A');
  log('transfer A issued', `id=${id1} qty=30`);

  const rcv = await Promise.allSettled([1, 2, 3].map(() =>
    callRaw('POST', `/branch-transfers/${id1}/receive`, {}, headersB(branchBId))));
  const rcvStatuses = rcv.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
  const rcvOk = rcvStatuses.filter((s) => s === 201).length;
  const rcvRefused = rcvStatuses.filter((s) => s === 400).length;
  check('E2R-A: exactly ONE receive wins the race', rcvOk === 1 && rcvRefused === 2, `statuses=${rcvStatuses.join(',')}`);

  const { rows: t1 } = await sql.query(`SELECT status, outbound_journal_id, inbound_journal_id FROM branch_transfers WHERE branch_transfer_id = $1`, [id1]);
  check('E2R-A: transfer status = 4 (completed)', Number(t1[0]?.status) === 4, `status=${t1[0]?.status}`);

  const { rows: inq } = await sql.query(
    `SELECT COALESCE(SUM(on_hand_qty), 0)::numeric qty FROM item_warehouse_qty WHERE item_id = $1 AND warehouse_id = $2`, [itemId, whBId]);
  check('E2R-A: destination stock increased by exactly 30 (not 60/90)', eq2(inq[0].qty, 30), `qty=${inq[0].qty}`);

  const { rows: srcq } = await sql.query(
    `SELECT on_hand_qty::numeric qty FROM item_warehouse_qty WHERE item_id = $1 AND warehouse_id = $2`, [itemId, srcWh]);
  check('E2R-A: source stock decremented exactly once', eq2(srcq[0].qty, 70), `qty=${srcq[0].qty}`);

  const { rows: rcvJournals } = await sql.query(
    `SELECT COUNT(*)::int n FROM gl_journals WHERE source_type = 'branch_transfer' AND source_id = $1`, [id1]);
  check('E2R-A: exactly TWO journals for the transfer (approve + ONE receive)', Number(rcvJournals[0].n) === 2, `n=${rcvJournals[0].n}`);

  const { rows: receiveMoves } = await sql.query(
    `SELECT COUNT(*)::int n FROM stock_movements WHERE reference_no LIKE 'BT-%' AND move_type = 5
       AND reference_id = $1`, [id1]);
  check('E2R-A: exactly ONE transferIn movement recorded', Number(receiveMoves[0].n) === 1, `n=${receiveMoves[0].n}`);

  const suspense = await call('GET', '/reports/branch-transfers/suspense', null, headersA);
  check('E2R-A: 1108 clearing nets to ZERO company-wide after receive',
    suspense.company && Math.abs(Number(suspense.company.glClearing)) < 0.005, JSON.stringify(suspense.company));

  const { rows: actRecv } = await sql.query(
    `SELECT COUNT(*)::int n FROM activity_log WHERE action = 'stock.branch_transfer.receive' AND entity_id = $1`, [id1]);
  check('E2R-A: exactly ONE receive audit row', Number(actRecv[0].n) === 1, `n=${actRecv[0].n}`);

  // ================= Scenario B — cancel race =================
  const id2 = await issueTransfer(10, 'B');
  log('transfer B issued', `id=${id2} qty=10`);

  const cnl = await Promise.allSettled([1, 2, 3].map(() =>
    callRaw('POST', `/branch-transfers/${id2}/cancel`, { reason: 'إلغاء تزامني للاختبار' }, headersA)));
  const cnlStatuses = cnl.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
  const cnlOk = cnlStatuses.filter((s) => s === 201).length;
  const cnlRefused = cnlStatuses.filter((s) => s === 400).length;
  check('E2R-B: exactly ONE cancel wins the race', cnlOk === 1 && cnlRefused === 2, `statuses=${cnlStatuses.join(',')}`);

  const { rows: t2 } = await sql.query(`SELECT status FROM branch_transfers WHERE branch_transfer_id = $1`, [id2]);
  check('E2R-B: transfer B status = 5 (cancelled)', Number(t2[0]?.status) === 5, `status=${t2[0]?.status}`);

  const { rows: cancelMoves } = await sql.query(
    `SELECT COUNT(*)::int n FROM stock_movements WHERE reference_id = $1 AND move_type = 5`, [id2]);
  check('E2R-B: reversal movement recorded exactly once', Number(cancelMoves[0].n) === 1, `n=${cancelMoves[0].n}`);

  const { rows: cancelJournals } = await sql.query(
    `SELECT COUNT(*)::int n FROM gl_journals WHERE source_type = 'branch_transfer_cancel' AND source_id = $1`, [id2]);
  check('E2R-B: exactly ONE cancellation journal', Number(cancelJournals[0].n) === 1, `n=${cancelJournals[0].n}`);

  const { rows: actCancel } = await sql.query(
    `SELECT COUNT(*)::int n FROM activity_log WHERE action = 'stock.branch_transfer.cancel' AND entity_id = $1`, [id2]);
  check('E2R-B: exactly ONE cancel audit row', Number(actCancel[0].n) === 1, `n=${actCancel[0].n}`);

  // ================= Scenario C — destination period locked =================
  const id3 = await issueTransfer(5, 'C');
  log('transfer C issued', `id=${id3} qty=5`);

  // lock the DESTINATION branch period covering today (administrative lock)
  const today = new Date().toISOString().slice(0, 10);
  const pB = await call('POST', '/accounting/periods', { name: `فترة قفل E2 ${stamp}`, startDate: '2020-01-01', endDate: '2099-12-31', branchId: branchBId }, headersB(branchBId));
  const periodBid = Number(pB.periodId ?? pB.id);
  await call('POST', `/accounting/periods/${periodBid}/manual-lock`, { reason: 'E2 realtest administrative lock' }, headersB(branchBId));
  check('E2R-C: destination period administratively locked', periodBid > 0, `periodId=${periodBid}`);

  const lockedReceive = await callRaw('POST', `/branch-transfers/${id3}/receive`, {}, headersB(branchBId));
  check('E2R-C: receive REFUSED while destination is administratively locked (400)', lockedReceive.status === 400, `status=${lockedReceive.status}`);

  await call('POST', `/accounting/periods/${periodBid}/manual-unlock`, { reason: 'E2 realtest unlock' }, headersB(branchBId));
  const unlockedReceive = await callRaw('POST', `/branch-transfers/${id3}/receive`, {}, headersB(branchBId));
  check('E2R-C: receive succeeds after unlock', unlockedReceive.status === 201 && unlockedReceive.body?.status === 4, `status=${unlockedReceive.status}`);

  // ================= Scenario D — destination period is_closed (accounting) =================
  const id4 = await issueTransfer(5, 'D');
  log('transfer D issued', `id=${id4} qty=5`);
  await sql.query(`UPDATE periods SET is_closed = true WHERE period_id = $1`, [periodBid]);
  const closedReceive = await callRaw('POST', `/branch-transfers/${id4}/receive`, {}, headersB(branchBId));
  check('E2R-D: receive REFUSED while destination period is is_closed (400)', closedReceive.status === 400,
    `status=${closedReceive.status} ${JSON.stringify(closedReceive.body).slice(0, 120)}`);
  await sql.query(`UPDATE periods SET is_closed = false WHERE period_id = $1`, [periodBid]);
  const reopenedReceive = await callRaw('POST', `/branch-transfers/${id4}/receive`, {}, headersB(branchBId));
  check('E2R-D: receive succeeds once the accounting period is reopened', reopenedReceive.status === 201 && reopenedReceive.body?.status === 4, `status=${reopenedReceive.status}`);

  // ================= final: clearing must net to zero =================
  const suspenseFinal = await call('GET', '/reports/branch-transfers/suspense', null, headersA);
  check('E2R: 1108 clearing still ZERO after scenarios A+B+C+D',
    suspenseFinal.company && Math.abs(Number(suspenseFinal.company.glClearing)) < 0.005,
    JSON.stringify(suspenseFinal.company));

  const { rows: tb } = await sql.query(
    `SELECT (SELECT COALESCE(SUM(debit),0) FROM gl_entries)::numeric d, (SELECT COALESCE(SUM(credit),0) FROM gl_entries)::numeric c`);
  check('E2R: trial balance still balanced after all races', eq2(tb[0].d, tb[0].c), `debit=${tb[0].d} credit=${tb[0].c}`);

  await sql.end();
  console.log(failures === 0 ? '\nE2 REAL-PG CONCURRENCY: ALL CHECKS PASSED' : `\nE2 REAL-PG CONCURRENCY: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2 REAL-PG CONCURRENCY ERROR:', e.message); process.exit(1); });

function eq2(a, b) { return Math.abs(Number(a) - Number(b)) < 0.005; }
