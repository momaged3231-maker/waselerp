/**
 * TD-53/54 Phase 1 — unit tests for supplier-claim helpers (P1-02, P1-03).
 * Direct helper calls via a real pg transaction; no API endpoints.
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));
const { postSupplierClaimJournal, reverseSupplierVat } = require(
  path.join(__dirname, '..', 'apps', 'api', 'dist', 'modules', 'purchases', 'supplier-claims.helper'));
const { postJournal: requirePost } = require(path.join(__dirname, '..', 'apps', 'api', 'dist', 'common', 'posting'));

async function main() {
  const c = new Client({ host: '127.0.0.1', port: Number(process.env.PGPORT ?? 5664),
    user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  await c.query("INSERT INTO parties (name, party_type, branch_id) VALUES ('TD53 test supplier', 2, 1)");
  const party = (await c.query("SELECT party_id FROM parties ORDER BY party_id LIMIT 1")).rows[0].party_id;
  const branch = 1;
  let pass = 0, total = 0;
  const check = (name, ok, detail) => { total++; if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); };

  const acct = await c.query("SELECT code, account_id, account_type FROM gl_accounts WHERE code='2108'");
  const map = await c.query("SELECT account_id FROM gl_mappings WHERE mapping_key='SUPPLIER_CLAIM_RECEIVABLE'");
  check('P1-01 account 2108', acct.rows.length === 1 && Number(acct.rows[0].account_type) === 1, JSON.stringify(acct.rows));
  check('P1-01 mapping', map.rows.length === 1 && Number(map.rows[0].account_id) === Number(acct.rows[0]?.account_id), JSON.stringify({map: map.rows, acct: acct.rows}));

  async function testHelper(name, fn, expected, sourceExpected) {
    await c.query('BEGIN');
    try {
      const j = await fn();
      const jr = await c.query(`SELECT j.source_type, j.source_id, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
          FROM gl_journals j JOIN gl_entries l ON l.journal_id=j.journal_id WHERE j.journal_id=$1 GROUP BY j.source_type,j.source_id`, [j]);
      const r = jr.rows[0];
      const lines = await c.query(`SELECT a.code, l.debit, l.credit FROM gl_entries l JOIN gl_accounts a ON a.account_id=l.account_id WHERE l.journal_id=$1 ORDER BY a.code`, [j]);
      check(`${name} journal balanced + source`,
        Math.abs(Number(r.d) - expected.amount) < 0.01 && Math.abs(Number(r.c) - expected.amount) < 0.01 &&
        r.source_type === sourceExpected && Number(r.source_id) === expected.sourceId,
        JSON.stringify({d:r.d, c:r.c, t:r.source_type, id:r.source_id}));
      check(`${name} Dr/Cr accounts`,
        lines.rows.some((x) => x.code === expected.dr && Number(x.debit) === expected.amount) &&
        lines.rows.some((x) => x.code === expected.cr && Number(x.credit) === expected.amount),
        JSON.stringify(lines.rows));
    } catch (e) {
      check(`${name} journal balanced + source`, false, 'ERROR: ' + String(e.message));
      check(`${name} Dr/Cr accounts`, false, '(blocked by same error)');
    } finally { await c.query('ROLLBACK'); }
  }

  await testHelper('P1-02', () => postSupplierClaimJournal(c, { branchId: branch, supplierId: party, claimId: 1, amount: 100, description: 'P1-02 unit test claim' }),
    { amount: 100, sourceId: 1, dr: '2108', cr: '1104' }, 'supplier_claim');
  await testHelper('P1-03', () => reverseSupplierVat(c, { branchId: branch, supplierId: party, supplierInvoiceId: 2, vatAmount: 14, description: 'P1-03 unit test VAT reversal' }),
    { amount: 14, sourceId: 2, dr: '2101', cr: '1105' }, 'supplier_vat_reversal');

  // P1-02b — default-deny still active: unknown source on a control account is rejected
  await c.query('BEGIN');
  try {
    const inv = await c.query("SELECT account_id FROM gl_accounts WHERE code='1104'");
    const cash = await c.query("SELECT account_id FROM gl_accounts WHERE code='1101'");
    await requirePost(c, {
      branchId: branch, journalType: 2, description: 'bogus source', sourceType: 'bogus_test_type', sourceId: 1,
      lines: [
        { accountId: Number(inv.rows[0].account_id), debit: 10, credit: 0 },
        { accountId: Number(cash.rows[0].account_id), debit: 0, credit: 10 },
      ],
    });
    check('P1-02b bogus source rejected', false, 'unexpectedly accepted');
  } catch (e) {
    check('P1-02b bogus source rejected', true, String(e.message).slice(0, 90));
  } finally { await c.query('ROLLBACK'); }

  console.log(`\nRESULT ${pass}/${total}`);
  await c.end();
  process.exit(pass === total ? 0 : 1);
}
main().catch((e) => { console.error(e.stack); process.exit(2); });
