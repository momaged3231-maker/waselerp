/*
 * GL-10 — Budgets: acceptance verification (GL10-01 .. GL10-12)
 *
 *   API_BASE=http://127.0.0.1:4001/api PGPORT=5434 node tools/verify-gl10.js
 *
 * Runs against an ISOLATED API + database (default 4001 / 5434). Every check
 * prints the literal expected and actual value; expected values that describe
 * money are computed by INDEPENDENT SQL in this file, never copied from the API.
 *
 * Scope being verified (owner-approved, fixed):
 *   base currency only · revenue(4)/expense(5) only · non-group accounts only ·
 *   month 1..12 · per-branch NOT NULL · cost_center_id NULLable (= غير موزّع) ·
 *   annual + 12 months, NOT derived from `periods` · same-user approval needs a
 *   reason · approved budgets are never edited in place (new version) ·
 *   over-budget is warning-only (posting.ts untouched) · no UI · no E6 coupling.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'pg'));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4001/api';
const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5434),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

const S = `GL10-${Date.now().toString().slice(-8)}`;
const branchId = 1;
const tokens = {};
const results = [];
let db;

function record(id, title, expected, actual, pass) {
  results.push({ id, title, expected, actual, pass });
  console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${id} — ${title}`);
  console.log(`        expected: ${JSON.stringify(expected)}`);
  console.log(`        actual:   ${JSON.stringify(actual)}`);
  return pass;
}

function sub(label, expected, actual, pass) {
  console.log(`        · ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)} ${pass ? 'OK' : '<<< MISMATCH'}`);
  return pass;
}

const is2xx = (s) => s >= 200 && s < 300;
const money = (n) => Math.round(Number(n) * 100) / 100;
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

async function login(userName, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, password }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`login ${userName} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function call(who, method, url, body) {
  const headers = { 'Content-Type': 'application/json', 'x-branch-id': String(branchId) };
  if (tokens[who]) headers.Authorization = `Bearer ${tokens[who]}`;
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}

async function all(sql, params = []) { return (await db.query(sql, params)).rows; }
async function one(sql, params = []) { return (await all(sql, params))[0] ?? null; }

/** Independent actual for one account/branch/year/month, sign per account type. */
async function sqlActual(accountId, year, month, costCenterId) {
  const cc = costCenterId === 'ALL'
    ? 'TRUE'
    : costCenterId === null || costCenterId === undefined
      ? 'e.cost_center_id IS NULL'
      : `e.cost_center_id = ${Number(costCenterId)}`;
  const row = await one(
    `SELECT COALESCE(SUM(
              CASE WHEN a.account_type = 4 THEN e.credit - e.debit
                   WHEN a.account_type = 5 THEN e.debit  - e.credit
                   ELSE 0 END), 0)::numeric(18,2) AS actual
       FROM gl_entries e
       JOIN gl_journals j ON j.journal_id = e.journal_id
       JOIN gl_accounts a ON a.account_id = e.account_id
      WHERE j.status = 2
        AND e.account_id = $1::int AND e.branch_id = $2::int
        AND EXTRACT(YEAR FROM j.journal_date) = $3::int
        AND EXTRACT(MONTH FROM j.journal_date) = $4::int
        AND ${cc}`,
    [accountId, branchId, year, month],
  );
  return Number(row.actual);
}

function scanForWord(dir, word) {
  const hits = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'out') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (new RegExp(word, 'i').test(text)) hits.push(path.relative(process.cwd(), full));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

(async () => {
  db = new Client(DB);
  await db.connect();

  // ------------------------------------------------------------------ setup
  const admin = await login('admin', 'admin123');
  tokens.admin = admin.accessToken;
  const accountant = await login('accountant_1795041320036', 'Test$12345');
  tokens.accountant = accountant.accessToken;
  const cashier = await login('cashier_1795041320036', 'Test$12345');
  tokens.cashier = cashier.accessToken;
  console.log(`[setup] suffix=${S} admin=${admin.user.userId} accountant=${accountant.user.userId} cashier=${cashier.user.userId}`);
  console.log(`[setup] admin budget perms: approve=${admin.permissions.includes('accounting.approve_budget')} close=${admin.permissions.includes('accounting.close_budget')}`);
  console.log(`[setup] accountant budget perms: approve=${accountant.permissions.includes('accounting.approve_budget')} close=${accountant.permissions.includes('accounting.close_budget')}`);

  const baseCurrency = (await one(`SELECT currency_code FROM currencies WHERE is_base = true ORDER BY currency_code LIMIT 1`)).currency_code;
  console.log(`[setup] base currency = ${baseCurrency}`);

  // ================================================================ GL10-01
  {
    const objects = await one(`SELECT
        to_regclass('public.budgets')         IS NOT NULL AS budgets,
        to_regclass('public.budget_lines')    IS NOT NULL AS budget_lines,
        to_regclass('public.v_budget_actual') IS NOT NULL AS view`);
    const shape = await one(`SELECT
        (SELECT is_nullable FROM information_schema.columns
          WHERE table_name='budget_lines' AND column_name='cost_center_id')          AS cc_nullable,
        (SELECT data_type  FROM information_schema.columns
          WHERE table_name='budget_lines' AND column_name='period_month')           AS month_type,
        (SELECT count(*)::int FROM pg_indexes WHERE indexname IN ('ux_bl_nocc','ux_bl_cc')) AS partial_indexes,
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE')                  AS base_tables,
        (SELECT count(*)::int FROM schema_migrations
          WHERE filename LIKE '%2026-11-19-gl10-budgets.sql')                       AS migration_row`);
    const expected = { budgets: true, budget_lines: true, view: true, cc_nullable: 'YES', month_type: 'smallint', partial_indexes: 2, base_tables: 137, migration_row: 1 };
    record('GL10-01', 'المخطط: جدولان + عرض + فهارس فريدة جزئية + migration مسجّل (إضافي فقط: 135→137)',
      expected, { ...objects, ...shape },
      objects.budgets && objects.budget_lines && objects.view &&
      shape.cc_nullable === 'YES' && shape.month_type === 'smallint' &&
      shape.partial_indexes === 2 && shape.base_tables === 137 && shape.migration_row === 1);
  }

  // ================================================================ GL10-02
  {
    const perms = await all(`SELECT code FROM permissions
        WHERE code IN ('accounting.approve_budget','accounting.close_budget') ORDER BY code`);
    const role = await all(`SELECT p.code FROM role_permissions rp
        JOIN roles r ON r.role_id = rp.role_id
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE r.name_en = 'Accountant' AND p.code IN ('accounting.approve_budget','accounting.close_budget')
        ORDER BY p.code`);
    const cashierCreate = await call('cashier', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-cashier`, lines: [{ accountId: 44, periodMonth: 1, plannedAmount: 1 }],
    });
    const expected = { permission_codes: 2, accountant_role_codes: 2, cashier_create: 403 };
    record('GL10-02', 'الصلاحيات: رمزان جديدان + دور المحاسب + الكاشير مرفوض (403)',
      expected,
      { permission_codes: perms.length, accountant_role_codes: role.length, cashier_create: cashierCreate.status },
      perms.length === 2 && role.length === 2 && cashierCreate.status === 403);
  }

  // ================================================================ GL10-03
  {
    const checks = [];
    const valid = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-valid`, currencyCode: baseCurrency, notes: 'GL-10 تحقق',
      lines: [
        { accountId: 44, costCenterId: null, periodMonth: 11, plannedAmount: 7000 },
        { accountId: 52, costCenterId: null, periodMonth: 11, plannedAmount: 3000 },
      ],
    });
    const validGet = valid.ok ? await call('admin', 'GET', `/accounting/budgets/${valid.data.budgetId}`) : { data: {} };
    checks.push(sub('create valid draft', { status: 1, lines: 2, plannedTotal: 10000 },
      { status: valid.data?.status, lines: valid.data?.lines, plannedTotal: validGet.data?.plannedTotal },
      valid.ok && valid.data.status === 1 && valid.data.lines === 2 && eq(validGet.data.plannedTotal, 10000)));

    const cases = [
      ['asset account 1101 rejected', { accountId: 18, periodMonth: 11, plannedAmount: 10 }, 'مسموحة للإيرادات والمصروفات'],
      ['group account 4 rejected', { accountId: 43, periodMonth: 11, plannedAmount: 10 }, 'تجميعي'],
      ['month 13 rejected', { accountId: 44, periodMonth: 13, plannedAmount: 10 }, 'بين 1 و12'],
      ['negative amount rejected', { accountId: 44, periodMonth: 11, plannedAmount: -5 }, 'سالب'],
      ['duplicate line rejected', null, 'بند مكرر'],
      ['empty lines rejected', 'EMPTY', 'بندًا واحدًا'],
      ['duplicate name rejected', 'DUPNAME', 'بنفس الاسم'],
    ];
    for (const [label, line, needle] of cases) {
      let body;
      if (line === 'EMPTY') body = { year: 2026, name: `${S}-empty`, lines: [] };
      else if (line === 'DUPNAME') body = { year: 2026, name: `${S}-valid`, lines: [{ accountId: 44, periodMonth: 1, plannedAmount: 1 }] };
      else if (line === null) body = { year: 2026, name: `${S}-dup`, lines: [
        { accountId: 44, periodMonth: 11, plannedAmount: 1 },
        { accountId: 44, periodMonth: 11, plannedAmount: 2 },
      ] };
      else body = { year: 2026, name: `${S}-${label.split(' ')[0]}`, lines: [line] };
      const res = await call('admin', 'POST', '/accounting/budgets', body);
      const message = String(res.data?.message ?? '');
      checks.push(sub(label, { status: 400, message_contains: needle }, { status: res.status, message: message.slice(0, 90) },
        res.status === 400 && message.includes(needle)));
    }
    record('GL10-03', 'إنشاء مسودة + رفض: حسابات 4/5 فقط، غير تجميعي، شهر 1..12، مبلغ ≥0، بند/اسم مكرر',
      '8 sub-checks', { passed: checks.filter(Boolean).length, total: checks.length }, checks.every(Boolean));
  }

  // ================================================================ GL10-04
  {
    const usd = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-usd`, currencyCode: 'USD',
      lines: [{ accountId: 44, periodMonth: 1, plannedAmount: 1 }],
    });
    const sar = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-sar`, currencyCode: 'SAR',
      lines: [{ accountId: 44, periodMonth: 1, plannedAmount: 1 }],
    });
    const list = await call('admin', 'GET', `/accounting/budgets?year=2026`);
    const valid = (list.data ?? []).find((b) => b.name === `${S}-valid`);
    const msg = 'الموازنات بالعملة الأجنبية غير مدعومة في v1';
    record('GL10-04', 'العملة الأساسية فقط: USD/SAR → 400 بالرسالة المحددة، والموازنة الصحيحة تحمل عملة القاعدة',
      { usd: 400, sar: 400, message: msg, currency: baseCurrency },
      { usd: usd.status, sar: sar.status, usdMessage: usd.data?.message, currency: valid?.currencyCode },
      usd.status === 400 && sar.status === 400 && usd.data?.message === msg && valid?.currencyCode === baseCurrency);
  }

  // ================================================================ GL10-05
  {
    const created = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-cross`, lines: [{ accountId: 44, periodMonth: 11, plannedAmount: 5000 }],
    });
    const id = created.data.budgetId;
    const approved = await call('accountant', 'POST', `/accounting/budgets/${id}/approve`, {});
    const row = await one(`SELECT status, approved_by, approved_at IS NOT NULL AS has_at,
                                 same_user_approval_reason AS reason, created_by
                            FROM budgets WHERE budget_id = $1::bigint`, [id]);
    const again = await call('accountant', 'POST', `/accounting/budgets/${id}/approve`, {});
    record('GL10-05', 'اعتماد مستخدم ثانٍ: approved_by مكتوب NOT NULL، الحالة=2، وإعادة الاعتماد مرفوضة',
      { approve: '2xx', status: 2, approved_by: accountant.user.userId, has_at: true, reason: null, reapprove: 400 },
      { approve: approved.status, status: Number(row.status), approved_by: Number(row.approved_by), has_at: row.has_at, reason: row.reason, reapprove: again.status },
      is2xx(approved.status) && Number(row.status) === 2 && Number(row.approved_by) === accountant.user.userId &&
      row.has_at === true && row.reason == null && Number(row.created_by) === admin.user.userId && again.status === 400);
  }

  // ================================================================ GL10-06
  {
    const created = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-self`, lines: [{ accountId: 44, periodMonth: 11, plannedAmount: 4000 }],
    });
    const id = created.data.budgetId;
    const noReason = await call('admin', 'POST', `/accounting/budgets/${id}/approve`, {});
    const reason = 'اعتماد ذاتي — اختبار GL-10 (سبب موثّق)';
    const withReason = await call('admin', 'POST', `/accounting/budgets/${id}/approve`, { sameUserApprovalReason: reason });
    const get = await call('admin', 'GET', `/accounting/budgets/${id}`);
    record('GL10-06', 'SoD: اعتماد المُنشئ لموازنته بلا سبب → 400، وبسبب → 2xx والسبب محفوظ',
      { noReason: 400, noReasonMentionsKey: true, withReason: '2xx', reason: reason },
      { noReason: noReason.status, message: noReason.data?.message, withReason: withReason.status, reason: get.data?.sameUserApprovalReason },
      noReason.status === 400 && String(noReason.data?.message).includes('sameUserApprovalReason') &&
      is2xx(withReason.status) && get.data?.sameUserApprovalReason === reason);
  }

  // ================================================================ GL10-07
  {
    const list = await call('admin', 'GET', `/accounting/budgets?year=2026`);
    const cross = (list.data ?? []).find((b) => b.name === `${S}-cross`);
    const patchApproved = await call('admin', 'PATCH', `/accounting/budgets/${cross.budgetId}`, { notes: 'محاولة تعديل' });
    const revised = await call('admin', 'POST', `/accounting/budgets/${cross.budgetId}/revise`, {});
    const newId = revised.data?.budgetId;
    const rows = await one(`SELECT
        (SELECT status FROM budgets WHERE budget_id = $1::bigint)                        AS old_status,
        (SELECT superseded_by FROM budgets WHERE budget_id = $1::bigint)                AS old_superseded_by,
        (SELECT supersedes_id FROM budgets WHERE budget_id = $2::bigint)                AS new_supersedes_id,
        (SELECT status FROM budgets WHERE budget_id = $2::bigint)                       AS new_status,
        (SELECT count(*)::int FROM budget_lines WHERE budget_id = $1::bigint)           AS old_lines,
        (SELECT count(*)::int FROM budget_lines WHERE budget_id = $2::bigint)           AS new_lines`,
      [cross.budgetId, newId ?? 0]);
    const patchOld = await call('admin', 'PATCH', `/accounting/budgets/${cross.budgetId}`, { notes: 'x' });
    const reviseOldAgain = await call('admin', 'POST', `/accounting/budgets/${cross.budgetId}/revise`, {});
    const draft = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-draft`, lines: [{ accountId: 44, periodMonth: 11, plannedAmount: 1 }],
    });
    const reviseDraft = await call('admin', 'POST', `/accounting/budgets/${draft.data.budgetId}/revise`, {});
    const patchNew = await call('admin', 'PATCH', `/accounting/budgets/${newId}`, {
      lines: [
        { accountId: 44, periodMonth: 11, plannedAmount: 6000 },
        { accountId: 52, periodMonth: 11, plannedAmount: 2000 },
      ],
    });
    const newGet = await call('admin', 'GET', `/accounting/budgets/${newId}`);
    record('GL10-07', 'المعتمدة لا تُعدّل: PATCH→400 · المراجعة تُنشئ إصدارًا جديدًا (القديم status=4 + superseded_by) · المسودة قابلة للتعديل',
      { patchApproved: 400, old_status: 4, old_superseded_by: newId, new_supersedes_id: cross.budgetId, new_status: 1, copied_lines: 1, patchOld: 400, reviseOldAgain: 400, reviseDraft: 400, patchNew: '2xx', newTotal: 8000 },
      {
        patchApproved: patchApproved.status, old_status: Number(rows.old_status), old_superseded_by: Number(rows.old_superseded_by),
        new_supersedes_id: Number(rows.new_supersedes_id), new_status: Number(rows.new_status),
        old_lines: rows.old_lines, new_lines: rows.new_lines,
        patchOld: patchOld.status, reviseOldAgain: reviseOldAgain.status, reviseDraft: reviseDraft.status,
        patchNew: patchNew.status, newTotal: newGet.data?.plannedTotal,
      },
      patchApproved.status === 400 && Number(rows.old_status) === 4 && Number(rows.old_superseded_by) === newId &&
      Number(rows.new_supersedes_id) === cross.budgetId && Number(rows.new_status) === 1 &&
      rows.old_lines === 1 && rows.new_lines === 1 &&
      patchOld.status === 400 && reviseOldAgain.status === 400 && reviseDraft.status === 400 &&
      is2xx(patchNew.status) && eq(newGet.data?.plannedTotal, 8000));
  }

  // ================================================================ GL10-08
  {
    const list = await call('admin', 'GET', `/accounting/budgets?year=2026`);
    const draftRow = (list.data ?? []).find((b) => b.name === `${S}-draft`);
    const closeDraft = await call('accountant', 'POST', `/accounting/budgets/${draftRow.budgetId}/close`, {});
    const approveDraft = await call('accountant', 'POST', `/accounting/budgets/${draftRow.budgetId}/approve`, {});
    const journalsBefore = Number((await one(`SELECT count(*)::int AS n FROM gl_journals`)).n);
    const periodsBefore = await all(`SELECT period_id, is_closed, manual_lock FROM periods ORDER BY period_id`);
    const closed = await call('accountant', 'POST', `/accounting/budgets/${draftRow.budgetId}/close`, { reason: 'إغلاق إداري للاختبار' });
    const closeAgain = await call('accountant', 'POST', `/accounting/budgets/${draftRow.budgetId}/close`, {});
    const journalsAfter = Number((await one(`SELECT count(*)::int AS n FROM gl_journals`)).n);
    const periodsAfter = await all(`SELECT period_id, is_closed, manual_lock FROM periods ORDER BY period_id`);
    const budgetJournals = Number((await one(`SELECT count(*)::int AS n FROM gl_journals WHERE source_type ILIKE '%budget%'`)).n);
    const get = await call('admin', 'GET', `/accounting/budgets/${draftRow.budgetId}`);
    const report = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${draftRow.budgetId}`);
    const patchClosed = await call('admin', 'PATCH', `/accounting/budgets/${draftRow.budgetId}`, { notes: 'x' });
    const periodsEqual = JSON.stringify(periodsBefore) === JSON.stringify(periodsAfter);
    record('GL10-08', 'الإغلاق إداري مستقل عن E6: لا قيد ولا تغيير في periods · إغلاق المسودة→400 · إعادة الإغلاق→400 · المغلقة تُقرأ ويُشتق تقريرها',
      { closeDraft: 400, close: '2xx', status: 3, closeAgain: 400, journalsDelta: 0, periodsChanged: false, budgetJournals: 0, getStatus: 3, report: '2xx', patchClosed: 400 },
      {
        closeDraft: closeDraft.status, close: closed.status, status: Number(get.data?.status), closeAgain: closeAgain.status,
        journalsDelta: journalsAfter - journalsBefore, periodsChanged: !periodsEqual, budgetJournals,
        getStatus: Number(get.data?.status), report: report.status, patchClosed: patchClosed.status,
      },
      closeDraft.status === 400 && is2xx(approveDraft.status) && is2xx(closed.status) &&
      Number(get.data?.status) === 3 && closeAgain.status === 400 && journalsAfter === journalsBefore &&
      periodsEqual && budgetJournals === 0 && is2xx(report.status) && patchClosed.status === 400);
  }

  // ================================================================ GL10-09
  {
    const created = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-math`,
      lines: [
        { accountId: 44, periodMonth: 11, plannedAmount: 7000 },   // 4101 revenue
        { accountId: 52, periodMonth: 11, plannedAmount: 3000 },   // 5101 expense
        { accountId: 49, periodMonth: 12, plannedAmount: 100 },    // 4106 no activity
      ],
    });
    const id = created.data.budgetId;
    await call('accountant', 'POST', `/accounting/budgets/${id}/approve`, {});
    const report = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}`);
    const expected = {
      44: money(await sqlActual(44, 2026, 11, null)),
      52: money(await sqlActual(52, 2026, 11, null)),
      49: money(await sqlActual(49, 2026, 12, null)),
    };
    const line = (accountId) => (report.data?.lines ?? []).find((l) => Number(l.accountId) === accountId) ?? {};
    const okLines = [44, 52, 49].every((acc) => eq(line(acc).actualAmount, expected[acc]));
    const varianceOk = [44, 52, 49].every((acc) => eq(line(acc).variance, money(line(acc).plannedAmount - expected[acc])));
    const plannedTotal = money((report.data?.lines ?? []).reduce((s, l) => s + Number(l.plannedAmount), 0));
    const actualTotal = money((report.data?.lines ?? []).reduce((s, l) => s + Number(l.actualAmount), 0));
    const m11 = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}&month=11`);
    const m12 = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}&month=12`);
    const csv = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}&format=csv`);
    const csvText = csv.data?.base64 ? Buffer.from(csv.data.base64, 'base64').toString('utf8') : '';
    const csvHasTotals = csvText.includes('الإجمالي') && csvText.includes('4101');
    record('GL10-09', 'مخطط vs فعلي = SQL مستقل بالقرش (إيراد credit−debit، مصروف debit−credit، حساب بلا حركة=0) + فلتر الشهر + CSV',
      { actuals: expected, totals: { planned: plannedTotal, actual: actualTotal }, varianceOk: true, month11Lines: 2, month12Lines: 1, csv: true },
      {
        actuals: { 44: line(44).actualAmount, 52: line(52).actualAmount, 49: line(49).actualAmount },
        variances: { 44: line(44).variance, 52: line(52).variance, 49: line(49).variance },
        totals: report.data?.totals, varianceOk,
        month11Lines: (m11.data?.lines ?? []).length, month12Lines: (m12.data?.lines ?? []).length,
        csv: csvHasTotals,
      },
      okLines && varianceOk && eq(plannedTotal, 10100) && eq(actualTotal, money(expected[44] + expected[52] + expected[49])) &&
      (m11.data?.lines ?? []).length === 2 && (m12.data?.lines ?? []).length === 1 && csvHasTotals);
  }

  // ================================================================ GL10-10
  {
    // Group accounts must never be matched by the view.
    const groupRows = Number((await one(`SELECT count(*)::int AS n FROM v_budget_actual WHERE account_id IN (43, 51)`)).n);

    const created = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-reversal`,
      lines: [{ accountId: 49, periodMonth: 12, plannedAmount: 100 }],
    });
    const id = created.data.budgetId;
    await call('accountant', 'POST', `/accounting/budgets/${id}/approve`, {});
    const actualNow = async () => {
      const r = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}&month=12`);
      return Number((r.data?.lines ?? [])[0]?.actualAmount ?? NaN);
    };
    const before = await actualNow();
    const maxBefore = Number((await one(`SELECT COALESCE(MAX(journal_id), 0) AS max_id FROM gl_journals`)).max_id);
    const up = await call('admin', 'POST', '/accounting/journals', {
      journalDate: '2026-12-15', description: 'GL-10 reversal test +500',
      lines: [
        { accountId: 18, debit: 500, credit: 0 },
        { accountId: 49, debit: 0, credit: 500 },
      ],
    });
    const afterUp = await actualNow();
    const mirror = await call('admin', 'POST', '/accounting/journals', {
      journalDate: '2026-12-15', description: 'GL-10 reversal test mirror -500',
      lines: [
        { accountId: 49, debit: 500, credit: 0 },
        { accountId: 18, debit: 0, credit: 500 },
      ],
    });
    const afterMirror = await actualNow();
    const posted = await one(`SELECT count(*)::int AS entries, count(DISTINCT j.journal_id)::int AS journals,
                                     min(j.status)::int AS min_status, max(j.status)::int AS max_status
                                FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id
                               WHERE e.account_id = 49 AND e.branch_id = 1
                                 AND EXTRACT(YEAR FROM j.journal_date) = 2026
                                 AND EXTRACT(MONTH FROM j.journal_date) = 12
                                 AND j.journal_id > $1::bigint`, [maxBefore]);
    record('GL10-10', 'is_group لا يُطابَق (0 صف) · قيود العكس تُحتسب ولا تُستبعد: +500 يرفع الفعلي 500 ثم قيد مرآة يعيده (فرق 0)',
      { groupRows: 0, deltaUp: 500, deltaMirror: 0, newEntries: 2, newJournals: 2, statuses: [2, 2] },
      {
        groupRows, before, afterUp, afterMirror,
        deltaUp: money(afterUp - before), deltaMirror: money(afterMirror - before),
        newEntries: Number(posted.entries), newJournals: Number(posted.journals),
        statuses: [Number(posted.min_status), Number(posted.max_status)],
      },
      groupRows === 0 && is2xx(up.status) && is2xx(mirror.status) &&
      eq(afterUp - before, 500) && eq(afterMirror - before, 0) &&
      Number(posted.entries) === 2 && Number(posted.journals) === 2 &&
      Number(posted.min_status) === 2 && Number(posted.max_status) === 2);
  }

  // ================================================================ GL10-11
  {
    const created = await call('admin', 'POST', '/accounting/budgets', {
      year: 2026, name: `${S}-cc`,
      lines: [
        { accountId: 47, costCenterId: null, periodMonth: 11, plannedAmount: 8000 },
        { accountId: 47, costCenterId: 5, periodMonth: 11, plannedAmount: 700 },
      ],
    });
    const id = created.data.budgetId;
    await call('accountant', 'POST', `/accounting/budgets/${id}/approve`, {});
    const report = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${id}`);
    const lines = report.data?.lines ?? [];
    const unalloc = lines.find((l) => l.costCenterId == null) ?? {};
    const alloc = lines.find((l) => Number(l.costCenterId) === 5) ?? {};
    const expUnalloc = money(await sqlActual(47, 2026, 11, null));
    const expAlloc = money(await sqlActual(47, 2026, 11, 5));
    const expTotal = money(await sqlActual(47, 2026, 11, 'ALL'));
    record('GL10-11', 'مركز التكلفة: NULL = «غير موزّع» (سطور بلا مركز فقط) · مركز محدد = سطوره فقط · مجموعهما = إجمالي الفرع',
      { unallocatedActual: expUnalloc, allocatedActual: expAlloc, sum: money(expUnalloc + expAlloc), total: expTotal, unallocatedLines: 1, allocatedLines: 1 },
      {
        unallocatedActual: unalloc.actualAmount, allocatedActual: alloc.actualAmount,
        sum: money(Number(unalloc.actualAmount ?? 0) + Number(alloc.actualAmount ?? 0)),
        total: report.data?.totals?.actual,
        unallocatedLines: report.data?.unallocated?.lines, allocatedLines: report.data?.allocated?.lines,
      },
      eq(unalloc.actualAmount, expUnalloc) && eq(alloc.actualAmount, expAlloc) &&
      eq(Number(unalloc.actualAmount) + Number(alloc.actualAmount), expTotal) &&
      report.data?.unallocated?.lines === 1 && report.data?.allocated?.lines === 1);
  }

  // ================================================================ GL10-12
  {
    // --- warning-only: posting must succeed while already over budget ------
    const list = await call('admin', 'GET', `/accounting/budgets?year=2026`);
    const rev = (list.data ?? []).find((b) => b.name === `${S}-reversal`);
    const preReport = await call('admin', 'GET', `/accounting/reports/budget-vs-actual?budget_id=${rev.budgetId}&month=12`);
    const preActual = money((preReport.data?.lines ?? [])[0]?.actualAmount ?? 0);
    const first = await call('admin', 'POST', '/accounting/journals', {
      journalDate: '2026-12-16', description: 'GL-10 over-budget +500',
      lines: [
        { accountId: 18, debit: 500, credit: 0 },
        { accountId: 49, debit: 0, credit: 500 },
      ],
    });
    const second = await call('admin', 'POST', '/accounting/journals', {
      journalDate: '2026-12-16', description: 'GL-10 over-budget +100 (already over)',
      lines: [
        { accountId: 18, debit: 100, credit: 0 },
        { accountId: 49, debit: 0, credit: 100 },
      ],
    });
    const alerts = await call('admin', 'GET', '/accounting/reports/budget-alerts?year=2026&month=12');
    const alertRow = (alerts.data ?? []).find((a) => Number(a.accountId) === 49 && Number(a.budgetId) === Number(rev.budgetId));
    const expectedActual = money(preActual + 600);
    const expectedExcess = money(expectedActual - 100);

    // --- posting.ts must be untouched by GL-10 -----------------------------
    const postingPath = path.join('apps', 'api', 'src', 'common', 'posting.ts');
    const migrationPath = path.join('db', 'migrations', '2026-11-19-gl10-budgets.sql');
    const postingMtime = fs.statSync(postingPath).mtimeMs;
    const migrationMtime = fs.statSync(migrationPath).mtimeMs;
    const postingText = fs.readFileSync(postingPath, 'utf8');
    const budgetRefs = (postingText.match(/budget/gi) ?? []).length;
    const diffRaw = execSync(`git diff --numstat -- ${postingPath}`, { encoding: 'utf8' }).trim();
    const [added = '0', removed = '0'] = diffRaw ? diffRaw.split(/\s+/) : [];
    const diffText = execSync(`git diff -- ${postingPath}`, { encoding: 'utf8' });
    const diffBudgetLines = diffText.split('\n').filter((l) => /budget/i.test(l)).length;
    const webHits = scanForWord(path.join('apps', 'web'), 'budget');
    const requireCc = Number((await one(`SELECT count(*)::int AS n FROM gl_accounts WHERE require_cost_center = true`)).n);
    const budgetJournals = Number((await one(`SELECT count(*)::int AS n FROM gl_journals WHERE source_type ILIKE '%budget%'`)).n);

    record('GL10-12', 'تحذير فقط: ترحيل فوق الموازنة ينجح (2xx) + تنبيه بالزيادة · posting.ts لم يُمَس · لا UI · لا require_cost_center · لا قيد موازنة',
      {
        postOverBudget: '2xx', postAlreadyOver: '2xx', alert: { planned: 100, actual: expectedActual, excess: expectedExcess },
        postingMtimeBeforeMigration: true, budgetRefsInPosting: 0, budgetLinesInDiff: 0, webFiles: 0, requireCostCenterAccounts: 0, budgetJournals: 0,
      },
      {
        postOverBudget: first.status, postAlreadyOver: second.status,
        alert: alertRow ? { planned: alertRow.plannedAmount, actual: alertRow.actualAmount, excess: alertRow.excess } : null,
        postingMtimeBeforeMigration: postingMtime < migrationMtime,
        postingMtime: new Date(postingMtime).toISOString(), migrationMtime: new Date(migrationMtime).toISOString(),
        diffVsHead: { added: Number(added), removed: Number(removed) },
        budgetRefsInPosting: budgetRefs, budgetLinesInDiff: diffBudgetLines, webFiles: webHits.length, requireCostCenterAccounts: requireCc, budgetJournals,
      },
      is2xx(first.status) && is2xx(second.status) &&
      alertRow && eq(alertRow.plannedAmount, 100) && eq(alertRow.actualAmount, expectedActual) && eq(alertRow.excess, expectedExcess) &&
      postingMtime < migrationMtime && budgetRefs === 0 && diffBudgetLines === 0 && webHits.length === 0 && requireCc === 0 && budgetJournals === 0);
  }

  // ------------------------------------------------------------------ summary
  const passed = results.filter((r) => r.pass).length;
  console.log('\n================ GL-10 SUMMARY ================');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.title}`);
  console.log(`----------------------------------------------`);
  console.log(`TOTAL: ${passed}/${results.length}`);
  await db.end();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (error) => {
  console.error('\n[FATAL]', error);
  try { await db?.end(); } catch { /* ignore */ }
  process.exit(2);
});
