/**
 * Sales Cycle Integration — permanent suite (IT-01..06).
 * Paid invoice → Credit Note: customer credit balance, no refund / no stock.
 * Run: npm run test:sales-integration
 */
import { Pool, PoolClient } from 'pg';
import { SalesService } from '../../src/modules/sales/sales.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const r2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
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
  const svc = new SalesService(makeDb(c), { publish: () => {} } as any);
  const branchId = Number((await c.query('SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1')).rows[0].branch_id);
  const warehouseId = Number((await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0].warehouse_id);
  const cashAccountId = Number((await c.query('SELECT cash_account_id FROM cash_accounts LIMIT 1')).rows[0].cash_account_id);
  const user: any = { userId: 1, permissions: ['sales.manage', 'sales.view'], userName: 'admin', branchIds: [branchId], maxDiscountPct: 100 };
  const stamp = Date.now();
  const pcode = 'ITP' + (stamp % 100000), icode = 'ITI' + (stamp % 100000);

  try {
    await c.query('INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited) VALUES ($1,$2,1,true,0,true)', [pcode, 'IT customer']);
    const partyId = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', [pcode])).rows[0].party_id);
    await c.query("INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'IT item',unit_id,true,20,100,true FROM units WHERE code='PCS'", [icode]);
    const it = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', [icode])).rows[0];
    const itemId = Number(it.item_id), unitId = Number(it.base_unit_id);
    await c.query('INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),50,20,1,1)', [branchId, warehouseId, itemId, unitId]);
    await c.query('INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,50,20,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=50,avg_cost=20', [itemId, warehouseId, unitId]);

    const sale: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId, paymentType: 1,
      paidAmount: 100, cashAccountId,
      lines: [{ itemId, unitId, quantity: 1, unitPrice: 100, taxPct: 0 }],
    } as any, user, branchId);
    const pl = (await c.query('SELECT invoice_line_id FROM invoice_lines WHERE invoice_id=$1', [sale.invoiceId])).rows[0];
    const cn: any = await svc.create({
      invoiceType: 6, branchId, warehouseId, partyId, parentInvoiceId: sale.invoiceId,
      notes: 'paid invoice → credit note',
      lines: [{ itemId, unitId, quantity: 1, parentLineId: pl.invoice_line_id, settleAmount: 60 }],
    } as any, user, branchId);

    const balance = r2((await c.query('SELECT COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE -amount END),0) v FROM ledger_entries WHERE party_id=$1', [partyId])).rows[0].v);
    check('IT-01 customer becomes creditor (-60)', balance === -60, `balance=${balance}`);

    const exposure = r2((await c.query('SELECT exposure FROM v_customer_exposure WHERE party_id=$1', [partyId])).rows[0].exposure);
    check('IT-02 credit exposure reflects creditor (-60)', exposure === -60, `exposure=${exposure}`);

    const cashTx = Number((await c.query('SELECT COUNT(*)::int n FROM cash_transactions WHERE invoice_id=$1', [cn.invoiceId])).rows[0].n);
    check('IT-03 no automatic refund / cash transaction', cashTx === 0, `cash_tx=${cashTx}`);

    const stockMv = Number((await c.query('SELECT COUNT(*)::int n FROM stock_movements WHERE reference_id=$1', [cn.invoiceId])).rows[0].n);
    check('IT-04 no stock movement from credit note', stockMv === 0, `stock_mv=${stockMv}`);

    const journals = Number((await c.query("SELECT COUNT(*)::int n FROM gl_journals WHERE source_id=$1 AND source_type='sales_credit_note'", [cn.invoiceId])).rows[0].n);
    check('IT-05 exactly one sales_credit_note journal', journals === 1, `journals=${journals}`);

    const dr = r2((await c.query('SELECT COALESCE(SUM(debit),0) v FROM gl_entries')).rows[0].v);
    const cr = r2((await c.query('SELECT COALESCE(SUM(credit),0) v FROM gl_entries')).rows[0].v);
    check('IT-06 trial balance stays balanced', dr === cr, `dr=${dr} cr=${cr}`);

  } catch (e: any) {
    console.error('FATAL', e.stack || e.message);
  } finally {
    console.log(`\nRESULT: ${results.length - results.filter((r) => !r.ok).length}/${results.length} passed`);
    await c.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
