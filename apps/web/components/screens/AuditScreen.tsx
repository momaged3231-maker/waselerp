'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateTime, useDisplayTimezone } from '@/lib/time';

/**
 * Tools → «سجل عمليات المستخدمين»
 * Filterable operations log: who / when / what / free-text search + CSV export.
 */
export default function AuditScreen() {
  const timeZone = useDisplayTimezone();
  const [rows, setRows] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [filters, setFilters] = useState({ userId: '', from: '', to: '', action: '', search: '', limit: 200 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError('');
    const qs = new URLSearchParams();
    qs.set('limit', String(filters.limit || 200));
    if (filters.action.trim()) qs.set('action', filters.action.trim());
    if (filters.userId) qs.set('userId', filters.userId);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.search.trim()) qs.set('search', filters.search.trim());
    try {
      setRows(await apiFetch<any[]>(`/admin/audit?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التحميل — تحتاج صلاحية مناسبة');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    apiFetch<any[]>('/admin/users').then(setUsers).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo(() => [...new Set(rows.map((row) => row.action))].sort(), [rows]);

  function downloadCsv() {
    const header = ['التاريخ', 'المستخدم', 'الفرع', 'العملية', 'الكيان', 'التفاصيل'];
    const escape = (v: any) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(',')]
      .concat(rows.map((row) => [
        formatDateTime(row.createdAt, timeZone, true), row.userName ?? '', row.branchName ?? '', row.action ?? '',
        `${row.entity ?? ''} #${row.entityId ?? ''}`, row.details ?? '',
      ].map(escape).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wasel-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">المستخدم</label>
          <select className="input w-44" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
            <option value="">الكل</option>
            {users.map((u) => <option key={u.userId} value={u.userId}>{u.fullName} (@{u.userName})</option>)}
          </select>
        </div>
        <div><label className="label">من</label><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><label className="label">إلى</label><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <div><label className="label">نوع العملية</label><input className="input w-44" list="audit-actions" placeholder="مثال: invoice.cancel" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} /><datalist id="audit-actions">{actions.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div className="flex-1 min-w-44"><label className="label">بحث في التفاصيل/الكيان</label><input className="input" placeholder="اكتب كلمة…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <div><label className="label">الحد الأقصى</label><input className="input w-24" type="number" min={1} max={1000} value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value) || 200 })} /></div>
        <button className="btn-primary" onClick={load} disabled={busy}>{busy ? 'جارٍ البحث…' : 'عرض'}</button>
        <button className="btn-soft" onClick={downloadCsv} disabled={rows.length === 0}>تصدير CSV</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="card-title"><span>العمليات ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>التاريخ</th><th>المستخدم</th><th>الفرع</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.activityLogId}>
                  <td className="text-xs whitespace-nowrap">{formatDateTime(row.createdAt, timeZone, true)}</td>
                  <td className="font-semibold">{row.userName ?? '—'}</td>
                  <td className="text-slate-500">{row.branchName ?? '—'}</td>
                  <td><span className="badge bg-slate-100 text-slate-600">{row.action}</span></td>
                  <td className="text-xs">{row.entity} #{row.entityId}</td>
                  <td className="text-xs text-slate-500">{row.details ?? '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد عمليات مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
