'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

export default function InventoryPage() {
  const [tab, setTab] = useState<'balances' | 'alerts' | 'movements' | 'operations'>('balances');
  const [balances, setBalances] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);

  async function load() {
    const rows = await apiFetch<any[]>(
      `/inventory/balances?search=${encodeURIComponent(search)}&warehouseId=${warehouseId || ''}&lowStock=${lowStock}`,
    );
    setBalances(rows);
  }

  useEffect(() => {
    apiFetch('/catalog/warehouses').then(setWarehouses).catch(() => {});
    apiFetch('/inventory/movements?limit=100').then(setMovements).catch(() => {});
    apiFetch('/inventory/operations').then(setOperations).catch(() => {});
    apiFetch('/inventory/reorder-alerts').then(setAlerts).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [search, warehouseId, lowStock]);

  const totalValue = balances.reduce((sum, row) => sum + Number(row.stockValue ?? 0), 0);

  return (
    <AppShell title="المخزون">
      <div className="flex flex-wrap gap-2 mb-4">
        {([['balances', 'الأرصدة'], ['alerts', 'تنبيهات حد الطلب'], ['movements', 'الحركات'], ['operations', 'التحويلات والجرد']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
        <div className="flex-1" />
        <span className="badge bg-emerald-50 text-emerald-700 self-center">قيمة المخزون {formatMoney(totalValue)}</span>
      </div>

      {tab === 'balances' && (
        <div className="card">
          <div className="card-title flex-wrap gap-2">
            <span>أرصدة الأصناف</span>
            <div className="flex gap-2">
              <select className="input w-44 py-1.5" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">كل المخازن</option>
                {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
              <input className="input w-40 py-1.5" placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
                تحت الحد
              </label>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>الصنف</th><th>المخزن</th><th>الفرع</th><th>الرصيد</th><th>متوسط التكلفة</th><th>القيمة</th></tr></thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={`${row.itemId}-${row.warehouseId}`}>
                    <td className="font-mono text-xs">{row.code}</td>
                    <td className="font-semibold">{row.name}</td>
                    <td>{row.warehouseName}</td>
                    <td className="text-slate-500">{row.branchName}</td>
                    <td className={row.lowStock ? 'text-rose-600 font-bold' : ''}>{Number(row.onHandQty).toFixed(2)} {row.unitName}</td>
                    <td>{formatMoney(row.avgCost)}</td>
                    <td className="font-bold">{formatMoney(row.stockValue)}</td>
                  </tr>
                ))}
                {balances.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد أرصدة</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'alerts' && (
        <div className="card">
          <div className="card-title"><span>أصناف وصلت أو نزلت عن حد الطلب</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>الصنف</th><th>المخزن</th><th>المتاح</th><th>حد الطلب</th><th>العجز</th></tr></thead>
              <tbody>
                {alerts.map((row, idx) => {
                  const shortage = Math.max(0, Number(row.reorderPoint) - Number(row.onHand));
                  return (
                    <tr key={`${row.itemId}-${row.warehouseName}-${idx}`}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td className="font-semibold">{row.name}</td>
                      <td>{row.warehouseName ?? '—'}</td>
                      <td className="font-bold text-rose-600">{Number(row.onHand).toFixed(2)} {row.unitName ?? ''}</td>
                      <td>{Number(row.reorderPoint).toFixed(2)}</td>
                      <td>{shortage.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {alerts.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد تنبيهات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'movements' && (
        <div className="card">
          <div className="card-title"><span>حركات المخزون</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>التكلفة</th><th>المرجع</th><th>المخزن</th></tr></thead>
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
                    <td className="font-mono text-xs">{row.referenceNo ?? '—'}</td>
                    <td className="text-slate-500">{row.warehouseName}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد حركات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'operations' && (
        <div className="card">
          <div className="card-title"><span>عمليات التحويل والجرد</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>من</th><th>إلى</th><th>عدد الأصناف</th><th>المستخدم</th></tr></thead>
              <tbody>
                {operations.map((row) => (
                  <tr key={row.operationId}>
                    <td className="font-mono text-xs">{row.operationNo}</td>
                    <td>{row.operationType === 1 ? 'تحويل' : row.operationType === 2 ? 'جرد' : 'تسوية'}</td>
                    <td>{formatDate(row.operationDate)}</td>
                    <td>{row.fromWarehouse ?? '—'}</td>
                    <td>{row.toWarehouse ?? '—'}</td>
                    <td>{row.lineCount}</td>
                    <td className="text-slate-500">{row.createdBy ?? '—'}</td>
                  </tr>
                ))}
                {operations.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد عمليات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const MOVE_LABELS: Record<number, string> = {
  1: 'شراء', 2: 'بيع', 3: 'مرتجع بيع', 4: 'مرتجع شراء',
  5: 'تحويل داخل', 6: 'تحويل خارج', 7: 'زيادة جرد', 8: 'عجز جرد', 9: 'رصيد افتتاحي', 10: 'تسوية',
};
