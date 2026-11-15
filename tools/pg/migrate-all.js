/*
 * Applies the base schema then every db/migrations/*.sql to a database, in
 * chronological order (date prefix, then numeric suffix — d2 before d11).
 * Tracks applied files in schema_migrations so re-runs skip known-good files
 * instead of relying on every file being written idempotently.
 *
 *   node tools/pg/migrate-all.js <database> [--force]
 *
 * --force runs every file even when recorded (for debugging single files).
 * Connection comes from PGHOST/PGPORT/PGUSER/PGPASSWORD like run-sql.js.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

function clientConfig(database) {
  const url = process.env.DATABASE_URL;
  if (url) {
    const managed = /sslmode=require|pooler\.|supabase\.|neon\.tech|render\.com/i.test(url);
    return { connectionString: url, ssl: managed ? { rejectUnauthorized: false } : undefined };
  }
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database,
  };
}

/** "2026-11-15-d2-print-profiles.sql" -> sorts by date, then 2, then name. */
function sortKey(file) {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})-([a-z]*?)(\d*)(.*)\.sql$/i);
  if (!m) return [file, 0, file];
  return [m[1], Number(m[3] || 0), m[2] + m[4]];
}

async function main() {
  const database = process.argv[2] ?? 'wasel';
  const force = process.argv.includes('--force');
  const root = path.join(__dirname, '..', '..', 'db');
  const files = [];
  const schemaPath = path.join(root, 'schema.postgres.sql');
  if (fs.existsSync(schemaPath)) {
    files.push({ file: 'schema.postgres.sql', sql: fs.readFileSync(schemaPath, 'utf8') });
  }
  const dir = path.join(root, 'migrations');
  const migrationNames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  for (const name of migrationNames) {
    files.push({ file: 'migrations/' + name, sql: fs.readFileSync(path.join(dir, name), 'utf8') });
  }

  const client = new Client(clientConfig(database));
  await client.connect();
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
  );
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const { file, sql } of files) {
    if (applied.has(file) && !force) {
      console.log(`[migrate] ${file} — already applied, skip`);
      continue;
    }
    process.stdout.write(`[migrate] ${file} ... `);
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [file]
      );
      console.log('OK');
    } catch (e) {
      console.log('FAILED: ' + e.message);
      process.exitCode = 1;
    }
  }
  await client.end();
  console.log(process.exitCode ? '[migrate] DONE WITH ERRORS' : '[migrate] all applied');
}

main().catch((e) => {
  console.error('[migrate] fatal: ' + e.message);
  process.exit(1);
});
