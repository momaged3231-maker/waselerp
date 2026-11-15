/*
 * Idempotent migration of Ezees BANKS + Bank_actions into WaselERP as type-2 cash accounts
 * and cash_transactions, aligned with current schema (no separate banks master table).
 *
 *   node tools/migrate-ezees/migrate-banks.js --source "D:\New folder (2)\extracted-2026-11-15"
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'wasel',
};

function parseArgs(argv) {
  const out = { source: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--source') out.source = argv[++i];
  }
  return out;
}
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((x) => x !== '')).map((r) => {
    const o = {}; for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] !== undefined ? r[j] : ''; return o;
  });
}
const readCSV = (dir, name) => {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return [];
  return parseCSV(fs.readFileSync(p, 'utf8'));
};
const trim = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0; };
const sqlDate = (v) => { const s = trim(v); if (!s) return null; return s.replace(' ', 'T').replace(/\.\d+$/, '') + 'Z'; };

(async () => {
  const opts = parseArgs(process.argv);
  const defSrc = path.resolve(__dirname, '..', '..', '..', 'extracted-2026-11-15');
  opts.source = opts.source ? path.resolve(opts.source) : (fs.existsSync(defSrc) ? defSrc : null);
  if (!opts.source || !fs.existsSync(opts.source)) { console.error('مصدر غير موجود'); process.exit(1); }

  const banks = readCSV(opts.source, 'BANKS.csv');
  const actions = readCSV(opts.source, 'Bank_actions.csv');
  const report = { banks: { read: 0, inserted: 0, skipped: 0 }, actions: { read: 0, inserted: 0, skipped: 0, errors: 0 }, warnings: [] };

  const client = new Client(DB);
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ezees_migration_map (
      source_table text NOT NULL, source_id text NOT NULL, target_table text NOT NULL,
      target_id bigint NOT NULL, meta jsonb, migrated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(source_table,source_id))`);

    const getMapped = async (st, sid) => {
      const r = await client.query('SELECT target_id::bigint AS target_id FROM ezees_migration_map WHERE source_table=$1 AND source_id=$2', [st, String(sid)]);
      return r.rows[0] ? Number(r.rows[0].target_id) : null;
    };
    const setMapped = async (st, sid, tt, tid, meta) => {
      await client.query(`INSERT INTO ezees_migration_map(source_table,source_id,target_table,target_id,meta)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_table,source_id) DO UPDATE SET target_table=EXCLUDED.target_table,target_id=EXCLUDED.target_id,meta=EXCLUDED.meta`,
        [st, String(sid), tt, Number(tid), meta ? JSON.stringify(meta) : null]);
    };

    // 1) Bank master -> type-2 cash accounts, branch inferred by matching Ezees branch id (same numbering: 1=CIB Dahab/EZ-BR-1, 2=NBE/EZ-BR-2, 3=V.Cash DAHAB/EZ-BR-3)
    for (const b of banks) {
      report.banks.read++;
      const sid = trim(b.ID); if (!sid) continue;
      let acctId = await getMapped('BANKS', sid);
      if (acctId) { report.banks.skipped++; continue; }
      const name = trim(b.BANK_NAME) || `بنك ${sid}`;
      const branchId = await getMapped('Branches', sid); // bank id aligns with branch id in this dataset
      if (!branchId) { report.warnings.push(`bank ${sid} (${name}) no branch mapping`); continue; }
      const ex = await client.query(
        'SELECT cash_account_id FROM cash_accounts WHERE branch_id=$1::int AND type=2 AND lower(name)=lower($2)',
        [branchId, name],
      );
      if (ex.rows[0]) acctId = Number(ex.rows[0].cash_account_id);
      else {
        const ins = await client.query(
          `INSERT INTO cash_accounts(branch_id,name,type,bank_name,currency_code,opening_balance,is_active,notes)
           VALUES($1::int,$2,2,$2,$3,0,true,$4) RETURNING cash_account_id`,
          [branchId, name, 'EGP', 'مرحّل من Ezees (BANKS)'],
        );
        acctId = Number(ins.rows[0].cash_account_id);
      }
      await setMapped('BANKS', sid, 'cash_accounts', acctId, { name, branchId });
      report.banks.inserted++;
    }

    // 2) Bank actions -> cash transactions on the mapped bank account
    for (const r of actions) {
      report.actions.read++;
      const sid = trim(r.ID); if (!sid) continue;
      if (await getMapped('Bank_actions', sid)) { report.actions.skipped++; continue; }
      const bankSid = trim(r.Bank_id);
      const acctId = await getMapped('BANKS', bankSid);
      if (!acctId) { report.warnings.push(`bank action ${sid} bank ${bankSid} not mapped`); report.actions.skipped++; continue; }
      const acc = await client.query('SELECT branch_id FROM cash_accounts WHERE cash_account_id=$1::int', [acctId]);
      const branchId = acc.rows[0] ? Number(acc.rows[0].branch_id) : null;
      if (!branchId) { report.warnings.push(`bank action ${sid} no branch for account`); report.actions.skipped++; continue; }
      // action_type: 0 observed as outflows (payments), 1 as inflows (deposits) in samples — map to direction 2/1
      const dir = trim(r.action_type) === '1' ? 1 : 2;
      const amount = num(r.money);
      const date = sqlDate(r.date) || new Date().toISOString();
      const desc = (trim(r.Notes) || `حركة بنكية مرحّلة Ezees`) + ` [EZ-BANKACT#${sid}]`;
      try {
        await client.query(
          `INSERT INTO cash_transactions(branch_id,cash_account_id,direction,amount,transaction_date,description,created_by)
           VALUES($1::int,$2::int,$3::smallint,$4::numeric,$5::timestamptz,$6,1)`,
          [branchId, acctId, dir, amount, date, desc],
        );
        await setMapped('Bank_actions', sid, 'cash_transactions', 0, { amount, dir, bankSid });
        report.actions.inserted++;
      } catch (e) {
        report.actions.errors++;
        report.warnings.push(`bank action ${sid}: ${e.message}`);
      }
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
