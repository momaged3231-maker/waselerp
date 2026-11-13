/*
 * Development-only PostgreSQL over the wire protocol using PGlite.
 *
 * Useful on machines where a real PostgreSQL server cannot be installed
 * (for example a Windows Administrator account). PGlite runs PostgreSQL
 * compiled to WebAssembly inside Node and speaks the real wire protocol
 * through @electric-sql/pglite-socket, so `pg` clients connect unchanged.
 *
 *   node tools/pg/pglite/server.js
 *
 * Environment:
 *   PGPORT      port to listen on          (default 5432)
 *   PGLITE_DIR  on-disk data directory     (default tools/pg/pglite/data)
 *
 * Data is persisted to disk, so stopping and starting keeps the database.
 * Delete the data directory to start from scratch.
 */
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const PORT = Number(process.env.PGPORT ?? 5432);
const DATA_DIR = process.env.PGLITE_DIR ?? path.join(__dirname, 'data');

async function main() {
  const db = await PGlite.create({ dataDir: DATA_DIR });
  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
    // The default of 1 makes a `pg` pool fail with ECONNRESET.
    maxConnections: Number(process.env.PGLITE_MAX_CONNECTIONS ?? 40),
  });
  await server.start();
  console.log(`[pglite] listening on 127.0.0.1:${PORT}`);
  console.log(`[pglite] data directory: ${DATA_DIR}`);

  const shutdown = async () => {
    console.log('\n[pglite] stopping…');
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[pglite] failed to start:', error);
  process.exit(1);
});
