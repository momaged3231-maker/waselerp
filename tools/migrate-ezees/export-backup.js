/*
 * Export WaselERP DB to backup JSON compatible with /admin/backup (BackupService).
 *   node tools/migrate-ezees/export-backup.js --out "path/to/backup.json"
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
  const out = { out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

function serializeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (Buffer.isBuffer(value)) out[key] = { __bytea: value.toString('base64') };
    else out[key] = value;
  }
  return out;
}

(async () => {
  const opts = parseArgs(process.argv);
  if (!opts.out) { console.error('usage: node export-backup.js --out <file.json>'); process.exit(1); }
  const client = new Client(DB);
  await client.connect();
  try {
    const tableRows = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    const tables = {};
    let totalRows = 0;
    for (const row of tableRows.rows) {
      const tableName = String(row.table_name);
      const data = await client.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = data.rows.map(serializeRow);
      totalRows += data.rows.length;
    }
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      meta: { tables: tableRows.rows.length, rows: totalRows },
      tables,
    };
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload), 'utf8');
    console.log(`تم تصدير النسخة الاحتياطية: ${outPath}`);
    console.log(`الجداول: ${payload.meta.tables} | السطور: ${payload.meta.rows}`);
  } finally {
    await client.end();
  }
})().catch(e => { console.error('فشل التصدير:', e.message || e); process.exit(1); });
