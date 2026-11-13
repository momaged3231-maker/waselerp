/*
 * Starts the local PostgreSQL instance used for development.
 *
 * PostgreSQL refuses to run as a Windows Administrator, so this script
 * starts the server under a dedicated local account (`pgwasel`).
 *
 *   node tools/pg/start.js
 *
 * One-time setup (run from an elevated PowerShell):
 *   net user pgwasel 'Pg$Wasel2026' /add
 *   icacls C:\pgdata /grant "pgwasel:(OI)(CI)F" /T /Q
 */
const { execFileSync } = require('node:child_process');

const PG_BIN = process.env.PG_BIN ?? 'C:\\pg\\bin';
const PG_DATA = process.env.PG_DATA ?? 'C:\\pgdata';
const PG_USER = process.env.PG_USER ?? 'pgwasel';
const PG_PASSWORD = process.env.PG_PASSWORD ?? 'Pg$Wasel2026';
const PORT = process.env.PGPORT ?? '5432';

try {
  execFileSync(
    `${PG_BIN}\\pg_ctl.exe`,
    ['-D', PG_DATA, '-l', `${PG_DATA}\\server.log`, '-o', `-p ${PORT}`, '-w', 'start'],
    { stdio: 'inherit' },
  );
  console.log(`[pg] running on port ${PORT} (data: ${PG_DATA})`);
  console.log(`[pg] connection: postgres://postgres:postgres@localhost:${PORT}/wasel`);
  console.log(`[pg] service account: ${PG_USER} / ${PG_PASSWORD}`);
} catch (error) {
  console.error('[pg] start failed — check that the service account exists and C:\\pgdata is writable by it.');
  console.error(error.message);
  process.exit(1);
}
