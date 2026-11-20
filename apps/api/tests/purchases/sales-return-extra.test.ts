/**
 * B5.3 — Damaged portion + Gift/Sample returns — permanent suite (B5.3-01..09).
 * Run: npm run test:sales-return-extra
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
  const branchId = Number((await c.query('SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1')).rows[0].branch_id);
  const warehouseId = Number((await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0].warehouse_id);
  const ca = (await c.query('SELECT cash_account_id FROM cash_accounts LIMIT 1')).rows[0];
  const svc = new SalesService(makeDb(c), { publish: () => {} } as any);
  const user: any = { userId: 1, permissions: ['sales.manage', 'sales.view', 'pos.operate'], userName: 'admin', branchIds: [branchId], maxDiscountPct: 100 };
  const stamp = Date.now();
  const created = { parties: [] as number[], items: [] as number[], invoices: [] as number[] };

  await c.query('INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited) VALUES ($1,$2,1,true,0,true)', ['B53C' + (stamp % 100000), 'B53 customer']);
  const customer = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', ['B53C' + (stamp % 100000)])).rows[0].party_id);
  created.parties.push(customer);

  async function makeItem() {
    const code = 'B53I' + (stamp % 100000) + Math.floor(Math.random() * 1000);
    await c.query("INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'B53 item',unit_id,true,8,10,true FROM units WHERE code='PCS'", [code]);
    const it = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', [code])).rows[0];
    const itemId = Number(it.item_id), unitId = Number(it.base_unit_id);
    created.items.push(itemId);
    await c.query('INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),100,8,1,1)', [branchId, warehouseId, itemId, unitId]);
    await c.query('INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,100,8,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=100,avg_cost=8', [itemId, warehouseId, unitId]);
    return { itemId, unitId };
  }
  const item = await makeItem();

  async function makeParent(tax = 0) {
    const r: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0,
      lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 5, unitPrice: 10, taxPct: tax }],
    } as any, user, branchId);
    created.invoices.push(Number(r.invoiceId));
    const line = (await c.query('SELECT invoice_line_id FROM invoice_lines WHERE invoice_id=$1', [r.invoiceId])).rows[0];
    return { invoiceId: Number(r.invoiceId), line };
  }
  const makeReturn = (parent: any, damagedQty: number) => svc.create({
    invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0,
    parentInvoiceId: parent.invoiceId,
    lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 5, parentLineId: parent.line.invoice_line_id, damagedQty }],
  } as any, user, branchId).then((r: any) => { created.invoices.push(Number(r.invoiceId)); return r; });

  const glOf = async (invoiceId: number) => {
    const j = (await c.query("SELECT journal_id FROM gl_journals WHERE source_id=$1 AND source_type='sale_return'", [invoiceId])).rows[0];
    if (!j) return [] as any[];
    return (await c.query('SELECT a.code,e.debit,e.credit FROM gl_entries e JOIN gl_accounts a ON a.account_id=e.account_id WHERE e.journal_id=$1', [j.journal_id])).rows;
  };
  const g = (rows: any[], code: string, side: 'debit' | 'credit') => round2(rows.filter((x) => x.code === code).reduce((s, x) => s + Number(x[side]), 0));

  try {
    // B5.3-01 — schema
    const r01 = await c.query("SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name='invoice_lines' AND column_name='damaged_qty'", []);
    const r01b = await c.query("SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_invoice_lines_damaged_qty'", []);
    check('B5.3-01 schema: damaged_qty column + CHECK constraint', r01.rows[0].n === 1 && r01b.rows[0].n === 1, `col=${r01.rows[0].n} chk=${r01b.rows[0].n}`);

    // B5.3-02 — 5 returned, 2 damaged (cost 8): Dr INV 24, Dr DMG 16, Cr COGS 40
    const p02 = await makeParent();
    const ret02: any = await makeReturn(p02, 2);
    const gl02 = await glOf(Number(ret02.invoiceId));
    check('B5.3-02 damaged 2/5: Dr INV 24 + Dr DMG 16 / Cr COGS 40, full reversal 50',
      g(gl02, '1104', 'debit') === 24 && g(gl02, '5112', 'debit') === 16
      && g(gl02, '5101', 'credit') === 40 && g(gl02, '4102', 'debit') === 50 && g(gl02, '1103', 'credit') === 50,
      `1104=${g(gl02,'1104','debit')} 5112=${g(gl02,'5112','debit')} 5101=${g(gl02,'5101','credit')} 4102=${g(gl02,'4102','debit')} 1103=${g(gl02,'1103','credit')}`);

    // B5.3-03 — damaged > quantity → 400
    const p03 = await makeParent();
    let b03 = false, d03 = '';
    try { await makeReturn(p03, 6); } catch (e: any) { b03 = /كمية التلف لا يمكن أن تتجاوز الكمية المرتجعة/.test(e.message); d03 = e.message; }
    check('B5.3-03 damaged_qty > quantity → 400 Arabic', b03, d03);

    // B5.3-04 — all damaged
    const p04 = await makeParent();
    const ret04: any = await makeReturn(p04, 5);
    const gl04 = await glOf(Number(ret04.invoiceId));
    check('B5.3-04 all damaged: Dr INV 0, Dr DMG 40',
      g(gl04, '1104', 'debit') === 0 && g(gl04, '5112', 'debit') === 40,
      `1104=${g(gl04,'1104','debit')} 5112=${g(gl04,'5112','debit')}`);

    // B5.3-05 — no damaged → behaves exactly like B5.2
    const p05 = await makeParent();
    const ret05: any = await makeReturn(p05, 0);
    const gl05 = await glOf(Number(ret05.invoiceId));
    check('B5.3-05 damaged=0 → B5.2 behaviour (Dr INV 40, no damage line)',
      g(gl05, '1104', 'debit') === 40 && g(gl05, '5112', 'debit') === 0,
      `1104=${g(gl05,'1104','debit')} 5112=${g(gl05,'5112','debit')}`);

    // B5.3-06 — gift/sample return type 5: stock in, no GL/AR/revenue/VAT
    const balBefore = Number((await c.query('SELECT on_hand_qty FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2', [item.itemId, warehouseId])).rows[0].on_hand_qty);
    const gift: any = await svc.create({
      invoiceType: 5, branchId, warehouseId, notes: 'هدية عائدة — كسر بسيط',
      lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 3 }],
    } as any, user, branchId);
    created.invoices.push(Number(gift.invoiceId));
    const balAfter = Number((await c.query('SELECT on_hand_qty FROM item_warehouse_qty WHERE item_id=$1 AND warehouse_id=$2', [item.itemId, warehouseId])).rows[0].on_hand_qty);
    const giftJournal = (await c.query("SELECT journal_id FROM gl_journals WHERE source_id=$1 AND source_type='gift_return'", [gift.invoiceId])).rows[0];
    const giftLines = giftJournal ? (await c.query('SELECT a.code,e.debit,e.credit FROM gl_entries e JOIN gl_accounts a ON a.account_id=e.account_id WHERE e.journal_id=$1', [giftJournal.journal_id])).rows : [];
    const giftLedger = (await c.query('SELECT COUNT(*)::int n FROM ledger_entries WHERE invoice_id=$1', [gift.invoiceId])).rows[0].n;
    const giftMv = (await c.query('SELECT move_type,unit_cost,quantity FROM stock_movements WHERE reference_id=$1', [gift.invoiceId])).rows[0];
    const giftDr = g(giftLines, '1104', 'debit'), giftCr = g(giftLines, '5115', 'credit');
    const giftWrong = g(giftLines, '4102', 'debit') + g(giftLines, '1103', 'credit') + g(giftLines, '2102', 'debit');
    check('B5.3-06 gift return: stock +3, Dr 1104 / Cr 5115 at cost, no AR/revenue/VAT',
      round2(balAfter - balBefore) === 3 && !!giftJournal && giftDr === 24 && giftCr === 24
      && giftWrong === 0 && giftLedger === 0
      && Number(giftMv.move_type) === 10 && Number(giftMv.unit_cost) === 8 && Number(gift.totalAmount) === 0,
      `stock +${round2(balAfter-balBefore)} 1104=${giftDr} 5115=${giftCr} wrong=${giftWrong} ledger=${giftLedger} mv=${giftMv.move_type}@${giftMv.unit_cost}`);

    // B5.3-07 — gift without reason → 400
    let b07 = false, d07 = '';
    try {
      await svc.create({ invoiceType: 5, branchId, warehouseId, lines: [{ itemId: item.itemId, unitId: item.unitId, quantity: 1 }] } as any, user, branchId);
    } catch (e: any) { b07 = /سبب تسوية الهدية إلزامي/.test(e.message); d07 = e.message; }
    check('B5.3-07 gift return without reason → 400', b07, d07);

    // B5.3-08 — report columns + gift section
    const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: 'admin', password: 'admin123' }) });
    const login = await loginRes.json() as any;
    const r08 = await fetch(`${API}/sales/reports/returns?format=json`, { headers: { Authorization: `Bearer ${login.accessToken}`, 'x-branch-id': String(branchId) } });
    const rep = await r08.json() as any;
    const rows = rep.items ?? [];
    const damagedRow = rows.find((x: any) => Number(x.damaged_qty) === 2);
    const giftRow = rows.find((x: any) => x.doc_type === 'gift_return');
    check('B5.3-08 report carries damaged_qty/value + gift_return section',
      !!damagedRow && Number(damagedRow.damaged_value) === 16 && !!giftRow,
      `damaged_value=${damagedRow?.damaged_value} gift=${giftRow?.doc_type}`);

    // B5.3-09 — damaged return journal balanced
    const dr02 = round2(gl02.reduce((s, x) => s + Number(x.debit), 0));
    const cr02 = round2(gl02.reduce((s, x) => s + Number(x.credit), 0));
    check('B5.3-09 damaged return GL balanced (Dr = Cr)', dr02 === cr02 && gl02.length >= 5, `dr=${dr02} cr=${cr02} lines=${gl02.length}`);

  } catch (e: any) {
    console.error('FATAL', e.stack || e.message);
  } finally {
    console.log(`\nRESULT: ${results.length - results.filter((r) => !r.ok).length}/${results.length} passed`);
    try {
      await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT journal_id FROM gl_journals WHERE source_id = ANY($1::bigint[]))', [created.invoices]);
      await c.query('DELETE FROM invoice_lines WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM invoices WHERE invoice_id = ANY($1::bigint[])', [created.invoices]);
      await c.query('DELETE FROM gl_journals WHERE source_id = ANY($1::bigint[])', [created.invoices]);
      await c.query('DELETE FROM ledger_entries WHERE party_id = ANY($1::int[])', [created.parties]);
      await c.query('DELETE FROM stock_movements WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM item_warehouse_qty WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM items WHERE item_id = ANY($1::int[])', [created.items]);
      await c.query('DELETE FROM parties WHERE party_id = ANY($1::int[])', [created.parties]);
    } catch (e: any) { console.error('cleanup skipped:', e.message); }
    await c.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
