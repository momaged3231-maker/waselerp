const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

(async () => {
  const client = new Client({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'wasel',
  });
  await client.connect();
  const tables = await client.query(
    "SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const fks = await client.query(
    "SELECT count(*)::int AS c FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'",
  );
  const indexes = await client.query("SELECT count(*)::int AS c FROM pg_indexes WHERE schemaname = 'public'");
  console.log(`tables=${tables.rows[0].c} foreign_keys=${fks.rows[0].c} indexes=${indexes.rows[0].c}`);

  const query = process.argv[2];
  if (query) {
    const result = await client.query(query);
    console.log(JSON.stringify(result.rows, null, 2));
  }
  await client.end();
})().catch((error) => {
  console.error('[db] error:', error.message);
  process.exit(1);
});
