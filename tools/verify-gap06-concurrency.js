/*
 * GAP06-11 / GAP06-12 — concurrency safety (GRN + vouchers)
 *   API_BASE=http://127.0.0.1:4016/api PGPORT=5456 PGDATABASE=postgres node tools/verify-gap06-concurrency.js
 */
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4016/api';
const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5456),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

let token = '';
let branchId = 1;
let db;
const results = [];
const record = (id, ok, expected, actual, title) => { results.push({ id, ok }); console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${id} — ${title}`); console.log(`  expected: ${JSON.stringify(expected)}`); console.log(`  actual:   ${JSON.stringify(actual)}`); return ok; };
const sub = (label, expected, actual, ok) => console.log(`  · ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)} ${ok ? 'OK' : '<<< MISMATCH'}`);

async function raw(method, url, body) {
  const headers = { 'Content-Type': 'application/json', 'x-branch-id': String(branchId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, ok: r.ok, data };
}
async function call(method, url, body) { const r = await raw(method, url, body); if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(r.data)}`); return r.data; }
async function login(u,p){ const r=await raw('POST','/auth/login',{userName:u,password:p}); if(!r.ok) throw new Error(`login ${r.status}`); return r.data; }
async function one(sql, params=[]) { return (await db.query(sql, params)).rows[0] ?? null; }
async function qall(sql, params=[]) { return (await db.query(sql, params)).rows; }
const uid = () => crypto.randomUUID();

(async () => {
  db = new Client(DB); await db.connect();
  const admin = await login('admin','admin123');
  token = admin.accessToken || admin.token;
  branchId = admin.activeBranchId || admin.user?.defaultBranchId || (admin.branches?.[0]?.branchId || admin.branches?.[0]?.branch_id) || 1;
  console.log(`[setup] branch=${branchId}`);

  const wh = await one(`SELECT warehouse_id AS id FROM warehouses WHERE branch_id=$1 ORDER BY warehouse_id LIMIT 1`, [branchId]) || await one(`SELECT warehouse_id AS id FROM warehouses ORDER BY warehouse_id LIMIT 1`);
  const warehouseId = Number(wh.id);
  const ca = await one(`SELECT cash_account_id AS id FROM cash_accounts WHERE branch_id=$1 ORDER BY cash_account_id LIMIT 1`, [branchId]) || await one(`SELECT cash_account_id AS id FROM cash_accounts ORDER BY cash_account_id LIMIT 1`);
  const cashAccountId = ca ? Number(ca.id) : null;

  // ================= GAP06-11: GRN concurrency =================
  {
    const supp = await call('POST','/parties',{ name:`Supp-GRNConc-${Date.now()}`, partyType:2 });
    const supplierId = Number(supp.partyId ?? supp.party_id);
    const item = await call('POST','/items',{ code:`GC-${Date.now()}`, name:`Item-GRNConc-${Date.now()}`, baseUnitId:1, sellPrice:100, costPrice:50, isActive:true });
    const itemId = Number(item.itemId ?? item.item_id);

    const po = await call('POST','/orders',{ orderType:2, partyId:supplierId, warehouseId, lines:[{ itemId, unitId:1, quantity:10, unitPrice:50, taxPct:0 }], notes:'GAP06-11 PO' });
    const poId = Number(po.orderId ?? po.order_id);
    await call('POST', `/orders/${poId}/status`, { status: 2 });
    const poDetail = await call('GET', `/orders/${poId}`);
    const orderLineId = Number((poDetail.lines||[])[0].lineId ?? (poDetail.lines||[])[0].order_line_id ?? (poDetail.lines||[])[0].line_id);

    const key = 'grn-conc-1-' + uid();
    const payload = { clientRequestId: key, orderId: poId, warehouseId, receivedBy: 1, inspectedBy: 1, lines:[{ orderLineId, acceptedQty: 10, unitCost: 50 }], notes:'GAP06-11' };
    const [a,b] = await Promise.all([ raw('POST','/purchases/receipts', payload), raw('POST','/purchases/receipts', payload) ]);
    const statuses = [a.status,b.status].sort((x,y)=>x-y);
    const ids = [a.data?.receiptId, b.data?.receiptId].filter(v=>v!=null);
    const sameId = ids.length===2 && ids[0]===ids[1];
    const receiptId = ids[0];
    const receiptRows = await qall(`SELECT receipt_id FROM purchase_receipts WHERE client_request_id=$1`, [key]);
    const stockMoves = receiptId ? await qall(`SELECT stock_movement_id, quantity, move_type, reference_type, reference_id FROM stock_movements WHERE reference_type=1 AND reference_id=$1::bigint`, [receiptId]) : [];
    const journal = receiptId ? await one(`SELECT gl_journal_id AS journal_id FROM purchase_receipts WHERE receipt_id=$1::bigint`, [receiptId]) : null;
    const journalId = journal ? Number(journal.journal_id) : null;
    const journalBySrc = await one(`SELECT journal_id FROM gl_journals WHERE source_type='grn' AND source_id=$1::bigint`, [receiptId||0]);
    const jid = journalId || (journalBySrc ? Number(journalBySrc.journal_id) : 0);
    const glBySrc = jid ? await qall(`SELECT entry_id, debit, credit FROM gl_entries WHERE journal_id=$1::bigint`, [jid]) : [];
    const pol = await one(`SELECT delivered_qty, quantity FROM order_lines WHERE order_line_id=$1::bigint`, [orderLineId]);

    const receivedQty = Number(pol?.delivered_qty ?? pol?.received_qty ?? 0);
    const ok = statuses[0]===200 && statuses[1]===201 && sameId && receiptRows.length===1 && stockMoves.length===1 && glBySrc.length===2 && Math.abs(receivedQty-10)<0.000001;
    sub('statuses(sorted)', [200,201], statuses, statuses[0]===200 && statuses[1]===201);
    sub('same receiptId', ids[0], ids[1], sameId);
    sub('purchase_receipts rows', 1, receiptRows.length, receiptRows.length===1);
    sub('stock_movements for GRN', 1, stockMoves.length, stockMoves.length===1);
    sub('gl_entries for GRN journal (pair)', 2, glBySrc.length, glBySrc.length===2);
    sub('purchase_order_lines.received_qty (delivered_qty)', 10, receivedQty, Math.abs(receivedQty-10)<0.000001);
    console.log(`  detail: stockMoves=${JSON.stringify(stockMoves)} glEntries=${JSON.stringify(glBySrc)} journalId=${jid} pol=${JSON.stringify(pol)}`);
    record('GAP06-11', ok, '201+200,1 row,1 stock mv,2 gl entries,received_qty=10', { a:{s:a.status,id:a.data?.receiptId,err:a.ok?null:a.data}, b:{s:b.status,id:b.data?.receiptId,dup:a.status===200?a.data?.duplicate:b.data?.duplicate,err:b.ok?null:b.data}, receiptRows:receiptRows.length, stockMoves:stockMoves.length, glEntries:glBySrc.length, receivedQty, journalId: jid }, 'GRN concurrency: 2 simultaneous same clientRequestId');
  }

  // ================= GAP06-12: Voucher concurrency =================
  {
    const cust = await call('POST','/parties',{ name:`Cust-VchConc-${Date.now()}`, partyType:1 });
    const customerId = Number(cust.partyId ?? cust.party_id);
    const key = 'vch-conc-1-' + uid();
    const payload = { voucherType: 1, partyId: customerId, cashAccountId, amount: 50, description: 'GAP06-12', clientRequestId: key };
    // baseline ledger entries for this party (to compute N delta) - none expected but be precise
    const beforeLed = await one(`SELECT COUNT(*)::int c FROM ledger_entries WHERE party_id=$1::int`, [customerId]);
    const [a,b] = await Promise.all([ raw('POST','/accounting/vouchers', payload), raw('POST','/accounting/vouchers', payload) ]);
    const statuses = [a.status,b.status].sort((x,y)=>x-y);
    const ids = [a.data?.voucherId, b.data?.voucherId].filter(v=>v!=null);
    const sameId = ids.length===2 && ids[0]===ids[1];
    const voucherId = ids[0];
    const vRows = await qall(`SELECT voucher_id, journal_id FROM vouchers WHERE client_request_id=$1`, [key]);
    const journalId = vRows[0] ? Number(vRows[0].journal_id) : null;
    const journalCountForVoucher = journalId ? await one(`SELECT COUNT(*)::int c FROM gl_journals WHERE journal_id=$1::bigint`, [journalId]) : { c: 0 };
    const glEntries = journalId ? await qall(`SELECT entry_id, debit, credit FROM gl_entries WHERE journal_id=$1::bigint`, [journalId]) : [];
    const afterLed = await one(`SELECT COUNT(*)::int c FROM ledger_entries WHERE party_id=$1::int`, [customerId]);
    const ledDelta = Number(afterLed.c) - Number(beforeLed.c);
    const voucherNo = vRows[0] ? (await one(`SELECT voucher_no FROM vouchers WHERE voucher_id=$1::bigint`, [voucherId]))?.voucher_no : null;
    const cashTxByRef = voucherNo ? await qall(`SELECT cash_transaction_id FROM cash_transactions WHERE description LIKE $1`, [`%${voucherNo}%`]) : [];

    const journalCountOk = Number(journalCountForVoucher.c) === 1;
    const ok = statuses[0]===200 && statuses[1]===201 && sameId && vRows.length===1 && journalCountOk && glEntries.length===2 && ledDelta===1;
    sub('statuses(sorted)', [200,201], statuses, statuses[0]===200 && statuses[1]===201);
    sub('same voucherId', ids[0], ids[1], sameId);
    sub('vouchers rows', 1, vRows.length, vRows.length===1);
    sub('journal count (voucher.journal_id)', 1, Number(journalCountForVoucher.c), journalCountOk);
    sub('gl_entries for voucher journal (pair)', 2, glEntries.length, glEntries.length===2);
    sub('ledger_entries delta (N)', 1, ledDelta, ledDelta===1);
    console.log(`  detail: voucherId=${voucherId} voucherNo=${voucherNo} journalId=${journalId} journalCountForVoucher=${JSON.stringify(journalCountForVoucher)} glEntries=${JSON.stringify(glEntries)} cashTx=${cashTxByRef.length}`);
    record('GAP06-12', ok, '201+200,1 voucher,1 journal,2 gl entries,1 ledger entry', { a:{s:a.status,id:a.data?.voucherId,dup:a.status===200?a.data?.duplicate:null,err:a.ok?null:a.data}, b:{s:b.status,id:b.data?.voucherId,dup:b.status===200?b.data?.duplicate:null,err:b.ok?null:b.data}, vRows:vRows.length, journalId, journalCount:Number(journalCountForVoucher.c), glEntries:glEntries.length, ledDelta, cashTx:cashTxByRef.length }, 'Voucher concurrency: 2 simultaneous same clientRequestId');
  }

  const pass = results.filter(r=>r.ok).length; const fail = results.filter(r=>!r.ok).length;
  console.log(`\nTOTAL: ${pass} PASS, ${fail} FAIL, ${results.length} checks`);
  if (fail>0) process.exitCode = 1;
  await db.end();
})().catch(async e=>{ console.error('[fatal]', e); try{ if(db) await db.end(); }catch{} process.exit(1); });
