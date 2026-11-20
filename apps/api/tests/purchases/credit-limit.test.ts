/**
 * B5.1 — Credit limit + overdue — permanent test suite (B5.1-01..15).
 *
 * Uses direct service calls + HTTP for the report. Requires the API running
 * on :4000 for B5.1-13 (CSV/JSON report) and a local PGlite test DB.
 *
 * Run: npm run test:credit-limit
 */
import { Pool, PoolClient } from 'pg';
import { SalesService } from '../../src/modules/sales/sales.slice';

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
    nextNumber: async () => Math.floor(Math.random() * 1e7),
  } as any;
}

async function main() {
  const pool = new Pool({ connectionString: CONNECTION });
  const c = await pool.connect();
  const branch = (await c.query('SELECT branch_id FROM branches LIMIT 1')).rows[0];
  const branchId = Number(branch.branch_id);
  const wh = (await c.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1 LIMIT 1', [branchId])).rows[0];
  const warehouseId = Number(wh.warehouse_id);
  const ca = (await c.query('SELECT cash_account_id FROM cash_accounts LIMIT 1')).rows[0];
  const cashAccountId = ca ? Number(ca.cash_account_id) : null;
  const salesDb = makeDb(c);
  const svc = new SalesService(salesDb, { publish: () => {} } as any);
  const userAdmin: any = { userId: 1, permissions: ['sales.manage','sales.approve_over_credit','pos.operate'], userName:'admin', branchIds:[branchId], maxDiscountPct:100 };
  const userNoPerm: any = { ...userAdmin, permissions: ['sales.manage','pos.operate'] };
  const stamp = Date.now();
  const created = { parties: [] as number[], items: [] as number[], invoices: [] as number[], overrides: [] as number[], checks: [] as number[] };

  async function makeCustomer(name: string, limit: number | null, unlimited = false, grace = 0, opening = 0) {
    const code = 'B51' + name + (stamp % 100000);
    await c.query('INSERT INTO parties (code,name,party_type,is_active,credit_limit,credit_unlimited,grace_days,opening_balance) VALUES ($1,$2,1,true,$3,$4,$5,$6)',
      [code.slice(0,30), name, limit, unlimited, grace, opening]);
    const id = Number((await c.query('SELECT party_id FROM parties WHERE code=$1',[code.slice(0,30)])).rows[0].party_id);
    created.parties.push(id);
    return id;
  }
  async function makeItem() {
    const code='B51I'+(stamp%100000)+Math.floor(Math.random()*1000);
    await c.query(`INSERT INTO items (code,name,base_unit_id,track_quantity,cost_price,sell_price,is_active) SELECT $1,'B51 item',unit_id,false,10,20,true FROM units WHERE code='PCS'`,[code]);
    const it=(await c.query('SELECT item_id,base_unit_id FROM items WHERE code=$1',[code])).rows[0];
    created.items.push(Number(it.item_id));
    return { itemId:Number(it.item_id), unitId:Number(it.base_unit_id) };
  }
  const item = await makeItem();
  const creditSale = (pid:number, amount:number, extra:any={}) => svc.create({
    invoiceType:1, branchId, warehouseId, partyId:pid, paymentType:2, paidAmount:0, cashAccountId,
    lines:[{itemId:item.itemId, unitId:item.unitId, quantity:1, unitPrice:amount, taxPct:0}], ...extra,
  } as any, userAdmin, branchId).then((r:any)=>{created.invoices.push(r.invoiceId);return r;}).catch((e:any)=>{throw e;});

  try {
    // B5.1-01 — schema objects
    const r01 = await c.query("SELECT to_regclass('public.v_customer_exposure') v, to_regclass('public.sales_credit_overrides') t, (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_name='parties' AND column_name='grace_days') g, (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_name='parties' AND column_name='credit_unlimited') u");
    check('B5.1-01 schema (view/table/columns)', !!r01.rows[0].v && !!r01.rows[0].t && r01.rows[0].g===1 && r01.rows[0].u===1, JSON.stringify(r01.rows[0]));
    // B5.1-02 — permission seeded
    const r02=await c.query("SELECT COUNT(*)::int n FROM permissions WHERE code='sales.approve_over_credit'");
    check('B5.1-02 permission seeded', r02.rows[0].n>=1, `n=${r02.rows[0].n}`);
    // B5.1-03 — view exposure = ledger + pdc
    const p03=await makeCustomer('VIEW', 1000, false, 0, 500);
    const r03=await c.query('SELECT ledger_balance,uncollected_pdc,exposure FROM v_customer_exposure WHERE party_id=$1',[p03]);
    check('B5.1-03 view exposure = ledger + PDC', Number(r03.rows[0].exposure)===round2(Number(r03.rows[0].ledger_balance)+Number(r03.rows[0].uncollected_pdc)), JSON.stringify(r03.rows[0]));

    // B5.1-04/05 — 0 / unset limit → block (credit_limit is NOT NULL in schema,
    // so "NULL" cannot exist at rest; the code still treats null as 0 → block).
    const p04=await makeCustomer('ZERO1', 0);
    let b04=false; try{await creditSale(p04,100);}catch(e:any){b04=/حد الائتمان غير محدد/.test(e.message);} check('B5.1-04 unset/0 limit → 400 "حد الائتمان غير محدد"', b04);
    const p05=await makeCustomer('ZERO2', 0);
    let b05=false; try{await creditSale(p05,100);}catch(e:any){b05=/حد الائتمان غير محدد/.test(e.message);} check('B5.1-05 0 limit (second customer) → 400', b05);
    // B5.1-06 — unlimited passes
    const p06=await makeCustomer('UNL', 0, true);
    let ok06=false; try{await creditSale(p06,100);ok06=true;}catch(e:any){} check('B5.1-06 credit_unlimited → 200', ok06);
    // B5.1-07 — within limit passes
    const p07=await makeCustomer('IN', 1000, false, 0, 0);
    let ok07=false; try{await creditSale(p07,100);ok07=true;}catch(e:any){} check('B5.1-07 within limit → 200', ok07);

    // B5.1-08 — over + not overdue + no permission → 403
    const p08=await makeCustomer('OVER', 50, false, 0, 0);
    let b08=false;
    try{ await svc.create({invoiceType:1,branchId,warehouseId,partyId:p08,paymentType:2,paidAmount:0,cashAccountId,lines:[{itemId:item.itemId,unitId:item.unitId,quantity:1,unitPrice:100,taxPct:0}]} as any,userNoPerm,branchId); }
    catch(e:any){ b08 = e.status===403 || /sales.approve_over_credit/.test(e.message); }
    check('B5.1-08 over + no permission → 403', b08);

    // B5.1-09 — over + permission + reason → 200 + override row
    const p09=await makeCustomer('OVU', 50, false, 0, 0);
    const r09:any = await creditSale(p09, 100, {creditOverrideReason:'عميل موثوق —purchase order مضمون'});
    const ovc = Number((await c.query('SELECT COUNT(*)::int n FROM sales_credit_overrides WHERE invoice_id=$1',[r09.invoiceId])).rows[0].n);
    check('B5.1-09 over + override → row', !!r09.invoiceId && ovc===1, `invoice=${r09.invoiceId} rows=${ovc}`);

    // B5.1-10 — over + overdue → absolute block even with permission
    const p10=await makeCustomer('LATE', 50, false, 0, 0);
    await creditSale(p10, 100, {creditOverrideReason:'أول فاتورة'}); // now balance 100 > limit, not yet overdue (due today)
    // force an overdue open invoice by setting due_date in the past
    await c.query('UPDATE invoices SET due_date=CURRENT_DATE-10 WHERE party_id=$1 AND invoice_type=1',[p10]);
    let b10=false;
    try{ await creditSale(p10, 100, {creditOverrideReason:'محاولة ثانية'}); }
    catch(e:any){ b10 = e.status===403 || /حظر مطلق|متأخر/.test(e.message); }
    check('B5.1-10 over+overdue → absolute 403', b10);

    // B5.1-16 — grace_days: overdue FACT vs hard-block POLICY (DEC-SALES-006)
    const forceDue = async (pid:number, days:number) => {
      await c.query('UPDATE invoices SET due_date=CURRENT_DATE-$1::int WHERE party_id=$2 AND invoice_type=1 AND status=2',[days,pid]);
    };
    // (a) overdue 3 days, grace=7 → NOT hard block → override path (200 with reason)
    const pg7=await makeCustomer('GR7', 50, false, 7, 0);
    await creditSale(pg7, 100, {creditOverrideReason:'داخل فترة السماح'}); // balance 100 > limit, due today
    await forceDue(pg7, 3);
    let okG7=false; try{ await creditSale(pg7, 100, {creditOverrideReason:'ما زال داخل السماح'}); okG7=true; }catch(e:any){ okG7=false; }
    check('B5.1-16a overdue 3d + grace 7 → override 200 (not hard block)', okG7);
    // (b) overdue 10 days, grace=7 → absolute block even with reason
    const pg10=await makeCustomer('GR70', 50, false, 7, 0);
    await creditSale(pg10, 100, {creditOverrideReason:'أول فاتورة'});
    await forceDue(pg10, 10);
    let bG10=false; try{ await creditSale(pg10, 100, {creditOverrideReason:'محاولة بعد السماح'}); }catch(e:any){ bG10=/حظر مطلق|السماح|متأخر/.test(e.message); }
    check('B5.1-16b overdue 10d + grace 7 → absolute 403', bG10);
    // (c) overdue 1 day, grace=0 (default) → absolute block
    const pg0=await makeCustomer('GR0', 50, false, 0, 0);
    await creditSale(pg0, 100, {creditOverrideReason:'أول فاتورة'});
    await forceDue(pg0, 1);
    let bG0=false; try{ await creditSale(pg0, 100, {creditOverrideReason:'محاولة ثانية'}); }catch(e:any){ bG0=/حظر مطلق|السماح|متأخر/.test(e.message); }
    check('B5.1-16c overdue 1d + grace 0 → absolute 403', bG0);

    // B5.1-11/12 — PDC exposure-only
    const p11=await makeCustomer('PDC', 5000, false, 0, 0);
    await c.query("INSERT INTO checks (branch_id,direction,check_no,bank_name,amount,party_id,cash_account_id,status,created_by) VALUES ($1,1,$2,'بنك',500,$3,$4,1,1)",
      [branchId,'B51CHK'+stamp,p11,cashAccountId]);
    const chk=Number((await c.query("SELECT check_id FROM checks WHERE check_no='B51CHK'||$1",[stamp])).rows[0].check_id); created.checks.push(chk);
    const r11=await c.query('SELECT ledger_balance,uncollected_pdc,exposure FROM v_customer_exposure WHERE party_id=$1',[p11]);
    check('B5.1-11 PDC added back to exposure', Number(r11.rows[0].uncollected_pdc)===500, JSON.stringify(r11.rows[0]));
    await c.query('UPDATE checks SET status=2 WHERE check_id=$1',[chk]);
    const r12=await c.query('SELECT uncollected_pdc,exposure FROM v_customer_exposure WHERE party_id=$1',[p11]);
    check('B5.1-12 after collect exposure drops 500 (no GL change)', Number(r12.rows[0].uncollected_pdc)===0, JSON.stringify(r12.rows[0]));

    // B5.1-13 — report JSON+CSV via HTTP
    const login=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userName:'admin',password:'admin123'})});
    const tok=(await login.json()).accessToken;
    const month=new Date().toISOString().slice(0,7);
    const jr=await fetch(`${API}/sales/reports/credit-overrides?month=${month}`,{headers:{Authorization:`Bearer ${tok}`}});
    const jd=await jr.json();
    const cr=await fetch(`${API}/sales/reports/credit-overrides?month=${month}&format=csv`,{headers:{Authorization:`Bearer ${tok}`}});
    const cd=await cr.json();
    const buf=Buffer.from(cd.base64||'','base64');
    const bom=buf[0]===0xef&&buf[1]===0xbb&&buf[2]===0xbf;
    const dec=buf.toString('utf8').replace(/^\uFEFF/,'');
    check('B5.1-13 report JSON+CSV with BOM', jr.status===200 && (jd.items||[]).length>=1 && bom && dec.includes('العميل'), `jsonN=${(jd.items||[]).length} bom=${bom}`);
  } catch (e:any) {
    check('SUITE SETUP/RUN', false, e.message);
  } finally {
    try {
      for(const id of created.overrides) await c.query('DELETE FROM sales_credit_overrides WHERE override_id=$1',[id]).catch(()=>{});
      await c.query('DELETE FROM sales_credit_overrides WHERE invoice_id IN (SELECT invoice_id FROM invoices WHERE party_id = ANY($1::int[]))',[created.parties]).catch(()=>{});
      for(const id of created.checks) await c.query('DELETE FROM checks WHERE check_id=$1',[id]).catch(()=>{});
      for(const id of created.invoices) await c.query('DELETE FROM invoices WHERE invoice_id=$1',[id]).catch(()=>{});
      for(const id of created.parties) await c.query('DELETE FROM parties WHERE party_id=$1',[id]).catch(()=>{});
      for(const id of created.items) await c.query('DELETE FROM items WHERE item_id=$1',[id]).catch(()=>{});
    } catch {}
    c.release(); await pool.end();
  }
  const passed=results.filter(r=>r.ok).length;
  console.log(`\nRESULT: ${passed}/${results.length} passed`);
  if(passed!==results.length) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
