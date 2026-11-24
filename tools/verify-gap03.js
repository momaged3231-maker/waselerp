/**
 * GAP-03 verification — warranty policy enforcement + TD-56 COGS fix.
 * Usage: API_BASE=http://127.0.0.1:4032/api PGPORT=5610 node tools/verify-gap03.js
 */
const { Client } = require('../apps/api/node_modules/pg');
const { execSync } = require('child_process');
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4032/api';
const PGPORT = Number(process.env.PGPORT ?? 5610);
let token = '', cashToken = '', branchId = 1, checks = 0, passes = 0;
const samples = [];
function check(id, label, ok, detail) {
  checks++; if (ok) passes++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${id} | ${label} | ${detail}`);
}
async function api(method, path, body, tk) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (tk ?? token), 'x-branch-id': String(branchId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}
const iso = (d) => d.toISOString().slice(0, 10);
(async () => {
  const db = new Client({ host: '127.0.0.1', port: PGPORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await db.connect();
  const login = await api('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.body.accessToken || login.body.token;
  branchId = login.body.activeBranchId || 1;

  const wh = await db.query('SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1');
  const warehouseId = Number(wh.rows[0].warehouse_id);
  const unit = await db.query('SELECT unit_id FROM units ORDER BY unit_id LIMIT 1');
  const unitId = Number(unit.rows[0].unit_id);
  await db.query('UPDATE users SET is_sales_rep = true WHERE user_id = 1');
  const item = await api('POST', '/items', { code: `G03-${Date.now()}`, name: 'GAP03 part', baseUnitId: unitId, costPrice: 7, sellPrice: 10 });
  const itemId = item.body.itemId;
  await api('POST', '/inventory/operations', { operationType: 3, fromWarehouseId: warehouseId, notes: 'GAP03 stock',
    lines: [{ itemId, unitId, expectedQty: 0, actualQty: 100, unitCost: 7 }] });
  const product = await api('POST', '/maintenance/products', { name: `GAP03 product ${Date.now()}` });
  const model = await api('POST', '/maintenance/models', { productId: product.body.productId, name: 'Model', warrantyDurationDays: 365 });
  const productId = product.body.productId, modelId = model.body.modelId;
  const today = new Date(), start = iso(today), end = iso(new Date(today.getTime() + 365 * 86400000));
  const base = () => ({ customerName: 'GAP03 customer', phone: '01000000000', productId, modelId,
    productCondition: 'جيد', estimatedCost: 0, warrantyStartDate: start, warrantyEndDate: end });

  // ---- Part A: schema (01-02) --------------------------------------------
  const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='maintenance_tickets'`);
  const names = cols.rows.map((r) => r.column_name);
  const needed = ['warranty_start_date', 'warranty_end_date', 'warranty_charged', 'warranty_charge_reason'];
  const cons = await db.query(`SELECT conname FROM pg_constraint WHERE conname='ck_maintenance_tickets_warranty_dates'`);
  check('GAP03-01', 'schema columns + CHECK', needed.every((n) => names.includes(n)) && cons.rows.length === 1,
    `cols=${needed.filter((n)=>names.includes(n)).length}/4 check=${cons.rows.length}`);
  const pcols = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name='warranty_duration_days' AND table_name IN ('maintenance_products','maintenance_models')`);
  const defaultTicket = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true, warrantyRef: 'W-DUR' });
  const defRow = await db.query('SELECT warranty_start_date::text s, warranty_end_date::text e FROM maintenance_tickets WHERE ticket_id=$1', [defaultTicket.body.ticketId]);
  check('GAP03-02', 'product/model default duration copied', pcols.rows.length === 2 && !!defRow.rows[0]?.e,
    `tables=${pcols.rows.length}/2 derivedEnd=${defRow.rows[0]?.e}`);

  // ---- Part B: enforcement (03-07) ---------------------------------------
  const noRef = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true, warrantyStartDate: start, warrantyEndDate: end, warrantyRef: '' });
  check('GAP03-03', 'warranty without ref → 400', noRef.status === 400,
    `status=${noRef.status} msg=${noRef.body?.message ?? ''}`);
  const noStart = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true, warrantyRef: 'W-2', warrantyStartDate: null });
  check('GAP03-04', 'warranty without start date → 400', noStart.status === 400,
    `status=${noStart.status} msg=${noStart.body?.message ?? ''}`);
  const chargeNoPerm = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true,
    warrantyRef: 'W-3', actualCost: 50 });
  check('GAP03-05', 'warranty with actualCost>0 and not charged → 400', chargeNoPerm.status === 400,
    `status=${chargeNoPerm.status} msg=${chargeNoPerm.body?.message ?? ''}`);

  // user with maintenance.manage but WITHOUT maintenance.charge_warranty
  const stamp = Date.now();
  const roles = (await api('GET', '/admin/roles')).body;
  const cashierRole = roles.find((r) => r.nameEn === 'Cashier');
  const created = await api('POST', '/admin/users', { userName: `g03cash_${stamp}`, password: 'Test$12345',
    fullName: 'G03 cashier', defaultBranchId: branchId, roleIds: [cashierRole.roleId] });
  const perm = await db.query("SELECT permission_id FROM permissions WHERE code='maintenance.manage'");
  if (perm.rows.length) await db.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [cashierRole.roleId, perm.rows[0].permission_id]);
  const cl = await api('POST', '/auth/login', { userName: `g03cash_${stamp}`, password: 'Test$12345' });
  cashToken = cl.body.accessToken || cl.body.token;
  const forbiddenCharge = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true,
    warrantyRef: 'W-4', warrantyCharged: true, warrantyChargeReason: 'خارج الضمان' }, cashToken);
  check('GAP03-06', 'charge warranty without permission → 403', forbiddenCharge.status === 403,
    `status=${forbiddenCharge.status} msg=${forbiddenCharge.body?.message ?? ''}`);

  const charged = await api('POST', '/maintenance/tickets', { ...base(), isWarranty: true,
    warrantyRef: 'W-5', warrantyCharged: true, warrantyChargeReason: 'عطل متعمد', actualCost: 25 });
  const chRow = await db.query('SELECT warranty_charge_reason, warranty_charged FROM maintenance_tickets WHERE ticket_id=$1', [charged.body.ticketId]);
  const audit = await db.query("SELECT activity_log_id FROM activity_log WHERE action='maintenance.warranty_charge_override' AND entity_id=$1", [String(charged.body.ticketId)]);
  check('GAP03-07', 'authorized charge → 201 + reason + audit',
    charged.status === 201 && chRow.rows[0]?.warranty_charge_reason === 'عطل متعمد' && audit.rows.length === 1,
    `status=${charged.status} reason=${chRow.rows[0]?.warranty_charge_reason} auditRows=${audit.rows.length}`);

  // ---- Part C: journal (08a-08d) -----------------------------------------
  async function journalOf(ticketId) {
    const r = await db.query(`SELECT j.journal_id, j.source_type, j.description,
        COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
        FROM gl_journals j LEFT JOIN gl_entries l ON l.journal_id=j.journal_id
       WHERE j.source_type='maintenance_ticket' AND j.source_id=$1::bigint GROUP BY j.journal_id`, [ticketId]);
    return r.rows;
  }
  async function makeTicketAndInspect(warranty, withParts) {
    const body = { ...base(), isWarranty: warranty };
    if (warranty) { body.warrantyRef = `W-${Date.now()}`; }
    const t = await api('POST', '/maintenance/tickets', body);
    const id = t.body.ticketId;
    if (withParts) {
      await api('POST', `/maintenance/tickets/${id}/inspect`, { inspectionStatus: 3, engineerId: 1,
        actualCost: warranty ? 0 : 20, parts: [{ itemId, unitId, quantity: 2, unitPrice: 10 }] });
    }
    return id;
  }
  const a = await makeTicketAndInspect(true, true);
  await api('POST', `/maintenance/tickets/${a}/deliver`, { paid: 0 });
  const ja = await journalOf(a);
  const aOk = ja.length === 1 && Number(ja[0].d) === 14 && Number(ja[0].c) === 14;
  check('GAP03-08a', 'warranty + parts + no payment → COGS journal only', aOk,
    `ticket=${a} journals=${JSON.stringify(ja)}`);
  if (ja.length) samples.push({ id: '08a', ticketId: a, journal: ja[0] });

  const b = await makeTicketAndInspect(false, true);
  await api('POST', `/maintenance/tickets/${b}/deliver`, { paid: 0 });
  const jb = await journalOf(b);
  check('GAP03-08b', 'normal + parts + no payment → COGS journal (TD-56 fix)',
    jb.length === 1 && Number(jb[0].d) === 14 && Number(jb[0].c) === 14,
    `ticket=${b} journals=${JSON.stringify(jb)}`);
  if (jb.length) samples.push({ id: '08b', ticketId: b, journal: jb[0] });

  const c = await makeTicketAndInspect(false, true);
  await api('POST', `/maintenance/tickets/${c}/deliver`, { paidAmount: 20, cashAccountId: (await db.query('SELECT cash_account_id FROM cash_accounts LIMIT 1')).rows[0].cash_account_id });
  const jc = await journalOf(c);
  const cashJ = jc.filter((j) => String(j.description).includes('سداد'));
  check('GAP03-08c', 'normal + parts + payment → COGS + cash journal',
    jc.length === 2 && cashJ.length === 1 && Number(jc.find((j) => String(j.description).includes('تكلفة'))?.d ?? 0) === 14,
    `ticket=${c} journals=${JSON.stringify(jc)}`);
  if (jc.length) samples.push({ id: '08c', ticketId: c, journal: jc[0] });

  const d = await makeTicketAndInspect(true, false);
  await api('POST', `/maintenance/tickets/${d}/deliver`, { paid: 0 });
  const jd = await journalOf(d);
  check('GAP03-08d', 'warranty + no parts → no journal', jd.length === 0,
    `ticket=${d} journals=${JSON.stringify(jd)}`);

  // ---- Part D (10-11) -----------------------------------------------------
  const rep = await api('GET', `/maintenance/reports/warranty?from=${start}&to=${end}`);
  const r = rep.body;
  check('GAP03-10', 'warranty report JSON', rep.status === 200 && typeof r.count === 'number'
    && typeof r.chargedCount === 'number' && Array.isArray(r.overrides),
    `status=${rep.status} count=${r.count} charged=${r.chargedCount} uncharged=${r.unchargedCount} totalCogs=${r.totalCogs}`);
  const diff = execSync('git diff --stat -- apps/api/src/common/posting.ts', { cwd: process.cwd() }).toString().trim();
  check('GAP03-11', 'posting.ts diff = 0', diff === '', `diff='${diff}'`);

  console.log('\n=== JOURNAL SAMPLES ===');
  for (const s of samples) console.log(JSON.stringify(s));
  console.log(`\nRESULT ${passes}/${checks}`);
  await db.end();
  process.exit(passes === checks ? 0 : 1);
})().catch((e) => { console.error('ERR ' + e.stack); process.exit(1); });
