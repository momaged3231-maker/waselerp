'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

const STATUS: Record<number, string> = { 1: 'تحت التحصيل', 2: 'محصّل/مصروف', 3: 'مرتد', 4: 'ملغي' };
const DIR: Record<number, string> = { 1: 'قبض (وارد)', 2: 'صرف (صادر)' };

/** Tools → «تقرير الأوراق المالية» — aging + totals for notes receivable/payable. */
export default function SecuritiesReportScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [filters, setFilters] = useState({ from: '', to: '', direction: 0, status: 0, search: '' });
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const qs = new URLSearchParams();
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.direction) qs.set('direction', String(filters.direction));
    if (filters.status) qs.set('status', String(filters.status));
    if (filters.search.trim()) qs.set('search', filters.search.trim());
    const data = await apiFetch<any>(`/checks/report?${qs.toString()}`);
    setRows(data?.items ?? []);
    setSummary(data?.totals ?? null);
    setAging(data?.aging ?? null);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const outstanding = Number(summary?.outstanding ?? 0);
  const collected = Number(summary?.collected ?? 0);
  const paidOut = Number(summary?.paidOut ?? 0);

  function exportCsv() {
    downloadCsv('wasel-securities-report', rows.map((row: any) => ({
      'الرقم': row.checkNo, 'الاتجاه': DIR[row.direction] || row.direction, 'الطرف': row.partyName ?? '',
      'البنك': row.bankName ?? '', 'القيمة': Number(row.amount), 'الاستحقاق': row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      'الحالة': STATUS[row.status] || row.status,
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div><label className="label">من (الاستحقاق)</label><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><label className="label">إلى</label><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <div><label className="label">الاتجاه</label><select className="input w-36" value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: Number(e.target.value) })}><option value={0}>الكل</option><option value={1}>قبض</option><option value={2}>صرف</option></select></div>
        <div><label className="label">الحالة</label><select className="input w-40" value={filters.status} onChange={(e) => setFilters({ ...filters, status: Number(e.target.value) })}><option value={0}>الكل</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="flex-1 min-w-44"><label className="label">بحث</label><input className="input" placeholder="رقم الورقة / الطرف / البنك" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
        <button className="btn-primary" onClick={load}>عرض</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'تحت التحصيل (المتبقي)', value: formatMoney(outstanding) },
          { label: 'عدد المتأخرة', value: String(summary?.overdueCount ?? 0), warn: Number(summary?.overdueCount ?? 0) > 0 },
          { label: 'المحصّل (قبض)', value: formatMoney(collected) },
          { label: 'المصروف (صرف)', value: formatMoney(paidOut) },
        ].map((card, i) => (
          <div key={i} className={`card p-4 ${card.warn ? 'border-amber-300 bg-amber-50' : ''}`}>
            <div className="text-[11px] text-slate-500">{card.label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{card.value}</div>
          </div>
        ))}
      </div>

      {aging && (
        <div className="card p-4">
          <div className="font-bold text-slate-800 mb-2">شيخوخة الأوراق المتأخرة (تحت التحصيل)</div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              ['0–7 يوم', aging.d0_7], ['8–15 يوم', aging.d8_15], ['16–30 يوم', aging.d16_30], ['أكثر من 30', aging.d31plus],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[10px] text-slate-500">{label}</div>
                <div className="font-extrabold text-slate-800">{formatMoney(Number(value) || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title"><span>الأوراق ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>الرقم</th><th>الاتجاه</th><th>الطرف</th><th>البنك</th><th>القيمة</th><th>الاستحقاق</th><th>الحالة</th></tr></thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.checkId}>
                  <td>{row.checkId}</td>
                  <td className="font-medium">{row.checkNo}</td>
                  <td>{DIR[row.direction] || row.direction}</td>
                  <td>{row.partyName || '-'}</td>
                  <td>{row.bankName || '-'}</td>
                  <td className="font-bold">{formatMoney(Number(row.amount))}</td>
                  <td>{row.dueDate ? formatDate(row.dueDate) : '-'}</td>
                  <td><span className={`badge ${row.status === 1 ? 'bg-amber-50 text-amber-700' : row.status === 2 ? 'bg-emerald-50 text-emerald-700' : row.status === 3 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{STATUS[row.status] || row.status}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد أوراق مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
