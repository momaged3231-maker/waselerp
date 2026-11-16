/* E6 review — full reset of the ISOLATED review environment (never touches wasel/production).
 *
 *   node tools/e6-review-reset.js            → stop 4260/5434, wipe, re-migrate, re-seed, restart API, verify login
 *
 * The environment: PGlite on 5434 (data dir tools/pg/pglite-e6rev/, gitignored),
 * API on 4260, database wasel_e6rev. Safe to re-run as many times as needed.
 */
'use strict';
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PGLITE_DIR = path.join(ROOT, 'tools', 'pg', 'pglite-e6rev', 'data');
const envBase = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5434', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: 'wasel_e6rev' };

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.trim().split(/\s+/).pop();
      if (m && /^\d+$/.test(m)) pids.add(Number(m));
    }
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch { /* already gone */ }
    }
  } catch { /* no listener */ }
}

function waitForPort(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.on('connect', () => { sock.end(); resolve(); });
      sock.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`port ${port} did not come up`));
        else setTimeout(attempt, 750);
      });
      sock.end();
    };
    attempt();
  });
}

(async () => {
  console.log('[reset] stopping API (4260) and PGlite (5434)...');
  killPort(4260);
  killPort(5434);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('[reset] wiping data dir...');
  fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PGLITE_DIR, { recursive: true });

  console.log('[reset] starting PGlite 5434 briefly to migrate and seed...');
  const pglite = spawn(process.execPath, [path.join(ROOT, 'tools', 'pg', 'pglite', 'server.js')], {
    env: { ...process.env, PGPORT: '5434', PGLITE_DIR },
    stdio: 'ignore',
  });
  await waitForPort(5434);
  const run = (args, cwd, env) => execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  // PGlite serves a single embedded database over the wire — the logical name is
  // informational; connecting always lands on it. No CREATE DATABASE needed.
  run(['tools/pg/migrate-all.js', 'wasel_e6rev'], ROOT, envBase);
  run(['tools/pg/seed-reference.js', 'wasel_e6rev'], ROOT, envBase);
  execFileSync('npx', ['ts-node', '--transpile-only', 'src/cli/seed.ts'], { cwd: path.join(ROOT, 'apps', 'api'), env: envBase, stdio: 'inherit', shell: true });
  // The reset job is done once the data is on disk. Stop the temporary server —
  // the operator starts PGlite and the API as detached background processes:
  try { pglite.kill(); } catch { /* best effort */ }
  await new Promise((r) => setTimeout(r, 1500));
  console.log('[reset] database ready on disk. Start the two services as detached background processes:');
  console.log('[reset]   PGLITE_DIR=tools/pg/pglite-e6rev/data  PGPORT=5434  node tools/pg/pglite/server.js   (background)');
  console.log('[reset]   PORT=4260 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5434/wasel_e6rev DB_POOL_MAX=6  node apps/api/dist/main.js   (background, cwd=apps/api)');
  process.exit(0);
})().catch((err) => { console.error('[reset] FATAL', err); process.exit(1); });
