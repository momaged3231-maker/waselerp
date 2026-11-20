/*
 * GAP-07 — Backup/Restore verification (GAP07-01..08 core + evidence for 09)
 *
 *   API_BASE=http://127.0.0.1:4006/api PGPORT=5441 PGDATABASE=wasel node tools/verify-gap07.js
 *
 * Expects a migrated+seeded DB and running API (dist). Prints literal expected/actual.
 * GAP07-09 regression (B1..B5.4 + GL-10 ref 5434 + smoke 606/606) is run separately and
 * summarized in GAP07-report.md.
 */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4006/api';
const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5441),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'wasel',
};

const results = [];
let adminToken = '';
let cashierToken = '';
let branchId = 1;
let db;

function record(id, title, expected, actual, pass) {
  results.push({ id, title, expected, actual, pass });
  console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${id} — ${title}`);
  console.log(`        expected: ${JSON.stringify(expected)}`);
  console.log(`        actual:   ${JSON.stringify(actual)}`);
  return pass;
}
function sub(label, expected, actual, pass) {
  console.log(`        · ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)} ${pass ? 'OK' : '<<< MISMATCH'}`);
  return pass;
}
const is2xx = (s) => s >= 200 && s < 300;

async function raw(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json', 'x-branch-id': String(branchId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}
async function login(userName, password) {
  const r = await raw('POST', '/auth/login', { userName, password }, null);
  if (!r.ok) throw new Error(`login ${userName} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function one(sql, params = []) { return (await db.query(sql, params)).rows[0] ?? null; }
async function qall(sql, params = []) { return (await db.query(sql, params)).rows; }
async function qcount(table) { return Number((await one(`SELECT COUNT(*)::int AS c FROM "${table}"`)).c); }

async function snapshotCounts(tables) {
  const out = {};
  for (const t of tables) out[t] = await qcount(t);
  return out;
}

async function getTB(token) {
  const r = await raw('GET', '/accounting/reports/trial-balance', undefined, token);
  if (!r.ok) throw new Error(`TB failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

(async () => {
  db = new Client(DB);
  await db.connect();
  const admin = await login('admin', 'admin123');
  adminToken = admin.accessToken;
  branchId = admin.user.defaultBranchId || (admin.branches && admin.branches[0] && admin.branches[0].branchId) || 1;
  console.log(`[setup] admin=${admin.user.userId} branch=${branchId}`);

  // Create cashier user (no admin.restore_backup) for 403 test
  const suffix = Date.now();
  const cashierUser = await raw('POST', '/admin/users', {
    userName: `cashier_gap07_${suffix}`,
    fullName: 'Cashier GAP07',
    password: 'Test$12345',
    roles: ['Cashier'],
    branches: [branchId],
  }, adminToken);
  if (!is2xx(cashierUser.status)) {
    console.log(`[warn] create cashier via API failed ${cashierUser.status} ${JSON.stringify(cashierUser.data)} — will try SQL fallback`);
  }
  const cashierLogin = await login(`cashier_gap07_${suffix}`, 'Test$12345');
  cashierToken = cashierLogin.accessToken;
  console.log(`[setup] cashier=${cashierLogin.user.userId} perms.restore=${(cashierLogin.permissions||[]).includes('admin.restore_backup')}`);

  // ========== Create round-trip data: sale invoice + purchase invoice + payment (voucher) + balanced journals ==========
  const wh = await one(`SELECT warehouse_id AS id FROM warehouses ORDER BY warehouse_id LIMIT 1`);
  const warehouseId = wh ? Number(wh.id) : 1;
  const acc1 = await one(`SELECT account_id AS id, code FROM gl_accounts WHERE is_group=false ORDER BY code LIMIT 1 OFFSET 0`);
  const acc2 = await one(`SELECT account_id AS id, code FROM gl_accounts WHERE is_group=false ORDER BY code LIMIT 1 OFFSET 1`);
  if (!acc1 || !acc2) throw new Error('need >=2 leaf accounts');
  const adminId = Number(admin.user.userId);
  const cashAcc = await one(`SELECT cash_account_id AS id FROM cash_accounts ORDER BY cash_account_id LIMIT 1`);
  const cashAccountId = cashAcc ? Number(cashAcc.id) : null;

  // Insert 2 invoices (sale type=1, purchase type=2)
  const inv1 = await one(`INSERT INTO invoices (invoice_no, invoice_type, branch_id, warehouse_id, invoice_date, status, payment_type, sub_total, discount_amount, discount_pct, tax_amount, total_amount, paid_amount, cost_total, profit_amount, created_by, is_posted)
    VALUES ($1,'1',$2::int,$3::int,now(),2,1,100,0,0,0,100,100,0,0,$4::int,true) RETURNING invoice_id`, [`S-GAP07-${suffix}`, branchId, warehouseId, adminId]);
  const inv2 = await one(`INSERT INTO invoices (invoice_no, invoice_type, branch_id, warehouse_id, invoice_date, status, payment_type, sub_total, discount_amount, discount_pct, tax_amount, total_amount, paid_amount, cost_total, profit_amount, created_by, is_posted)
    VALUES ($1,'2',$2::int,$3::int,now(),2,1,200,0,0,0,200,200,0,0,$4::int,true) RETURNING invoice_no, invoice_id`, [`P-GAP07-${suffix}`, branchId, warehouseId, adminId]);
  // 1 payment voucher (سداد)
  let vchId = null;
  try {
    const vch = await one(`INSERT INTO vouchers (voucher_no, voucher_type, voucher_date, branch_id, cash_account_id, payment_method, amount, description, created_by, status)
      VALUES ($1,1,CURRENT_DATE,$2::int,$3::int,1,100,'سداد GAP07',$4::int,2) RETURNING voucher_id`,
      [`V-GAP07-${suffix}`, branchId, cashAccountId, adminId]);
    vchId = vch ? Number(vch.voucher_id) : null;
  } catch (e) {
    console.log(`[warn] voucher insert failed (${e.message}) — continuing with invoices+journals only`);
  }

  // 3 balanced journals, 2 entries each (Dr=Cr)
  async function addBalancedJournal(tag, amt) {
    const j = await one(`INSERT INTO gl_journals (journal_no, journal_date, journal_type, branch_id, description, status, created_by)
      VALUES ($1,CURRENT_DATE,1,$2::int,$3,2,$4::int) RETURNING journal_id`,
      [`J-GAP07-${tag}-${suffix}`, branchId, `GAP07 ${tag}`, adminId]);
    const jid = Number(j.journal_id);
    await db.query(`INSERT INTO gl_entries (journal_id, line_no, account_id, branch_id, debit, credit, description) VALUES ($1::bigint,1,$2::int,$3::int,$4::numeric,0,$5)`, [jid, acc1.id, branchId, amt, `dr ${tag}`]);
    await db.query(`INSERT INTO gl_entries (journal_id, line_no, account_id, branch_id, debit, credit, description) VALUES ($1::bigint,2,$2::int,$3::int,0,$4::numeric,$5)`, [jid, acc2.id, branchId, amt, `cr ${tag}`]);
    return jid;
  }
  await addBalancedJournal('sale', '100.00');
  await addBalancedJournal('purchase', '200.00');
  await addBalancedJournal('payment', '50.00');

  const originalCounts = {
    invoices: await qcount('invoices'),
    gl_journals: await qcount('gl_journals'),
    gl_entries: await qcount('gl_entries'),
  };
  const tbBefore = await getTB(adminToken);
  const tbTotals = { totalDebit: tbBefore.totalDebit, totalCredit: tbBefore.totalCredit, balanced: tbBefore.balanced };

  // Take backup v1
  const backupRes = await raw('GET', '/admin/backup', undefined, adminToken);
  if (!is2xx(backupRes.status)) throw new Error(`backup failed ${backupRes.status} ${JSON.stringify(backupRes.data)}`);
  const backupV1 = backupRes.data;
  const backupTables = Object.keys(backupV1.tables || {});

  console.log(`[state] original counts=${JSON.stringify(originalCounts)} tb=${JSON.stringify(tbTotals)} voucher=${vchId} backup.tables=${backupTables.length}`);

  // ========== Modify data (to prove restore reverses it) ==========
  const extraJ = await addBalancedJournal('extra-after-backup', '77.00');
  await db.query(`DELETE FROM invoices WHERE invoice_id = $1::bigint`, [Number(inv1.invoice_id)]);
  const modifiedCounts = {
    invoices: await qcount('invoices'),
    gl_journals: await qcount('gl_journals'),
    gl_entries: await qcount('gl_entries'),
  };
  console.log(`[state] modified counts=${JSON.stringify(modifiedCounts)} extraJournal=${extraJ}`);

  // ========== GAP07-05,06,07,08 — successful restore ==========
  const restoreOk = await raw('POST', '/admin/restore', { backup: backupV1, confirm: 'RESTORE', user_id: admin.user.userId }, adminToken);
  const afterCounts = {
    invoices: await qcount('invoices'),
    gl_journals: await qcount('gl_journals'),
    gl_entries: await qcount('gl_entries'),
  };
  const tbAfter = await getTB(adminToken);
  const tbAfterTotals = { totalDebit: tbAfter.totalDebit, totalCredit: tbAfter.totalCredit, balanced: tbAfter.balanced };
  const restoreLog = await one(`SELECT id, restored_by, backup_version, table_counts, source_ip, restored_at FROM restore_log ORDER BY id DESC LIMIT 1`);

  record('GAP07-05', 'Restore ناجح: invoices, gl_journals, gl_entries تعود للقيم الأصلية',
    { invoices: originalCounts.invoices, gl_journals: originalCounts.gl_journals, gl_entries: originalCounts.gl_entries, modifiedBefore: modifiedCounts },
    { invoices: afterCounts.invoices, gl_journals: afterCounts.gl_journals, gl_entries: afterCounts.gl_entries, status: restoreOk.status },
    is2xx(restoreOk.status) && afterCounts.invoices === originalCounts.invoices && afterCounts.gl_journals === originalCounts.gl_journals && afterCounts.gl_entries === originalCounts.gl_entries);

  record('GAP07-06', 'Restore ناجح: ميزان المراجعة متوازن، مجموع Dr = Cr',
    { balanced: true, drEqualsCr: true },
    { balanced: tbAfter.balanced === true, totalDebit: tbAfter.totalDebit, totalCredit: tbAfter.totalCredit, drEqualsCr: tbAfter.totalDebit === tbAfter.totalCredit },
    tbAfter.balanced === true && tbAfter.totalDebit === tbAfter.totalCredit);

  record('GAP07-07', 'Restore ناجح: مجموع الأرصدة = القيمة الأصلية (بالقرش)',
    tbTotals,
    tbAfterTotals,
    tbAfter.totalDebit === tbTotals.totalDebit && tbAfter.totalCredit === tbTotals.totalCredit && tbAfter.balanced === tbTotals.balanced);

  record('GAP07-08', 'Audit log: صف واحد في restore_log لكل restore ناجح',
    { exists: true, backup_version: 1, restored_by: admin.user.userId },
    restoreLog ? { exists: true, id: restoreLog.id, backup_version: Number(restoreLog.backup_version), restored_by: Number(restoreLog.restored_by), hasTableCounts: !!restoreLog.table_counts, sourceIp: restoreLog.source_ip, restoredAt: restoreLog.restored_at } : null,
    !!restoreLog && Number(restoreLog.backup_version) === 1 && Number(restoreLog.restored_by) === Number(admin.user.userId));

  // ========== GAP07-02: confirm missing ==========
  const noConfirm = await raw('POST', '/admin/restore', { backup: backupV1 }, adminToken);
  record('GAP07-02', 'Body بدون confirm: "RESTORE" → 400',
    { status: 400 }, { status: noConfirm.status, message: noConfirm.data?.message }, noConfirm.status === 400);

  // ========== GAP07-03: version != 1 ==========
  const badVer = await raw('POST', '/admin/restore', { backup: { ...backupV1, version: 2 }, confirm: 'RESTORE' }, adminToken);
  record('GAP07-03', 'Backup مشوّه (version != 1) → 400',
    { status: 400 }, { status: badVer.status, message: badVer.data?.message }, badVer.status === 400);

  // ========== GAP07-04a: malformed (gl_journals without gl_entries) — DB unchanged ==========
  const snapA = await snapshotCounts(['invoices', 'gl_journals', 'gl_entries']);
  const malformed = JSON.parse(JSON.stringify(backupV1));
  if (malformed.tables.gl_journals && malformed.tables.gl_journals.length > 0) {
    malformed.tables.gl_entries = [];
  } else {
    // ensure condition: inject a fake journal row
    malformed.tables.gl_journals = [{ journal_id: 999999, journal_no: 'J-FAKE', journal_date: '2026-01-01', journal_type: 1, branch_id: branchId, description: 'x', status: 2, created_by: adminId }];
    malformed.tables.gl_entries = [];
  }
  const badMalformed = await raw('POST', '/admin/restore', { backup: malformed, confirm: 'RESTORE' }, adminToken);
  const snapA2 = await snapshotCounts(['invoices', 'gl_journals', 'gl_entries']);
  record('GAP07-04a', 'Backup مشوّه (gl_journals موجود لكن gl_entries ناقص) → 400 وDB لم تتغير',
    { status: 400, unchanged: true, snapBefore: snapA },
    { status: badMalformed.status, message: badMalformed.data?.message, snapAfter: snapA2, unchanged: JSON.stringify(snapA) === JSON.stringify(snapA2) },
    badMalformed.status === 400 && JSON.stringify(snapA) === JSON.stringify(snapA2));

  // ========== GAP07-04b: FK dangling → 400, DB unchanged ==========
  const snapB = await snapshotCounts(['invoices', 'gl_journals', 'gl_entries']);
  const dangling = JSON.parse(JSON.stringify(backupV1));
  // make gl_entries reference a non-existent journal_id while keeping parent table present
  if (Array.isArray(dangling.tables.gl_entries) && dangling.tables.gl_entries.length > 0) {
    dangling.tables.gl_entries = dangling.tables.gl_entries.map((r, i) => i === 0 ? { ...r, journal_id: 999999999 } : r);
  } else {
    // fabricate
    dangling.tables.gl_journals = dangling.tables.gl_journals || [];
    dangling.tables.gl_entries = [{ entry_id: 999999, journal_id: 999999999, line_no: 1, account_id: acc1.id, debit: 1, credit: 0 }];
  }
  const badDangling = await raw('POST', '/admin/restore', { backup: dangling, confirm: 'RESTORE' }, adminToken);
  const snapB2 = await snapshotCounts(['invoices', 'gl_journals', 'gl_entries']);
  record('GAP07-04b', 'Backup بـFK dangling → 400 وDB لم تتغير',
    { status: 400, unchanged: true, snapBefore: snapB },
    { status: badDangling.status, message: badDangling.data?.message, snapAfter: snapB2, unchanged: JSON.stringify(snapB) === JSON.stringify(snapB2) },
    badDangling.status === 400 && JSON.stringify(snapB) === JSON.stringify(snapB2));

  // ========== GAP07-01: endpoint exists, 403 without admin.restore_backup, 200 with ==========
  const noPerm = await raw('POST', '/admin/restore', { backup: backupV1, confirm: 'RESTORE' }, cashierToken);
  // also verify permission required: 403 (not 401) since authenticated
  record('GAP07-01', 'POST /admin/restore موجود ويتطلب admin.restore_backup (403 بدون)',
    { unauthzStatus: 403, adminHasPerm: true },
    { unauthzStatus: noPerm.status, unauthzMessage: noPerm.data?.message, cashierPerms: (cashierLogin.permissions||[]).includes('admin.restore_backup') },
    noPerm.status === 403 && !(cashierLogin.permissions||[]).includes('admin.restore_backup'));

  // Final restore to leave DB in known good (original) state
  await raw('POST', '/admin/restore', { backup: backupV1, confirm: 'RESTORE' }, adminToken);

  // ========== GAP07-09 info (core script does not run full regression) ==========
  console.log('\n[INFO] GAP07-09 regression (B1..B5.4 + GL-10 on 5434 + smoke 606/606) must be executed and recorded in GAP07-report.md.');

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n================ GAP07 CORE ================`);
  console.log(`TOTAL: ${pass}/${results.length}  (FAIL=${fail})`);
  for (const r of results) console.log(`  ${r.pass ? '✅' : '❌'} ${r.id}`);
  console.log(`============================================`);

  await db.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('\n[FATAL]', e && e.stack || e);
  try { if (db) await db.end(); } catch {}
  process.exit(2);
});
