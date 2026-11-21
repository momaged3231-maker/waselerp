/**
 * GAP-01 Part B verification — every financial operation must write one
 * activity_log row with a real, non-'unknown' ip_address.
 *
 * Usage: API_BASE=http://127.0.0.1:4022/api PGPORT=5462 node tools/verify-gap01-partB.js
 */
const { Client } = require('../apps/api/node_modules/pg');
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4022/api';
const PGPORT = Number(process.env.PGPORT ?? 5462);
const pgConfig = {
  host: process.env.PGHOST ?? '127.0.0.1', port: PGPORT,
  user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};
let token = '';
let checks = 0, passes = 0;
const samples = [];
function check(id, label, ok, detail) {
  checks++;
  if (ok) passes++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${id} | ${label} | ${detail}`);
  return ok;
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-branch-id': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}

(async () => {
  const db = new Client(pgConfig);
  await db.connect();

  // B1 — helper source exists (signature checked statically in report).
  const fs = require('fs');
  const auditSrc = fs.readFileSync(require('path').join(__dirname, '../apps/api/src/common/audit.ts'), 'utf8');
  check('GAP01-B1', 'common/audit.ts with required ip', /ip:\s*string/.test(auditSrc) && auditSrc.includes('ip_address'), 'audit.ts loaded');

  const login = await api('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.body.accessToken || login.body.token;
  check('GAP01-B0', 'login', login.status === 201 || login.status === 200, `status=${login.status}`);

  // --- fixtures for missing operations -------------------------------------
  const branchId = 1;
  const warehouseRes = await db.query('SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1');
  const warehouseId = Number(warehouseRes.rows[0]?.warehouse_id ?? 1);
  const itemRes = await db.query('SELECT item_id, base_unit_id FROM items ORDER BY item_id LIMIT 1');
  const itemId = Number(itemRes.rows[0].item_id);
  const unitId = Number(itemRes.rows[0].base_unit_id);

  // CN (B5) against a posted sales invoice with a GL journal.
  const parentRes = await db.query(
    `SELECT i.invoice_id, i.party_id, i.branch_id, i.warehouse_id, l.invoice_line_id, l.item_id, l.unit_id
       FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.invoice_id
      WHERE i.invoice_type = 1 AND i.status = 2 AND i.gl_journal_id IS NOT NULL AND i.party_id IS NOT NULL
      ORDER BY i.invoice_id DESC LIMIT 1`);
  if (parentRes.rows.length) {
    const p = parentRes.rows[0];
    const cn = await api('POST', '/sales/credit-notes', {
      invoiceType: 6, branchId: Number(p.branch_id) || branchId, warehouseId: Number(p.warehouse_id) || warehouseId,
      partyId: Number(p.party_id), parentInvoiceId: Number(p.invoice_id), paymentType: 2,
      notes: 'GAP01-B5 ip verification',
      lines: [{ itemId: Number(p.item_id), unitId: Number(p.unit_id), quantity: 1, parentLineId: Number(p.invoice_line_id), settleAmount: 1 }],
    });
    console.log(`[INFO] CN create status=${cn.status} ${cn.status >= 400 ? JSON.stringify(cn.body).slice(0, 250) : ''}`);
  }

  // Gift return (B6).
  const gift = await api('POST', '/sales/invoices', {
    invoiceType: 5, branchId, warehouseId, paymentType: 2, notes: 'GAP01-B6 ip verification',
    lines: [{ itemId, unitId, quantity: 1, unitPrice: 0, taxPct: 0 }],
  });
  console.log(`[INFO] gift return status=${gift.status} ${gift.status >= 400 ? JSON.stringify(gift.body).slice(0, 250) : ''}`);

  // GRN + reverse (B10) — fresh PO + GRN so the period is open.
  const supplier = await api('POST', '/parties', { name: `GAP01-B10-supplier-${Date.now()}`, partyType: 2 });
  const po = await api('POST', '/orders', {
    orderType: 2, partyId: supplier.body.partyId, warehouseId,
    lines: [{ itemId, unitId, quantity: 1, unitPrice: 10, taxPct: 0 }],
  });
  if (po.status === 201) {
    await api('POST', `/orders/${po.body.orderId}/status`, { status: 2 });
    const detail = await api('GET', `/orders/${po.body.orderId}`);
    const line = detail.body?.lines?.[0];
    if (line) {
      const grn = await api('POST', '/purchases/receipts', {
        orderId: po.body.orderId, warehouseId, receivedBy: 1, inspectedBy: 1,
        lines: [{ orderLineId: line.lineId ?? line.orderLineId, acceptedQty: 1, unitCost: 10 }],
      });
      console.log(`[INFO] GRN create status=${grn.status} ${grn.status >= 400 ? JSON.stringify(grn.body).slice(0, 250) : ''}`);
      if (grn.status === 201 || grn.body?.duplicate) {
        const rev = await api('POST', `/purchases/receipts/${grn.body.receiptId}/reverse`, {});
        console.log(`[INFO] GRN reverse status=${rev.status} ${rev.status >= 400 ? JSON.stringify(rev.body).slice(0, 250) : ''}`);
      }
    }
  }

  // Voucher payment (B8) — smoke covers receipts only.
  const cashRes = await db.query('SELECT cash_account_id FROM cash_accounts ORDER BY cash_account_id LIMIT 1');
  const cashAccountId = Number(cashRes.rows[0]?.cash_account_id ?? 1);
  const pay = await api('POST', '/accounting/vouchers', {
    voucherType: 2, partyId: supplier.body.partyId, cashAccountId, amount: 33,
    description: 'GAP01-B8 ip verification',
  });
  console.log(`[INFO] voucher payment status=${pay.status} ${pay.status >= 400 ? JSON.stringify(pay.body).slice(0, 250) : ''}`);

  // --- query activity_log rows per action ----------------------------------
  const ACTIONS = [
    ['GAP01-B2', 'invoice.post.sale', 'فاتورة بيع'],
    ['GAP01-B3', 'invoice.post.purchase', 'فاتورة شراء'],
    ['GAP01-B4', 'invoice.post.return_sale', 'مرتجع بيع'],
    ['GAP01-B5', 'invoice.post.credit_note', 'إشعار دائن'],
    ['GAP01-B6', 'invoice.post.gift_return', 'هدية عائدة'],
    ['GAP01-B7', 'voucher.receipt', 'سند قبض'],
    ['GAP01-B8', 'voucher.payment', 'سند صرف'],
    ['GAP01-B9', 'gl.journal.create', 'قيد يدوي'],
    ['GAP01-B10a', 'purchases.grn.create', 'GRN'],
    ['GAP01-B10b', 'purchases.grn.reverse', 'عكس GRN'],
    ['GAP01-B11a', 'stock.operation', 'عملية مخزون'],
    ['GAP01-B11b', 'stock.voucher.approve', 'اعتماد أذن مخزن'],
    ['GAP01-B11c', 'stock.count.approve', 'اعتماد سند جرد'],
  ];
  for (const [id, action, label] of ACTIONS) {
    const r = await db.query(
      `SELECT activity_log_id, action, entity, entity_id, ip_address, created_at
         FROM activity_log WHERE action = $1 ORDER BY activity_log_id DESC LIMIT 1`, [action]);
    const row = r.rows[0];
    const ip = row?.ip_address;
    const ok = !!row && typeof ip === 'string' && ip.trim() !== '' && ip !== 'unknown';
    check(id, label, ok, row ? `row=${row.activity_log_id} ip=${ip} entity=${row.entity}:${row.entity_id}` : 'NO ROW');
    if (row) samples.push({ id, action, activity_log_id: Number(row.activity_log_id), entity: row.entity, entity_id: row.entity_id, ip_address: ip, created_at: row.created_at });
  }

  console.log('\n--- SAMPLES (literal rows) ---');
  for (const s of samples) console.log(JSON.stringify(s));
  console.log(`\nRESULT ${passes}/${checks}`);
  await db.end();
  process.exit(passes === checks ? 0 : 1);
})().catch((e) => { console.error('ERR ' + e.stack); process.exit(1); });
