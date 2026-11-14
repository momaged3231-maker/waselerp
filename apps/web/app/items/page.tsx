'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const empty = {
  code: '', name: '', nameEn: '', barcode: '', categoryId: 0, baseUnitId: 1,
  costPrice: 0, sellPrice: 0, vatPct: 0, discountPct: 0, reorderPoint: 0,
  isService: false, hasSerial: false, isActive: true, notes: '',
};

export default function ItemsPage() {
  const { can } = useSession();
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<any>(empty);
  const [itemUnits, setItemUnits] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load(term = search) {
    const data = await apiFetch<any>(`/items?search=${encodeURIComponent(term)}&pageSize=100`);
    setItems(data.items ?? []);
  }

  useEffect(() => {
    apiFetch('/catalog/categories').then(setCategories).catch(() => {});
    apiFetch('/catalog/units').then(setUnits).catch(() => {});
    load('');
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const saved = form.itemId
        ? await apiFetch<any>(`/items/${form.itemId}`, { method: 'PUT', body: form })
        : await apiFetch<any>('/items', { method: 'POST', body: form });

      const itemId = saved.itemId ?? form.itemId;
      if (itemId && itemUnits.length) {
        await apiFetch(`/items/${itemId}/units`, {
          method: 'POST',
          body: {
            units: itemUnits.map((unit) => ({
              unitId: unit.unitId,
              factor: unit.factor,
              sellPrice: unit.sellPrice ?? null,
              buyPrice: unit.buyPrice ?? null,
            })),
          },
        });
      }
      setForm(empty);
      setItemUnits([]);
      load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  function edit(item: any) {
    setForm({
      itemId: item.itemId, code: item.code, name: item.name, nameEn: item.nameEn ?? '',
      barcode: item.barcode ?? '', categoryId: item.categoryId ?? 0, baseUnitId: item.baseUnitId,
      costPrice: Number(item.costPrice), sellPrice: Number(item.sellPrice), vatPct: Number(item.vatPct),
      discountPct: Number(item.discountPct), reorderPoint: Number(item.reorderPoint),
      isService: item.isService, hasSerial: item.hasSerial, isActive: item.isActive, notes: '',
    });
    const baseUnit = units.find((u) => u.unitId === item.baseUnitId);
    setItemUnits([
      ...(item.units ?? []),
      ...((item.units ?? []).some((u: any) => u.unitId === item.baseUnitId)
        ? []
        : [{ unitId: item.baseUnitId, unitName: baseUnit?.name ?? 'أساسي', factor: 1, sellPrice: item.sellPrice }]),
    ]);
  }

  return (
    <AppShell title="الأصناف">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="card-title">
            <span>قائمة الأصناف ({items.length})</span>
            <input
              className="input w-52 py-1.5"
              placeholder="بحث"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الكود</th><th>الاسم</th><th>الفئة</th><th>التكلفة</th><th>البيع</th>
                  <th>الرصيد</th>{can('items.manage') && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.itemId}>
                    <td className="font-mono text-xs">{item.code}</td>
                    <td className="font-semibold">{item.name}</td>
                    <td className="text-slate-500">{item.categoryName ?? '—'}</td>
                    <td>{formatMoney(item.costPrice)}</td>
                    <td className="font-bold">{formatMoney(item.sellPrice)}</td>
                    <td>
                      <span className={Number(item.onHandQty) <= Number(item.reorderPoint) ? 'text-rose-600 font-bold' : ''}>
                        {Number(item.onHandQty).toFixed(0)}
                      </span>
                    </td>
                    {can('items.manage') && (
                      <td>
                        <button className="text-brand-600 text-xs font-semibold" onClick={() => edit(item)}>تعديل</button>
                      </td>
                    )}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد أصناف</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {can('items.manage') && (
          <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
            <div className="font-bold mb-1">{form.itemId ? 'تعديل صنف' : 'صنف جديد'}</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">الكود <span className="font-normal text-[10px] text-slate-400">(فارغ = كود تلقائي)</span></label>
                <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" placeholder="ITM-000001" />
              </div>
              <div>
                <label className="label">الباركود</label>
                <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} dir="ltr" />
              </div>
            </div>

            <div>
              <label className="label">الاسم</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">الفئة</label>
                <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}>
                  <option value={0}>— بدون —</option>
                  {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الوحدة</label>
                <select className="input" value={form.baseUnitId} onChange={(e) => setForm({ ...form, baseUnitId: Number(e.target.value) })}>
                  {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">سعر التكلفة</label>
                <input className="input" type="number" step="0.01" value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">سعر البيع</label>
                <input className="input" type="number" step="0.01" value={form.sellPrice}
                  onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">الضريبة %</label>
                <input className="input" type="number" step="0.01" value={form.vatPct}
                  onChange={(e) => setForm({ ...form, vatPct: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">حد الطلب</label>
                <input className="input" type="number" value={form.reorderPoint}
                  onChange={(e) => setForm({ ...form, reorderPoint: Number(e.target.value) })} />
              </div>
            </div>

            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isService} onChange={(e) => setForm({ ...form, isService: e.target.checked })} />
                خدمة
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.hasSerial} onChange={(e) => setForm({ ...form, hasSerial: e.target.checked })} />
                أرقام سيريال
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                نشط
              </label>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold">وحدات البيع</span>
                <select
                  className="input w-40 py-1.5 text-xs"
                  value=""
                  onChange={(e) => {
                    const unitId = Number(e.target.value);
                    if (!unitId) return;
                    const unit = units.find((u) => u.unitId === unitId);
                    if (itemUnits.some((u) => u.unitId === unitId)) return;
                    setItemUnits([...itemUnits, { unitId, unitName: unit?.name ?? '', factor: 1, sellPrice: form.sellPrice }]);
                  }}
                >
                  <option value="">+ إضافة وحدة</option>
                  {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
                </select>
              </div>

              {itemUnits.length === 0 && (
                <div className="text-xs text-slate-400">الوحدة الأساسية تُحفظ تلقائياً</div>
              )}

              <div className="space-y-2">
                {itemUnits.map((unit, index) => (
                  <div key={unit.unitId} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4 text-xs font-semibold">{unit.unitName}</div>
                    <div className="col-span-3">
                      <input
                        className="input px-2 py-1 text-xs"
                        type="number" step="0.001" min="0.001"
                        value={unit.factor}
                        onChange={(e) => setItemUnits(itemUnits.map((u, i) => (i === index ? { ...u, factor: Number(e.target.value) } : u)))}
                        title="عدد الوحدات الأساسية"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        className="input px-2 py-1 text-xs"
                        type="number" step="0.01"
                        value={unit.sellPrice ?? ''}
                        onChange={(e) => setItemUnits(itemUnits.map((u, i) => (i === index ? { ...u, sellPrice: Number(e.target.value) } : u)))}
                        title="سعر البيع"
                      />
                    </div>
                    <div className="col-span-2 text-left">
                      <button type="button" className="text-rose-500 text-xs" onClick={() => setItemUnits(itemUnits.filter((_, i) => i !== index))}>حذف</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                المعامل = عدد الوحدة الأساسية داخل وحدة البيع (مثال: الكرتونة = 12 قطعة)
              </div>
            </div>

            {error && <div className="text-sm text-rose-600">{error}</div>}

            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1">حفظ</button>
              {form.itemId && (
                <button type="button" className="btn-soft" onClick={() => setForm(empty)}>جديد</button>
              )}
            </div>

            {form.itemId && (
              <div className="border-t border-slate-100 pt-3">
                <AttachmentsPanel entityType="item" entityId={form.itemId} compact />
              </div>
            )}
          </form>
        )}
      </div>
    </AppShell>
  );
}
