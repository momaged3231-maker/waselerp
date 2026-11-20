'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { formatDocumentDateTime, formatStampForExport, localTodayIso, useDisplayTimezone } from '@/lib/time';
import { useSession } from '@/lib/session';
import { downloadCsv } from '@/lib/export';

/** Tools → «المعاملات البنكية» — per-account statement with running balance + new entry form. */
export default function BankTransactionsScreen() {
  const { can } = useSession();
  const timeZone = useDisplayTimezone();
  const canManage = can('cash.manage');

  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(() => localTodayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(() => localTodayIso());
  const [statement, setStatement] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({ direction: 1, amount: '', transactionDate: localTodayIso(), categoryId: '', description: '' });
  const [error, setError] = useState('');

  async function loadStatement() {
    if (!accountId) { setStatement(null); return; }
    setError('');
    const qs = new URLSearchParams({ from, to });
    const data = await apiFetch<any>(`/treasury/accounts/${accountId}/statement?${qs.toString()}`);
    setStatement(data);
  }

  async function addMovement(event: React.FormEvent) {
    event.preventDefault();
    if (!accountId) { setError('اختر الحساب أولًا'); return; }
    setError('');
    try {
      await apiFetch('/treasury/transactions', {
        method: 'POST',
        body: {
          cashAccountId: Number(accountId),
          direction: Number(form.direction),
          amount: Number(form.amount),
          transactionDate: form.transactionDate || undefined,
          categoryId: form.categoryId ? Number(form.categoryId) : undefined,
          description: form.description || undefined,
        },
      });
      setForm({ ...form, amount: '', description: '' });
      await loadStatement();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحفظ'); }
  }

  useEffect(() => {
    apiFetch<any[]>('/treasury/accounts').then((rows) => setAccounts((rows ?? []).filter((r: any) => Number(r.type) === 2))).catch(() => {});
    apiFetch<any[]>('/treasury/categories').then(setCategories).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadStatement().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accountId]);

  const totalIn = (statement?.items ?? []).filter((r: any) => Number(r.direction) === 1).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalOut = (statement?.items ?? []).filter((r: any) => Number(r.direction) === 2).reduce((s: number, r: any) => s + Number(r.amount), 0);

  function exportCsv() {
    if (!statement) return;
    downloadCsv(`wasel-bank-${accountId}`, statement.items.map((row: any) => ({
      'التاريخ': formatStampForExport(row.transactionDate, row.createdAt, timeZone), 'البيان': row.description ?? '', 'الطرف': row.partyName ?? '',
      'وارد': Number(row.direction) === 1 ? Number(row.amount) : 0, 'صادر': Number(row.direction) === 2 ? Number(row.amount) : 0,
      'الرصيد': Number(row.balance), 'الفئة': row.categoryName ?? '',
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">الحساب البنكي</label>
          <select className="input w-56" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— اختر —</option>
            {accounts.map((a: any) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}{a.bankName ? ` — ${a.bankName}` : ''}{a.accountNo ? ` · ${a.accountNo}` : ''}</option>)}
          </select>
        </div>
        <div><label className="label">من</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">إلى</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn-primary" onClick={() => loadStatement()}>عرض</button>
        <button className="btn-soft" onClick={exportCsv} disabled={!statement?.items?.length}>تصدير CSV</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      {statement && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'الرصيد الافتتاحي', value: formatMoney(statement.opening ?? 0) },
              { label: 'إجمالي الوارد', value: formatMoney(totalIn) },
              { label: 'إجمالي الصادر', value: formatMoney(totalOut) },
              { label: 'الرصيد الختامي', value: formatMoney(statement.totals?.balance ?? 0) },
            ].map((card) => (
              <div key={card.label} className="card p-4">
                <div className="text-[11px] text-slate-500">{card.label}</div>
                <div className="text-lg font-extrabold text-slate-800 mt-1">{card.value}</div>
              </div>
            ))}
          </div>

          {canManage && (
            <form onSubmit={addMovement} className="card p-4 grid sm:grid-cols-6 gap-2 items-end">
              <div className="sm:col-span-1">
                <label className="label">نوع الحركة</label>
                <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: Number(e.target.value) })}>
                  <option value={1}>وارد (إيداع)</option>
                  <option value={2}>صادر (سحب/مصروف)</option>
                </select>
              </div>
              <div><label className="label">القيمة</label><input className="input" type="number" step="0.01" min={0} dir="ltr" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="label">التاريخ</label><input className="input" type="date" value={form.transactionDate} onChange={(e) => setForm({ ...form, transactionDate: e.target.value })} /></div>
              <div>
                <label className="label">الفئة</label>
                <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">— بدون —</option>
                  {categories.filter((c: any) => Number(c.direction) === Number(form.direction)).map((c: any) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">البيان</label>
                <input className="input" placeholder="إيداع شيكات / مصروف تشغيلي…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <button type="submit" className="btn-primary sm:col-span-6">تسجيل الحركة</button>
            </form>
          )}

          <div className="card">
            <div className="card-title"><span>الحركات ({(statement.items ?? []).length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>التاريخ والوقت</th><th>البيان</th><th>الطرف</th><th>وارد</th><th>صادر</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {(statement.items ?? []).map((row: any) => (
                    <tr key={row.transactionId}>
                      <td className="whitespace-nowrap">{formatDocumentDateTime(row.transactionDate, row.createdAt, timeZone)}</td>
                      <td>{row.description ?? '—'}{row.categoryName ? <span className="text-[10px] text-slate-400 mr-1">· {row.categoryName}</span> : null}</td>
                      <td className="text-slate-500">{row.partyName ?? '—'}</td>
                      <td className="text-emerald-700">{Number(row.direction) === 1 ? formatMoney(row.amount) : '—'}</td>
                      <td className="text-rose-600">{Number(row.direction) === 2 ? formatMoney(row.amount) : '—'}</td>
                      <td className="font-bold">{formatMoney(row.balance)}</td>
                    </tr>
                  ))}
                  {(statement.items ?? []).length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد حركات في الفترة</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
