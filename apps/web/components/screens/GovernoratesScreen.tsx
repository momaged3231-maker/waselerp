'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const empty = { governorateId: undefined as any, code: '', name: '', nameEn: '', countryId: '', countryCode: '', shippingFees: 0, isActive: true, notes: '' };

export default function GovernoratesScreen() {
  const { can } = useSession();
  const canManage = can('settings.manage');
  const [rows, setRows] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const [g, c] = await Promise.all([
        apiFetch<any[]>('/catalog/governorates'),
        apiFetch<any[]>('/shipping/countries').catch(() => []),
      ]);
      setRows(Array.isArray(g) ? g : []);
      setCountries(Array.isArray(c) ? c : []);
      setError('');
    } catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!String(form.name ?? '').trim()) { setError('اسم المحافظة مطلوب'); return; }
    const payload = {
      code: form.code?.trim() || null,
      name: form.name.trim(),
      nameEn: form.nameEn?.trim() || null,
      countryId: form.countryId ? Number(form.countryId) : null,
      countryCode: form.countryCode?.trim() || null,
      shippingFees: Number(form.shippingFees || 0),
      isActive: form.isActive !== false,
      notes: form.notes?.trim() || null,
    };
    try {
      if (form.governorateId) await apiFetch(`/catalog/governorates/${form.governorateId}`, { method: 'PUT', body: payload });
      else await apiFetch('/catalog/governorates', { method: 'POST', body: payload });
      setMessage(form.governorateId ? 'تم حفظ التعديل' : 'تمت إضافة المحافظة');
      setForm(empty);
      await load();
    } catch (e: any) { setError(e?.message ?? 'تعذر الحفظ'); }
  }

  async function remove(row: any) {
    setError('');
    try { await apiFetch(`/catalog/governorates/${row.governorateId}`, { method: 'DELETE' }); setMessage('تم الحذف'); await load(); }
    catch (e: any) { setError(e?.message ?? 'تعذر الحذف'); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>المحافظات ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>المحافظة</th><th>الدولة</th><th>رسوم الشحن</th><th>الحالة</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.governorateId}>
                  <td className="font-mono text-xs">{row.code ?? '—'}</td>
                  <td className="font-semibold">{row.name}{row.nameEn ? <div className="text-[10px] text-slate-400">{row.nameEn}</div> : null}</td>
                  <td>{row.countryName ?? row.countryCode ?? row.countryId ?? '—'}</td>
                  <td dir="ltr" className="text-right">{Number(row.shippingFees ?? 0).toFixed(2)}</td>
                  <td><span className={`badge ${row.isActive === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span></td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ governorateId: row.governorateId, code: row.code ?? '', name: row.name, nameEn: row.nameEn ?? '', countryId: row.countryId ?? '', countryCode: row.countryCode ?? '', shippingFees: row.shippingFees ?? 0, isActive: row.isActive !== false, notes: row.notes ?? '' })}>تعديل</button>
                      <DeleteButton screenKey="governorates" className="text-rose-600 text-xs font-semibold mr-2" confirmText={`حذف المحافظة «${row.name}»؟`} onDelete={() => remove(row)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="text-center text-slate-400 py-8">لا توجد محافظات</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      {canManage && (
        <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
          <div className="font-bold">{form.governorateId ? 'تعديل محافظة' : 'محافظة جديدة'}</div>
          <div><label className="label">الكود</label><input className="input" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">اسم المحافظة *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">الاسم بالإنجليزية</label><input className="input" dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
          <div>
            <label className="label">الدولة</label>
            <select className="input" value={form.countryId} onChange={(e) => setForm({ ...form, countryId: e.target.value })}>
              <option value="">— بدون —</option>
              {countries.map((c: any) => <option key={c.countryId ?? c.id} value={c.countryId ?? c.id}>{c.name} {c.code ? `(${c.code})` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">كود الدولة</label><input className="input" dir="ltr" placeholder="EG" value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} /></div>
            <div><label className="label">رسوم الشحن</label><input className="input" type="number" step="0.01" dir="ltr" value={form.shippingFees} onChange={(e) => setForm({ ...form, shippingFees: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />نشطة</label>
          <button type="submit" className="btn-primary w-full">{form.governorateId ? 'حفظ التعديل' : 'إضافة'}</button>
          {form.governorateId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
        </form>
      )}
    </div>
  );
}
