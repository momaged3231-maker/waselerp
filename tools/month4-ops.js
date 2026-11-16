/* Phase E2 — Month simulation with TWO branches (isolated DB wasel_month4, port 5436, API 4280).
 *
 * Scenario (all amounts EGP, VAT 14% where applicable):
 *   Branch A (الفرع الرئيسي, id=1)  <->  Branch B (created fresh)
 *
 *   P1  purchase in A               : 10 x M4-LAP-A @800 (+14% VAT) · 5 x M4-KB @200 (VAT 0)  (cash)
 *   S1  sale in A                   : 2 x M4-LAP-A @1500 (+14% VAT)                         (cash)
 *   T1  transfer A -> B             : 4 x M4-LAP-A         approve in A, receive in B
 *   S2  sale in B (transferred)     : 1 x M4-LAP-A @1600 (+14% VAT)                         (cash account of B)
 *   RET return in B (of S2)         : 1 x M4-LAP-A @1600                                   (cash account of B)
 *   T2  transfer A -> B             : 2 x M4-KB @200        approve in A, then CANCEL (pre-receive)
 *   DAV damage in A (voucher 3)     : 1 x M4-KB @200       Dr DAMAGE_EXPENSE / Cr INVENTORY
 *   CNT stock count in A            : M4-LAP-A counted 3 (system 4) -> 1 unit count loss
 *
 * Expected final quantities (recomputed independently by tools/month4-check.js):
 *   A: M4-LAP-A 3 x 800 = 2,400 · M4-KB 4 x 200 = 800   -> A inventory 3,200
 *   B: M4-LAP-A 4 x 800 = 3,200                          -> B inventory 3,200
 *   Company inventory 6,400 · 1108 clearing = 0.00 · RETAINED unchanged
 *
 * Writes the scenario ids to tools/pg/pglite-month4/month4-scenario.json for the checker.
 */
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.M4_BASE ?? 'http://127.0.0.1:4280/api';
const DB = process.env.M4_DB ?? 'postgres://postgres:postgres@127.0.0.1:5436/wasel_month4';
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

let token = null;
const hdr = (branch) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
  ...(branch ? { 'x-branch-id': String(branch) } : {}),
});
const call = async (method, p, body, branch) => {
  const r = await fetch(`${BASE}${p}`, { method, headers: hdr(branch), body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (r.status >= 400) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
};

(async () => {
  const sql = new Client({ connectionString: DB });
  await sql.connect();

  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  const BRANCH_A = Number(login.activeBranchId) || 1;

  // before-value of RETAINED_EARNINGS (read-only) — must be unchanged at the end
  const { rows: retBefore } = await sql.query(
    `SELECT COALESCE(SUM(e.credit - e.debit), 0)::numeric net
       FROM gl_entries e
       JOIN gl_accounts a ON a.account_id = e.account_id
       JOIN gl_mappings m ON m.account_id = a.account_id
      WHERE m.mapping_key = 'RETAINED_EARNINGS'`);
  const retainedBefore = Number(retBefore[0].net);

  // --- branch B, warehouse B, cash account B, count employee ----------------
  const branchB = await call('POST', '/admin/branches', { code: `M4B${stamp}`, name: `فرع المحاكاة ب ${stamp}`, city: 'الجيزة', isActive: true });
  const BRANCH_B = Number(branchB.branchId);
  const cashB = await call('POST', '/treasury/accounts', { name: `خزينة فرع المحاكاة ${stamp}`, type: 1 }, BRANCH_B);
  const cashBId = Number(cashB.cashAccountId ?? cashB.id);
  const whB = await call('POST', '/catalog/warehouses', { branchId: BRANCH_B, code: `M4BW${stamp}`, name: `مخزن فرع B ${stamp}`, isActive: true });
  const whBId = Number(whB.warehouseId);
  const employee = await call('POST', '/hr/employees', { name: `موظف الجرد ${stamp}`, code: `JERD${stamp}` });
  const employeeId = Number(employee.employeeId);

  const whsA = await call('GET', '/catalog/warehouses');
  const whA = Number((whsA.find((w) => w.isDefault) ?? whsA[0]).warehouseId);

  // --- items -----------------------------------------------------------------
  const itemA = await call('POST', '/items', { code: `M4-LAP-${stamp}`, name: 'لابتوب محاكاة E2', baseUnitId: 1, costPrice: 800, sellPrice: 1500, vatPct: 14 });
  const itemB = await call('POST', '/items', { code: `M4-KB-${stamp}`, name: 'كيبورد محاكاة E2', baseUnitId: 1, costPrice: 200, sellPrice: 350, vatPct: 0 });
  const itemAId = Number(itemA.itemId), itemBId = Number(itemB.itemId);

  // --- P1 purchase (A) --------------------------------------------------------
  const p1Total = 10 * 800 + Math.round(10 * 800 * 0.14 * 100) / 100 + 5 * 200;
  const p1 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whA, partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: p1Total,
    invoiceDate: today, notes: 'P1 شراء افتتاحي — محاكاة E2',
    lines: [
      { itemId: itemAId, unitId: 1, quantity: 10, unitPrice: 800, discountPct: 0, taxPct: 14 },
      { itemId: itemBId, unitId: 1, quantity: 5, unitPrice: 200, discountPct: 0, taxPct: 0 },
    ],
  });
  console.log('P1', p1.invoiceId, `total ${p1Total}`);

  // --- S1 sale (A) ------------------------------------------------------------
  const s1Total = Math.round(2 * 1500 * 1.14 * 100) / 100;
  const s1 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whA, partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: s1Total,
    invoiceDate: today, notes: 'S1 بيع نقدي — محاكاة E2',
    lines: [{ itemId: itemAId, unitId: 1, quantity: 2, unitPrice: 1500, discountPct: 0, taxPct: 14 }],
  });
  console.log('S1', s1.invoiceId, `total ${s1Total}`);

  // --- T1 transfer A -> B (approve in A, receive in B) -------------------------
  const t1 = await call('POST', '/branch-transfers', {
    fromWarehouseId: whA, toWarehouseId: whBId, transferDate: today,
    notes: 'T1 تحويل إلى فرع B — محاكاة E2', clientRequestId: `m4-t1-${stamp}`,
  }, BRANCH_A);
  const t1Id = Number(t1.branchTransferId);
  await call('POST', `/branch-transfers/${t1Id}/lines`, { itemId: itemAId, unitId: 1, quantity: 4 }, BRANCH_A);
  await call('POST', `/branch-transfers/${t1Id}/approve`, {}, BRANCH_A);
  const t1Recv = await call('POST', `/branch-transfers/${t1Id}/receive`, {}, BRANCH_B);
  console.log('T1', t1Id, `status after receive ${t1Recv.status}`);

  // --- S2 sale in B (on transferred stock) --------------------------------------
  const s2Total = Math.round(1 * 1600 * 1.14 * 100) / 100;
  const s2 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whBId, partyId: null, paymentType: 1, cashAccountId: cashBId, paidAmount: s2Total,
    invoiceDate: today, notes: 'S2 بيع في فرع B — محاكاة E2',
    lines: [{ itemId: itemAId, unitId: 1, quantity: 1, unitPrice: 1600, discountPct: 0, taxPct: 14 }],
  }, BRANCH_B);
  console.log('S2', s2.invoiceId, `total ${s2Total}`);

  // --- RET return in B (of the S2 invoice) --------------------------------------
  const ret = await call('POST', '/sales/invoices', {
    invoiceType: 3, warehouseId: whBId, partyId: null, paymentType: 1, cashAccountId: cashBId, paidAmount: s2Total,
    parentInvoiceId: s2.invoiceId, invoiceDate: today, notes: 'RET مرتجع S2 — محاكاة E2',
    lines: [{ itemId: itemAId, unitId: 1, quantity: 1, unitPrice: 1600, discountPct: 0, taxPct: 14 }],
  }, BRANCH_B);
  console.log('RET', ret.invoiceId);

  // --- T2 transfer A -> B then CANCEL before receive ------------------------------
  const t2 = await call('POST', '/branch-transfers', {
    fromWarehouseId: whA, toWarehouseId: whBId, transferDate: today,
    notes: 'T2 تحويل ألغى قبل الاستلام — محاكاة E2', clientRequestId: `m4-t2-${stamp}`,
  }, BRANCH_A);
  const t2Id = Number(t2.branchTransferId);
  await call('POST', `/branch-transfers/${t2Id}/lines`, { itemId: itemBId, unitId: 1, quantity: 2 }, BRANCH_A);
  await call('POST', `/branch-transfers/${t2Id}/approve`, {}, BRANCH_A);
  const t2Cancel = await call('POST', `/branch-transfers/${t2Id}/cancel`, { reason: 'كمية خاطئة — محاكاة الإلغاء' }, BRANCH_A);
  console.log('T2', t2Id, `cancelled status ${t2Cancel.status}`);

  // --- DAV damage in A (voucher type 3) -------------------------------------------
  const voucher = await call('POST', '/stock-vouchers', { warehouseId: whA, voucherType: 3, voucherDate: today, notes: 'تالف — محاكاة E2' }, BRANCH_A);
  const vId = Number(voucher.stockVoucherId);
  await call('POST', `/stock-vouchers/${vId}/lines`, { itemId: itemBId, unitId: 1, quantity: 1, unitCost: 200 }, BRANCH_A);
  await call('POST', `/stock-vouchers/${vId}/approve`, {}, BRANCH_A);
  console.log('DAV', vId);

  // --- CNT stock count in A (1 unit shortage on M4-LAP-A) --------------------------
  const cnt = await call('POST', '/stock-counts', { warehouseId: whA, employeeId, countDate: today, notes: 'جرد — محاكاة E2' }, BRANCH_A);
  const cntId = Number(cnt.stockCountId);
  await call('POST', `/stock-counts/${cntId}/lines`, { itemId: itemAId, unitId: 1, countedQty: 3 }, BRANCH_A);
  await call('POST', `/stock-counts/${cntId}/approve`, {}, BRANCH_A);
  console.log('CNT', cntId);

  await sql.end();

  const scenario = {
    stamp, today, BRANCH_A, BRANCH_B, whA, whBId, cashBId, employeeId,
    itemAId, itemBId, p1: p1.invoiceId, s1: s1.invoiceId, s2: s2.invoiceId, ret: ret.invoiceId,
    t1: t1Id, t2: t2Id, dav: vId, cnt: cntId, retainedBefore,
    expected: {
      invA: 3200, invB: 3200, invCompany: 6400, clearing: 0,
      revenueA: 3000, revenueB: 0, cogsA: 1600, cogsB: 0,
      damageA: 200, countLossA: 800, vatOutputA: 420, vatInputA: 1120,
    },
  };
  fs.writeFileSync(path.join(__dirname, 'pg', 'pglite-month4', 'month4-scenario.json'), JSON.stringify(scenario, null, 2));
  console.log('scenario written to tools/pg/pglite-month4/month4-scenario.json');
})().catch((e) => { console.error('M4 OPS ERROR:', e.message); process.exit(1); });
