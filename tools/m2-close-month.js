/* M2/M3 close helper: create bounded periods, run pre-close checklist, close with E6. */
const BASE = process.env.M2_BASE ?? 'http://127.0.0.1:4250/api';
let token = null, branchId = null;
(async () => {
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: 'admin', password: 'admin123' }) }).then((r) => r.json());
  token = login.accessToken;
  branchId = login.activeBranchId;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-branch-id': String(branchId) };
  const name = process.argv[2];
  const start = process.argv[3];
  const end = process.argv[4] ?? null;
  const created = await fetch(`${BASE}/accounting/periods`, { method: 'POST', headers: H, body: JSON.stringify({ name, startDate: start, endDate: end }) }).then((r) => r.json());
  console.log('period:', JSON.stringify(created));
  const periodId = created.periodId;
  const pre = await fetch(`${BASE}/accounting/periods/${periodId}/preclose-check`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
  console.log('preclose:', JSON.stringify({ passed: pre.passed, failed: pre.failed, checks: (pre.checks ?? []).map((c) => [c.checkCode, c.status]) }, null, 1));
  const close = await fetch(`${BASE}/accounting/periods/${periodId}/close-month`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
  console.log('close:', JSON.stringify(close, null, 1).slice(0, 800));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
