'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const empty = { branchId: undefined as any, code: '', name: '', nameEn: '', address: '', city: '', phone: '', taxNumber: '', isActive: true, notes: '' };

/** Branch definitions — moved here from the settings screen (definitions hub). */
export default function BranchesScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/admin/branches')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل — تحتاج صلاحية إدارة المستخدمين'); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    const payload = {
      code: form.code, name: form.name, nameEn: form.nameEn || null,
      address: form.address || null, city: form.city || null, phone: form.phone || null,
      taxNumber: form.taxNumber || null, isActive: form.isActive !== false, notes: form.notes || null,
    };
    if (!payload.code || !payload.name) { setError('الكود والاسم مطلوبان'); return; }
    try {
      if (form.branchId) await apiFetch(`/admin/branches/${form.branchId}`, { method: 'PUT', body: payload });
      else await apiFetch('/admin/branches', { method: 'POST', body: payload });
      setMessage(form.branchId ? 'تم حفظ التعديل' : 'تم إضافة الفرع');
      setForm(empty);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>الفروع ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الاسم</th><th>المدينة</th><th>التليفون</th><th>الرقم الضريبي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((branch) => (
                <tr key={branch.branchId}>
                  <td className="font-mono text-xs">{branch.code}</td>
                  <td className="font-semibold">{branch.name}{branch.nameEn ? <div className="text-[10px] text-slate-400" dir="ltr">{branch.nameEn}</div> : null}</td>
                  <td>{branch.city ?? '—'}</td>
                  <td dir="ltr" className="text-right">{branch.phone ?? '—'}</td>
                  <td dir="ltr" className="text-right">{branch.taxNumber ?? '—'}</td>
                  <td>
                    <span className={`badge ${branch.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {branch.isActive ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td><button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ branchId: branch.branchId, code: branch.code, name: branch.name, nameEn: branch.nameEn ?? '', address: branch.address ?? '', city: branch.city ?? '', phone: branch.phone ?? '', taxNumber: branch.taxNumber ?? '', isActive: branch.isActive !== false, notes: branch.notes ?? '' })}>تعديل</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد فروع</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
        <div className="font-bold">{form.branchId ? 'تعديل الفرع' : 'فرع جديد'}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">الكود</label><input className="input" required dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">الاسم</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">الاسم بالإنجليزي</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">العنوان</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><label className="label">المدينة</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label className="label">التليفون</label><input className="input" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">الرقم الضريبي</label><input className="input" dir="ltr" value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">ملاحظات</label><textarea className="input h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />الفرع نشط</label>
        <button type="submit" className="btn-primary w-full">{form.branchId ? 'حفظ التعديل' : 'إضافة'}</button>
        {form.branchId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء التعديل</button>}
      </form>
    </div>
  );
}
