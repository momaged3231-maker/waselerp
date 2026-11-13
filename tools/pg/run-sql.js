/*
 * Small postgres helper (the embedded distribution ships server binaries only).
 *   node tools/pg/run-sql.js <database> <file.sql>
 *   node tools/pg/run-sql.js <database> --exec "select 1"
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const CONFIG = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
};

async function ensureDatabase(name) {
  const admin = new Client({ ...CONFIG, database: 'postgres' });
  await admin.connect();
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!rows.length) {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`[db] created database ${name}`);
  } else {
    console.log(`[db] database ${name} exists`);
  }
  await admin.end();
}

async function run(database, sql, file) {
  const client = new Client({ ...CONFIG, database });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log(`[db] executed ${file ?? 'statement'} on ${database}`);
}

(async () => {
  const [database, target] = process.argv.slice(2);
  if (!database || !target) {
    console.error('usage: node run-sql.js <database> <file.sql | --exec "sql">');
    process.exit(1);
  }
  await ensureDatabase(database);
  if (target === '--exec') {
    await run(database, process.argv[5] ?? '', 'statement');
  } else {
    const sql = fs.readFileSync(target, 'utf8');
    await run(database, sql, path.basename(target));
  }
})().catch((error) => {
  console.error('[db] error:', error.message);
  process.exit(1);
});
