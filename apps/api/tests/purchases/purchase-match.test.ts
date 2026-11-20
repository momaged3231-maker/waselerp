/**
 * B3 — three-way match + exception approval + GRNI aging + GRN variance.
 *
 * Covers B3-01..08. Uses direct service calls for data assertions and the
 * running API (HTTP) for the permission gate (B3-04), mirroring the smoke
 * suite's createUser/loginAs pattern.
 *
 * Run:  npm run test:purchases-match   (API must be running on :4000)
 */
import { Pool } from 'pg';
import { PoolClient } from 'pg';
import { PurchaseReceiptService } from '../../src/modules/purchases/purchase-receipt.slice';
import { PurchaseMatchService } from '../../src/modules/purchases/purchase-match.slice';
import { SalesService } from '../../src/modules/sales/sales.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wasel';
const API = process.env.API_BASE ?? 'http://localhost:4000/api';
const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

let results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function makeSvc(client: PoolClient) {
  const db: any = {
    // Mirror DatabaseService.query → T[] (not QueryResult).
    query: async (...a: any[]) => (await client.query(...(a as [any]))).rows,
    one: async (...a: any[]) => (await client.query(...(a as [any]))).rows[0],
    transaction: (fn: any) => fn(client),
    nextNumber: async () => 1,
  };
  return db;
}

async function http(method: string, path: string, body: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}

async function main() {
  const pool = new Pool({ connectionString: CONNECTION });
  const c = await pool.connect();
  const branch = (await c.query('SELECT branch_id FROM branches LIMIT 1')).rows[0];
  const branchId = Number(branch.branch_id);
  const wh = (await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0];
  const warehouseId = Number(wh.warehouse_id);

  let invoiceSeq = Math.floor(Math.random() * 1e7);
  const salesDb = makeSvc(c);
  (salesDb as any).nextNumber = async () => ++invoiceSeq;

  const grnSvc = new PurchaseReceiptService(makeSvc(c));
  const matchSvc = new PurchaseMatchService(makeSvc(c));
  const salesSvc = new SalesService(salesDb, { publish: () => {} } as any);
  const user: any = { userId: 1, permissions: ['purchases.manage', 'purchases.receive', 'purchases.approve_exception'], userName: 'admin', branchIds: [branchId], maxDiscountPct: 100 };

  const created = { items: [] as number[], parties: [] as number[], orders: [] as number[], receipts: [] as number[], invoices: [] as number[], users: [] as number[] };
  const stamp = Date.now();

  async function makeItem(code: string) {
    await c.query(`INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'B3 item',unit_id,true,10,12,true FROM units WHERE code='PCS'`, [code]);
    const it = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', [code])).rows[0];
    created.items.push(Number(it.item_id));
    return { itemId: Number(it.item_id), unitId: Number(it.base_unit_id) };
  }
  async function makeSupplier() {
    const pc = 'B3SUP-' + stamp + '-' + Math.floor(Math.random() * 1e6);
    await c.query('INSERT INTO parties (code,name,party_type,is_active) VALUES ($1,$2,2,true)', [pc, 'B3 supplier']);
    const id = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', [pc])).rows[0].party_id);
    created.parties.push(id);
    return id;
  }
  async function makePO(itemId: number, unitId: number, supplier: number, qty: number, price: number) {
    const no = 'B3PO-' + stamp + '-' + Math.floor(Math.random() * 1e7);
    const r = await c.query(`INSERT INTO orders (order_no,order_date,branch_id,party_id,warehouse_id,order_type,status,subtotal,total_amount,created_by) VALUES ($1,CURRENT_DATE,$2,$3,$4,2,2,$5,$5,1) RETURNING order_id`, [no, branchId, supplier, warehouseId, qty * price]);
    const poId = Number(r.rows[0].order_id); created.orders.push(poId);
    const ol = await c.query(`INSERT INTO order_lines (order_id,line_number,item_id,unit_id,quantity,delivered_qty,unit_price,line_total) VALUES ($1,1,$2,$3,$4,0,$5,$6) RETURNING order_line_id`, [poId, itemId, unitId, qty, price, qty * price]);
    return { poId, orderLineId: Number(ol.rows[0].order_line_id) };
  }
  async function makeGRN(po: { poId: number; orderLineId: number }, accepted: number, cost: number, receiptDate?: string) {
    const r: any = await grnSvc.create({ orderId: po.poId, warehouseId, receivedBy: 1, inspectedBy: 1,
      lines: [{ orderLineId: po.orderLineId, acceptedQty: accepted, unitCost: cost }], ...(receiptDate ? { receiptDate } : {}) }, user, branchId);
    created.receipts.push(r.receiptId);
    const rl = (await c.query('SELECT line_id FROM purchase_receipt_lines WHERE receipt_id=$1', [r.receiptId])).rows[0];
    return { receiptId: Number(r.receiptId), receiptNo: r.receiptNo, lineId: Number(rl.line_id) };
  }
  async function makeInvoice(itemId: number, unitId: number, supplier: number, qty: number, price: number, lineId: number, allowOver = false) {
    const u = allowOver ? user : user; // exception permission present for over-invoice path
    const r: any = await salesSvc.create({
      invoiceType: 2, branchId, warehouseId, partyId: supplier, paymentType: 2,
      receiptLinks: [{ receiptLineId: lineId, qty }],
      lines: [{ itemId, unitId, quantity: qty, unitPrice: price, taxPct: 0 }],
    } as any, u, branchId);
    created.invoices.push(r.invoiceId);
    return Number(r.invoiceId);
  }

  try {
    const itemA = await makeItem('B3M-A-' + stamp);
    const itemB = await makeItem('B3M-B-' + stamp);
    const itemC = await makeItem('B3M-C-' + stamp);
    const itemD = await makeItem('B3M-D-' + stamp);
    const supplier = await makeSupplier();

    // B3-01 — GRN 10@10, invoice 10@10 → 1 line matched, variances 0
    const grnA = await makeGRN(await makePO(itemA.itemId, itemA.unitId, supplier, 10, 10), 10, 10);
    const invA = await makeInvoice(itemA.itemId, itemA.unitId, supplier, 10, 10, grnA.lineId);
    const mA: any = await matchSvc.match(invA, branchId);
    check('B3-01 match 10/10 → matched, variances 0',
      mA.lines.length === 1 && mA.lines[0].status === 'matched' && mA.lines[0].qtyVariance === 0 && mA.lines[0].priceVariance === 0,
      JSON.stringify(mA.lines[0]));

    // B3-02 — GRN 10@10, invoice 10@12 → price_variance=20, qty_variance=0, matched
    const grnB = await makeGRN(await makePO(itemB.itemId, itemB.unitId, supplier, 10, 10), 10, 10);
    const invB = await makeInvoice(itemB.itemId, itemB.unitId, supplier, 10, 12, grnB.lineId);
    const mB: any = await matchSvc.match(invB, branchId);
    check('B3-02 match 10@10 vs 10@12 → priceVariance=20, matched',
      mB.lines[0].priceVariance === 20 && mB.lines[0].qtyVariance === 0 && mB.lines[0].status === 'matched',
      JSON.stringify(mB.lines[0]));

    // B3-03 — invoice 11 on GRN 10 → qty_variance=1, status qty_over
    // (create with exception permission so B2 allows the over-invoice; link is capped at 10)
    const grnC = await makeGRN(await makePO(itemC.itemId, itemC.unitId, supplier, 10, 10), 10, 10);
    const invC = await makeInvoice(itemC.itemId, itemC.unitId, supplier, 11, 10, grnC.lineId, true);
    const mC: any = await matchSvc.match(invC, branchId);
    check('B3-03 invoice 11 / GRN 10 → qtyVariance=1, qty_over',
      mC.lines[0].qtyVariance === 1 && mC.lines[0].status === 'qty_over',
      JSON.stringify(mC.lines[0]));

    // B3-04 — HTTP 403 without purchases.approve_exception
    // create a cashier (role lacks the permission) via admin API
    const adminLogin = await http('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
    const adminToken = adminLogin.data?.accessToken;
    const cu = await http('POST', '/admin/users', {
      userName: `b3cash_${stamp}`, password: 'Test$12345', fullName: 'B3 cashier',
      defaultBranchId: branchId, maxDiscountPct: 100, isCashier: true,
      roleIds: [(await c.query("SELECT role_id FROM roles WHERE name_en='Cashier'")).rows[0].role_id],
    }, adminToken);
    created.users.push(cu.data?.userId);
    const cashLogin = await http('POST', '/auth/login', { userName: `b3cash_${stamp}`, password: 'Test$12345' });
    const cashToken = cashLogin.data?.accessToken;
    const ex403 = await http('POST', `/purchases/invoices/${invA}/exception`, { reason: 'test', links: [{ receipt_line_id: grnA.lineId, qty: 1 }] }, cashToken);
    check('B3-04 exception without permission → 403', ex403.status === 403, `status=${ex403.status}`);

    // B3-05 — with permission + reason → 200 + override row
    const ex200 = await http('POST', `/purchases/invoices/${invC}/exception`,
      { reason: 'توريد زائد موافق عليه', links: [{ receipt_line_id: grnC.lineId, qty: 1 }] }, adminToken);
    const ovc = Number((await c.query('SELECT COUNT(*)::int n FROM purchase_match_overrides WHERE invoice_id=$1', [invC])).rows[0].n);
    check('B3-05 exception with permission+reason → 200 + override row',
      ex200.status === 200 && ovc >= 1, `status=${ex200.status} overrides=${ovc}`);

    // B3-06 — GRN without invoice → 0-30 bucket
    const grnD = await makeGRN(await makePO(itemD.itemId, itemD.unitId, supplier, 5, 10), 5, 10);
    const aging: any = await matchSvc.grniAging({ branchId, partyId: supplier });
    const rowD = aging.rows.find((r: any) => r.receiptLineId === grnD.lineId);
    check('B3-06 fresh GRN → 0-30 bucket', !!rowD && rowD.bucket === '0-30', JSON.stringify(rowD));

    // B3-07 — age a GRN to 95 days → >90 + warning
    await c.query('UPDATE purchase_receipts SET receipt_date = CURRENT_DATE - 95 WHERE receipt_id=$1', [grnD.receiptId]);
    const aging2: any = await matchSvc.grniAging({ branchId, partyId: supplier });
    const rowD2 = aging2.rows.find((r: any) => r.receiptLineId === grnD.lineId);
    const over90 = aging2.buckets.find((b: any) => b.bucket === '>90');
    check('B3-07 95-day GRN → >90 bucket + warning',
      !!rowD2 && rowD2.bucket === '>90' && rowD2.ageDays === 95 && aging2.warning === true && over90.warning === true,
      `row=${JSON.stringify(rowD2)} warning=${aging2.warning}`);

    // B3-08 — GRN 10@10 + invoice 10@12 → grn_value=100, invoiced=120, ppv=20
    const variance: any = await matchSvc.grnVariance({ branchId });
    const vb = variance.lines.find((l: any) => l.receiptLineId === grnB.lineId);
    check('B3-08 variance 10@10 vs 10@12 → grn=100 invoiced=120 ppv=20',
      !!vb && vb.grnValue === 100 && vb.invoiced === 120 && vb.ppv === 20,
      JSON.stringify(vb));
  } catch (e: any) {
    check('SUITE SETUP/RUN', false, e.message);
  } finally {
    try {
      for (const u of created.users) await c.query('DELETE FROM users WHERE user_id=$1', [u]).catch(()=>{});
      for (const iid of created.invoices) await http('POST', `/sales/invoices/${iid}/cancel`, {}, undefined).catch(()=>{});
      for (const iid of created.invoices) await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT gl_journal_id FROM invoices WHERE invoice_id=$1)', [iid]).catch(()=>{});
      for (const rid of created.receipts) await c.query('DELETE FROM purchase_invoice_links WHERE receipt_id=$1', [rid]).catch(()=>{});
      for (const rid of created.receipts) await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT gl_journal_id FROM purchase_receipts WHERE receipt_id=$1)', [rid]).catch(()=>{});
      for (const rid of created.receipts) await c.query('DELETE FROM gl_journals WHERE journal_id IN (SELECT gl_journal_id FROM purchase_receipts WHERE receipt_id=$1)', [rid]).catch(()=>{});
      for (const rid of created.receipts) await c.query('DELETE FROM purchase_receipts WHERE receipt_id=$1', [rid]).catch(()=>{});
      for (const iid of created.invoices) await c.query('DELETE FROM invoices WHERE invoice_id=$1', [iid]).catch(()=>{});
      for (const oid of created.orders) { await c.query('DELETE FROM order_lines WHERE order_id=$1', [oid]).catch(()=>{}); await c.query('DELETE FROM orders WHERE order_id=$1', [oid]).catch(()=>{}); }
      for (const iid of created.items) { await c.query('DELETE FROM stock_movements WHERE item_id=$1', [iid]).catch(()=>{}); await c.query('DELETE FROM item_warehouse_qty WHERE item_id=$1', [iid]).catch(()=>{}); await c.query('DELETE FROM item_units WHERE item_id=$1', [iid]).catch(()=>{}); await c.query('DELETE FROM items WHERE item_id=$1', [iid]).catch(()=>{}); }
      for (const pid of created.parties) await c.query('DELETE FROM parties WHERE party_id=$1', [pid]).catch(()=>{});
    } catch {}
    c.release(); await pool.end();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
