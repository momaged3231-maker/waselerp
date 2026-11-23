/**
 * GAP-01 Part C verification — exactly ONE activity_log row per operation.
 * Usage: API_BASE=http://127.0.0.1:4026/api PGPORT=5600 node tools/verify-gap01-partC.js
 */
const { Client } = require('../apps/api/node_modules/pg');
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4026/api';
const PGPORT = Number(process.env.PGPORT ?? 5600);
let token = '', checks = 0, passes = 0, branchId = 1;
function check(id, label, ok, detail) {
  checks++; if (ok) passes++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${id} | ${label} | ${detail}`);
}
async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-branch-id': String(branchId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}
async function count(db, action, entityId, extra) {
  const where = extra ?? 'action = $1::text AND entity_id = $2::text';
  const args = extra ? [String(entityId)] : [action, String(entityId)];
  const r = await db.query(`SELECT COUNT(*)::int AS c FROM activity_log WHERE ${where}`, args);
  return Number(r.rows[0].c);
}
(async () => {
  const db = new Client({ host: '127.0.0.1', port: PGPORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await db.connect();
  const login = await api('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.body.accessToken || login.body.token;
  branchId = login.body.activeBranchId || 1;

  const wh = await db.query('SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1');
  const warehouseId = Number(wh.rows[0].warehouse_id);
  let it = await db.query('SELECT item_id, base_unit_id FROM items ORDER BY item_id LIMIT 1');
  if (!it.rows.length) {
    const unit = await db.query('SELECT unit_id FROM units ORDER BY unit_id LIMIT 1');
    const created = await api('POST', '/items', {
      code: `GAP01-C-${Date.now()}`, name: 'GAP01-C test item',
      baseUnitId: Number(unit.rows[0].unit_id), costPrice: 5, sellPrice: 10, vatPct: 0,
    });
    console.log(`[INFO] item create status=${created.status} ${created.status >= 400 ? JSON.stringify(created.body).slice(0, 250) : ''}`);
    it = await db.query('SELECT item_id, base_unit_id FROM items ORDER BY item_id LIMIT 1');
  }
  const itemId = Number(it.rows[0].item_id), unitId = Number(it.rows[0].base_unit_id);
  // Seed stock so sales/returns do not trip the negative-stock guard.
  const initialStock = await api('POST', '/inventory/operations', {
    operationType: 3, fromWarehouseId: warehouseId, notes: 'GAP01-C stock seed',
    lines: [{ itemId, unitId, expectedQty: 0, actualQty: 20, unitCost: 5 }],
  });
  console.log(`[INFO] stock seed status=${initialStock.status} ${initialStock.status >= 400 ? JSON.stringify(initialStock.body).slice(0, 250) : ''}`);
  const ca = await db.query('SELECT cash_account_id FROM cash_accounts ORDER BY cash_account_id LIMIT 1');
  const cashAccountId = Number(ca.rows[0].cash_account_id);
  const party = await api('POST', '/parties', { name: `GAP01-C-${Date.now()}`, partyType: 1 });
  const partyId = party.body.partyId;
  const supplier = await api('POST', '/parties', { name: `GAP01-C-sup-${Date.now()}`, partyType: 2 });
  const saleBody = () => ({
    invoiceType: 1, branchId, warehouseId, partyId, paymentType: 1, paidAmount: 10, cashAccountId,
    lines: [{ itemId, unitId, quantity: 1, unitPrice: 10, taxPct: 0 }],
  });

  // C2 — single sale.
  const sale = await api('POST', '/sales/invoices', saleBody());
  const saleId = sale.body.invoiceId;
  let c = await count(db, 'invoice.post.sale', saleId);
  check('GAP01-C2', 'sale → 1 row', c === 1, `invoice_id=${saleId} COUNT=${c} (expected 1)`);

  // C3 — single voucher receipt.
  const voucher = await api('POST', '/accounting/vouchers', { voucherType: 1, partyId, cashAccountId, amount: 10, description: 'GAP01-C3' });
  const voucherId = voucher.body.voucherId;
  c = await count(db, 'voucher.receipt', voucherId);
  check('GAP01-C3', 'voucher.receipt → 1 row', c === 1, `voucher_id=${voucherId} COUNT=${c} (expected 1)`);

  // C4 — single GRN.
  const po = await api('POST', '/orders', { orderType: 2, partyId: supplier.body.partyId, warehouseId,
    lines: [{ itemId, unitId, quantity: 1, unitPrice: 10, taxPct: 0 }] });
  await api('POST', `/orders/${po.body.orderId}/status`, { status: 2 });
  const detail = await api('GET', `/orders/${po.body.orderId}`);
  const line = detail.body?.lines?.[0];
  const grn = await api('POST', '/purchases/receipts', { orderId: po.body.orderId, warehouseId, receivedBy: 1, inspectedBy: 1,
    lines: [{ orderLineId: line?.lineId ?? line?.orderLineId, acceptedQty: 1, unitCost: 10 }] });
  const receiptId = grn.body.receiptId;
  c = await count(db, 'purchases.grn.create', receiptId);
  check('GAP01-C4', 'GRN → 1 row', c === 1, `receipt_id=${receiptId} COUNT=${c} (expected 1)`);

  // C5 — single manual journal.
  const accts = await db.query('SELECT account_id FROM gl_accounts ORDER BY account_id LIMIT 2');
  const a1 = Number(accts.rows[0].account_id), a2 = Number(accts.rows[1].account_id);
  const journal = await api('POST', '/accounting/journals', { description: 'GAP01-C5',
    lines: [{ accountId: a1, debit: 10, credit: 0 }, { accountId: a2, debit: 0, credit: 10 }] });
  const journalId = journal.body.journalId;
  c = await count(db, 'gl.journal.create', journalId);
  check('GAP01-C5', 'journal → 1 row', c === 1, `journal_id=${journalId} COUNT=${c} (expected 1)`);

  // C6 — single stock operation.
  const stock = await api('POST', '/inventory/operations', { operationType: 3, fromWarehouseId: warehouseId, notes: 'GAP01-C6',
    lines: [{ itemId, unitId, expectedQty: 5, actualQty: 4, unitCost: 10 }] });
  const opId = stock.body.operationId ?? stock.body.stockOperationId;
  c = await count(db, undefined, opId, "entity_id = $1::text AND action IN ('stock.operation','stock.voucher.approve','stock.count.approve')");
  check('GAP01-C6', 'stock operation → 1 row', c === 1, `operation_id=${opId} COUNT=${c} (expected 1)`);

  // C7 — idempotent duplicate.
  const key = `dup-test-${Date.now()}`;
  const first = await api('POST', '/sales/invoices', { ...saleBody(), clientRequestId: key });
  const second = await api('POST', '/sales/invoices', { ...saleBody(), clientRequestId: key });
  const dupId = first.body.invoiceId;
  c = await count(db, 'invoice.post.sale', dupId);
  check('GAP01-C7', 'idempotent duplicate → 1 row', c === 1 && String(second.body.invoiceId) === String(dupId),
    `invoice_id=${dupId} status=${first.status}/${second.status} same_id=${String(second.body.invoiceId) === String(dupId)} COUNT=${c} (expected 1)`);

  // C8 — sale + edit.
  const e = await api('POST', '/sales/invoices', saleBody());
  const eId = e.body.invoiceId;
  const edited = await api('PUT', `/sales/invoices/${eId}`, { ...saleBody(), notes: 'GAP01-C8 edit' });
  const postC = await count(db, 'invoice.post.sale', eId);
  const editC = await count(db, 'invoice.edit', eId);
  const totalC = await count(db, undefined, eId, "entity_id = $1::text AND action IN ('invoice.post.sale','invoice.edit')");
  check('GAP01-C8', 'sale+edit → 2 rows', postC === 1 && editC === 1 && totalC === 2,
    `invoice_id=${eId} edit_status=${edited.status} post=${postC} edit=${editC} total=${totalC} (expected 1/1/2)`);

  // C9 — sale + cancel.
  const x = await api('POST', '/sales/invoices', saleBody());
  const xId = x.body.invoiceId;
  const cancelled = await api('POST', `/sales/invoices/${xId}/cancel`, {});
  const postC9 = await count(db, 'invoice.post.sale', xId);
  const cancelC9 = await count(db, 'invoice.cancel', xId);
  const totalC9 = await count(db, undefined, xId, "entity_id = $1::text AND action IN ('invoice.post.sale','invoice.cancel')");
  check('GAP01-C9', 'sale+cancel → 2 rows', postC9 === 1 && cancelC9 === 1 && totalC9 === 2,
    `invoice_id=${xId} cancel_status=${cancelled.status} post=${postC9} cancel=${cancelC9} total=${totalC9} (expected 1/1/2)`);

  console.log(`\nRESULT ${passes}/${checks}`);
  await db.end();
  process.exit(passes === checks ? 0 : 1);
})().catch((e) => { console.error('ERR ' + e.stack); process.exit(1); });
