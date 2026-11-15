'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const empty = { bankId: undefined as any, code: '', name: '', nameEn: '', isActive: true, notes: '' };

/** Banks master (definitions). Bank accounts link to these records. */
export default function BanksScreen() {
  const { can } = useSession();
  const canManage = can('cash.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/catalog/banks')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!String(form.name ?? '').trim()) { setError('اسم البنك مطلوب'); return; }
    const payload = {
      code: form.code?.trim() || null,
      name: form.name.trim(),
      nameEn: form.nameEn?.trim() || null,
      isActive: form.isActive !== false,
      notes: form.notes?.trim() || null,
    };
    try {
      if (form.bankId) await apiFetch(`/catalog/banks/${form.bankId}`, { method: 'PUT', body: payload });
      else await apiFetch('/catalog/banks', { method: 'POST', body: payload });
      setMessage(form.bankId ? 'تم حفظ التعديل' : 'تمت إضافة البنك');
      setForm(empty);
      await load();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحفظ'); }
  }

  async function remove(row: any) {
    setError('');
    try {
      await apiFetch(`/catalog/banks/${row.bankId}`, { method: 'DELETE' });
      setMessage('تم حذف البنك');
      await load();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحذف'); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>البنوك ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>اسم البنك</th><th>الاسم بالإنجليزية</th><th>حسابات مرتبطة</th><th>الحالة</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.bankId}>
                  <td className="font-mono text-xs">{row.code ?? '—'}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.nameEn ?? '—'}</td>
                  <td>{Number(row.accountCount ?? 0)}</td>
                  <td><span className={`badge ${row.isActive === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span></td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ bankId: row.bankId, code: row.code ?? '', name: row.name, nameEn: row.nameEn ?? '', isActive: row.isActive !== false, notes: row.notes ?? '' })}>تعديل</button>
                      <DeleteButton screenKey="banks" className="text-rose-600 text-xs font-semibold mr-2" confirmText={`حذف البنك «${row.name}»؟`} onDelete={() => remove(row)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="text-center text-slate-400 py-8">لا توجد بنوك — أضف بنكًا</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      {canManage && (
        <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
          <div className="font-bold">{form.bankId ? 'تعديل البنك' : 'بنك جديد'}</div>
          <div><label className="label">الكود</label><input className="input" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">اسم البنك *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">الاسم بالإنجليزية</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
          <div><label className="label">ملاحظات</label><textarea className="input h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />نشط</label>
          <button type="submit" className="btn-primary w-full">{form.bankId ? 'حفظ التعديل' : 'إضافة'}</button>
          {form.bankId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
          <div className="text-[11px] text-slate-400 leading-5">هذا جدول مرجعي للبنوك. ربط البنك بحساب بنكي/خزينة يتم من «الحسابات البنكية والخزائن».</div>
        </form>
      )}
    </div>
  );
}
