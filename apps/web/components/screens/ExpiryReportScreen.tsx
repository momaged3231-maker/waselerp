'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** «تقرير الأصناف منتهية الصلاحية» — stock lines whose expiry date falls within the selected horizon. */
export default function ExpiryReportScreen() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load(horizon = days) {
    setError('');
    try {
      setRows(await apiFetch<any[]>(`/inventory/expiry-alerts?days=${horizon}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل التقرير');
    }
  }

  useEffect(() => { load(30); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const expired = rows.filter((row) => Number(row.daysLeft) < 0).length;

  function exportCsv() {
    downloadCsv('wasel-expiry-report', rows.map((row) => ({
      'الكود': row.code, 'الصنف': row.name, 'الوحدة': row.unitName ?? '', 'المخزن': row.warehouseName ?? '',
      'الرقم المسلسل': row.serialNo ?? '', 'تاريخ الصلاحية': row.expiryDate ? String(row.expiryDate).slice(0, 10) : '',
      'الأيام المتبقية': Number(row.daysLeft ?? 0), 'الرصيد': Number(row.onHand ?? 0),
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">أصناف منتهية / قاربت الصلاحية ({rows.length})</span>
        <div className="flex items-center gap-2">
          <label className="label mb-0 text-xs">خلال</label>
          <select className="input w-28 py-1.5" value={days} onChange={(e) => { const next = Number(e.target.value); setDays(next); load(next); }}>
            <option value={7}>7 أيام</option>
            <option value={30}>30 يوم</option>
            <option value={60}>60 يوم</option>
            <option value={90}>90 يوم</option>
          </select>
        </div>
        <div className="flex-1" />
        {expired > 0 && <span className="badge bg-rose-50 text-rose-700">{expired} منتهية الصلاحية فعليًا</span>}
        <button className="btn-soft" onClick={() => load()}>تحديث</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>المخزن</th><th>الرقم المسلسل</th><th>تاريخ الصلاحية</th><th>الأيام المتبقية</th><th>الرصيد</th></tr></thead>
            <tbody>
              {rows.map((row, idx) => {
                const daysLeft = Number(row.daysLeft ?? 0);
                return (
                  <tr key={`${row.itemId}-${row.serialNo ?? ''}-${idx}`}>
                    <td className="font-mono text-xs">{row.code}</td>
                    <td className="font-semibold">{row.name}</td>
                    <td>{row.warehouseName ?? '—'}</td>
                    <td className="font-mono text-xs" dir="ltr">{row.serialNo ?? '—'}</td>
                    <td>{formatDate(row.expiryDate)}</td>
                    <td>
                      <span className={`badge ${daysLeft < 0 ? 'bg-rose-50 text-rose-700' : daysLeft <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {daysLeft < 0 ? `منتهية منذ ${Math.abs(daysLeft)} يوم` : `${daysLeft} يوم`}
                      </span>
                    </td>
                    <td className="font-bold">{Number(row.onHand ?? 0).toFixed(2)} {row.unitName ?? ''}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-emerald-700 py-8">لا توجد أصناف منتهية أو قاربت الصلاحية خلال {days} يومًا</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[11px] text-slate-400 px-1">يعرض الكميات الموجبة من حركات الإضافة فقط (شراء/مرتجع/تحويل/جرد/افتتاحي/تسوية) — قد لا يكون قد استُنفد كلها بالكامل.</div>
    </div>
  );
}
