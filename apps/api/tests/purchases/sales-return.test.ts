/**
 * B5.2 — Sales Returns — permanent test suite (B5.2-01..14).
 * Direct service calls + HTTP report. Requires API on :4000 and local PGlite.
 * Run: npm run test:sales-return
 */
import { Pool, PoolClient } from 'pg';
import { SalesService } from '../../src/modules/sales/sales.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
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
    nextNumber: async () => Math.floor(Math.random() * 1e7),
  } as any;
}

async function main() {
  const pool = new Pool({ connectionString: CONNECTION });
  const c = await pool.connect();
  const branchRow = (await c.query('SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1')).rows[0];
  const branchId = Number(branchRow.branch_id);
  const wh = (await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0];
  const warehouseId = Number(wh.warehouse_id);
  const ca = (await c.query('SELECT cash_account_id FROM cash_accounts LIMIT 1')).rows[0];
  const cashAccountId = ca ? Number(ca.cash_account_id) : null;
  const svc = new SalesService(makeDb(c), { publish: () => {} } as any);
  const user: any = {
    userId: 1, permissions: ['sales.manage', 'sales.view', 'pos.operate'],
    userName: 'admin', branchIds: [branchId], maxDiscountPct: 100,
  };
  const stamp = Date.now();
  const created = { parties: [] as number[], items: [] as number[], invoices: [] as number[] };

  async function makeCustomer(tag: string, unlimited = true, limit = 100) {
    const code = 'B52' + tag + (stamp % 100000);
    await c.query(
      'INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited) VALUES ($1,$2,1,true,$3,$4)',
      [code.slice(0, 30), tag, limit, unlimited],
    );
    const id = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', [code.slice(0, 30)])).rows[0].party_id);
    created.parties.push(id);
    return id;
  }
  async function makeItem(cost = 10, price = 20) {
    const code = 'B52I' + (stamp % 100000) + Math.floor(Math.random() * 1000);
    await c.query(
      `INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active)
       SELECT $1,'B52 item',unit_id,true,$2,$3,true FROM units WHERE code='PCS'`,
      [code, cost, price],
    );
    const it = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', [code])).rows[0];
    const itemId = Number(it.item_id), unitId = Number(it.base_unit_id);
    created.items.push(itemId);
    return { itemId, unitId };
  }
  const item = await makeItem();
  const customer = await makeCustomer('CUST', true);

  // seed stock: 100 units @ cost 10 (the ORIGINAL cost of every parent sale)
  await c.query(
    `INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,reference_no,created_by)
     VALUES ($1,$2,$3,$4,1,now(),100,10,1,'B52STK',1)`,
    [branchId, warehouseId, item.itemId, item.unitId],
  );
  await c.query(
    `INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at)
     VALUES ($1,$2,$3,100,10,now())
     ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=100, avg_cost=10`,
    [item.itemId, warehouseId, item.unitId],
  );

  async function makeParent(qty = 10, price = 20, tax = 10, pid = customer) {
    const r: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: pid, paymentType: 1, paidAmount: 0,
      cashAccountId, lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: qty, unitPrice: price, taxPct: tax }],
    } as any, user, branchId);
    created.invoices.push(Number(r.invoiceId));
    const lines = (await c.query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_number', [r.invoiceId])).rows;
    return { invoiceId: Number(r.invoiceId), line: lines[0], partyId: pid, total: Number(r.totalAmount) };
  }
  const makeReturn = (parent: any, qty: number, extra: any = {}, bid = branchId) =>
    svc.create({
      invoiceType: 3, branchId: bid, warehouseId, partyId: parent.partyId,
      paymentType: 1, paidAmount: 0, cashAccountId,
      parentInvoiceId: parent.invoiceId, notes: 'مرتجع اختبار B52',
      lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: qty, parentLineId: parent.line.invoice_line_id }],
      ...extra,
    } as any, user, branchId).then((r: any) => { created.invoices.push(Number(r.invoiceId)); return r; });

  try {
    // B5.2-01 — no parent id
    let b01 = false;
    try {
      await svc.create({
        invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0,
        lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1 }],
      } as any, user, branchId);
    } catch (e: any) { b01 = /الفاتورة الأصلية مطلوبة/.test(e.message); }
    check('B5.2-01 return without parentInvoiceId → 400 Arabic', b01);

    // B5.2-02 — different party
    const other = await makeCustomer('OTHER', true);
    const p02 = await makeParent();
    let b02 = false;
    try {
      await svc.create({
        invoiceType: 3, branchId, warehouseId, partyId: other, paymentType: 1, paidAmount: 0,
        parentInvoiceId: p02.invoiceId,
        lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1 }],
      } as any, user, branchId);
    } catch (e: any) { b02 = /طرف المرتجع يجب أن يطابق/.test(e.message); }
    check('B5.2-02 return with different party → 400', b02);

    // B5.2-03 — different branch
    const bcode = 'B52BR' + (stamp % 100000);
    await c.query('INSERT INTO branches (code,name,is_active) VALUES ($1,$2,true)', [bcode.slice(0, 20), 'فرع B52']);
    const otherBranch = Number((await c.query('SELECT branch_id FROM branches WHERE code=$1', [bcode.slice(0, 20)])).rows[0].branch_id);
    await c.query('INSERT INTO warehouses (branch_id,code,name,is_default,is_active) VALUES ($1,$2,$3,false,true)',
      [otherBranch, 'B52WH' + (stamp % 100000), 'مخزن فرع B52']);
    const otherWh = Number((await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 ORDER BY warehouse_id DESC LIMIT 1', [otherBranch])).rows[0].warehouse_id);
    user.branchIds.push(otherBranch);
    const p03 = await makeParent();
    let b03 = false, d03 = '';
    try {
      await svc.create({
        invoiceType: 3, branchId: otherBranch, warehouseId: otherWh, partyId: customer,
        paymentType: 1, paidAmount: 0, parentInvoiceId: p03.invoiceId,
        lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1, parentLineId: p03.line.invoice_line_id }],
      } as any, user, otherBranch);
    } catch (e: any) { b03 = /فرعًا آخر/.test(e.message); d03 = e.message; }
    check('B5.2-03 return on parent from another branch → 400', b03, d03);

    // B5.2-04 — parent in a closed period
    const p04 = await makeParent();
    const periodId = Number((await c.query('SELECT period_id FROM invoices WHERE invoice_id=$1', [p04.invoiceId])).rows[0].period_id);
    await c.query('UPDATE periods SET is_closed=true WHERE period_id=$1', [periodId]);
    let b04 = false;
    try { await makeReturn(p04, 1); }
    catch (e: any) { b04 = /فترة مقفولة/.test(e.message); }
    await c.query('UPDATE periods SET is_closed=false WHERE period_id=$1', [periodId]);
    check('B5.2-04 parent in closed period → 400', b04);

    // B5.2-05 — qty > parent line qty
    const p05 = await makeParent();
    let b05 = false, d05 = '';
    try { await makeReturn(p05, 11); }
    catch (e: any) { b05 = /المتبقي = 10/.test(e.message); d05 = e.message; }
    check('B5.2-05 qty > parent line qty → 400 «المتبقي = N»', b05, d05);

    // B5.2-06 + B5.2-07 — partial then exact remainder, then third refused
    const p06 = await makeParent();
    const r06: any = await makeReturn(p06, 6);
    let b06 = false, d06 = '';
    try { await makeReturn(p06, 6); }
    catch (e: any) { b06 = /المتبقي = 4/.test(e.message); d06 = e.message; }
    check('B5.2-06 qty > parent − prior returns → 400 «المتبقي = 4»', b06, d06);
    const r07: any = await makeReturn(p06, 4);
    let b07 = false;
    try { await makeReturn(p06, 1); } catch (e: any) { b07 = /المتبقي = 0/.test(e.message); }
    check('B5.2-07 qty = remaining → 200, third return refused', !!r07.invoiceId && b07);

    // B5.2-08/09 — price + VAT snapshot
    const p08 = await makeParent(10, 37, 14);
    const r08: any = await makeReturn(p08, 2);
    let b08 = false, d08 = '';
    try {
      const l = (await c.query('SELECT unit_price,tax_pct FROM invoice_lines WHERE invoice_id=$1', [r08.invoiceId])).rows[0];
      const pl = (await c.query('SELECT unit_price,tax_pct FROM invoice_lines WHERE invoice_id=$1', [p08.invoiceId])).rows[0];
      b08 = Number(l.unit_price) === Number(pl.unit_price);
      d08 = `return=${l.unit_price} parent=${pl.unit_price}`;
    } catch (e: any) { d08 = e.message; }
    check('B5.2-08 unit_price = parent_line.unit_price (snapshot)', b08, d08);
    // manual different price must be refused
    let refusePrice = false;
    try {
      await makeReturn(p08, 1, { lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1, unitPrice: 1, parentLineId: p08.line.invoice_line_id }] } as any);
    } catch (e: any) { refusePrice = /لا يمكن تعديل سعر سطر المرتجع/.test(e.message); }
    check('B5.2-08 manual price override → 400', refusePrice);
    const r09: any = await makeReturn(p08, 1, { lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1, taxPct: 5, parentLineId: p08.line.invoice_line_id }] } as any);
    const l09 = (await c.query('SELECT tax_pct FROM invoice_lines WHERE invoice_id=$1', [r09.invoiceId])).rows[0];
    check('B5.2-09 tax_pct = parent_line.tax_pct', Number(l09.tax_pct) === 14, `tax=${l09.tax_pct}`);

    // B5.2-10 — original movement cost, not current average (10 vs 15)
    const p10 = await makeParent(); // original sale happens while avg cost is still 10
    await c.query('UPDATE item_warehouse_qty SET avg_cost=15 WHERE item_id=$1 AND warehouse_id=$2', [item.itemId, warehouseId]);
    const r10: any = await makeReturn(p10, 5);
    const l10 = (await c.query('SELECT unit_cost FROM invoice_lines WHERE invoice_id=$1', [r10.invoiceId])).rows[0];
    const mv10 = (await c.query("SELECT unit_cost FROM stock_movements WHERE reference_id=$1 AND move_type=3 ORDER BY stock_movement_id DESC LIMIT 1", [r10.invoiceId])).rows[0];
    check('B5.2-10 COGS uses original movement cost 10 (avg now 15)',
      Math.abs(Number(l10.unit_cost) - 10) < 0.0001 && Math.abs(Number(mv10.unit_cost) - 10) < 0.0001,
      `line=${l10.unit_cost} movement=${mv10.unit_cost} avg=15`);

    // B5.2-11 — balanced GL with source_type sale_return
    const j11 = (await c.query("SELECT journal_id FROM gl_journals WHERE source_id=$1 AND source_type='sale_return'", [r10.invoiceId])).rows[0];
    const ents11 = j11 ? (await c.query('SELECT account_id,debit,credit FROM gl_entries WHERE journal_id=$1', [j11.journal_id])).rows : [];
    const dr11 = round2(ents11.reduce((s: number, e: any) => s + Number(e.debit), 0));
    const cr11 = round2(ents11.reduce((s: number, e: any) => s + Number(e.credit), 0));
    check('B5.2-11 GL balanced, source=sale_return, Dr Revenue+VAT / Cr AR',
      !!j11 && ents11.length >= 4 && dr11 === cr11, `lines=${ents11.length} dr=${dr11} cr=${cr11}`);

    // B5.2-12 — stock +qty, avg_cost unchanged (15)
    const bal12 = (await c.query('SELECT on_hand_qty,avg_cost FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2', [item.itemId, warehouseId])).rows[0];
    check('B5.2-12 inventory +qty and avg_cost NOT recomputed',
      Number(bal12.avg_cost) === 15 && Number(bal12.on_hand_qty) > 0,
      `on_hand=${bal12.on_hand_qty} avg=${bal12.avg_cost}`);

    // B5.2-13 — credit freed after return
    const limited = await makeCustomer('LIM', false, 100);
    const p13: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: limited, paymentType: 2, paidAmount: 0,
      cashAccountId, lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1, unitPrice: 100, taxPct: 0 }],
    } as any, user, branchId);
    created.invoices.push(Number(p13.invoiceId));
    const expBefore = Number((await c.query('SELECT exposure FROM v_customer_exposure WHERE party_id=$1', [limited])).rows[0].exposure);
    await makeReturn({ invoiceId: p13.invoiceId, partyId: limited, line: (await c.query('SELECT * FROM invoice_lines WHERE invoice_id=$1', [p13.invoiceId])).rows[0] }, 1);
    const expAfter = Number((await c.query('SELECT exposure FROM v_customer_exposure WHERE party_id=$1', [limited])).rows[0].exposure);
    check('B5.2-13 exposure decreases after return (credit freed)', expAfter < expBefore, `${expBefore} → ${expAfter}`);

    // B5.2-15 — multi-line COGS: two items in one invoice, each returned fully
    const itemA = await makeItem(8, 10);
    const itemB = await makeItem(10, 12);
    for (const [it, cost] of [[itemA, 8], [itemB, 10]] as any[]) {
      await c.query(
        'INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),50,$5,1,1)',
        [branchId, warehouseId, it.itemId, it.unitId, cost],
      );
      await c.query(
        'INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,50,$4,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=50,avg_cost=$4',
        [it.itemId, warehouseId, it.unitId, cost],
      );
    }
    const p15: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0,
      lines: [
        { itemId: itemA.itemId, unitId: itemA.unitId, quantity: 5, unitPrice: 10, taxPct: 0 },
        { itemId: itemB.itemId, unitId: itemB.unitId, quantity: 5, unitPrice: 12, taxPct: 0 },
      ],
    } as any, user, branchId);
    created.invoices.push(Number(p15.invoiceId));
    const p15lines = (await c.query('SELECT invoice_line_id,item_id FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_number', [p15.invoiceId])).rows;
    const ret15A: any = await svc.create({
      invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0, parentInvoiceId: p15.invoiceId,
      lines: [{ itemId: itemA.itemId, unitId: itemA.unitId, quantity: 5, parentLineId: p15lines[0].invoice_line_id }],
    } as any, user, branchId);
    const ret15B: any = await svc.create({
      invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0, parentInvoiceId: p15.invoiceId,
      lines: [{ itemId: itemB.itemId, unitId: itemB.unitId, quantity: 5, parentLineId: p15lines[1].invoice_line_id }],
    } as any, user, branchId);
    created.invoices.push(Number(ret15A.invoiceId), Number(ret15B.invoiceId));
    const l15A = (await c.query('SELECT unit_cost FROM invoice_lines WHERE invoice_id=$1', [ret15A.invoiceId])).rows[0];
    const l15B = (await c.query('SELECT unit_cost FROM invoice_lines WHERE invoice_id=$1', [ret15B.invoiceId])).rows[0];
    const mv15A = (await c.query('SELECT unit_cost FROM stock_movements WHERE reference_id=$1 AND move_type=3', [ret15A.invoiceId])).rows[0];
    const mv15B = (await c.query('SELECT unit_cost FROM stock_movements WHERE reference_id=$1 AND move_type=3', [ret15B.invoiceId])).rows[0];
    check('B5.2-15 multi-line COGS: A=8, B=10, no cross-mix',
      Math.abs(Number(l15A.unit_cost) - 8) < 0.0001 && Math.abs(Number(l15B.unit_cost) - 10) < 0.0001
      && Math.abs(Number(mv15A.unit_cost) - 8) < 0.0001 && Math.abs(Number(mv15B.unit_cost) - 10) < 0.0001,
      `A(line=${l15A.unit_cost},mv=${mv15A.unit_cost}) B(line=${l15B.unit_cost},mv=${mv15B.unit_cost})`);

    // B5.2-16 — VAT is a separate GL line (VAT_OUTPUT code 2102)
    const itemV = await makeItem(8, 10);
    await c.query('INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),50,8,1,1)', [branchId, warehouseId, itemV.itemId, itemV.unitId]);
    await c.query('INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,50,8,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=50,avg_cost=8', [itemV.itemId, warehouseId, itemV.unitId]);
    const p16: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0,
      lines: [{ itemId: itemV.itemId, unitId: itemV.unitId, quantity: 5, unitPrice: 10, taxPct: 15 }],
    } as any, user, branchId);
    created.invoices.push(Number(p16.invoiceId));
    const l16 = (await c.query('SELECT invoice_line_id FROM invoice_lines WHERE invoice_id=$1', [p16.invoiceId])).rows[0];
    const ret16: any = await svc.create({
      invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0, parentInvoiceId: p16.invoiceId,
      lines: [{ itemId: itemV.itemId, unitId: itemV.unitId, quantity: 5, parentLineId: l16.invoice_line_id }],
    } as any, user, branchId);
    created.invoices.push(Number(ret16.invoiceId));
    const j16 = (await c.query("SELECT journal_id FROM gl_journals WHERE source_id=$1 AND source_type='sale_return'", [ret16.invoiceId])).rows[0];
    const gl16 = j16 ? (await c.query('SELECT a.code,e.debit,e.credit FROM gl_entries e JOIN gl_accounts a ON a.account_id=e.account_id WHERE e.journal_id=$1', [j16.journal_id])).rows : [];
    const g = (code: string, side: 'debit' | 'credit') => round2(gl16.filter((x: any) => x.code === code).reduce((s: number, x: any) => s + Number(x[side]), 0));
    check('B5.2-16 VAT 15% posted as separate Dr VAT_OUTPUT 7.50 / Cr AR 57.50',
      g('4102', 'debit') === 50 && g('2102', 'debit') === 7.5 && g('1103', 'credit') === 57.5
      && g('1104', 'debit') === 40 && g('5101', 'credit') === 40,
      `4102=${g('4102','debit')} 2102=${g('2102','debit')} 1103=${g('1103','credit')} 1104=${g('1104','debit')} 5101=${g('5101','credit')}`);

    // B5.2-14 — report JSON + CSV
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: 'admin', password: 'admin123' }),
    });
    const login = await loginRes.json() as any;
    const headers: any = { Authorization: `Bearer ${login.accessToken}`, 'x-branch-id': String(branchId) };
    const r14 = await fetch(`${API}/sales/reports/returns?format=json`, { headers });
    const json = await r14.json() as any;
    const r14c = await fetch(`${API}/sales/reports/returns?format=csv`, { headers });
    const csv = await r14c.json() as any;
    check('B5.2-14 report JSON + CSV with BOM',
      r14.status === 200 && Array.isArray(json.items) && json.items.length > 0 && csv.base64 && Buffer.from(csv.base64, 'base64').toString('utf8').startsWith('\uFEFF'),
      `jsonN=${json.items?.length} bom=${!!csv.base64}`);

  } catch (e: any) {
    console.error('FATAL', e.stack || e.message);
  } finally {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nRESULT: ${results.length - failed.length}/${results.length} passed`);
    try {
      await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT journal_id FROM gl_journals WHERE source_id = ANY($1::bigint[]))', [created.invoices]);
      await c.query('DELETE FROM invoice_lines WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM invoices WHERE invoice_id = ANY($1::bigint[])', [created.invoices]);
      await c.query('DELETE FROM gl_journals WHERE source_id = ANY($1::bigint[])', [created.invoices]);
      await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT journal_id FROM gl_journals WHERE source_id IN (SELECT invoice_id FROM invoices WHERE party_id = ANY($1::int[])))', [created.parties]);
      await c.query('DELETE FROM gl_journals WHERE source_id IN (SELECT invoice_id FROM invoices WHERE party_id = ANY($1::int[]))', [created.parties]);
      await c.query('DELETE FROM invoice_lines WHERE invoice_id IN (SELECT invoice_id FROM invoices WHERE party_id = ANY($1::int[]))', [created.parties]);
      await c.query('DELETE FROM invoices WHERE party_id = ANY($1::int[])', [created.parties]);
      await c.query('DELETE FROM ledger_entries WHERE party_id = ANY($1::int[])', [created.parties]);
      await c.query('DELETE FROM stock_movements WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM item_warehouse_qty WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM items WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM parties WHERE party_id = ANY($1::int[])', [created.parties]);
    } catch (e: any) { console.error('cleanup skipped:', e.message); }
    await c.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(failed.length ? 1 : 0);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
