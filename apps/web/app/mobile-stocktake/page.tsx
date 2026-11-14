'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function MobileStocktakePage() {
  const { can } = useSession();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [countId, setCountId] = useState<number | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [countedQty, setCountedQty] = useState(1);
  const [lines, setLines] = useState<{ itemId: number; code: string; name: string; countedQty: number }[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const canManage = can('stock.manage');

  async function init() {
    try {
      const [wh, emp, itemRows] = await Promise.all([
        apiFetch<any[]>('/catalog/warehouses'),
        apiFetch<any[]>('/hr/employees'),
        apiFetch<any>('/items?pageSize=1000'),
      ]);
      setWarehouses(wh);
      setEmployees(emp);
      setItems(itemRows.items ?? itemRows);
      if (wh.length) setWarehouseId(wh[0].warehouseId);
      if (emp.length) setEmployeeId(emp[0].employeeId);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { init(); }, []);

  async function startCount() {
    if (!warehouseId || !employeeId) { setError('اختر المخزن والموظف'); return; }
    setError(''); setMessage('');
    setLoading(true);
    try {
      const created = await apiFetch<any>('/stock-counts', {
        method: 'POST',
        body: { warehouseId: Number(warehouseId), employeeId: Number(employeeId), notes: 'جرد موبايل' },
      });
      setCountId(created.stockCountId);
      setLines([]);
      setMessage(`تم إنشاء سند الجرد ${created.countNo} — ابدأ المسح`);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleScan() {
    setError(''); setMessage('');
    if (!countId) { setError('أنشئ سند جرد أولًا'); return; }
    const code = scanCode.trim();
    if (!code) return;
    const item = items.find((i) => i.code === code || i.barcode === code);
    if (!item) { setError(`لا يوجد صنف بالكود/الباركود: ${code}`); return; }
    const qty = Number(countedQty) || 1;
    try {
      await apiFetch(`/stock-counts/${countId}/lines`, {
        method: 'POST',
        body: { itemId: item.itemId, countedQty: qty },
      });
      setLines((prev) => {
        const existing = prev.find((l) => l.itemId === item.itemId);
        if (existing) return prev.map((l) => l.itemId === item.itemId ? { ...l, countedQty: l.countedQty + qty } : l);
        return [...prev, { itemId: item.itemId, code: item.code, name: item.name, countedQty: qty }];
      });
      setScanCode('');
      setCountedQty(1);
      setMessage(`تمت إضافة ${item.name}`);
    } catch (e: any) { setError(e.message); }
  }

  async function approveCount() {
    if (!countId) return;
    setError(''); setMessage('');
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/stock-counts/${countId}/approve`, { method: 'POST' });
      setMessage(`تم اعتماد السند — قيمة الفرق ${Number(res.totalValue ?? 0).toFixed(2)}`);
      setCountId(null);
      setLines([]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <AppShell title="الجرد الموبايل">
      <div className="p-4 max-w-2xl space-y-4">
        {error && <div className="card p-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
        {message && <div className="card p-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

        {!countId ? (
          <div className="card p-4 space-y-3">
            <div className="font-bold">بدء سند جرد</div>
            <div>
              <label className="label">المخزن</label>
              <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))} disabled={!canManage}>
                <option value="">— اختر —</option>
                {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">الموظف المختص</label>
              <select className="input" value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))} disabled={!canManage}>
                <option value="">— اختر —</option>
                {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}
              </select>
            </div>
            <button className="btn-primary w-full" onClick={startCount} disabled={!canManage || loading || !warehouseId || !employeeId}>
              {loading ? 'جاري الإنشاء...' : 'إنشاء سند جرد'}
            </button>
          </div>
        ) : (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold">سند جرد مفتوح #{countId}</div>
              <button className="btn-soft text-xs" onClick={approveCount} disabled={!canManage || loading || lines.length === 0}>
                اعتماد وتطبيق
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <input
                className="input flex-1 min-w-[180px]"
                placeholder="امسح الباركود أو أدخل الكود"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                disabled={!canManage}
                autoFocus
              />
              <input
                className="input w-24"
                type="number"
                step="0.001"
                value={countedQty}
                onChange={(e) => setCountedQty(Number(e.target.value))}
                disabled={!canManage}
              />
              <button className="btn-primary" onClick={handleScan} disabled={!canManage || !scanCode}>إضافة</button>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الصنف</th><th>الكمية المضافة</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.itemId}>
                      <td className="font-mono text-xs">{l.code}</td>
                      <td className="text-sm">{l.name}</td>
                      <td className="font-bold">{l.countedQty}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-6">لم تُضف أصناف بعد</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-slate-500">إضافة نفس الصنف مرة أخرى تجمع الكمية تلقائيًا في السند.</div>
          </div>
        )}
      </div>
    </AppShell>
  );
}