/**
 * GAP-02 verification — lost-reason enforcement + transparent win rate.
 * Usage: API_BASE=http://127.0.0.1:4038/api PGPORT=5618 node tools/verify-gap02.js
 */
const { Client } = require('../apps/api/node_modules/pg');
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4038/api';
const PGPORT = Number(process.env.PGPORT ?? 5618);
let token = '', branchId = 1, checks = 0, passes = 0;
const samples = [];
function check(id, label, ok, detail) {
  checks++; if (ok) passes++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${id} | ${label} | ${detail}`);
}
async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-branch-id': String(branchId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}
(async () => {
  const db = new Client({ host: '127.0.0.1', port: PGPORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await db.connect();
  const login = await api('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.body.accessToken || login.body.token;
  branchId = login.body.activeBranchId || 1;
  const newLead = async () => (await api('POST', '/crm/leads', { name: `GAP02-${Date.now()}-${Math.floor(Math.random()*1e6)}` })).body.leadId;

  // 01 — close lost without reason → 400
  const a = await newLead();
  const noReason = await api('PUT', `/crm/leads/${a}`, { stage: 6 });
  check('GAP02-01', 'close lost without reason → 400', noReason.status === 400,
    `lead=${a} status=${noReason.status} msg=${noReason.body?.message ?? ''}`);

  // 02 — close lost with reason → 200 + audit with ip
  const withReason = await api('PUT', `/crm/leads/${a}`, { stage: 6, lostReason: 'سعر مرتفع' });
  const al1 = await db.query("SELECT activity_log_id, action, entity, entity_id, ip_address, details FROM activity_log WHERE action='crm.lead.lost' AND entity_id=$1", [String(a)]);
  const row1 = al1.rows[0];
  check('GAP02-02', 'close lost with reason → 200 + audit+ip',
    withReason.status === 200 && !!row1 && !!row1.ip_address && row1.ip_address !== 'unknown',
    `lead=${a} status=${withReason.status} audit=${JSON.stringify(row1 ?? null)}`);
  if (row1) samples.push({ id: '02', ...row1 });

  // 03 — DB CHECK: direct INSERT stage=6 without reason → exception
  let dbRejected = false, dbMsg = '';
  try {
    await db.query("INSERT INTO crm_leads (branch_id,name,stage) VALUES ($1,'GAP02-DB-CHECK',6)", [branchId]);
  } catch (e) { dbRejected = true; dbMsg = String(e.message).split('\n')[0]; }
  check('GAP02-03', 'DB CHECK rejects stage=6 no reason', dbRejected, `rejected=${dbRejected} err=${dbMsg}`);

  // 04 — reason edit on a closed lost lead → 200 + audit old ← new
  const lead4 = await newLead();
  await api('PUT', `/crm/leads/${lead4}`, { stage: 6, lostReason: 'قديم' });
  const edit = await api('PUT', `/crm/leads/${lead4}`, { lostReason: 'جديد' });
  const detail4 = await db.query('SELECT lost_reason FROM crm_leads WHERE lead_id=$1', [lead4]);
  const al4 = await db.query("SELECT activity_log_id, action, details, ip_address FROM activity_log WHERE action='crm.lead.lost_reason.edit' AND entity_id=$1", [String(lead4)]);
  const row4 = al4.rows[0];
  check('GAP02-04', 'edit lost reason → 200 + old ← new audit',
    edit.status === 200 && detail4.rows[0]?.lost_reason === 'جديد' && !!row4 && String(row4.details).includes('قديم') && String(row4.details).includes('جديد'),
    `lead=${lead4} status=${edit.status} reason=${detail4.rows[0]?.lost_reason} audit=${JSON.stringify(row4 ?? null)}`);
  if (row4) samples.push({ id: '04', ...row4 });

  // 05 — explicit clear on a lost lead → 400
  const clear = await api('PUT', `/crm/leads/${lead4}`, { lostReason: null });
  check('GAP02-05', 'clear lost reason while stage=6 → 400', clear.status === 400,
    `lead=${lead4} status=${clear.status} msg=${clear.body?.message ?? ''}`);

  // 06 — win rate from an isolated cohort (3 leads, created 2020-01-01)
  await db.query("DELETE FROM crm_leads WHERE created_at >= '2020-01-01' AND created_at < '2020-01-02'");
  for (const stage of [5, 5, 6]) {
    await db.query("INSERT INTO crm_leads (branch_id,name,stage,lost_reason,created_at,updated_at) VALUES ($1,$2,$3,$4,'2020-01-01','2020-01-01')",
      [branchId, `GAP02-cohort-${stage}-${Math.random()}`, stage, stage === 6 ? 'منافس' : null]);
  }
  const sum6 = await api('GET', '/crm/summary?from=2020-01-01&to=2020-01-01');
  const wr6 = sum6.body?.winRate;
  check('GAP02-06', 'winRate 2/1/3 → 67%',
    wr6?.won === 2 && wr6?.lost === 1 && wr6?.decided === 3 && wr6?.percentage === 67,
    `winRate=${JSON.stringify(wr6 ?? null)}`);

  // 07 — empty cohort → zero / null (no division by zero)
  const sum7 = await api('GET', '/crm/summary?from=1999-01-01&to=1999-01-01');
  const wr7 = sum7.body?.winRate;
  check('GAP02-07', 'empty cohort → 0/0/0/null',
    wr7?.won === 0 && wr7?.lost === 0 && wr7?.decided === 0 && wr7?.percentage === null,
    `winRate=${JSON.stringify(wr7 ?? null)}`);

  console.log('\n=== AUDIT SAMPLES ===');
  for (const s of samples) console.log(JSON.stringify(s));
  console.log(`\nRESULT ${passes}/${checks}`);
  await db.end();
  process.exit(passes === checks ? 0 : 1);
})().catch((e) => { console.error('ERR ' + e.stack); process.exit(1); });
