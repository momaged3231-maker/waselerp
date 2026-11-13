/*
 * Runs a SELECT against the development database and prints the rows.
 *   node tools/pg/q.js "select * from gl_accounts limit 5"
 */
const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const CONFIG = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'wasel',
};

(async () => {
  const sql = process.argv.slice(2).join(' ');
  if (!sql) {
    console.error('usage: node tools/pg/q.js "select ..."');
    process.exit(1);
  }
  const client = new Client(CONFIG);
  await client.connect();
  const result = await client.query(sql);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})().catch((error) => {
  console.error('[db] error:', error.message);
  process.exit(1);
});
