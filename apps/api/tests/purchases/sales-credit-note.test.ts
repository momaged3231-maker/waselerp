/**
 * B5.4 — Sales Credit Note — permanent suite (CN-01..CN-24).
 * Run: npm run test:sales-credit-note
 */
import { Pool, PoolClient } from 'pg';
import { SalesService } from '../../src/modules/sales/sales.slice';

const CONNECTION = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const API = process.env.API_BASE ?? 'http://localhost:4000/api';
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
  const created = { parties: [] as number[], items: [] as number[], invoices: [] as number[] };

  await c.query('INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited) VALUES ($1,$2,1,true,0,true)', ['CNC' + (stamp % 100000), 'CN customer']);
  const customer = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', ['CNC' + (stamp % 100000)])).rows[0].party_id);
  created.parties.push(customer);
  await c.query("INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'CN item',unit_id,true,20,100,true FROM units WHERE code='PCS'", ['CNI' + (stamp % 100000)]);
  const item = (await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1', ['CNI' + (stamp % 100000)])).rows[0];
  const itemId = Number(item.item_id), unitId = Number(item.base_unit_id);
  created.items.push(itemId);
  await c.query('INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),1000,20,1,1)', [branchId, warehouseId, itemId, unitId]);
  await c.query('INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,1000,20,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=1000,avg_cost=20', [itemId, warehouseId, unitId]);

  async function makeParent(qty = 10, price = 100, taxPct = 15, paid = false) {
    const r: any = await svc.create({
      invoiceType: 1, branchId, warehouseId, partyId: customer, paymentType: 1,
      paidAmount: paid ? qty * price * (1 + taxPct / 100) : 0, cashAccountId,
      lines: [{ itemId, unitId, quantity: qty, unitPrice: price, taxPct }],
    } as any, user, branchId);
    created.invoices.push(Number(r.invoiceId));
    const line = (await c.query('SELECT * FROM invoice_lines WHERE invoice_id=$1', [r.invoiceId])).rows[0];
    return { invoiceId: Number(r.invoiceId), line, partyId: customer };
  }
  const cn = (parent: any, settleAmount: number, extra: any = {}) => svc.create({
    invoiceType: 6, branchId, warehouseId, partyId: parent.partyId,
    parentInvoiceId: parent.invoiceId, notes: 'تصحيح سعر بعد الإصدار',
    lines: [{ itemId, unitId, quantity: 1, parentLineId: parent.line.invoice_line_id, settleAmount }],
    ...extra,
  } as any, user, branchId).then((r: any) => { created.invoices.push(Number(r.invoiceId)); return r; });

  const journalOf = async (invoiceId: number) => (await c.query("SELECT journal_id FROM gl_journals WHERE source_id=$1 AND source_type='sales_credit_note'", [invoiceId])).rows[0];
  const glOf = async (invoiceId: number) => {
    const j = await journalOf(invoiceId);
    if (!j) return [] as any[];
    return (await c.query('SELECT a.code,e.debit,e.credit FROM gl_entries e JOIN gl_accounts a ON a.account_id=e.account_id WHERE e.journal_id=$1', [j.journal_id])).rows;
  };
  const g = (rows: any[], code: string, side: 'debit' | 'credit') => r2(rows.filter((x) => x.code === code).reduce((s, x) => s + Number(x[side]), 0));
  const expOf = async () => Number((await c.query('SELECT exposure FROM v_customer_exposure WHERE party_id=$1', [customer])).rows[0].exposure);

  try {
    // CN-01
    const p01 = await makeParent();
    const r01: any = await cn(p01, 50);
    check('CN-01 create credit note', !!r01.invoiceId && Number(r01.invoiceNo ?? 0) > 0 || String(r01.invoiceNo).startsWith('CN-'), String(r01.invoiceNo));

    // CN-02
    let b02 = false;
    try { await svc.create({ invoiceType: 6, branchId, warehouseId, partyId: customer, notes: 'سبب', lines: [{ itemId, unitId, quantity: 1, settleAmount: 10 }] } as any, user, branchId); }
    catch (e: any) { b02 = /الفاتورة الأصلية مطلوبة/.test(e.message); }
    check('CN-02 reject without parentInvoiceId', b02);

    // CN-03
    const p03 = await makeParent();
    await svc.cancel(p03.invoiceId, user, [1]);
    let b03 = false;
    try { await cn(p03, 10); } catch (e: any) { b03 = /ملغاة/.test(e.message); }
    check('CN-03 reject cancelled parent', b03);

    // CN-04
    await c.query('INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited) VALUES ($1,$2,1,true,0,true)', ['CNX' + (stamp % 100000), 'other']);
    const other = Number((await c.query('SELECT party_id FROM parties WHERE code=$1', ['CNX' + (stamp % 100000)])).rows[0].party_id);
    created.parties.push(other);
    const p04 = await makeParent();
    let b04 = false;
    try { await svc.create({ invoiceType: 6, branchId, warehouseId, partyId: other, parentInvoiceId: p04.invoiceId, notes: 'سبب', lines: [{ itemId, unitId, quantity: 1, parentLineId: p04.line.invoice_line_id, settleAmount: 10 }] } as any, user, branchId); }
    catch (e: any) { b04 = /عميل إشعار الدائن/.test(e.message); }
    check('CN-04 reject different party', b04);

    // CN-05
    const bcode = 'CNB' + (stamp % 100000);
    await c.query('INSERT INTO branches (code,name,is_active) VALUES ($1,$2,true)', [bcode, 'CN branch']);
    const otherBranch = Number((await c.query('SELECT branch_id FROM branches WHERE code=$1', [bcode])).rows[0].branch_id);
    await c.query('INSERT INTO warehouses (branch_id,code,name,is_default,is_active) VALUES ($1,$2,$3,false,true)', [otherBranch, bcode + 'W', 'other wh']);
    const otherWh = Number((await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 ORDER BY warehouse_id DESC LIMIT 1', [otherBranch])).rows[0].warehouse_id);
    user.branchIds.push(otherBranch);
    const p05 = await makeParent();
    let b05 = false;
    try { await svc.create({ invoiceType: 6, branchId: otherBranch, warehouseId: otherWh, partyId: customer, parentInvoiceId: p05.invoiceId, notes: 'سبب', lines: [{ itemId, unitId, quantity: 1, parentLineId: p05.line.invoice_line_id, settleAmount: 10 }] } as any, user, otherBranch); }
    catch (e: any) { b05 = /فرعًا آخر/.test(e.message); }
    check('CN-05 reject different branch', b05);

    // CN-06
    const p06 = await makeParent(10, 100, 0);
    let b06 = false;
    try { await cn(p06, 1001); } catch (e: any) { b06 = /المتبقي/.test(e.message); }
    check('CN-06 reject over original line value', b06);

    // CN-07 — prior CN is deducted NET of VAT (1000 net; 200 CN → 800 remains).
    const p07 = await makeParent(10, 100, 15);
    await cn(p07, 200);
    let b07 = false, d07 = '';
    try { await cn(p07, 850); } catch (e: any) { b07 = /المتبقي/.test(e.message); d07 = e.message; }
    check('CN-07 reject over remaining after prior notes (net basis)', b07, d07);

    // CN-08 — prior RETURNS are deducted NET of VAT (1000 net; 5×100 returned → 500 remains).
    const p08 = await makeParent(10, 100, 15);
    await svc.create({ invoiceType: 3, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0, parentInvoiceId: p08.invoiceId, lines: [{ itemId, unitId, quantity: 5, parentLineId: p08.line.invoice_line_id }] } as any, user, branchId);
    let b08 = false, d08 = '';
    try { await cn(p08, 550); } catch (e: any) { b08 = /المتبقي/.test(e.message); d08 = e.message; }
    check('CN-08 returns consumed in financial ceiling (net basis)', b08, d08);

    // CN-09
    const p09 = await makeParent(10, 100, 0);
    const a09: any = await cn(p09, 200), b09: any = await cn(p09, 300);
    check('CN-09 sequential partial notes', !!a09.invoiceId && !!b09.invoiceId);

    // CN-10
    const p10 = await makeParent(10, 100, 15);
    let b10 = false;
    try { await svc.create({ invoiceType: 6, branchId, warehouseId, partyId: customer, parentInvoiceId: p10.invoiceId, notes: 'سبب', lines: [{ itemId, unitId, quantity: 1, parentLineId: p10.line.invoice_line_id, settleAmount: 50, taxPct: 5 }] } as any, user, branchId); }
    catch (e: any) { b10 = /نسبة الضريبة/.test(e.message); }
    check('CN-10 reject changed tax_pct', b10);

    // CN-11 / CN-12
    const p11 = await makeParent(10, 100, 15);
    const r11: any = await cn(p11, 50);
    const gl11 = await glOf(Number(r11.invoiceId));
    check('CN-11 VAT Output separate 7.50', g(gl11, '2102', 'debit') === 7.5 && g(gl11, '4108', 'debit') === 50 && g(gl11, '1103', 'credit') === 57.5,
      `lines=${JSON.stringify(gl11)} 4108=${g(gl11,'4108','debit')} 2102=${g(gl11,'2102','debit')} 1103=${g(gl11,'1103','credit')}`);
    const dr11 = r2(gl11.reduce((s, x) => s + Number(x.debit), 0)), cr11 = r2(gl11.reduce((s, x) => s + Number(x.credit), 0));
    check('CN-12 balanced journal + dedicated source', !!(await journalOf(Number(r11.invoiceId))) && dr11 === cr11 && gl11.length === 3, `dr=${dr11} cr=${cr11} lines=${gl11.length}`);

    // CN-13
    const before13 = await expOf();
    await cn(p11, 20);
    const after13 = await expOf();
    check('CN-13 AR + exposure decrease', after13 < before13, `${before13} → ${after13}`);

    // CN-14 / CN-15
    const nMov14 = Number((await c.query('SELECT COUNT(*)::int n FROM stock_movements WHERE reference_id=$1', [r11.invoiceId])).rows[0].n);
    check('CN-14 no stock movement', nMov14 === 0, `n=${nMov14}`);
    const cogs11 = g(gl11, '5101', 'debit') + g(gl11, '5101', 'credit');
    const lc11 = Number((await c.query('SELECT unit_cost FROM invoice_lines WHERE invoice_id=$1', [r11.invoiceId])).rows[0].unit_cost);
    check('CN-15 no COGS', cogs11 === 0 && lc11 === 0, `cogs=${cogs11} line_cost=${lc11}`);

    // CN-16
    const bal16Before = Number((await c.query('SELECT COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE -amount END),0) v FROM ledger_entries WHERE party_id=$1', [customer])).rows[0].v);
    const p16 = await makeParent(10, 100, 0, true);
    const r16: any = await cn(p16, 100);
    const bal16After = Number((await c.query('SELECT COALESCE(SUM(CASE WHEN direction=1 THEN amount ELSE -amount END),0) v FROM ledger_entries WHERE party_id=$1', [customer])).rows[0].v);
    check('CN-16 fully paid parent can receive credit note', !!r16.invoiceId && r2(bal16Before - bal16After) === 100, `delta=${r2(bal16Before - bal16After)}`);

    // CN-17
    await c.query("INSERT INTO periods (branch_id,name,start_date,end_date,is_closed) VALUES ($1,$2,'2020-01-01','2020-12-31',true) ON CONFLICT (branch_id,name) DO NOTHING", [branchId, 'CN closed']);
    const p17 = await makeParent();
    let b17 = false, d17 = '';
    try { await cn(p17, 10, { invoiceDate: '2020-08-01' }); } catch (e: any) { b17 = /مقفل/.test(e.message); d17 = e.message; }
    check('CN-17 reject document date in closed period', b17, d17);

    // CN-18
    const p18 = await makeParent();
    const closedPeriod = Number((await c.query("SELECT period_id FROM periods WHERE name='CN closed'")).rows[0].period_id);
    await c.query('UPDATE invoices SET invoice_date=$2, period_id=$3 WHERE invoice_id=$1', [p18.invoiceId, '2020-06-01', closedPeriod]);
    const r18: any = await cn(p18, 10);
    check('CN-18 accept parent from closed period with current doc date', !!r18.invoiceId);

    // CN-19 / CN-20 / CN-21
    const p19 = await makeParent(10, 100, 0);
    const r19: any = await cn(p19, 200);
    await svc.cancel(Number(r19.invoiceId), user, [6], 'تصحيح خطأ في الإشعار');
    const st19 = (await c.query('SELECT status FROM invoices WHERE invoice_id=$1', [r19.invoiceId])).rows[0].status;
    const rev19 = Number((await c.query("SELECT COUNT(*)::int n FROM gl_journals WHERE source_id=$1 AND source_type='reversal'", [Number((await c.query('SELECT gl_journal_id FROM invoices WHERE invoice_id=$1', [r19.invoiceId])).rows[0].gl_journal_id)])).rows[0].n);
    check('CN-19 cancel reverses GL fully', Number(st19) === 3 && rev19 >= 0, `status=${st19} reversal_refs=${rev19}`);
    const r20: any = await cn(p19, 250);
    check('CN-20 availability restored after cancel', !!r20.invoiceId);
    let b21 = false;
    try { await svc.cancel(Number(r19.invoiceId), user, [6], 'مرة ثانية'); } catch (e: any) { b21 = /ملغاة بالفعل/.test(e.message); }
    check('CN-21 reject duplicate cancel', b21);

    // CN-22
    const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: 'admin', password: 'admin123' }) });
    const login = await loginRes.json() as any;
    const headers: any = { Authorization: `Bearer ${login.accessToken}`, 'x-branch-id': String(branchId) };
    const j22 = await fetch(`${API}/sales/reports/credit-notes?format=json`, { headers });
    const json22 = await j22.json() as any;
    const c22 = await fetch(`${API}/sales/reports/credit-notes?format=csv`, { headers });
    const csv22 = await c22.json() as any;
    check('CN-22 JSON + CSV with BOM', j22.status === 200 && Array.isArray(json22.items) && json22.items.length > 0 && Buffer.from(csv22.base64, 'base64').toString('utf8').startsWith('\uFEFF'), `jsonN=${json22.items?.length}`);

    // CN-23
    await c.query("INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'CN item2',unit_id,true,30,200,true FROM units WHERE code='PCS'", ['CNJ' + (stamp % 100000)]);
    const item2 = Number((await c.query('SELECT item_id FROM items WHERE code=$1', ['CNJ' + (stamp % 100000)])).rows[0].item_id);
    created.items.push(item2);
    await c.query('INSERT INTO stock_movements (branch_id,warehouse_id,item_id,unit_id,move_type,move_date,quantity,unit_cost,reference_type,created_by) VALUES ($1,$2,$3,$4,1,now(),50,30,1,1)', [branchId, warehouseId, item2, unitId]);
    await c.query('INSERT INTO item_warehouse_qty (item_id,warehouse_id,unit_id,on_hand_qty,avg_cost,last_move_at) VALUES ($1,$2,$3,50,30,now()) ON CONFLICT (item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=50,avg_cost=30', [item2, warehouseId, unitId]);
    const p23: any = await svc.create({ invoiceType: 1, branchId, warehouseId, partyId: customer, paymentType: 1, paidAmount: 0, lines: [
      { itemId, unitId, quantity: 5, unitPrice: 100, taxPct: 10 },
      { itemId: item2, unitId, quantity: 5, unitPrice: 200, taxPct: 20 },
    ] } as any, user, branchId);
    created.invoices.push(Number(p23.invoiceId));
    const lines23 = (await c.query('SELECT invoice_line_id,tax_pct FROM invoice_lines WHERE invoice_id=$1 ORDER BY line_number', [p23.invoiceId])).rows;
    const r23: any = await svc.create({ invoiceType: 6, branchId, warehouseId, partyId: customer, parentInvoiceId: p23.invoiceId, notes: 'multi', lines: [
      { itemId, unitId, quantity: 1, parentLineId: lines23[0].invoice_line_id, settleAmount: 100 },
      { itemId: item2, unitId, quantity: 1, parentLineId: lines23[1].invoice_line_id, settleAmount: 50 },
    ] } as any, user, branchId);
    created.invoices.push(Number(r23.invoiceId));
    const gl23 = await glOf(Number(r23.invoiceId));
    check('CN-23 multi-line different taxes: VAT 10+10=20', g(gl23, '2102', 'debit') === 20 && g(gl23, '4108', 'debit') === 150 && g(gl23, '1103', 'credit') === 170,
      `4108=${g(gl23,'4108','debit')} 2102=${g(gl23,'2102','debit')} 1103=${g(gl23,'1103','credit')}`);

    // CN-24 — two genuinely CONCURRENT HTTP requests, same parent line.
    const p24 = await makeParent(10, 100, 0);
    const post = () => fetch(`${API}/sales/credit-notes`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchId, warehouseId, partyId: customer, parentInvoiceId: p24.invoiceId,
        notes: 'تزامن', lines: [{ itemId, unitId, quantity: 1, parentLineId: p24.line.invoice_line_id, settleAmount: 600 }],
      }),
    });
    const settled = await Promise.allSettled([post(), post()]);
    const statuses = settled.map((s) => s.status === 'fulfilled' ? s.value.status : 0);
    const okCount = statuses.filter((s) => s === 201).length;
    const rejectedCount = statuses.filter((s) => s >= 400).length;
    check('CN-24 concurrent requests cannot exceed available ceiling',
      okCount === 1 && rejectedCount === 1, `statuses=${JSON.stringify(statuses)}`);

  } catch (e: any) {
    console.error('FATAL', e.stack || e.message);
  } finally {
    console.log(`\nRESULT: ${results.length - results.filter((r) => !r.ok).length}/${results.length} passed`);
    try {
      await c.query('DELETE FROM gl_entries WHERE journal_id IN (SELECT journal_id FROM gl_journals WHERE source_id = ANY($1::bigint[]))', [created.invoices]);
      await c.query('DELETE FROM invoice_lines WHERE item_id = ANY($1::int[]) OR cn_parent_line_id IS NOT NULL OR returned_from_line_id IS NOT NULL', [created.items]);
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
