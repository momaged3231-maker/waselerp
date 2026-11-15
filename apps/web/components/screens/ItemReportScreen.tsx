'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** «تقرير الأصناف» — per-item stock totals across warehouses (on hand, cost, value, reorder status). */
export default function ItemReportScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setRows(await apiFetch<any[]>('/inventory/balances'));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل التقرير');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const aggregated = useMemo(() => {
    const map = new Map<number, any>();
    for (const row of rows) {
      const key = Number(row.itemId);
      const entry = map.get(key) ?? {
        itemId: key, code: row.code, name: row.name, unitName: row.unitName,
        onHand: 0, stockValue: 0, costWeighted: 0, reorderPoint: Number(row.reorderPoint ?? 0),
        sellPrice: Number(row.sellPrice ?? 0),
      };
      const qty = Number(row.onHandQty ?? 0);
      entry.onHand += qty;
      entry.stockValue += Number(row.stockValue ?? 0);
      entry.costWeighted += qty * Number(row.avgCost ?? 0);
      map.set(key, entry);
    }
    const term = search.trim().toLowerCase();
    return [...map.values()]
      .map((entry) => ({
        ...entry,
        avgCost: entry.onHand > 0 ? entry.costWeighted / entry.onHand : 0,
        lowStock: entry.onHand <= entry.reorderPoint,
      }))
      .filter((entry) => !term || entry.name?.toLowerCase().includes(term) || entry.code?.toLowerCase().includes(term))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  }, [rows, search]);

  const totalValue = aggregated.reduce((sum, row) => sum + row.stockValue, 0);
  const lowCount = aggregated.filter((row) => row.lowStock).length;

  function exportCsv() {
    downloadCsv('wasel-items-report', aggregated.map((row) => ({
      'الكود': row.code, 'الصنف': row.name, 'الوحدة': row.unitName ?? '',
      'إجمالي الرصيد': Number(row.onHand.toFixed(2)), 'حد الطلب': row.reorderPoint,
      'متوسط التكلفة المرجّح': Number(row.avgCost.toFixed(4)), 'قيمة المخزون': Number(row.stockValue.toFixed(2)),
      'سعر البيع': row.sellPrice, 'الحالة': row.lowStock ? 'تحت حد الطلب' : 'طبيعي',
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">تقرير الأصناف ({aggregated.length} صنف)</span>
        <div className="flex-1" />
        <span className="badge bg-emerald-50 text-emerald-700">قيمة المخزون {formatMoney(totalValue)}</span>
        <span className={`badge ${lowCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{lowCount} تحت حد الطلب</span>
        <button className="btn-soft" onClick={load}>تحديث</button>
        <button className="btn-soft" onClick={exportCsv} disabled={aggregated.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      <div className="card p-4">
        <input className="input max-w-sm" placeholder="بحث باسم أو كود الصنف…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>الوحده</th><th>إجمالي الرصيد</th><th>حد الطلب</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>سعر البيع</th><th>الحالة</th></tr></thead>
            <tbody>
              {aggregated.map((row) => (
                <tr key={row.itemId}>
                  <td className="font-mono text-xs">{row.code}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.unitName ?? '—'}</td>
                  <td className={row.lowStock ? 'font-bold text-rose-600' : 'font-bold'}>{row.onHand.toFixed(2)}</td>
                  <td>{row.reorderPoint}</td>
                  <td>{formatMoney(row.avgCost)}</td>
                  <td>{formatMoney(row.stockValue)}</td>
                  <td>{formatMoney(row.sellPrice)}</td>
                  <td>{row.lowStock ? <span className="badge bg-rose-50 text-rose-700">تحت الحد</span> : <span className="badge bg-emerald-50 text-emerald-700">طبيعي</span>}</td>
                </tr>
              ))}
              {aggregated.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد أرصدة مطابقة</td></tr>}
            </tbody>
            {aggregated.length > 0 && (
              <tfoot><tr className="font-bold"><td colSpan={6}>الإجمالي</td><td>{formatMoney(totalValue)}</td><td colSpan={2}></td></tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
