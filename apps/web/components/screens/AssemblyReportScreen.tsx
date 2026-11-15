'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** «تقرير كارت التصنيع» — how many units of each assembled item can be built from current stock. */
export default function AssemblyReportScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setRows(await apiFetch<any[]>('/items/assembly-availability'));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل التقرير');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totalPotential = rows.reduce((sum, row) => sum + Number(row.buildable ?? 0) * Number(row.sellPrice ?? 0), 0);

  function exportCsv() {
    const flat: any[] = [];
    for (const row of rows) {
      for (const comp of row.components ?? []) {
        flat.push({
          'الصنف المجمع': row.name, 'كود الصنف المجمع': row.code,
          'المكوّن': comp.name, 'كود المكوّن': comp.code,
          'الكمية اللازمة': Number(comp.quantity), 'الرصيد': Number(comp.onHand ?? 0),
          'متاح للتجميع': Number(comp.lineBuildable ?? 0),
          'الكمية المتاحة للتجميع': Number(row.buildable ?? 0),
        });
      }
      if ((row.components ?? []).length === 0) {
        flat.push({
          'الصنف المجمع': row.name, 'كود الصنف المجمع': row.code, 'المكوّن': '—', 'كود المكوّن': '',
          'الكمية اللازمة': 0, 'الرصيد': 0, 'متاح للتجميع': 0, 'الكمية المتاحة للتجميع': Number(row.buildable ?? 0),
        });
      }
    }
    downloadCsv('wasel-assembly-report', flat);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">التصنيع المتاح من الأرصدة الحالية ({rows.length} صنف مجمع)</span>
        <div className="flex-1" />
        <span className="badge bg-emerald-50 text-emerald-700">القيمة المحتملة {formatMoney(totalPotential)}</span>
        <button className="btn-soft" onClick={load}>تحديث</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      {rows.map((row) => (
        <div key={row.itemId} className="card">
          <div className="card-title flex-wrap gap-2">
            <span>{row.name} <span className="font-mono text-xs text-slate-400">{row.code}</span></span>
            <div className="flex items-center gap-2">
              <span className="badge bg-blue-50 text-blue-700">بيع {formatMoney(row.sellPrice)}</span>
              <span className={`badge ${Number(row.buildable) > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                الكمية المتاحة للتجميع: {Number(row.buildable ?? 0)} {row.unitName ?? ''}
              </span>
              <span className="badge bg-slate-100 text-slate-600">قيمة محتملة {formatMoney(Number(row.buildable ?? 0) * Number(row.sellPrice ?? 0))}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>المكوّن</th><th>الكمية اللازمة / وحدة</th><th>الوحدة</th><th>الرصيد المتاح</th><th>متاح للتجميع</th><th>القيد</th></tr></thead>
              <tbody>
                {(row.components ?? []).map((comp: any) => {
                  const limiting = Number(comp.lineBuildable ?? 0) === Number(row.buildable ?? 0);
                  return (
                    <tr key={comp.childItemId}>
                      <td className="font-mono text-xs">{comp.code}</td>
                      <td className="font-semibold">{comp.name}</td>
                      <td>{Number(comp.quantity)}</td>
                      <td>{comp.unitName ?? '—'}</td>
                      <td>{Number(comp.onHand ?? 0).toFixed(2)}</td>
                      <td className={limiting ? 'font-bold text-amber-700' : ''}>{Number(comp.lineBuildable ?? 0)}</td>
                      <td>{limiting ? 'المكوّن المقيِّد' : ''}</td>
                    </tr>
                  );
                })}
                {(row.components ?? []).length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد مكونات معرّفة — أضفها من «كارت التصنيع»</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {rows.length === 0 && !error && <div className="card p-8 text-center text-slate-400 text-sm">لا توجد أصناف مجمعة بعد — عرّفها من «كارت التصنيع»</div>}
    </div>
  );
}
