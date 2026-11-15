/* Phase 4 — Month 2 verification suite: independent numbers from the DB directly. */
const path = require('path');
const { Client } = require(path.resolve(process.cwd(), 'apps/api/node_modules/pg'));

(async () => {
  const c = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5433/wasel_month2' });
  await c.connect();
  const out = {};

  const q = (sql, p=[]) => c.query(sql, p).then(r => r.rows);
  const one = (sql, p=[]) => q(sql, p).then(r => r[0]);

  // Journal integrity
  out.journals = await one("SELECT count(*)::int n, (SELECT count(*) FROM gl_entries)::int e FROM gl_journals");
  out.orphanEntries = await one("SELECT count(*)::int n FROM gl_entries x LEFT JOIN gl_journals j ON j.journal_id = x.journal_id WHERE j.journal_id IS NULL");
  out.imbalanced = await one("SELECT count(*)::int n FROM gl_journals WHERE abs(total_debit - total_credit) > 0.005");
  out.unposted = await one("SELECT count(*)::int n FROM gl_journals WHERE status = 1");

  // Sales and purchases totals
  out.salesInvoices = await q("SELECT invoice_id, invoice_type, sub_total::numeric s, total_amount::numeric t, paid_amount::numeric p, status FROM invoices WHERE invoice_type IN (1,3) ORDER BY invoice_id");
  out.purchInvoices = await q("SELECT invoice_id, sub_total::numeric s, total_amount::numeric t, paid_amount::numeric p, tax_amount::numeric v, status FROM invoices WHERE invoice_type = 2 ORDER BY invoice_id");

  // COGS and sales
  out.cogs = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '5101'");
  out.sales = await one("SELECT COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '4101'");

  // Inventory value
  out.invGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '1104'");
  out.invQty = await q("SELECT i.code, q.on_hand_qty AS qty, q.avg_cost AS cost FROM items i JOIN item_warehouse_qty q ON q.item_id = i.item_id WHERE q.on_hand_qty > 0");

  // AR & AP
  out.arGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '1103'");
  out.apGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '2101'");
  out.arOpen = await q("SELECT i.party_id, SUM(i.sub_total - i.paid_amount)::numeric v FROM invoices i WHERE i.invoice_type = 1 AND i.status <> 3 GROUP BY i.party_id ORDER BY 1");
  out.apOpen = await q("SELECT i.party_id, SUM(i.sub_total - i.paid_amount)::numeric v FROM invoices i WHERE i.invoice_type = 2 AND i.status <> 3 GROUP BY i.party_id ORDER BY 1");

  // Cash & bank
  out.cashGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '1101'");
  out.bankGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d, COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '1102'");

  // VAT totals
  out.vatOut = await one("SELECT COALESCE(SUM(e.credit),0)::numeric c FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '2102'");
  out.vatIn = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '1105'");

  // Payroll
  out.salaryExp = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '5103'");
  out.salaryPay = await one("SELECT COALESCE(SUM(e.credit),0)::numeric c, COALESCE(SUM(e.debit),0)::numeric d FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code = '2103'");

  // Profit & Loss check: assets = liab + equity + income (since no closing entry in this test, equity + income/loss balancing)
  out.assets = await one("SELECT COALESCE(SUM(e.debit - e.credit),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.account_type = 1");
  out.liab = await one("SELECT COALESCE(SUM(e.credit - e.debit),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.account_type = 2");
  out.equity = await one("SELECT COALESCE(SUM(e.credit - e.debit),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.account_type = 3");
  out.pnl = await one("SELECT COALESCE(SUM(CASE WHEN a.account_type=4 THEN e.credit - e.debit WHEN a.account_type=5 THEN e.debit - e.credit ELSE 0 END),0)::numeric net FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.account_type IN (4,5)");

  // Damage & variance
  out.damageGL = await one("SELECT COALESCE(SUM(e.debit),0)::numeric d FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code='5112'");
  out.varianceGL = await one("SELECT COALESCE(SUM(CASE WHEN e.debit>e.credit THEN e.debit-e.credit ELSE e.credit-e.debit END),0)::numeric v FROM gl_entries e JOIN gl_accounts a ON a.account_id = e.account_id WHERE a.code='5111'");

  // Movement sanity
  out.transferJournals = await one("SELECT count(*)::int n FROM gl_journals WHERE source_type = 'stock_transfer'");
  out.journalCountBySource = await q("SELECT COALESCE(source_type,'manual') src, count(*)::int n FROM gl_journals GROUP BY 1 ORDER BY 2 DESC");

  console.log(JSON.stringify(out, null, 1));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
