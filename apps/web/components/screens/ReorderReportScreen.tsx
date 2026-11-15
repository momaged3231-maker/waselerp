'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** «تقرير الأصناف تحت حد الطلب» — items at or below their reorder point, with shortage quantities. */
export default function ReorderReportScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setRows(await apiFetch<any[]>('/inventory/reorder-alerts'));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل التقرير');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const withShortage = rows.map((row) => ({
    ...row,
    shortage: Math.max(0, Number(row.reorderPoint) - Number(row.onHand)),
  }));
  const totalShortage = withShortage.reduce((sum, row) => sum + row.shortage, 0);

  function exportCsv() {
    downloadCsv('wasel-reorder-report', withShortage.map((row) => ({
      'الكود': row.code, 'الصنف': row.name, 'الوحدة': row.unitName ?? '', 'المخزن': row.warehouseName ?? 'كل المخازن',
      'المتاح': Number(row.onHand), 'حد الطلب': Number(row.reorderPoint), 'العجز': Number(row.shortage.toFixed(2)),
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">الأصناف تحت حد الطلب ({withShortage.length})</span>
        <div className="flex-1" />
        <span className={`badge ${totalShortage > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>إجمالي العجز {totalShortage.toFixed(2)}</span>
        <button className="btn-soft" onClick={load}>تحديث</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>المخزن</th><th>المتاح</th><th>حد الطلب</th><th>العجز</th></tr></thead>
            <tbody>
              {withShortage.map((row, idx) => (
                <tr key={`${row.itemId}-${row.warehouseName ?? 'all'}-${idx}`}>
                  <td className="font-mono text-xs">{row.code}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.unitName ?? '—'}</td>
                  <td>{row.warehouseName ?? 'كل المخازن'}</td>
                  <td className="font-bold text-rose-600">{Number(row.onHand).toFixed(2)}</td>
                  <td>{Number(row.reorderPoint).toFixed(2)}</td>
                  <td className="font-bold text-amber-700">{row.shortage.toFixed(2)}</td>
                </tr>
              ))}
              {withShortage.length === 0 && <tr><td colSpan={7} className="text-center text-emerald-700 py-8">لا توجد أصناف تحت حد الطلب — المخزون مطمئن</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
