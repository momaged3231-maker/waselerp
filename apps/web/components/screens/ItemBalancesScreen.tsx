'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** «استعلام أرصدة صنف» — query on-hand/reserved/available stock per warehouse with filters. */
export default function ItemBalancesScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const qs = new URLSearchParams();
      if (warehouseId) qs.set('warehouseId', String(warehouseId));
      if (search.trim()) qs.set('search', search.trim());
      if (lowStock) qs.set('lowStock', 'true');
      setRows(await apiFetch<any[]>(`/inventory/balances?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الأرصدة');
    }
  }

  useEffect(() => { apiFetch('/catalog/warehouses').then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, lowStock]);

  const totalValue = rows.reduce((sum, row) => sum + Number(row.stockValue ?? 0), 0);
  const totalOnHand = rows.reduce((sum, row) => sum + Number(row.onHandQty ?? 0), 0);
  const totalAvailable = rows.reduce((sum, row) => sum + Number(row.availableQty ?? 0), 0);

  function exportCsv() {
    downloadCsv('wasel-item-balances', rows.map((row) => ({
      'الكود': row.code, 'الصنف': row.name, 'الوحدة': row.unitName ?? '', 'المخزن': row.warehouseName, 'الفرع': row.branchName ?? '',
      'الرصيد': Number(row.onHandQty ?? 0), 'محجوز': Number(row.reservedQty ?? 0), 'المتاح': Number(row.availableQty ?? 0),
      'متوسط التكلفة': Number(row.avgCost ?? 0), 'القيمة': Number(row.stockValue ?? 0), 'حد الطلب': row.reorderPoint,
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div className="min-w-44">
          <label className="label">المخزن</label>
          <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">كل المخازن</option>
            {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-52">
          <label className="label">بحث (اسم أو كود الصنف)</label>
          <div className="flex gap-2">
            <input className="input" placeholder="اكتب للتصفية…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <button className="btn-soft" onClick={load}>عرض</button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
          تحت حد الطلب فقط
        </label>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-4"><div className="text-[11px] text-slate-500">إجمالي الرصيد</div><div className="text-lg font-extrabold text-slate-800 mt-1">{totalOnHand.toFixed(2)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-slate-500">المتاح (بعد حجز الأوامر)</div><div className="text-lg font-extrabold text-slate-800 mt-1">{totalAvailable.toFixed(2)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-slate-500">قيمة المخزون</div><div className="text-lg font-extrabold text-slate-800 mt-1">{formatMoney(totalValue)}</div></div>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="card-title"><span>الأرصدة ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>المخزن</th><th>الفرع</th><th>الرصيد</th><th>محجوز</th><th>المتاح</th><th>متوسط التكلفة</th><th>القيمة</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.itemId}-${row.warehouseId}`}>
                  <td className="font-mono text-xs">{row.code}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.warehouseName}</td>
                  <td className="text-slate-500">{row.branchName ?? '—'}</td>
                  <td className={row.lowStock ? 'font-bold text-rose-600' : ''}>{Number(row.onHandQty).toFixed(2)} {row.unitName}</td>
                  <td>{Number(row.reservedQty ?? 0).toFixed(2)}</td>
                  <td className="font-bold">{Number(row.availableQty ?? 0).toFixed(2)}</td>
                  <td>{formatMoney(row.avgCost)}</td>
                  <td>{formatMoney(row.stockValue)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد أرصدة مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
