/*
 * Wipes ALL data by dropping and recreating the public schema — the demo
 * databases are "resettable and rebuildable" by design. DESTRUCTIVE: it
 * refuses to run without --yes. Take a backup first (GET /admin/backup).
 *
 *   node tools/pg/wipe-db.js --yes
 *
 * Connection supports DATABASE_URL (managed DBs) like migrate-all.js.
 * After a wipe run, in order: migrate-all -> seed.ts -> seed-reference.
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

function clientConfig() {
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
    database: process.env.PGDATABASE ?? 'wasel',
  };
}

(async () => {
  const client = new Client(clientConfig());
  await client.connect();
  const before = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  console.log(`[wipe] tables before: ${before.rows[0].n}`);
  if (!process.argv.includes('--yes')) {
    console.error('[wipe] رفض التنفيذ بدون --yes — هذه العملية تحذف كل البيانات');
    await client.end();
    process.exit(1);
  }
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO postgres');
  await client.query('GRANT ALL ON SCHEMA public TO public');
  const after = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  console.log(`[wipe] tables after: ${after.rows[0].n} — schema reset. Next: migrate-all -> seed -> seed-reference`);
  await client.end();
})().catch((e) => {
  console.error('[wipe] FAILED:', e.message);
  process.exit(1);
});
