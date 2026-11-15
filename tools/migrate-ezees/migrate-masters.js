/*
 * Migrate Ezees banks (master) + link cash_accounts.bank_id, and governorates from Gov.csv.
 * Idempotent. Usage:
 *   node tools/migrate-ezees/migrate-masters.js --source "D:\New folder (2)\extracted-2026-11-15"
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const DB = { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres', database: process.env.PGDATABASE ?? 'wasel' };

function parseArgs(argv) {
  const out = { source: null };
  for (let i = 2; i < argv.length; i++) { if (argv[i] === '--source') out.source = argv[++i]; }
  return out;
}
function parseCSV(text) {
  const rows = []; let i = 0, field = '', row = [], inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(x => x !== '')).map(r => { const o = {}; for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] !== undefined ? r[j] : ''; return o; });
}
const readCSV = (dir, name) => { const p = path.join(dir, name); if (!fs.existsSync(p)) return []; return parseCSV(fs.readFileSync(p, 'utf8')); };
const trim = v => (v == null ? '' : String(v)).trim();
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0; };

(async () => {
  const opts = parseArgs(process.argv);
  const defSrc = path.resolve(__dirname, '..', '..', '..', 'extracted-2026-11-15');
  opts.source = opts.source ? path.resolve(opts.source) : (fs.existsSync(defSrc) ? defSrc : null);
  if (!opts.source) { console.error('source required'); process.exit(1); }

  const client = new Client(DB);
  await client.connect();
  const report = { banksMaster: { read: 0, inserted: 0, linked: 0 }, governorates: { read: 0, inserted: 0, skipped: 0 } };
  try {
    // Banks master from BANKS.csv + link cash_accounts
    const banks = readCSV(opts.source, 'BANKS.csv');
    for (const b of banks) {
      report.banksMaster.read++;
      const name = trim(b.BANK_NAME); if (!name) continue;
      let row = await client.query('SELECT bank_id FROM banks WHERE lower(name)=lower($1)', [name]);
      let bankId;
      if (row.rows[0]) bankId = Number(row.rows[0].bank_id);
      else {
        const ins = await client.query('INSERT INTO banks(code,name,is_active,notes) VALUES($1::text,$2::text,true,$3::text) RETURNING bank_id', [`BANK-${trim(b.ID)}`, name, 'مرحّل من Ezees']);
        bankId = Number(ins.rows[0].bank_id);
        report.banksMaster.inserted++;
      }
      // link type-2 cash accounts with matching bank_name
      const upd = await client.query('UPDATE cash_accounts SET bank_id=$1::int, bank_name=$2::text WHERE type=2 AND (bank_id IS NULL) AND lower(coalesce(bank_name,name))=lower($2::text)', [bankId, name]);
      report.banksMaster.linked += upd.rowCount || 0;
    }

    // Governorates from Gov.csv
    const govs = readCSV(opts.source, 'Gov.csv');
    // ensure Egypt country exists if referenced
    let eg = await client.query("SELECT country_id FROM countries WHERE upper(code)='EG' OR name ILIKE '%مصر%' OR name_en ILIKE '%Egypt%' LIMIT 1");
    let egId = eg.rows[0] ? Number(eg.rows[0].country_id) : null;
    for (const g of govs) {
      report.governorates.read++;
      const name = trim(g.GovName); if (!name) continue;
      const ex = await client.query('SELECT governorate_id FROM governorates WHERE lower(name)=lower($1)', [name]);
      if (ex.rows[0]) { report.governorates.skipped++; continue; }
      const cc = trim(g.CountryCode) || null;
      let countryId = null;
      if (cc && cc.toUpperCase() === 'EG') countryId = egId;
      await client.query(
        `INSERT INTO governorates(code,name,name_en,country_id,country_code,shipping_fees,is_active)
         VALUES($1::text,$2::text,$3::text,$4::int,$5::text,$6::numeric,$7::boolean)`,
        [trim(g.ID) ? `GOV-${trim(g.ID)}` : null, name, trim(g.GovNameEn) || null, countryId, cc, num(g.shipping_fees), true]
      );
      report.governorates.inserted++;
    }

    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
