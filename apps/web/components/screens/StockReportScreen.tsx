'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';
import { MOVE_LABELS } from '@/lib/stock';

/** «تقرير أرصدة المخازن وحركة الأصناف» — per-warehouse stock totals + item movement ledger. */
export default function StockReportScreen() {
  const [balances, setBalances] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  async function loadBalances() {
    setError('');
    try {
      setBalances(await apiFetch<any[]>('/inventory/balances'));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الأرصدة');
    }
  }

  async function loadMovements(nextItemId = itemId, nextWarehouse = warehouseId) {
    setError('');
    try {
      const qs = new URLSearchParams({ limit: '300' });
      if (nextItemId) qs.set('itemId', String(nextItemId));
      if (nextWarehouse) qs.set('warehouseId', String(nextWarehouse));
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      setMovements(await apiFetch<any[]>(`/inventory/movements?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الحركات');
    }
  }

  useEffect(() => {
    apiFetch('/catalog/warehouses').then(setWarehouses).catch(() => {});
    loadBalances();
    loadMovements('', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchItems(term: string) {
    setItemSearch(term);
    if (term.trim().length < 1) { setItemResults([]); return; }
    const data = await apiFetch<any>(`/items?search=${encodeURIComponent(term.trim())}&pageSize=8`);
    setItemResults(data.items ?? []);
  }

  function pickItem(item: any) {
    setItemId(Number(item.itemId));
    setItemSearch(`${item.code} — ${item.name}`);
    setItemResults([]);
    loadMovements(Number(item.itemId), warehouseId);
  }

  const warehouseTotals = useMemo(() => {
    const map = new Map<number, { warehouseId: number; warehouseName: string; branchName: string; lines: number; value: number }>();
    for (const row of balances) {
      const key = Number(row.warehouseId);
      const entry = map.get(key) ?? { warehouseId: key, warehouseName: row.warehouseName, branchName: row.branchName ?? '', lines: 0, value: 0 };
      if (Number(row.onHandQty ?? 0) > 0) entry.lines += 1;
      entry.value += Number(row.stockValue ?? 0);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [balances]);

  const grandTotal = warehouseTotals.reduce((sum, row) => sum + row.value, 0);

  function exportCsv() {
    const flat: any[] = [];
    for (const row of warehouseTotals) {
      flat.push({ 'القسم': 'أرصدة المخازن', 'المخزن': row.warehouseName, 'الفرع': row.branchName, 'أصناف برصيد': row.lines, 'قيمة المخزون': Number(row.value.toFixed(2)), 'التاريخ': '', 'الصنف': '', 'الحركة': '', 'الكمية': '', 'المرجع': '' });
    }
    for (const row of movements) {
      flat.push({ 'القسم': 'حركة الأصناف', 'المخزن': row.warehouseName, 'الفرع': '', 'أصناف برصيد': '', 'قيمة المخزون': '', 'التاريخ': row.moveDate ? String(row.moveDate).slice(0, 10) : '', 'الصنف': row.itemName, 'الحركة': MOVE_LABELS[row.moveType] ?? row.moveType, 'الكمية': Number(row.quantity), 'المرجع': row.referenceNo ?? '' });
    }
    downloadCsv('wasel-stock-report', flat);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">أرصدة المخازن وحركة الأصناف</span>
        <div className="flex-1" />
        <span className="badge bg-emerald-50 text-emerald-700">إجمالي قيمة المخزون {formatMoney(grandTotal)}</span>
        <button className="btn-soft" onClick={exportCsv} disabled={balances.length === 0 && movements.length === 0}>تصدير CSV</button>
        <button className="btn-soft" onClick={() => window.print()}>طباعة</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="card">
        <div className="card-title"><span>أرصدة المخازن</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>المخزن</th><th>الفرع</th><th>أصناف برصيد</th><th>قيمة المخزون</th></tr></thead>
            <tbody>
              {warehouseTotals.map((row) => (
                <tr key={row.warehouseId} className="cursor-pointer hover:bg-slate-50" onClick={() => { setWarehouseId(row.warehouseId); loadMovements(itemId, row.warehouseId); }} title="اضغط لعرض حركات هذا المخزن">
                  <td className="font-semibold">{row.warehouseName}</td>
                  <td className="text-slate-500">{row.branchName}</td>
                  <td>{row.lines}</td>
                  <td className="font-bold">{formatMoney(row.value)}</td>
                </tr>
              ))}
              {warehouseTotals.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد أرصدة مسجلة</td></tr>}
            </tbody>
            {warehouseTotals.length > 0 && <tfoot><tr className="font-bold"><td colSpan={3}>الإجمالي</td><td>{formatMoney(grandTotal)}</td></tr></tfoot>}
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title flex-wrap gap-2">
          <span>حركة الأصناف</span>
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative">
              <label className="label mb-1 text-[10px]">الصنف</label>
              <input className="input w-56 py-1.5" placeholder="بحث باسم/كود الصنف…" value={itemSearch} onChange={(e) => searchItems(e.target.value)} />
              {itemResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                  {itemResults.map((item) => (
                    <button key={item.itemId} type="button" className="w-full text-right px-3 py-2 text-xs hover:bg-brand-50 flex justify-between gap-2" onClick={() => pickItem(item)}>
                      <span>{item.name}</span>
                      <span className="font-mono text-slate-400">{item.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label mb-1 text-[10px]">المخزن</label>
              <select className="input w-40 py-1.5" value={warehouseId} onChange={(e) => { const next = e.target.value ? Number(e.target.value) : ''; setWarehouseId(next); loadMovements(itemId, next); }}>
                <option value="">كل المخازن</option>
                {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
            </div>
            <div><label className="label mb-1 text-[10px]">من</label><input className="input py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="label mb-1 text-[10px]">إلى</label><input className="input py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <button className="btn-primary py-1.5" onClick={() => loadMovements()}>عرض</button>
            {(itemId || itemSearch) && <button className="btn-soft py-1.5" onClick={() => { setItemId(''); setItemSearch(''); loadMovements('', warehouseId); }}>مسح الصنف</button>}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>التاريخ</th><th>الصنف</th><th>الحركة</th><th>الكمية</th><th>التكلفة</th><th>المرجع</th><th>المخزن</th></tr></thead>
            <tbody>
              {movements.map((row) => (
                <tr key={row.movementId}>
                  <td>{formatDate(row.moveDate)}</td>
                  <td className="font-semibold">{row.itemName}</td>
                  <td>
                    <span className={`badge ${Number(row.quantity) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {MOVE_LABELS[row.moveType] ?? row.moveType}
                    </span>
                  </td>
                  <td className="font-bold">{Number(row.quantity).toFixed(2)}</td>
                  <td>{formatMoney(row.unitCost)}</td>
                  <td className="font-mono text-xs">{[row.referenceType, row.referenceNo].filter(Boolean).join(' ') || '—'}</td>
                  <td>{row.warehouseName ?? '—'}</td>
                </tr>
              ))}
              {movements.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد حركات مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
