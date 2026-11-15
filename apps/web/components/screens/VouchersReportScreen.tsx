'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';
import { VOUCHER_STATUS_LABELS, VOUCHER_TYPE_LABELS } from '@/lib/stock';

/** «تقرير أذونات المخازن» — stock vouchers list with status/type/warehouse/date filters and totals. */
export default function VouchersReportScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [filters, setFilters] = useState({ status: 0, type: 0, warehouseId: 0, from: '', to: '', search: '' });
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const qs = new URLSearchParams({ limit: '500' });
      if (filters.status) qs.set('status', String(filters.status));
      if (filters.type) qs.set('type', String(filters.type));
      if (filters.warehouseId) qs.set('warehouseId', String(filters.warehouseId));
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.search.trim()) qs.set('search', filters.search.trim());
      setRows(await apiFetch<any[]>(`/stock-vouchers?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل التقرير');
    }
  }

  useEffect(() => {
    apiFetch('/catalog/warehouses').then(setWarehouses).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = {
    total: rows.length,
    approved: rows.filter((row) => Number(row.status) === 2).length,
    draft: rows.filter((row) => Number(row.status) === 1).length,
    cancelled: rows.filter((row) => Number(row.status) === 3).length,
  };

  function exportCsv() {
    downloadCsv('wasel-stock-vouchers-report', rows.map((row) => ({
      'الرقم': row.voucherNo, 'التاريخ': row.voucherDate ? String(row.voucherDate).slice(0, 10) : '',
      'النوع': VOUCHER_TYPE_LABELS[Number(row.voucherType)] ?? row.voucherType, 'المخزن': row.warehouseName,
      'عدد الأصناف': Number(row.lineCount ?? 0), 'الحالة': VOUCHER_STATUS_LABELS[Number(row.status)] ?? row.status,
      'أنشأها': row.createdBy ?? '', 'القيد المحاسبي': row.glJournalId ? `#${row.glJournalId}` : '—',
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">الحالة</label>
          <select className="input w-32" value={filters.status} onChange={(e) => setFilters({ ...filters, status: Number(e.target.value) })}>
            <option value={0}>الكل</option>
            {Object.entries(VOUCHER_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">النوع</label>
          <select className="input w-32" value={filters.type} onChange={(e) => setFilters({ ...filters, type: Number(e.target.value) })}>
            <option value={0}>الكل</option>
            {Object.entries(VOUCHER_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">المخزن</label>
          <select className="input w-40" value={filters.warehouseId} onChange={(e) => setFilters({ ...filters, warehouseId: Number(e.target.value) })}>
            <option value={0}>كل المخازن</option>
            {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
          </select>
        </div>
        <div><label className="label">من</label><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><label className="label">إلى</label><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <div className="flex-1 min-w-40"><label className="label">بحث (رقم الأذن)</label><input className="input" placeholder="SV-000123" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <button className="btn-primary" onClick={load}>عرض</button>
        <button className="btn-soft" onClick={exportCsv} disabled={rows.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['إجمالي الأذون', totals.total],
          ['معتمدة', totals.approved],
          ['مسودة', totals.draft],
          ['ملغاة', totals.cancelled],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{value}</div>
          </div>
        ))}
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="card-title"><span>الأذون ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>المخزن</th><th>عدد الأصناف</th><th>الحالة</th><th>أنشأها</th><th>القيد المحاسبي</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stockVoucherId}>
                  <td className="font-mono text-xs">{row.voucherNo}</td>
                  <td>{formatDate(row.voucherDate)}</td>
                  <td>{VOUCHER_TYPE_LABELS[Number(row.voucherType)] ?? row.voucherType}</td>
                  <td>{row.warehouseName}</td>
                  <td>{row.lineCount}</td>
                  <td>
                    <span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : Number(row.status) === 3 ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>
                      {VOUCHER_STATUS_LABELS[Number(row.status)] ?? row.status}
                    </span>
                  </td>
                  <td className="text-slate-500">{row.createdBy ?? '—'}</td>
                  <td className="font-mono text-xs">{row.glJournalId ? `#${row.glJournalId}` : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد أذون مطابقة للفلاتر</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
