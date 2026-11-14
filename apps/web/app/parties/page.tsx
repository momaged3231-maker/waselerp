'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const empty = { partyId: undefined, code: '', name: '', partyType: 1, phone: '', mobile: '', address: '', taxNumber: '', creditLimit: 0, discountPct: 0, isActive: true, priceListId: null, customerGroupId: null, classificationId: null, salesRepId: null };

export default function PartiesPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<any[]>([]);
  const [type, setType] = useState(0);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<any>(empty);
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [classifications, setClassifications] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load(term = search, partyType = type) {
    const data = await apiFetch<any>(`/parties?search=${encodeURIComponent(term)}&type=${partyType}&pageSize=100`);
    setRows(data.items ?? []);
  }

  useEffect(() => {
    load('', 0);
    apiFetch<any[]>('/pricing/lists').then(setPriceLists).catch(() => {});
    apiFetch<any[]>('/customer-groups').then(setGroups).catch(() => {});
    apiFetch<any[]>('/customer-classifications').then(setClassifications).catch(() => {});
    apiFetch<any[]>('/admin/users').then((users) => setReps((users || []).filter((u: any) => u.isSalesRep))).catch(() => {});
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (form.partyId) await apiFetch(`/parties/${form.partyId}`, { method: 'PUT', body: form });
      else await apiFetch('/parties', { method: 'POST', body: form });
      setForm(empty);
      load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  return (
    <AppShell title="العملاء والموردين">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="card-title">
            <span>السجل ({rows.length})</span>
            <div className="flex gap-2">
              <select className="input w-40 py-1.5" value={type} onChange={(e) => { setType(Number(e.target.value)); load(search, Number(e.target.value)); }}>
                <option value={0}>الكل</option>
                <option value={1}>عملاء</option>
                <option value={2}>موردون</option>
              </select>
              <input className="input w-48 py-1.5" placeholder="بحث" value={search}
                onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>الكود</th><th>الاسم</th><th>النوع</th><th>المجموعة</th><th>المندوب</th><th>التليفون</th><th>الرصيد</th><th>حد الائتمان</th>{can('parties.manage') && <th />}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.partyId}>
                    <td className="font-mono text-xs">{row.code ?? '—'}</td>
                    <td className="font-semibold">{row.name}</td>
                    <td>
                      <span className={`badge ${row.partyType === 1 ? 'bg-emerald-50 text-emerald-700' : row.partyType === 2 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {row.partyType === 1 ? 'عميل' : row.partyType === 2 ? 'مورد' : 'الاثنان'}
                      </span>
                    </td>
                    <td className="text-xs">{row.customerGroupName ?? '—'}</td>
                    <td className="text-xs">{row.salesRepName ?? '—'}</td>
                    <td dir="ltr" className="text-right">{row.phone ?? '—'}</td>
                    <td className={Number(row.balance) > 0 ? 'text-rose-600 font-bold' : 'text-emerald-700'}>{formatMoney(row.balance)}</td>
                    <td>{formatMoney(row.creditLimit)}</td>
                    {can('parties.manage') && (
                      <td>
                        <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ ...empty, ...row, code: row.code ?? '', phone: row.phone ?? '', mobile: row.mobile ?? '', address: row.address ?? '', taxNumber: row.taxNumber ?? '' })}>تعديل</button>
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {can('parties.manage') && (
          <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
            <div className="font-bold">{form.partyId ? 'تعديل' : 'إضافة جديد'}</div>
            <div>
              <label className="label">الاسم</label>
              <input className="input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">النوع</label>
                <select className="input" value={form.partyType} onChange={(e) => setForm({ ...form, partyType: Number(e.target.value) })}>
                  <option value={1}>عميل</option>
                  <option value={2}>مورد</option>
                  <option value={3}>عميل ومورد</option>
                </select>
              </div>
              <div>
                <label className="label">الكود</label>
                <input className="input" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className="label">التليفون</label>
                <input className="input" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className="label">الموبايل</label>
                <input className="input" value={form.mobile || ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className="label">حد الائتمان</label>
                <input className="input" type="number" value={form.creditLimit ?? 0} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">خصم %</label>
                <input className="input" type="number" step="0.01" value={form.discountPct ?? 0} onChange={(e) => setForm({ ...form, discountPct: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">مجموعة العملاء</label>
                <select className="input" value={form.customerGroupId ?? ''} onChange={(e) => setForm({ ...form, customerGroupId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— بدون —</option>
                  {groups.map((g: any) => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">التصنيف</label>
                <select className="input" value={form.classificationId ?? ''} onChange={(e) => setForm({ ...form, classificationId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— بدون —</option>
                  {classifications.map((c: any) => <option key={c.classificationId} value={c.classificationId}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">المندوب</label>
                <select className="input" value={form.salesRepId ?? ''} onChange={(e) => setForm({ ...form, salesRepId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— بدون —</option>
                  {reps.map((r: any) => <option key={r.userId} value={r.userId}>{r.fullName}</option>)}
                </select>
              </div>
              <div>
                <label className="label">قائمة الأسعار</label>
                <select className="input" value={form.priceListId ?? ''} onChange={(e) => setForm({ ...form, priceListId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— بدون —</option>
                  {priceLists.map((row: any) => (
                    <option key={row.priceListId} value={row.priceListId}>{row.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">العنوان</label>
              <input className="input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <label className="label">الرقم الضريبي</label>
              <input className="input" value={form.taxNumber || ''} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} dir="ltr" />
            </div>
            {error && <div className="text-sm text-rose-600">{error}</div>}
            <div className="flex gap-2">
              <button className="btn-primary flex-1">حفظ</button>
              {form.partyId && <button type="button" className="btn-soft" onClick={() => setForm(empty)}>جديد</button>}
            </div>

            {form.partyId && (
              <div className="border-t border-slate-100 pt-3">
                <AttachmentsPanel entityType="party" entityId={form.partyId} compact />
              </div>
            )}
          </form>
        )}
      </div>
    </AppShell>
  );
}
