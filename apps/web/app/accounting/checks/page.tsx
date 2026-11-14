'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const STATUS: Record<number, string> = { 1: 'تحت التحصيل', 2: 'محصّل', 3: 'مرتد', 4: 'ملغي' };
const DIR: Record<number, string> = { 1: 'قبض (وارد)', 2: 'صرف (صادر)' };

export default function ChecksPage() {
  const { can } = useSession();
  const canManage = can('accounting.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState(0);
  const [direction, setDirection] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ direction: 1, checkNo: '', bankName: '', amount: '', dueDate: '', partyId: '', cashAccountId: '', notes: '' });

  async function load() {
    const qs = new URLSearchParams();
    if (status) qs.set('status', String(status));
    if (direction) qs.set('direction', String(direction));
    setRows(await apiFetch(`/checks${qs.toString() ? `?${qs}` : ''}`));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [status, direction]);

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
      setMessage('تم تسجيل الشيك');
      setForm({ direction: 1, checkNo: '', bankName: '', amount: '', dueDate: '', partyId: '', cashAccountId: '', notes: '' });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function updateCheckStatus(id: number, st: number) {
    setError('');
    try {
      await apiFetch(`/checks/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: st }) });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <AppShell title="الشيكات وأوراق القبض والدفع">
      <AccountingNav />
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
        </div>

        {canManage && (
          <div className="card p-4 space-y-2">
            <h2 className="font-semibold">تسجيل شيك</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: Number(e.target.value) })}>
                <option value={1}>قبض (وارد)</option>
                <option value={2}>صرف (صادر)</option>
              </select>
              <input className="input" placeholder="رقم الشيك *" value={form.checkNo} onChange={(e) => setForm({ ...form, checkNo: e.target.value })} />
              <input className="input" placeholder="البنك" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              <input className="input" type="number" placeholder="القيمة *" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              <input className="input" type="number" placeholder="رقم الطرف (اختياري)" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })} />
              <input className="input" type="number" placeholder="حساب خزينة (اختياري)" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })} />
              <input className="input" placeholder="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={create}>حفظ</button>
          </div>
        )}

        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>الرقم</th><th>الاتجاه</th><th>الطرف</th><th>البنك</th><th>القيمة</th><th>الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.checkId}>
                  <td>{r.checkId}</td>
                  <td className="font-medium">{r.checkNo}</td>
                  <td>{DIR[r.direction] || r.direction}</td>
                  <td>{r.partyName || '-'}</td>
                  <td>{r.bankName || '-'}</td>
                  <td>{formatMoney(Number(r.amount || 0))}</td>
                  <td>{r.dueDate ? formatDate(r.dueDate) : '-'}</td>
                  <td>{STATUS[r.status] || r.status}</td>
                  <td>
                    {canManage && (
                      <select className="input text-xs w-32" value={r.status} onChange={(e) => updateCheckStatus(r.checkId, Number(e.target.value))}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-6">لا توجد شيكات</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
