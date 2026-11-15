'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const empty = { colorId: undefined as any, code: '', name: '', nameEn: '', hexValue: '', isActive: true, notes: '' };

export default function ColorsScreen() {
  const { can } = useSession();
  const canManage = can('settings.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/catalog/colors')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!String(form.name ?? '').trim()) { setError('اسم اللون مطلوب'); return; }
    const payload = { code: form.code?.trim() || null, name: form.name.trim(), nameEn: form.nameEn?.trim() || null, hexValue: form.hexValue?.trim() || null, isActive: form.isActive !== false, notes: form.notes?.trim() || null };
    try {
      if (form.colorId) await apiFetch(`/catalog/colors/${form.colorId}`, { method: 'PUT', body: payload });
      else await apiFetch('/catalog/colors', { method: 'POST', body: payload });
      setMessage(form.colorId ? 'تم حفظ التعديل' : 'تمت إضافة اللون');
      setForm(empty);
      await load();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحفظ'); }
  }

  async function remove(row: any) {
    setError('');
    try { await apiFetch(`/catalog/colors/${row.colorId}`, { method: 'DELETE' }); setMessage('تم الحذف'); await load(); }
    catch (e: any) { setError(e?.message ?? 'تعذر الحذف'); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>الألوان ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>اللون</th><th>الاسم</th><th>بالإنجليزية</th><th>الحالة</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.colorId}>
                  <td className="font-mono text-xs">{row.code ?? '—'}</td>
                  <td>{row.hexValue ? <span className="inline-flex items-center gap-2"><span className="inline-block w-4 h-4 rounded border" style={{ background: row.hexValue }} /> <span dir="ltr" className="text-xs">{row.hexValue}</span></span> : '—'}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.nameEn ?? '—'}</td>
                  <td><span className={`badge ${row.isActive === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span></td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ colorId: row.colorId, code: row.code ?? '', name: row.name, nameEn: row.nameEn ?? '', hexValue: row.hexValue ?? '', isActive: row.isActive !== false, notes: row.notes ?? '' })}>تعديل</button>
                      <DeleteButton screenKey="colors" className="text-rose-600 text-xs font-semibold mr-2" confirmText={`حذف اللون «${row.name}»؟`} onDelete={() => remove(row)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="text-center text-slate-400 py-8">لا توجد ألوان</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      {canManage && (
        <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
          <div className="font-bold">{form.colorId ? 'تعديل لون' : 'لون جديد'}</div>
          <div><label className="label">الكود</label><input className="input" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">اسم اللون *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">الاسم بالإنجليزية</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
          <div><label className="label">قيمة اللون (HEX)</label><input className="input" dir="ltr" placeholder="#FF0000" value={form.hexValue} onChange={(e) => setForm({ ...form, hexValue: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />نشط</label>
          <button type="submit" className="btn-primary w-full">{form.colorId ? 'حفظ التعديل' : 'إضافة'}</button>
          {form.colorId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
        </form>
      )}
    </div>
  );
}
