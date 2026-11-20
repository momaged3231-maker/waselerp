'use client';

import { useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { formatDocumentDateTime, useDisplayTimezone } from '@/lib/time';
import { MOVE_LABELS } from '@/lib/stock';

/** «بحث الأرقام المسلسلة للقطع» — serial-number ledger lookup across purchases, sales, transfers and returns. */
export default function SerialSearchScreen() {
  const timeZone = useDisplayTimezone();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setError('اكتب رقمين على الأقل للبحث'); return; }
    setLoading(true); setError('');
    try {
      setRows(await apiFetch<any[]>(`/inventory/serial-search?query=${encodeURIComponent(q)}`));
      setSearched(true);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر البحث');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="card p-4 flex flex-wrap items-end gap-2" onSubmit={search}>
        <div className="flex-1 min-w-60">
          <label className="label">الرقم المسلسل للقطعة</label>
          <input
            className="input"
            autoFocus
            dir="ltr"
            placeholder="مثال: SN-2026-000123"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={loading}>{loading ? 'جارٍ البحث…' : 'بحث'}</button>
        <span className="text-[11px] text-slate-400 w-full">يبحث في سجل حركات المخزون بالكامل (شراء، بيع، مرتجعات، تحويلات، جرد) مع رقم المستند والمخزن والفرع.</span>
      </form>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="card-title"><span>نتائج البحث ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>التاريخ</th><th>الصنف</th><th>الرقم المسلسل</th><th>الحركة</th><th>الكمية</th><th>المستند</th><th>المخزن</th><th>الفرع</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.movementId}>
                  <td className="whitespace-nowrap">{formatDocumentDateTime(row.moveDate, undefined, timeZone)}</td>
                  <td className="font-semibold">{row.itemName} <span className="font-mono text-[10px] text-slate-400">{row.itemCode}</span></td>
                  <td className="font-mono text-xs" dir="ltr">{row.serialNo ?? '—'}</td>
                  <td>
                    <span className={`badge ${Number(row.quantity) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {MOVE_LABELS[row.moveType] ?? row.moveType}
                    </span>
                  </td>
                  <td className="font-bold">{Number(row.quantity).toFixed(2)}</td>
                  <td className="font-mono text-xs">{row.referenceType ? `${row.referenceType} ` : ''}{row.referenceNo ?? '—'}</td>
                  <td>{row.warehouseName ?? '—'}</td>
                  <td className="text-slate-500">{row.branchName ?? '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">{searched ? 'لا توجد حركة مسجلة بهذا الرقم' : 'اكتب الرقم المسلسل واضغط بحث'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
