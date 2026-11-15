'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

/** Tools → «تقرير الحسابات البنكية» — per-bank-account movement and closing balance + GL link health. */
export default function BankReportScreen() {
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 8) + '01');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const qs = new URLSearchParams({ from, to });
    setData(await apiFetch<any>(`/treasury/bank-summary?${qs.toString()}`));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rows = data?.items ?? [];
  const totals = data?.totals;

  function exportCsv() {
    downloadCsv('wasel-bank-report', rows.map((row: any) => ({
      'الحساب': row.name, 'البنك': row.bankName ?? '', 'رقم الحساب': row.accountNo ?? '', 'العملة': row.currency ?? 'EGP',
      'الحساب المحاسبي': row.glAccountCode ? `${row.glAccountCode} — ${row.glAccountName}` : 'غير مربوط',
      'الافتتاحي': Number(row.opening), 'الوارد': Number(row.totalIn), 'الصادر': Number(row.totalOut), 'الإغلاق': Number(row.closing),
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div><label className="label">من</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">إلى</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn-primary" onClick={load}>عرض</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'إجمالي الوارد', value: formatMoney(totals.totalIn) },
            { label: 'إجمالي الصادر', value: formatMoney(totals.totalOut) },
            { label: 'إجمالي الإغلاق', value: formatMoney(totals.closing) },
          ].map((card, i) => (
            <div key={i} className="card p-4">
              <div className="text-[11px] text-slate-500">{card.label}</div>
              <div className="text-lg font-extrabold text-slate-800 mt-1">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title"><span>الحسابات البنكية ({rows.length})</span></div>
        <div className="table-wrap max-h-[34rem] overflow-y-auto">
          <table className="table">
            <thead><tr><th>الحساب</th><th>البنك</th><th>رقم الحساب</th><th>الحساب المحاسبي</th><th>العملة</th><th>الافتتاحي</th><th>الوارد</th><th>الصادر</th><th>الإغلاق</th></tr></thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.accountId}>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.bankName ?? '—'}</td>
                  <td dir="ltr" className="text-right">{row.accountNo ?? '—'}</td>
                  <td className="text-xs">{row.glAccountCode ? `${row.glAccountCode} — ${row.glAccountName}` : <span className="badge bg-amber-50 text-amber-700">غير مربوط</span>}</td>
                  <td dir="ltr" className="text-right">{row.currency ?? 'EGP'}</td>
                  <td>{formatMoney(row.opening)}</td>
                  <td className="text-emerald-700">{formatMoney(row.totalIn)}</td>
                  <td className="text-rose-600">{formatMoney(row.totalOut)}</td>
                  <td className="font-bold">{formatMoney(row.closing)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد حسابات بنكية (نوع 2) — أضفها من «البيانات الأساسية ← الحسابات البنكية والخزائن»</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
