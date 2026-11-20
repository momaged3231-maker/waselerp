/**
 * B1 — GRN slice permanent test suite (12 acceptance criteria + B1-13).
 *
 * Runs against a local PGlite/PostgreSQL test DB with schema + seed applied.
 * Creates its own disposable fixtures (items, party, POs) and cleans them up.
 * Uses direct service calls (no HTTP server required).
 *
 * Run:  DATABASE_URL=postgres://postgres:postgres@localhost:5432/wasel npx ts-node --transpile-only -P tests/tsconfig.json tests/purchases/purchase-receipt.test.ts
 *   or: npm run test:purchases
 */
import { Pool, PoolClient } from 'pg';
import { PurchaseReceiptService } from '../../src/modules/purchases/purchase-receipt.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/wasel';

interface Ctx {
  pool: Pool;
  client: PoolClient;
  svc: PurchaseReceiptService;
  user: any;
  noReceiveUser: any;
  branchId: number;
  item: any;
  unitId: number;
  warehouseId: number;
  supplierId: number;
  created: { items: number[]; orders: number[]; receipts: number[] };
}

let results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function makeService(client: PoolClient): PurchaseReceiptService {
  // Minimal DatabaseService shape — the service only uses transaction/query/one/nextNumber.
  const db: any = {
    query: (...a: any[]) => client.query(...(a as [any])),
    one: async (...a: any[]) => (await client.query(...(a as [any]))).rows[0],
    transaction: (fn: any) => fn(client),
    nextNumber: async () => 1,
  };
  return new PurchaseReceiptService(db);
}

async function makePO(ctx: Ctx, qty: number, supplierId: number | null): Promise<{ orderId: number; orderLineId: number }> {
  const c = ctx.client;
  const no = 'PO-T-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  const r = await c.query(
    `INSERT INTO orders (order_no, order_date, branch_id, party_id, warehouse_id, order_type, status, subtotal, total_amount, created_by)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, 2, 2, $5, $5, 1) RETURNING order_id`,
    [no, ctx.branchId, supplierId, ctx.warehouseId, qty * 10],
  );
  const orderId = Number(r.rows[0].order_id);
  const lr = await c.query(
    `INSERT INTO order_lines (order_id, line_number, item_id, unit_id, quantity, delivered_qty, unit_price, line_total)
     VALUES ($1, 1, $2, $3, $4, 0, 10, $5) RETURNING order_line_id`,
    [orderId, Number(ctx.item.item_id), ctx.unitId, qty, qty * 10],
  );
  ctx.created.orders.push(orderId);
  return { orderId, orderLineId: Number(lr.rows[0].order_line_id) };
}

async function setup(ctx: Ctx) {
  const c = ctx.client;
  // Disposable item
  const code = 'B1T-' + Date.now();
  await c.query(
    `INSERT INTO items (code, name, base_unit_id, track_quantity, cost_price, is_active)
     SELECT $1, 'B1 test item', unit_id, true, 10, true FROM units WHERE code='PCS'`,
    [code],
  );
  ctx.item = (await c.query('SELECT item_id, base_unit_id FROM items WHERE code=$1', [code])).rows[0];
  ctx.created.items.push(Number(ctx.item.item_id));
  ctx.unitId = Number(ctx.item.base_unit_id);

  // Real supplier party
  const pcode = 'B1SUP-' + Date.now();
  await c.query(
    `INSERT INTO parties (code, name, party_type, is_active) VALUES ($1, $2, 2, true)`,
    [pcode, 'B1 test supplier'],
  );
  ctx.supplierId = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', [pcode])).rows[0].party_id);

  const wh = (await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [ctx.branchId])).rows[0];
  ctx.warehouseId = Number(wh.warehouse_id);
}

async function cleanup(ctx: Ctx) {
  const c = ctx.client;
  try {
    for (const rid of ctx.created.receipts) {
      await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT gl_journal_id FROM purchase_receipts WHERE receipt_id=$1)', [rid]).catch(() => {});
      await c.query('DELETE FROM gl_journals WHERE journal_id IN (SELECT gl_journal_id FROM purchase_receipts WHERE receipt_id=$1)', [rid]).catch(() => {});
      await c.query('DELETE FROM purchase_receipts WHERE receipt_id=$1', [rid]).catch(() => {});
    }
    for (const oid of ctx.created.orders) {
      await c.query('DELETE FROM order_lines WHERE order_id=$1', [oid]).catch(() => {});
      await c.query('DELETE FROM orders WHERE order_id=$1', [oid]).catch(() => {});
    }
    for (const iid of ctx.created.items) {
      await c.query('DELETE FROM stock_movements WHERE item_id=$1', [iid]).catch(() => {});
      await c.query('DELETE FROM item_warehouse_qty WHERE item_id=$1', [iid]).catch(() => {});
      await c.query('DELETE FROM items WHERE item_id=$1', [iid]).catch(() => {});
    }
    if (ctx.supplierId) await c.query('DELETE FROM parties WHERE party_id=$1', [ctx.supplierId]).catch(() => {});
  } catch { /* best effort */ }
}

async function main() {
  const pool = new Pool({ connectionString: CONNECTION });
  const client = await pool.connect();
  const branch = (await client.query('SELECT branch_id FROM branches LIMIT 1')).rows[0];
  const ctx: Ctx = {
    pool, client,
    svc: makeService(client),
    user: { userId: 1, permissions: ['purchases.receive', 'purchases.approve_exception'], userName: 'admin' },
    noReceiveUser: { userId: 1, permissions: [], userName: 'norights' },
    branchId: Number(branch.branch_id),
    item: null, unitId: 0, warehouseId: 0, supplierId: 0,
    created: { items: [], orders: [], receipts: [] },
  };

  try {
    await setup(ctx);
    const svc = ctx.svc;

    // B1-01..04 — 10 accepted @10 with real supplier
    const po1 = await makePO(ctx, 10, ctx.supplierId);
    const before = Number((await client.query('SELECT COALESCE(on_hand_qty,0) AS q FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2 AND unit_id=$3', [ctx.item.item_id, ctx.warehouseId, ctx.unitId])).rows[0]?.q ?? 0);
    const r1: any = await svc.create({ orderId: po1.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: po1.orderLineId, acceptedQty: 10, unitCost: 10 }] }, ctx.user, ctx.branchId);
    ctx.created.receipts.push(r1.receiptId);
    check('B1-01 create', !!r1.receiptNo && r1.postingStatus === 2, `no=${r1.receiptNo} status=${r1.postingStatus} val=${r1.totalValue}`);
    const mv = (await client.query('SELECT quantity, move_type FROM stock_movements WHERE reference_id=$1 AND reference_type=1 AND reference_no=$2 ORDER BY stock_movement_id', [r1.receiptId, r1.receiptNo])).rows;
    const after = Number((await client.query('SELECT COALESCE(on_hand_qty,0) AS q FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2 AND unit_id=$3', [ctx.item.item_id, ctx.warehouseId, ctx.unitId])).rows[0]?.q ?? 0);
    check('B1-02 stock +10', mv.length === 1 && Number(mv[0].quantity) === 10 && after - before === 10, `mv=${JSON.stringify(mv)} delta=${after - before}`);
    const je = (await client.query('SELECT a.code, e.debit, e.credit, e.party_id, e.branch_id FROM gl_entries e JOIN gl_accounts a ON a.account_id=e.account_id WHERE e.journal_id=$1 ORDER BY e.line_no', [r1.journalId])).rows;
    check('B1-03 journal Dr1104/Cr2107 balanced', je.length === 2 && je[0].code === '1104' && Number(je[0].debit) === 100 && je[1].code === '2107' && Number(je[1].credit) === 100, JSON.stringify(je));
    const hdr = (await client.query('SELECT posting_status, gl_journal_id FROM purchase_receipts WHERE receipt_id=$1', [r1.receiptId])).rows[0];
    check('B1-04 posted + journal linked', Number(hdr.posting_status) === 2 && hdr.gl_journal_id != null, JSON.stringify(hdr));

    // B1-13 — GRNI party dimension with a REAL supplier
    const grniLine = je.find((x: any) => x.code === '2107');
    check('B1-13 GRNI carries supplier party_id', grniLine && Number(grniLine.party_id) === ctx.supplierId && Number(grniLine.branch_id) === ctx.branchId, `party=${grniLine?.party_id} expected=${ctx.supplierId} branch=${grniLine?.branch_id}`);

    // B1-05 — 8 accepted + 2 rejected
    const po2 = await makePO(ctx, 10, ctx.supplierId);
    const r2: any = await svc.create({ orderId: po2.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: po2.orderLineId, acceptedQty: 8, rejectedQty: 2, reason: 'تالف' }] }, ctx.user, ctx.branchId);
    ctx.created.receipts.push(r2.receiptId);
    const mv2 = (await client.query('SELECT quantity FROM stock_movements WHERE reference_id=$1 AND reference_type=1 AND reference_no=$2', [r2.receiptId, r2.receiptNo])).rows;
    const rej = (await client.query('SELECT x.rejected_qty, x.decision FROM purchase_rejections x JOIN purchase_receipt_lines l ON l.line_id=x.line_id WHERE l.receipt_id=$1', [r2.receiptId])).rows;
    check('B1-05 8 accepted 2 rejected', mv2.length === 1 && Number(mv2[0].quantity) === 8 && rej.length === 1 && Number(rej[0].rejected_qty) === 2 && Number(rej[0].decision) === 6, `mv=${JSON.stringify(mv2)} rej=${JSON.stringify(rej)}`);

    // B1-06 — missing inspectedBy
    const po3 = await makePO(ctx, 5, ctx.supplierId);
    let b06 = false;
    try { await svc.create({ orderId: po3.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, lines: [{ orderLineId: po3.orderLineId, acceptedQty: 5 }] }, ctx.user, ctx.branchId); } catch (e: any) { b06 = /inspectedBy|المفتش/.test(e.message); }
    check('B1-06 missing inspectedBy rejected', b06);

    // B1-07 — over-receipt blocked (over_pct=0)
    const po4 = await makePO(ctx, 10, ctx.supplierId);
    let b07 = false;
    try { await svc.create({ orderId: po4.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: po4.orderLineId, acceptedQty: 12 }] }, ctx.user, ctx.branchId); } catch (e: any) { b07 = /تجاوز|approve_exception/.test(e.message); }
    check('B1-07 over-receipt blocked', b07);

    // B1-08 — over-receipt with policy + reason (set supplier over_pct=20)
    await client.query('UPDATE parties SET default_over_receipt_pct=20 WHERE party_id=$1', [ctx.supplierId]);
    const po5 = await makePO(ctx, 10, ctx.supplierId);
    let b08 = false;
    try { const r5: any = await svc.create({ orderId: po5.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, reason: 'توريد إضافي متفق عليه', lines: [{ orderLineId: po5.orderLineId, acceptedQty: 12 }] }, ctx.user, ctx.branchId); b08 = !!r5.receiptNo; ctx.created.receipts.push(r5.receiptId); } catch (e: any) { console.log('  B1-08 err:', e.message); }
    check('B1-08 over-receipt with policy+reason', b08);

    // B1-09 — reverse
    const rev: any = await svc.reverse(r1.receiptId, ctx.user, ctx.branchId);
    const revHdr = (await client.query('SELECT posting_status FROM purchase_receipts WHERE receipt_id=$1', [r1.receiptId])).rows[0];
    const revMv = (await client.query('SELECT move_type, quantity FROM stock_movements WHERE reference_id=$1 AND reference_type=1 AND reference_no=$2 ORDER BY stock_movement_id', [r1.receiptId, r1.receiptNo])).rows;
    check('B1-09 reverse', rev.reversed === true && Number(revHdr.posting_status) === 3 && revMv.length === 2 && Number(revMv[1].move_type) === 4, `status=${revHdr.posting_status} mv=${JSON.stringify(revMv)}`);

    // B1-10 — closed period
    const po6 = await makePO(ctx, 3, ctx.supplierId);
    await client.query('UPDATE periods SET is_closed=true WHERE branch_id=$1', [ctx.branchId]);
    let b10 = false;
    try { await svc.create({ orderId: po6.orderId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: po6.orderLineId, acceptedQty: 3 }] }, ctx.user, ctx.branchId); } catch (e: any) { b10 = /مقفل|فترة|closed/.test(e.message); }
    await client.query('UPDATE periods SET is_closed=false WHERE branch_id=$1', [ctx.branchId]);
    check('B1-10 closed period rejected', b10);

    // B1-11 — permission decorator present in source (service has no auth layer)
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../../src/modules/purchases/purchase-receipt.slice.ts'), 'utf8');
    check('B1-11 purchases.receive decorator present', src.includes("@RequirePermissions('purchases.receive')"));

    // B1-12 — PO in another branch rejected
    await client.query("INSERT INTO branches (code,name,is_active) VALUES ('B1T-OTHER','B1 other',true) ON CONFLICT (code) DO NOTHING");
    const other = (await client.query("SELECT branch_id FROM branches WHERE code='B1T-OTHER'")).rows[0];
    const op = await client.query('INSERT INTO orders (order_no,order_date,branch_id,party_id,warehouse_id,order_type,status,subtotal,total_amount,created_by) VALUES ($1,CURRENT_DATE,$2,$3,$4,2,2,0,0,1) RETURNING order_id', ['PO-B1T-' + Date.now(), other.branch_id, ctx.supplierId, ctx.warehouseId]);
    const opId = Number(op.rows[0].order_id);
    ctx.created.orders.push(opId);
    const ol = await client.query('INSERT INTO order_lines (order_id,line_number,item_id,unit_id,quantity,delivered_qty,unit_price,line_total) VALUES ($1,1,$2,$3,5,0,10,50) RETURNING order_line_id', [opId, ctx.item.item_id, ctx.unitId]);
    let b12 = false;
    try { await svc.create({ orderId: opId, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1, lines: [{ orderLineId: Number(ol.rows[0].order_line_id), acceptedQty: 5 }] }, ctx.user, ctx.branchId); } catch (e: any) { b12 = /فرع|branch/.test(e.message); }
    check('B1-12 same-branch enforcement', b12);

    // B1-14 — non-base purchase unit: 2 BOX (factor 12) = 24 base units, stored at BASE unit.
    // Regression guard for the bug where baseUnitId was set to the receipt unit.
    const boxUnit = (await client.query("SELECT unit_id FROM units WHERE code='BOX' LIMIT 1")).rows[0];
    if (boxUnit) {
      const boxId = Number(boxUnit.unit_id);
      await client.query('DELETE FROM item_units WHERE item_id=$1 AND unit_id=$2', [ctx.item.item_id, boxId]);
      await client.query('INSERT INTO item_units (item_id,unit_id,factor,sell_price,buy_price) VALUES ($1,$2,12,120,120)', [ctx.item.item_id, boxId]);
      // Fresh PO priced in BOX units; 2 boxes ordered, 2 accepted.
      const no14 = 'PO-B1T-BOX-' + Date.now();
      const po14 = await client.query(
        `INSERT INTO orders (order_no,order_date,branch_id,party_id,warehouse_id,order_type,status,subtotal,total_amount,created_by)
         VALUES ($1,CURRENT_DATE,$2,$3,$4,2,2,240,240,1) RETURNING order_id`,
        [no14, ctx.branchId, ctx.supplierId, ctx.warehouseId]);
      const poId14 = Number(po14.rows[0].order_id);
      ctx.created.orders.push(poId14);
      const ol14 = await client.query(
        `INSERT INTO order_lines (order_id,line_number,item_id,unit_id,quantity,delivered_qty,unit_price,line_total)
         VALUES ($1,1,$2,$3,2,0,120,240) RETURNING order_line_id`,
        [poId14, ctx.item.item_id, boxId]);
      const baseId = Number(ctx.item.base_unit_id);
      const balBefore14 = Number((await client.query(
        'SELECT COALESCE(on_hand_qty,0) q FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2 AND unit_id=$3',
        [ctx.item.item_id, ctx.warehouseId, baseId])).rows[0].q);
      const r14: any = await svc.create(
        { orderId: poId14, warehouseId: ctx.warehouseId, receivedBy: 1, inspectedBy: 1,
          lines: [{ orderLineId: Number(ol14.rows[0].order_line_id), acceptedQty: 2, unitCost: 120 }] },
        ctx.user, ctx.branchId);
      ctx.created.receipts.push(r14.receiptId);
      const qtyRow = (await client.query(
        'SELECT unit_id, on_hand_qty FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2 AND unit_id=$3',
        [ctx.item.item_id, ctx.warehouseId, baseId])).rows[0];
      const mv14 = (await client.query(
        'SELECT unit_id, quantity FROM stock_movements WHERE reference_no=$1 AND reference_type=1',
        [r14.receiptNo])).rows;
      const delta = Number(qtyRow?.on_hand_qty ?? 0) - balBefore14;
      const okUnit = qtyRow && Number(qtyRow.unit_id) === baseId && Math.abs(delta - 24) < 1e-6
        && mv14.length === 1 && Number(mv14[0].unit_id) === baseId && Math.abs(Number(mv14[0].quantity) - 24) < 1e-6;
      check('B1-14 non-base unit (2 BOX→24 base) stored at base unit', !!okUnit,
        `base=${baseId} delta=${delta} mv=${JSON.stringify(mv14)}`);
    }
  } catch (e: any) {
    check('SUITE SETUP/RUN', false, e.message);
  } finally {
    await cleanup(ctx);
    client.release();
    await pool.end();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
