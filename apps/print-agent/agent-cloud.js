/*
 * Cloud (cross-location) integration for the WaselERP Print Agent.
 *
 * The agent registers itself with the WaselERP server, heartbeats its printer
 * list, and polls for pending print jobs assigned to it (any location). This
 * enables printing to a printer on a different cashier PC.
 *
 * Configuration (env or agent.env):
 *   WASEL_SERVER_BASE   server API base (default http://localhost:4000/api)
 *   WASEL_AGENT_SECRET  shared secret for registration (default wasel-agent-secret-2026)
 *   WASEL_AGENT_TOKEN   this agent's own token (default wasel-local-agent)
 *   WASEL_MACHINE_NAME  override machine name (default os.hostname())
 */
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_BASE = (process.env.WASEL_SERVER_BASE ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const AGENT_SECRET = process.env.WASEL_AGENT_SECRET ?? 'wasel-agent-secret-2026';
const AGENT_TOKEN = process.env.WASEL_AGENT_TOKEN ?? 'wasel-local-agent';
const CONFIG_PATH = path.join(__dirname, 'agent-config.json');
const CLOUD_STATE_PATH = path.join(__dirname, 'agent-cloud.json');

function loadCloudState() {
  try { return JSON.parse(fs.readFileSync(CLOUD_STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveCloudState(s) {
  try { fs.writeFileSync(CLOUD_STATE_PATH, JSON.stringify(s, null, 2), 'utf8'); } catch {}
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const full = SERVER_BASE + urlPath;
    const u = new URL(full);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : undefined;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 10000,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : null; } catch { parsed = chunks; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function loadConfig() {
  try { return JSON.parse(require('fs').readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

// --- public API ---
let state = loadCloudState();
let agentId = state.agentId || null;
let agentUid = state.agentUid || null;
let listPrintersFn = null; // injected
let executeJobFn = null;   // injected: (job) => Promise<void>

function init({ listPrinters, executeJob }) {
  listPrintersFn = listPrinters;
  executeJobFn = executeJob;
  if (!agentUid) {
    agentUid = (require('crypto').randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
    saveCloudState({ ...state, agentUid });
  }
  // register + start loops
  register().then(() => {
    startHeartbeat();
    startPolling();
  }).catch((e) => {
    console.error('[cloud] initial register failed:', e?.message || e);
    // retry registration in 10s
    setTimeout(() => register().then(() => { startHeartbeat(); startPolling(); }).catch(() => {}), 10000);
  });
}

async function register() {
  const cfg = loadConfig();
  const printers = listPrintersFn ? await listPrintersFn() : [];
  const machineName = process.env.WASEL_MACHINE_NAME || os.hostname();
  const res = await request('POST', '/print-agents/register', {
    agentUid, machineName, ipAddress: getLocalIp(), token: AGENT_TOKEN, printers,
  }, { 'x-agent-secret': AGENT_SECRET });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  agentId = res.data.agentId;
  state = { ...state, agentUid, agentId };
  saveCloudState(state);
  console.log(`[cloud] registered agent #${agentId} (${machineName}) with ${printers.length} printers`);
  return agentId;
}

function startHeartbeat() {
  const tick = async () => {
    if (!agentId) return;
    try {
      const printers = listPrintersFn ? await listPrintersFn() : [];
      await request('POST', `/print-agents/${agentId}/heartbeat`, { printers }, { 'x-agent-token': AGENT_TOKEN });
    } catch (e) {
      console.error('[cloud] heartbeat failed:', e?.message || e);
    }
  };
  tick();
  setInterval(tick, 30000);
}

function startPolling() {
  const tick = async () => {
    if (!agentId) return;
    try {
      const res = await request('GET', `/print-agents/jobs/pending?agentId=${agentId}`, null, { 'x-agent-token': AGENT_TOKEN });
      if (!res.ok) return;
      const jobs = Array.isArray(res.data) ? res.data : (res.data?.jobs ?? []);
      for (const job of jobs) {
        try {
          if (executeJobFn) await executeJobFn(job);
          await request('PATCH', `/print-agents/jobs/${job.jobId}?agentId=${agentId}`, { status: 'done' }, { 'x-agent-token': AGENT_TOKEN });
        } catch (e) {
          console.error('[cloud] job', job.jobId, 'failed:', e?.message || e);
          await request('PATCH', `/print-agents/jobs/${job.jobId}?agentId=${agentId}`, { status: 'failed', error: String(e?.message || e) }, { 'x-agent-token': AGENT_TOKEN }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[cloud] poll failed:', e?.message || e);
    }
  };
  setInterval(tick, 2000);
}

module.exports = { init, getAgentId: () => agentId, getAgentUid: () => agentUid };
