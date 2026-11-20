'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatMoney } from '@/lib/api';
import { formatDateTime, useDisplayTimezone } from '@/lib/time';

type Rule = {
  ruleId: number; name: string; description?: string; bankAccountId: number; bankAccountName?: string;
  expenseAccountId: number; expenseAccountCode?: string; expenseAccountName?: string;
  amount: number; frequency: number; frequencyName?: string; dayOfMonth: number;
  startDate: string; endDate?: string | null; counterpartyName?: string;
  isActive: boolean; suspendedAt?: string | null; suspendedReason?: string | null;
  nextOccurrence?: string | null; postedCount?: number; lastGenerated?: string | null;
};
type RunEntry = {
  runId: number; ruleId: number; ruleName: string; periodKey: string;
  status: number; statusName?: string; journalId?: number | null; refusalReason?: string | null; runAt: string;
};
const FREQS: [number, string][] = [[1, 'شهري'], [2, 'ربع سنوي'], [3, 'نصف سنوي'], [4, 'سنوي']];

export default function BankExpensesPage() {
  const timeZone = useDisplayTimezone();
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<Rule | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [runResult, setRunResult] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: '', bankAccountId: 0, expenseAccountId: 0, amount: '', frequency: 1, dayOfMonth: '1',
    startDate: '', endDate: '', counterpartyName: '', description: '',
  });

  const reload = useCallback(async () => {
    const [r, h] = await Promise.all([
      apiFetch<Rule[]>('/accounting/bank-expense-rules'),
      apiFetch<RunEntry[]>('/accounting/bank-expense-rules/runs?status=1'),
    ]);
    setRules(Array.isArray(r) ? r : []);
    setRuns(Array.isArray(h) ? h : []);
  }, []);

  useEffect(() => {
    apiFetch<any>('/treasury/accounts')
      .then((rows) => setAccounts(Array.isArray(rows) ? rows.filter((a: any) => Number(a.type) === 2) : []))
      .catch(() => {});
    apiFetch<any>('/accounting/accounts')
      .then((tree) => {
        const out: { accountId: number; label: string }[] = [];
        const walk = (nodes: any[]) => {
          for (const node of nodes ?? []) {
            if (!node.isGroup && Number(node.accountType) === 5) out.push({ accountId: node.accountId, label: `${node.code} — ${node.name}` });
            if (node.children?.length) walk(node.children);
          }
        };
        walk(Array.isArray(tree) ? tree : []);
        setExpenseAccounts(out);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err?.message ?? 'تعذر تحميل القواعد'));
  }, [reload]);

  const openCreate = () => { setEditing(null); setForm({ name: '', bankAccountId: accounts[0]?.cashAccountId ?? 0, expenseAccountId: 0, amount: '', frequency: 1, dayOfMonth: '1', startDate: new Date().toISOString().slice(0, 10), endDate: '', counterpartyName: '', description: '' }); setCreateOpen(true); };
  const openEdit = (r: Rule) => { setEditing(r); setForm({ name: r.name, bankAccountId: r.bankAccountId, expenseAccountId: r.expenseAccountId, amount: String(r.amount), frequency: r.frequency, dayOfMonth: String(r.dayOfMonth), startDate: r.startDate, endDate: r.endDate ?? '', counterpartyName: r.counterpartyName ?? '', description: r.description ?? '' }); setCreateOpen(true); };

  async function submit() {
    if (!form.name || !form.amount) { setError('الاسم والمبلغ مطلوبان'); return; }
    setBusy(true);
    setError('');
    try {
      const body: any = {
        name: form.name, description: form.description || undefined,
        bankAccountId: Number(form.bankAccountId), expenseAccountId: Number(form.expenseAccountId),
        amount: Number(form.amount), frequency: Number(form.frequency), dayOfMonth: Number(form.dayOfMonth),
        startDate: form.startDate, endDate: form.endDate || undefined,
        counterpartyName: form.counterpartyName || undefined,
      };
      if (editing) {
        await apiFetch(`/accounting/bank-expense-rules/${editing.ruleId}`, { method: 'PUT', body });
      } else {
        await apiFetch('/accounting/bank-expense-rules', { method: 'POST', body });
      }
      setCreateOpen(false);
      setEditing(null);
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ القاعدة');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError('');
    setRunResult(null);
    try {
      const res = await apiFetch('/accounting/bank-expense-rules/run', { method: 'POST', body: {} });
      setRunResult(res);
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر توليد القيود');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: Rule) {
    try {
      await apiFetch(`/accounting/bank-expense-rules/${r.ruleId}/${r.isActive ? 'deactivate' : 'activate'}`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر');
    }
  }

  async function resume(r: Rule) {
    try {
      await apiFetch(`/accounting/bank-expense-rules/${r.ruleId}/resume`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الاستئناف');
    }
  }

  async function confirmSuspend() {
    if (!suspendTarget || !suspendReason.trim()) return;
    try {
      await apiFetch(`/accounting/bank-expense-rules/${suspendTarget.ruleId}/suspend`, { method: 'POST', body: { reason: suspendReason.trim() } });
      setSuspendTarget(null);
      setSuspendReason('');
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الإيقاف');
    }
  }

  const summary = useMemo(() => ({
    active: rules.filter((r) => r.isActive && !r.suspendedAt).length,
    suspended: rules.filter((r) => !!r.suspendedAt).length,
    posted: rules.reduce((s, r) => s + (r.postedCount ?? 0), 0),
    monthly: rules.filter((r) => r.isActive && r.frequency === 1 && !r.suspendedAt).reduce((s, r) => s + r.amount, 0),
  }), [rules]);

  return (
    <AppShell title="الرسوم البنكية الآلية">
      <AccountingNav />

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-4">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          ['قواعد نشطة', String(summary.active)],
          ['قواعد موقوفة', String(summary.suspended)],
          ['قيود مولّدة', String(summary.posted)],
          ['الالتزام الشهري', formatMoney(summary.monthly)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-2 mb-4">
        <div className="text-xs text-slate-500">القيود تتولّد من القواعد النشطة غير الموقوفة فقط — الوقائع القديمة تُرحّل تلقائيًا مرة واحدة فقط.</div>
        <div className="mr-auto flex gap-2">
          <button className="btn-soft" onClick={run} disabled={busy}>تشغيل التوليد</button>
          <button className="btn-primary" onClick={openCreate}>+ قاعدة جديدة</button>
        </div>
      </div>
      {runResult && (
        <div className="card p-3 mb-4 text-xs text-slate-600">
          التوليد: <b>{runResult.posted?.length ?? 0}</b> قيدًا مرحّلًا{runResult.refused?.length ? <> · مرفوض: <b>{runResult.refused.length}</b> ({runResult.refused.map((r: any) => r.reason).join('، ')})</> : <> · لا رفض</>}
        </div>
      )}

      <div className="card p-4 overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr><th>القاعدة</th><th>البنك</th><th>حساب المصروف</th><th>المبلغ</th><th>التكرار</th><th>اليوم</th><th>القادم</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId}>
                <td>
                  <div className="font-bold">{r.name}</div>
                  {r.counterpartyName && <div className="text-[10px] text-slate-400">{r.counterpartyName}</div>}
                </td>
                <td className="text-xs">{r.bankAccountName ?? r.bankAccountId}</td>
                <td className="text-xs">{r.expenseAccountCode} — {r.expenseAccountName}</td>
                <td className="font-num" dir="ltr">{formatMoney(r.amount)}</td>
                <td className="text-xs">{r.frequencyName}</td>
                <td className="text-center">{r.dayOfMonth}</td>
                <td dir="ltr" className="text-xs">{r.nextOccurrence ?? '—'}</td>
                <td>
                  {r.suspendedAt ? <span className="badge bg-amber-100 text-amber-800">موقوفة</span>
                    : r.isActive ? <span className="badge bg-emerald-100 text-emerald-800">نشطة</span>
                    : <span className="badge bg-slate-200 text-slate-700">متوقفة</span>}
                </td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    <button className="btn-soft h-8 px-2 text-xs" onClick={() => openEdit(r)}>تعديل</button>
                    {r.suspendedAt
                      ? <button className="btn-soft h-8 px-2 text-xs" onClick={() => resume(r)}>استئناف</button>
                      : <button className="btn-soft h-8 px-2 text-xs" onClick={() => { setSuspendTarget(r); setSuspendReason(''); }}>إيقاف</button>}
                    <button className="btn-soft h-8 px-2 text-xs" onClick={() => toggleActive(r)}>{r.isActive ? 'إلغاء' : 'تفعيل'}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!rules.length && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-6">لا توجد قواعد بعد — أنشئ قاعدة للبدء.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-3">{editing ? 'تعديل القاعدة' : 'قاعدة جديدة'}</h3>
            <div className="space-y-2">
              <input className="input w-full" placeholder="اسم القاعدة (مثال: رسوم POS الشهرية)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="input w-full" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: Number(e.target.value) })}>
                <option value={0}>— اختر الحساب البنكي —</option>
                {accounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
              </select>
              <select className="input w-full" value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: Number(e.target.value) })}>
                <option value={0}>— اختر حساب المصروف —</option>
                {expenseAccounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="input font-num" dir="ltr" type="number" min={0} placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <select className="input" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>اليوم {d}</option>)}
                </select>
              </div>
              <select className="input w-full" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: Number(e.target.value) })}>
                {FREQS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                <input className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} placeholder="نهاية (اختياري)" />
              </div>
              <input className="input w-full" placeholder="اسم المستفيد (اختياري — للتقرير)" value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} />
              <input className="input w-full" placeholder="وصف (اختياري)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end mt-3">
              <button className="btn-soft" onClick={() => setCreateOpen(false)}>إلغاء</button>
              <button className="btn-primary" onClick={submit} disabled={busy || !form.name || !form.amount}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend modal */}
      {suspendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSuspendTarget(null)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1">إيقاف القاعدة مؤقتًا</h3>
            <p className="text-xs text-slate-500 mb-3">{suspendTarget.name} — لن تتولّد قيود طالما القاعدة موقوفة، ويمكن استئنافها بنفس الزر.</p>
            <input className="input w-full mb-3" autoFocus placeholder="سبب الإيقاف (إلزامي)" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmSuspend()} />
            <div className="flex gap-2 justify-end">
              <button className="btn-soft" onClick={() => setSuspendTarget(null)}>إلغاء</button>
              <button className="btn-primary" onClick={confirmSuspend} disabled={!suspendReason.trim()}>إيقاف</button>
            </div>
          </div>
        </div>
      )}

      {/* Runs history */}
      <div className="card p-4 mt-4 overflow-x-auto">
        <div className="label mb-2">القيود المولّدة حديثًا</div>
        <table className="table w-full text-xs">
          <thead><tr><th>القاعدة</th><th>الواقعة</th><th>الحالة</th><th>القيد</th><th>الوقت</th></tr></thead>
          <tbody>
            {runs.slice(0, 10).map((r) => (
              <tr key={r.runId}>
                <td>{r.ruleName}</td>
                <td dir="ltr">{String(r.periodKey).slice(0, 10)}</td>
                <td>{r.statusName}</td>
                <td dir="ltr">{r.journalId ? `#${r.journalId}` : '—'}</td>
                <td className="text-slate-400 whitespace-nowrap">{formatDateTime(r.runAt, timeZone, true)}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={5} className="text-center text-slate-400 py-4">لم تتولّد أي قيود بعد</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
