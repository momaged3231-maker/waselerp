'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import { downloadCsv } from '@/lib/export';

const STATUS: Record<number, string> = { 1: 'تحت التحصيل', 2: 'محصّل', 3: 'مرتد', 4: 'ملغي' };
const DIR: Record<number, string> = { 1: 'قبض (وارد)', 2: 'صرف (صادر)' };

/**
 * Tools → «أوراق القبض والدفع» — register notes receivable/payable with journals:
 * issuing a قبض posts Dr notes receivable / Cr AR (+ party ledger), issuing a صرف posts
 * Dr AP / Cr notes payable. Collecting moves cash between the drawer/bank and the note.
 * Bounced/cancelled notes reverse the issuance (and the party ledger).
 */
export default function ChecksScreen() {
  const { can } = useSession();
  const canManage = can('accounting.manage');

  const [rows, setRows] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [status, setStatus] = useState(0);
  const [direction, setDirection] = useState(0);
  const [search, setSearch] = useState('');
  const [collectAccountId, setCollectAccountId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ direction: 1, checkNo: '', bankName: '', amount: '', dueDate: '', partyId: '', cashAccountId: '', notes: '' });

  async function load() {
    const qs = new URLSearchParams();
    if (status) qs.set('status', String(status));
    if (direction) qs.set('direction', String(direction));
    if (search.trim()) qs.set('search', search.trim());
    setRows(await apiFetch(`/checks${qs.toString() ? `?${qs}` : ''}`));
  }

  useEffect(() => {
    apiFetch<any>('/parties?type=0&pageSize=200').then((d) => setParties(d?.items ?? d ?? [])).catch(() => {});
    apiFetch<any[]>('/treasury/accounts').then(setAccounts).catch(() => {});
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, direction]);

  async function create() {
    setError(''); setMessage('');
    try {
      await apiFetch('/checks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          direction: Number(form.direction),
          amount: Number(form.amount),
          partyId: form.partyId ? Number(form.partyId) : null,
          cashAccountId: form.cashAccountId ? Number(form.cashAccountId) : null,
          dueDate: form.dueDate || null,
        }),
      });
      setMessage('تم تسجيل الورقة المالية');
      setForm({ direction: 1, checkNo: '', bankName: '', amount: '', dueDate: '', partyId: '', cashAccountId: '', notes: '' });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function setCheckStatus(id: number, st: number) {
    setError('');
    try {
      await apiFetch(`/checks/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: st, cashAccountId: collectAccountId ? Number(collectAccountId) : undefined }),
      });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  function exportCsv() {
    downloadCsv('wasel-checks', rows.map((row: any) => ({
      'الرقم': row.checkNo, 'الاتجاه': DIR[row.direction] || row.direction, 'الطرف': row.partyName ?? '',
      'البنك': row.bankName ?? '', 'القيمة': Number(row.amount), 'الاستحقاق': row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      'الحالة': STATUS[row.status] || row.status,
    })));
  }

  const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {message && <div className="text-green-700 text-sm">{message}</div>}

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <select className="input w-40" value={direction} onChange={(e) => setDirection(Number(e.target.value))}>
          <option value={0}>كل الاتجاهات</option>
          <option value={1}>قبض (وارد)</option>
          <option value={2}>صرف (صادر)</option>
        </select>
        <select className="input w-40" value={status} onChange={(e) => setStatus(Number(e.target.value))}>
          <option value={0}>كل الحالات</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input w-52" placeholder="بحث بالرقم/الطرف/البنك" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <div className="flex-1" />
        <select className="input w-48" value={collectAccountId} onChange={(e) => setCollectAccountId(e.target.value)} title="حساب غير مسجّل يُستخدم عند التحصيل">
          <option value="">حساب افتراضي للتحصيل</option>
          {accounts.map((a: any) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
        </select>
        <button className="btn-soft text-xs" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
      </div>

      {canManage && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold">تسجيل ورقة مالية</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: Number(e.target.value) })}>
              <option value={1}>قبض (وارد) — استلام من عميل</option>
              <option value={2}>صرف (صادر) — سداد لمورد</option>
            </select>
            <input className="input" placeholder="رقم الورقة *" value={form.checkNo} onChange={(e) => setForm({ ...form, checkNo: e.target.value })} />
            <input className="input" placeholder="البنك / الجهة" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            <input className="input" type="number" placeholder="القيمة *" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            <select className="input" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
              <option value="">الطرف (اختياري)</option>
              {parties.map((p: any) => <option key={p.partyId} value={p.partyId}>{p.name}</option>)}
            </select>
            <select className="input" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}>
              <option value="">حساب الخزينة للتحصيل (اختياري)</option>
              {accounts.map((a: any) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
            </select>
            <input className="input" placeholder="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="text-[11px] text-slate-400">الاستلام يُنشئ قيد: مدين «أوراق قبض» / دائن «ذمم العملاء» (أو العكس للصرف) ويُقيّد في دفتر الطرف.</div>
          <button className="btn-primary" onClick={create}>حفظ</button>
        </div>
      )}

      <div className="card table-wrap">
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="font-semibold text-slate-700">الأوراق ({rows.length}) — إجمالي {formatMoney(total)}</div>
        </div>
        <table className="table">
          <thead><tr><th>#</th><th>الرقم</th><th>الاتجاه</th><th>الطرف</th><th>البنك</th><th>القيمة</th><th>الاستحقاق</th><th>الحساب</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.checkId}>
                <td>{r.checkId}</td>
                <td className="font-medium">{r.checkNo}</td>
                <td>{DIR[r.direction] || r.direction}</td>
                <td>{r.partyName || '-'}</td>
                <td>{r.bankName || '-'}</td>
                <td className="font-bold">{formatMoney(Number(r.amount || 0))}</td>
                <td>{r.dueDate ? formatDate(r.dueDate) : '-'}</td>
                <td className="text-xs">{r.cashAccountName || '-'}</td>
                <td><span className={`badge ${r.status === 1 ? 'bg-amber-50 text-amber-700' : r.status === 2 ? 'bg-emerald-50 text-emerald-700' : r.status === 3 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{STATUS[r.status] || r.status}</span></td>
                <td className="whitespace-nowrap">
                  {canManage && Number(r.status) === 1 && (
                    <>
                      <button className="text-emerald-700 text-xs font-semibold" onClick={() => setCheckStatus(r.checkId, 2)}>تحصيل</button>
                      <button className="text-rose-600 text-xs font-semibold mr-2" onClick={() => setCheckStatus(r.checkId, 3)}>ارتداد</button>
                      <button className="text-slate-500 text-xs mr-2" onClick={() => setCheckStatus(r.checkId, 4)}>إلغاء</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-6">لا توجد أوراق</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
