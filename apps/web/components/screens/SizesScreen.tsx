'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const empty = { sizeId: undefined as any, code: '', name: '', nameEn: '', sortOrder: 0, isActive: true, notes: '' };

export default function SizesScreen() {
  const { can } = useSession();
  const canManage = can('settings.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/catalog/sizes')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!String(form.name ?? '').trim()) { setError('اسم المقاس مطلوب'); return; }
    const payload = { code: form.code?.trim() || null, name: form.name.trim(), nameEn: form.nameEn?.trim() || null, sortOrder: Number(form.sortOrder || 0), isActive: form.isActive !== false, notes: form.notes?.trim() || null };
    try {
      if (form.sizeId) await apiFetch(`/catalog/sizes/${form.sizeId}`, { method: 'PUT', body: payload });
      else await apiFetch('/catalog/sizes', { method: 'POST', body: payload });
      setMessage(form.sizeId ? 'تم حفظ التعديل' : 'تمت إضافة المقاس');
      setForm(empty);
      await load();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحفظ'); }
  }

  async function remove(row: any) {
    setError('');
    try { await apiFetch(`/catalog/sizes/${row.sizeId}`, { method: 'DELETE' }); setMessage('تم الحذف'); await load(); }
    catch (e: any) { setError(e?.message ?? 'تعذر الحذف'); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>المقاسات ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>المقاس</th><th>بالإنجليزية</th><th>الترتيب</th><th>الحالة</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sizeId}>
                  <td className="font-mono text-xs">{row.code ?? '—'}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.nameEn ?? '—'}</td>
                  <td>{row.sortOrder ?? 0}</td>
                  <td><span className={`badge ${row.isActive === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span></td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ sizeId: row.sizeId, code: row.code ?? '', name: row.name, nameEn: row.nameEn ?? '', sortOrder: row.sortOrder ?? 0, isActive: row.isActive !== false, notes: row.notes ?? '' })}>تعديل</button>
                      <DeleteButton screenKey="sizes" className="text-rose-600 text-xs font-semibold mr-2" confirmText={`حذف المقاس «${row.name}»؟`} onDelete={() => remove(row)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="text-center text-slate-400 py-8">لا توجد مقاسات</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      {canManage && (
        <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
          <div className="font-bold">{form.sizeId ? 'تعديل مقاس' : 'مقاس جديد'}</div>
          <div><label className="label">الكود</label><input className="input" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">اسم المقاس *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">الاسم بالإنجليزية</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
          <div><label className="label">الترتيب</label><input className="input" type="number" dir="ltr" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />نشط</label>
          <button type="submit" className="btn-primary w-full">{form.sizeId ? 'حفظ التعديل' : 'إضافة'}</button>
          {form.sizeId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
        </form>
      )}
    </div>
  );
}
