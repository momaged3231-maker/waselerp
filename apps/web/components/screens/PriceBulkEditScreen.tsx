'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';

const OPS = [
  { value: 'increasePct', label: 'زيادة بنسبة %' },
  { value: 'decreasePct', label: 'تخفيض بنسبة %' },
  { value: 'increaseAmount', label: 'زيادة بمبلغ ثابت' },
  { value: 'decreaseAmount', label: 'تخفيض بمبلغ ثابت' },
] as const;
const FIELDS = [
  { value: 'sellPrice', label: 'سعر البيع' },
  { value: 'costPrice', label: 'سعر التكلفة' },
] as const;

/** Tools → «أسعار الأصناف» — bulk edit sell/cost prices on all / one category / picked items. */
export default function PriceBulkEditScreen() {
  const [categories, setCategories] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [idsSearch, setIdsSearch] = useState('');
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const [form, setForm] = useState({ scope: 'all' as 'all' | 'category' | 'ids', categoryId: 0, field: 'sellPrice' as 'sellPrice' | 'costPrice', op: 'increasePct' as (typeof OPS)[number]['value'], value: 10 });
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/catalog/categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.scope !== 'ids') return;
    const qs = new URLSearchParams({ pageSize: '30' });
    if (idsSearch.trim()) qs.set('search', idsSearch.trim());
    apiFetch<any>(`/items?${qs.toString()}`).then((data) => setAllItems(data?.items ?? data ?? [])).catch(() => setAllItems([]));
  }, [form.scope, idsSearch]);

  const payload = { ...form, itemIds: pickedIds };

  async function run(mode: 'preview' | 'apply') {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await apiFetch<any>('/items/bulk-price', { method: 'POST', body: { mode, ...payload } });
      if (mode === 'preview') setPreview(data);
      else { setResult(data); setPreview(null); }
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التشغيل');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3 max-w-2xl">
        <div className="font-bold text-slate-800">تعديل جماعي لأسعار الأصناف</div>
        <div className="text-xs text-slate-500 leading-6">يطبّق التعديل على <b>كل الأصناف النشطة</b> أو <b>فئة واحدة</b> أو <b>أصناف محددة</b> — مع «معاينة» للعدد والعينة قبل «تطبيق».</div>
        {form.scope === 'ids' && (
          <div className="border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="input w-56 py-1.5 text-sm" placeholder="بحث بالاسم/الكود" value={idsSearch} onChange={(e) => setIdsSearch(e.target.value)} />
              <span className="text-xs text-slate-500">{pickedIds.length} محدد</span>
              <button type="button" className="text-xs text-rose-600" onClick={() => setPickedIds([])}>مسح الاختيار</button>
            </div>
            <div className="max-h-52 overflow-auto grid sm:grid-cols-2 gap-1">
              {allItems.map((item: any) => {
                const checked = pickedIds.includes(Number(item.itemId));
                return (
                  <label key={item.itemId} className={`flex items-center gap-2 border rounded-lg px-2 py-1.5 text-xs cursor-pointer ${checked ? 'border-brand-400 bg-blue-50' : 'border-slate-200'}`}>
                    <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={checked}
                      onChange={(e) => setPickedIds(e.target.checked ? [...pickedIds, Number(item.itemId)] : pickedIds.filter((id) => id !== Number(item.itemId)))} />
                    <span className="font-mono">{item.code}</span>
                    <span className="truncate">{item.name}</span>
                    <span className="mr-auto text-slate-400">{formatMoney(item.sellPrice)}</span>
                  </label>
                );
              })}
              {allItems.length === 0 && <div className="text-xs text-slate-400 col-span-2 text-center py-4">لا توجد أصناف مطابقة</div>}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">النطاق</label>
            <select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as any })}>
              <option value="all">كل الأصناف النشطة</option>
              <option value="category">فئة واحدة</option>
              <option value="ids">أصناف محددة</option>
            </select>
          </div>
          {form.scope === 'category' && (
            <div>
              <label className="label">الفئة</label>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}>
                <option value={0}>— اختر —</option>
                {categories.map((c: any) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">السعر</label>
            <select className="input" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as any })}>
              {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع التعديل</label>
            <select className="input" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value as any })}>
              {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">القيمة</label>
            <input className="input" type="number" step="0.01" min={0} dir="ltr" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => run('preview')} disabled={busy}>{busy ? 'جارٍ الحساب…' : 'معاينة'}</button>
          <button className="btn-soft" onClick={() => run('apply')} disabled={busy || !preview}>تطبيق</button>
        </div>
        {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {preview && (
        <div className="card p-5">
          <div className="font-bold mb-3">معاينة: {preview.count} صنف سيتغير {preview.field === 'costPrice' ? '(التكلفة)' : '(البيع)'}</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>الاسم</th><th>الحالي</th><th>الجديد</th></tr></thead>
              <tbody>
                {(preview.sample ?? []).map((row: any) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.code}</td>
                    <td className="font-semibold">{row.name}</td>
                    <td>{formatMoney(row.price)}</td>
                    <td className="font-bold text-brand-700">{formatMoney(row.newPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <div className="font-extrabold text-emerald-800">تم تحديث {result.updated} صنف.</div>
        </div>
      )}
    </div>
  );
}
