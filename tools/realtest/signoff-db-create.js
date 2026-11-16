/* Creates the isolated wasel_signoff database for the E6 sign-off (real PostgreSQL). */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  const existing = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', ['wasel_signoff']);
  if (!existing.rows.length) {
    await c.query('CREATE DATABASE wasel_signoff');
    console.log('[db] created database wasel_signoff');
  } else {
    console.log('[db] database wasel_signoff already exists');
  }
  const list = await c.query('SELECT datname FROM pg_database ORDER BY datname');
  console.log('databases:', list.rows.map((r) => r.datname).join(', '));
  await c.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
