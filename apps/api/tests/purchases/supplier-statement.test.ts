/**
 * B4 — Supplier statement (كشف حساب مورد) — permanent test suite.
 *
 * Covers B4-01..06 (backend). B4-07..09 (frontend / print) verified by the
 * web build + browser; B4-10 is the full regression.
 *
 * Run:  npm run test:purchases-statement   (API must be running on :4000 for CSV HTTP check)
 */
import { Pool, PoolClient } from 'pg';
import { SupplierStatementService } from '../../src/modules/purchases/supplier-statement.slice';
import { PurchaseReceiptService } from '../../src/modules/purchases/purchase-receipt.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wasel';
const API = process.env.API_BASE ?? 'http://localhost:4000/api';
const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

let results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function makeDb(client: PoolClient) {
  return {
    query: async (...a: any[]) => (await client.query(...(a as [any]))).rows,
    one: async (...a: any[]) => (await client.query(...(a as [any]))).rows[0],
    transaction: (fn: any) => fn(client),
    nextNumber: async () => 1,
  } as any;
}

async function http(path: string, token?: string) {
  const headers: any = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { headers });
  const json = await r.json();
  // CSV endpoints return {fileName, mimeType, base64}; decode base64 → raw bytes.
  const buf = json?.base64 ? Buffer.from(json.base64, 'base64') : Buffer.from(JSON.stringify(json));
  return { status: r.status, buf };
}

async function main() {
  const pool = new Pool({ connectionString: CONNECTION });
  const c = await pool.connect();
  const branch = (await c.query('SELECT branch_id FROM branches LIMIT 1')).rows[0];
  const branchId = Number(branch.branch_id);
  const wh = (await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0];
  const warehouseId = Number(wh.warehouse_id);
  const svc = new SupplierStatementService(makeDb(c));
  const grnSvc = new PurchaseReceiptService(makeDb(c));
  const user: any = { userId: 1, permissions: ['purchases.receive'], userName: 'admin' };
  const stamp = Date.now();

  const created = { parties: [] as number[], items: [] as number[], orders: [] as number[], receipts: [] as number[], invoices: [] as number[], advances: [] as number[] };
  const from = '2020-01-01';
  const to = '2099-01-01';

  async function makeSupplier(name: string) {
    const code = ('B4' + name + (stamp % 100000)).slice(0, 30);
    await c.query('INSERT INTO parties (code,name,party_type,is_active,tax_number) VALUES ($1,$2,2,true,$3)', [code, name, 'TAX-' + name]);
    const id = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', [code])).rows[0].party_id);
    created.parties.push(id);
    return id;
  }
  async function makeItem() {
    const code = 'B4I-' + stamp + '-' + Math.floor(Math.random() * 1e6);
    await c.query(`INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'B4 item',unit_id,true,10,15,true FROM units WHERE code='PCS'`, [code]);
    const it = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', [code])).rows[0];
    created.items.push(Number(it.item_id));
    return { itemId: Number(it.item_id), unitId: Number(it.base_unit_id) };
  }
  async function makeInvoice(supplier: number, daysAgo: number, total: number, paid: number) {
    const no = 'B4INV-' + stamp + '-' + Math.floor(Math.random() * 1e7);
    const date = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    await c.query(
      `INSERT INTO invoices (invoice_no,invoice_type,branch_id,warehouse_id,party_id,invoice_date,due_date,status,payment_type,sub_total,total_amount,paid_amount,cost_total,is_posted,posted_at,created_by)
       VALUES ($1,2,$2::int,$3::int,$4::int,$5::date,$5::date,2,2,$6::numeric,$6::numeric,$7::numeric,$6::numeric,true,now(),1)`,
      [no, branchId, warehouseId, supplier, date, total, paid],
    );
    const id = Number((await c.query('SELECT invoice_id FROM invoices WHERE invoice_no=$1', [no])).rows[0].invoice_id);
    created.invoices.push(id);
    return id;
  }
  async function makeAdvance(supplier: number, amount: number, stillOpen: number, status = 1) {
    const no = 'B4ADV-' + stamp + '-' + Math.floor(Math.random() * 1e7);
    await c.query(
      `INSERT INTO supplier_advances (party_id,branch_id,advance_no,amount,paid_amount,still_open,status)
       VALUES ($1,$2,$3,$4,$4,$5,$6)`,
      [supplier, branchId, no, amount, stillOpen, status],
    );
    const id = Number((await c.query('SELECT advance_id FROM supplier_advances WHERE advance_no=$1', [no])).rows[0].advance_id);
    created.advances.push(id);
    return id;
  }
  async function makeGrnNoInvoice(supplier: number) {
    const item = await makeItem();
    const no = 'B4PO-' + stamp + '-' + Math.floor(Math.random() * 1e7);
    const po = await c.query(`INSERT INTO orders (order_no,order_date,branch_id,party_id,warehouse_id,order_type,status,subtotal,total_amount,created_by) VALUES ($1,CURRENT_DATE,$2,$3,$4,2,2,100,100,1) RETURNING order_id`, [no, branchId, supplier, warehouseId]);
    const poId = Number(po.rows[0].order_id); created.orders.push(poId);
    const ol = await c.query(`INSERT INTO order_lines (order_id,line_number,item_id,unit_id,quantity,delivered_qty,unit_price,line_total) VALUES ($1,1,$2,$3,10,0,10,100) RETURNING order_line_id`, [poId, item.itemId, item.unitId]);
    const grn: any = await grnSvc.create({ orderId: poId, warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: Number(ol.rows[0].order_line_id), acceptedQty: 10, unitCost: 10 }] }, user, branchId);
    created.receipts.push(grn.receiptId);
    return grn;
  }

  try {
    // B4-01 — supplier with no data → empty sections, zeros, 200
    const emptySup = await makeSupplier('EMPTY');
    const empty: any = await svc.statement(emptySup, { from, to, branchId: 0 });
    check('B4-01 empty statement → zeros + 3 sections',
      empty.ap_aging.total === 0 && empty.ap_items.length === 0 && empty.grni_memo.total === 0 && empty.advances.available === 0 && empty.net_position === 0,
      JSON.stringify({ ap: empty.ap_aging.total, grni: empty.grni_memo.total, adv: empty.advances.available, net: empty.net_position }));

    // B4-02 — 2 open invoices aged 15 and 45 days
    const s2 = await makeSupplier('AGED');
    await makeInvoice(s2, 15, 1000, 0);
    await makeInvoice(s2, 45, 2000, 500);
    const d2: any = await svc.statement(s2, { from, to, branchId: 0 });
    check('B4-02 aged 15/45 days → correct buckets + total',
      d2.ap_items.length === 2 && d2.ap_aging.days_1_30 === 1000 && d2.ap_aging.days_31_60 === 1500 && d2.ap_aging.total === 2500,
      JSON.stringify(d2.ap_aging));

    // B4-03 — GRN with no invoice → grni_memo one row, ap_items empty
    const s3 = await makeSupplier('GRNI');
    await makeGrnNoInvoice(s3);
    const d3: any = await svc.statement(s3, { from, to, branchId: 0 });
    check('B4-03 GRNI only → grni_memo row, ap_items empty',
      d3.ap_items.length === 0 && d3.grni_memo.items.length >= 1 && d3.grni_memo.total >= 100,
      JSON.stringify({ ap: d3.ap_items.length, grniN: d3.grni_memo.items.length, grniTotal: d3.grni_memo.total }));

    // B4-04 — advance available → net_position = AP - advance
    const s4 = await makeSupplier('ADV');
    await makeInvoice(s4, 5, 1000, 0);
    await makeAdvance(s4, 400, 250, 1);
    const d4: any = await svc.statement(s4, { from, to, branchId: 0 });
    check('B4-04 advance → net_position = AP − available',
      d4.advances.available === 250 && d4.net_position === 750,
      `available=${d4.advances.available} ap=${d4.ap_aging.total} net=${d4.net_position}`);

    // B4-05 — all three sections correct, net accurate
    const s5 = await makeSupplier('ALL');
    await makeInvoice(s5, 10, 3000, 0);
    await makeGrnNoInvoice(s5);
    await makeAdvance(s5, 1000, 500, 2);
    const d5: any = await svc.statement(s5, { from, to, branchId: 0 });
    check('B4-05 AP+GRNI+advances → all 3 sections + net',
      d5.ap_aging.total === 3000 && d5.grni_memo.total >= 100 && d5.advances.available === 500 && d5.net_position === 2500,
      JSON.stringify({ ap: d5.ap_aging.total, grni: d5.grni_memo.total, adv: d5.advances.available, net: d5.net_position }));

    // B4-06 — CSV via HTTP → BOM + 3 sections
    const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: 'admin', password: 'admin123' }) });
    const token = (await login.json()).accessToken;
    const csvRes = await http(`/purchases/suppliers/${s5}/statement?from=${from}&to=${to}&format=csv`, token);
    const buf = csvRes.buf;
    const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    const decoded = buf.toString('utf8').replace(/^\uFEFF/, '');
    check('B4-06 CSV → UTF-8 BOM + 3 sections',
      csvRes.status === 200 && hasBom && decoded.includes('AP — الفواتير المفتوحة') && decoded.includes('مذكرة GRNI') && decoded.includes('السلف المقدمة'),
      `status=${csvRes.status} bom=${hasBom} len=${decoded.length}`);
  } catch (e: any) {
    check('SUITE SETUP/RUN', false, e.message);
  } finally {
    try {
      for (const aid of created.advances) await c.query('DELETE FROM supplier_advances WHERE advance_id=$1', [aid]).catch(()=>{});
      for (const iid of created.invoices) await c.query('DELETE FROM invoices WHERE invoice_id=$1', [iid]).catch(()=>{});
      for (const rid of created.receipts) {
        await c.query('DELETE FROM purchase_invoice_links WHERE receipt_id=$1', [rid]).catch(()=>{});
        await c.query('DELETE FROM purchase_rejections WHERE line_id IN (SELECT line_id FROM purchase_receipt_lines WHERE receipt_id=$1)', [rid]).catch(()=>{});
        await c.query('DELETE FROM purchase_receipt_lines WHERE receipt_id=$1', [rid]).catch(()=>{});
        await c.query('DELETE FROM purchase_receipts WHERE receipt_id=$1', [rid]).catch(()=>{});
      }
      for (const oid of created.orders) { await c.query('DELETE FROM order_lines WHERE order_id=$1', [oid]).catch(()=>{}); await c.query('DELETE FROM orders WHERE order_id=$1', [oid]).catch(()=>{}); }
      for (const iid of created.items) { await c.query('DELETE FROM stock_movements WHERE item_id=$1', [iid]).catch(()=>{}); await c.query('DELETE FROM item_warehouse_qty WHERE item_id=$1', [iid]).catch(()=>{}); await c.query('DELETE FROM items WHERE item_id=$1', [iid]).catch(()=>{}); }
      for (const pid of created.parties) await c.query('DELETE FROM parties WHERE party_id=$1', [pid]).catch(()=>{});
    } catch {}
    c.release(); await pool.end();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
