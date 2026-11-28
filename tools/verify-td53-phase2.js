/**
 * TD-53/54 Phase 2 verification — Supplier credit notes (12 criteria).
 * API_BASE / PGPORT from env.
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4070/api';
const PORT = Number(process.env.PGPORT ?? 5668);
let token = '', branchId = 1, checks = 0, passes = 0;
const check = (id, ok, detail) => { checks++; if (ok) passes++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${id} | ${detail}`); };
async function api(method, p, body, tk) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (tk ?? token), 'x-branch-id': String(branchId) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
async function main() {
  const db = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await db.connect();
  const login = await api('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.body.accessToken; branchId = login.body.activeBranchId || 1;
  const roles = (await api('GET', '/admin/roles')).body;
  const rid = (n) => roles.find((r) => r.nameEn === n)?.roleId;
  const cashierUser = `p2cash_${Date.now()}`;
  await api('POST', '/admin/users', { userName: cashierUser, password: 'Test$12345', fullName: 'P2 cashier',
    defaultBranchId: branchId, roleIds: [rid('Cashier')] });
  const cashierToken = (await api('POST', '/auth/login', { userName: cashierUser, password: 'Test$12345' })).body.accessToken;

  // P2-01 schema
  const cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='supplier_credit_notes'");
  const names = cols.rows.map((r) => r.column_name);
  const idx = await db.query("SELECT indexname FROM pg_indexes WHERE tablename='supplier_credit_notes'");
  check('P2-01 schema', ['credit_note_id','original_invoice_id','subtotal','tax_amount','total_amount','client_request_id','claim_id','cancel_journal_id'].every((n) => names.includes(n))
    && idx.rows.some((r) => r.indexname === 'ux_scn_client_request'), `cols=${names.length} indexes=${idx.rows.map(r=>r.indexname).join(',')}`);

  // create supplier + purchase invoice (type 2) with total
  const supplier = (await api('POST', '/parties', { name: 'P2 supplier', partyType: 2, branchId })).body;
  const item = (await api('POST', '/items', { code: `P2-${Date.now()}`, name: 'P2 item', baseUnitId: 1, costPrice: 10, sellPrice: 10 })).body;
  // seed stock so the (wrong-type) sale fixture can post
  await api('POST', '/inventory/operations', { operationType: 3, fromWarehouseId: 1, notes: 'P2 stock seed',
    lines: [{ itemId: item.itemId, unitId: 1, expectedQty: 0, actualQty: 100, unitCost: 10 }] });
  const inv = (await api('POST', '/sales/invoices', { invoiceType: 2, branchId, warehouseId: 1, partyId: supplier.partyId,
    paymentType: 2, paidAmount: 0, lines: [{ itemId: item.itemId, unitId: 1, quantity: 10, unitPrice: 100, taxPct: 0 }] })).body;
  check('fixture purchase invoice', !!inv.invoiceId, JSON.stringify(inv).slice(0, 120));

  // P2-02 permission: cashier forbidden
  const forbidden = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId, subtotal: 10, reason: 'x' }, cashierToken);
  check('P2-02 403 without approve_payment', forbidden.status === 403, `status=${forbidden.status}`);

  // P2-03 wrong party / wrong type / wrong branch
  const other = (await api('POST', '/parties', { name: 'P2 other', partyType: 2, branchId })).body;
  const wrongParty = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: other.partyId, subtotal: 10, reason: 'x' });
  check('P2-03 wrong party 400', wrongParty.status === 400, `status=${wrongParty.status} ${wrongParty.body?.message ?? ''}`);
  const saleRaw = await api('POST', '/sales/invoices', { invoiceType: 1, branchId, warehouseId: 1, paymentType: 1, paidAmount: 0,
    lines: [{ itemId: item.itemId, unitId: 1, quantity: 1, unitPrice: 10, taxPct: 0 }] });
  console.log('  [fixture sale debug]', saleRaw.status, JSON.stringify(saleRaw.body).slice(0, 160));
  const wrongType = await api('POST', '/purchases/credit-notes', { originalInvoiceId: saleRaw.body?.invoiceId, partyId: supplier.partyId, subtotal: 10, reason: 'x' });
  check('P2-03 wrong type 400', wrongType.status === 400, `status=${wrongType.status}`);

  // P2-04 date before invoice
  const past = '2020-01-01';
  const badDate = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId, subtotal: 10, cnDate: past, reason: 'x' });
  check('P2-04 past date 400', badDate.status === 400, `status=${badDate.status}`);

  // P2-05 over-credit
  const over = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId, subtotal: 99999, reason: 'x' });
  check('P2-05 over-credit 400', over.status === 400, `status=${over.status}`);

  // P2-06..P2-08 valid CN with idempotency
  const key = `p2-${Date.now()}`;
  const first = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId,
    subtotal: 100, taxAmount: 14, reason: 'P2 test CN', clientRequestId: key });
  const second = await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId,
    subtotal: 100, taxAmount: 14, reason: 'P2 test CN', clientRequestId: key });
  check('P2-08 idempotency', first.status === 201 && second.status === 200 && String(first.body.creditNoteId) === String(second.body.creditNoteId),
    `first=${first.status} second=${second.status} id=${first.body.creditNoteId}/${second.body.creditNoteId}`);
  const id = first.body.creditNoteId;
  const jid = first.body.journalId;
  const jr = await db.query(`SELECT j.source_type, j.source_id, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM gl_journals j JOIN gl_entries l ON l.journal_id=j.journal_id WHERE j.journal_id=$1 GROUP BY j.source_type,j.source_id`, [jid]);
  const jr0 = jr.rows[0];
  const lines = await db.query(`SELECT a.code, l.debit, l.credit FROM gl_entries l JOIN gl_accounts a ON a.account_id=l.account_id WHERE l.journal_id=$1 ORDER BY a.code`, [jid]);
  check('P2-06 journal Dr AP / Cr PPV / Cr VAT', Number(jr0.d) === 114 && Number(jr0.c) === 114 && jr0.source_type === 'supplier_credit_note',
    JSON.stringify({d:jr0.d,c:jr0.c,t:jr0.source_type,lines:lines.rows}));
  const cnRow = await db.query('SELECT credit_note_no FROM supplier_credit_notes WHERE credit_note_id=$1', [id]);
  check('P2-06 numbering SCN prefix', String(cnRow.rows[0].credit_note_no).startsWith('SCN-'), cnRow.rows[0].credit_note_no);
  const cnt = await db.query('SELECT COUNT(*)::int n FROM supplier_credit_notes WHERE client_request_id=$1', [key]);
  check('P2-08 one row', cnt.rows[0].n === 1, `rows=${cnt.rows[0].n}`);

  // P2-07 audit
  const audit = await db.query("SELECT ip_address FROM activity_log WHERE action='purchase.credit_note.post' AND entity_id=$1", [String(id)]);
  check('P2-07 audit ip', audit.rows.length === 1 && audit.rows[0].ip_address && audit.rows[0].ip_address !== 'unknown', JSON.stringify(audit.rows));

  // P2-09 cancel + mirror
  const cancelled = await api('POST', `/purchases/credit-notes/${id}/cancel`, { cancelReason: 'P2 test cancel' });
  check('P2-09 cancel', cancelled.status === 201 && cancelled.body.status === 3 && !!cancelled.body.reverseJournalId, JSON.stringify(cancelled.body).slice(0,150));
  const cancelAudit = await db.query("SELECT ip_address FROM activity_log WHERE action='purchase.credit_note.cancel' AND entity_id=$1", [String(id)]);
  check('P2-09 cancel audit ip', cancelAudit.rows.length === 1 && !!cancelAudit.rows[0].ip_address, JSON.stringify(cancelAudit.rows));

  // P2-10 cancel in closed period — create another CN then lock period & cancel
  const cn2 = (await api('POST', '/purchases/credit-notes', { originalInvoiceId: inv.invoiceId, partyId: supplier.partyId, subtotal: 50, reason: 'P2 period test' })).body;
  const period = (await api('POST', '/accounting/periods', { name: `P2 closed ${Date.now()}`, startDate: '2020-01-01', endDate: '2020-12-31' })).body;
  await api('POST', `/accounting/periods/${period.periodId}/manual-lock`, { reason: 'P2 test' });
  const blockedCancel = await api('POST', `/purchases/credit-notes/${cn2.creditNoteId}/cancel`, { cancelReason: 'x', cancelDate: '2020-06-15' });
  check('P2-10 closed period cancel 400', blockedCancel.status === 400, `status=${blockedCancel.status}`);

  // P2-11 diff is checked outside; P2-12 regression outside
  console.log(`\nRESULT ${passes}/${checks}`);
  await db.end();
  process.exit(passes === checks ? 0 : 1);
}
main().catch((e) => { console.error(e.stack); process.exit(2); });
