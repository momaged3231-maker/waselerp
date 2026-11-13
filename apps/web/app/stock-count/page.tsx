'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const STATUS: Record<number, string> = {
  1: 'غير معتمد', 2: 'معتمد', 3: 'ملغى',
};

export default function StockCountPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState(0);

  const [headerForm, setHeaderForm] = useState({ warehouseId: 0, employeeId: 0, countDate: '', notes: '' });
  const [lineForm, setLineForm] = useState({ itemId: 0, unitId: 0, countedQty: 0, expiryDate: '' });
  const [groupForm, setGroupForm] = useState({ categoryId: 0, quantity: 0 });
  const [itemSearch, setItemSearch] = useState('');

  const canManage = can('stock.manage');

  async function load() {
    const [list, wh, emp, cat, itemRows] = await Promise.all([
      apiFetch<any[]>(`/stock-counts?status=${statusFilter}&limit=100`),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any[]>('/hr/employees'),
      apiFetch<any[]>('/catalog/categories'),
      apiFetch<any>('/items?pageSize=200'),
    ]);
    setRows(list);
    setWarehouses(wh);
    setEmployees(emp);
    setCategories(cat);
    setItems(itemRows.items ?? itemRows);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [statusFilter]);

  async function open(id: number) {
    setError(''); setMessage('');
    try {
      const detail = await apiFetch(`/stock-counts/${id}`);
      setSelected(detail);
      setHeaderForm({
        warehouseId: detail.header.warehouseId,
        employeeId: detail.header.employeeId,
        countDate: String(detail.header.countDate ?? '').slice(0, 10),
        notes: detail.header.notes ?? '',
      });
    } catch (e: any) { setError(e.message); }
  }

  async function createCount() {
    setError(''); setMessage('');
    try {
      const result = await apiFetch('/stock-counts', { method: 'POST', body: headerForm });
      setMessage(`تم إنشاء سند الجرد ${result.countNo}`);
      await open(result.stockCountId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addLine() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/stock-counts/${selected.header.stockCountId}/lines`, {
        method: 'POST', body: lineForm,
      });
      setLineForm({ itemId: 0, unitId: 0, countedQty: 0, expiryDate: '' });
      await open(selected.header.stockCountId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addGroup() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const result = await apiFetch(`/stock-counts/${selected.header.stockCountId}/groups`, {
        method: 'POST', body: groupForm,
      });
      setMessage(`تمت إضافة ${result.added} صنف (${result.skipped} متجاوز)`);
      await open(selected.header.stockCountId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function updateLine(lineId: number, countedQty: number) {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/stock-counts/${selected.header.stockCountId}/lines/${lineId}`, {
        method: 'PUT', body: { countedQty },
      });
      await open(selected.header.stockCountId);
    } catch (e: any) { setError(e.message); }
  }

  async function approve() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const result = await apiFetch(`/stock-counts/${selected.header.stockCountId}/approve`, { method: 'POST' });
      setMessage(`تم اعتماد السند — قيمة الفرق ${formatMoney(result.totalValue)}`);
      await open(selected.header.stockCountId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove() {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/stock-counts/${selected.header.stockCountId}`, { method: 'DELETE' });
      setSelected(null);
      setMessage('تم حذف السند');
      await load();
    } catch (e: any) { setError(e.message); }
  }

  const filteredItems = itemSearch
    ? items.filter((item) => item.code.includes(itemSearch) || item.name.includes(itemSearch))
    : items;

  return (
    <AppShell title="سند الجرد">
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className="input w-36 py-1.5" value={statusFilter}
          onChange={(e) => setStatusFilter(Number(e.target.value))}>
          <option value={0}>كل الحالات</option>
          {[1, 2, 3].map((key) => (
            <option key={key} value={key}>{STATUS[key]}</option>
          ))}
        </select>
        <div className="flex-1" />
        {canManage && !selected && (
          <button className="btn-primary" disabled={!headerForm.warehouseId || !headerForm.employeeId}
            onClick={createCount}>
            سند جرد جديد
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          {canManage && !selected && (
            <div className="card p-4 space-y-3">
              <div className="font-bold">بيانات السند</div>
              <div>
                <label className="label">المخزن</label>
                <select className="input" value={headerForm.warehouseId}
                  onChange={(e) => setHeaderForm({ ...headerForm, warehouseId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {warehouses.map((row) => (
                    <option key={row.warehouseId} value={row.warehouseId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">الموظف المختص (إلزامي)</label>
                <select className="input" value={headerForm.employeeId}
                  onChange={(e) => setHeaderForm({ ...headerForm, employeeId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {employees.map((row) => (
                    <option key={row.employeeId} value={row.employeeId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={headerForm.countDate}
                  onChange={(e) => setHeaderForm({ ...headerForm, countDate: e.target.value })} />
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input className="input" value={headerForm.notes}
                  onChange={(e) => setHeaderForm({ ...headerForm, notes: e.target.value })} />
              </div>
            </div>
          )}

          {canManage && selected && Number(selected.header.status) === 1 && (
            <>
              <div className="card p-4 space-y-3">
                <div className="font-bold">إضافة صنف</div>
                <input className="input" placeholder="ابحث بكود الصنف أو اسمه" value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)} />
                <select className="input" value={lineForm.itemId}
                  onChange={(e) => setLineForm({ ...lineForm, itemId: Number(e.target.value) })}>
                  <option value={0}>— الصنف —</option>
                  {filteredItems.map((item) => (
                    <option key={item.itemId} value={item.itemId}>{item.code} — {item.name}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="number" step="0.001" placeholder="الكمية الفعلية"
                    value={lineForm.countedQty || ''}
                    onChange={(e) => setLineForm({ ...lineForm, countedQty: Number(e.target.value) })} />
                  <input className="input" type="date" value={lineForm.expiryDate}
                    onChange={(e) => setLineForm({ ...lineForm, expiryDate: e.target.value })} />
                </div>
                <button className="btn-primary w-full" disabled={!lineForm.itemId} onClick={addLine}>
                  إضافة للسند
                </button>
              </div>

              <div className="card p-4 space-y-3">
                <div className="font-bold">إضافة مجموعة أصناف</div>
                <select className="input" value={groupForm.categoryId}
                  onChange={(e) => setGroupForm({ ...groupForm, categoryId: Number(e.target.value) })}>
                  <option value={0}>كل الأصناف</option>
                  {categories.map((row) => (
                    <option key={row.categoryId} value={row.categoryId}>{row.name}</option>
                  ))}
                </select>
                <input className="input" type="number" step="0.001" placeholder="كمية موحدة لكل صنف"
                  value={groupForm.quantity || ''}
                  onChange={(e) => setGroupForm({ ...groupForm, quantity: Number(e.target.value) })} />
                <button className="btn-soft w-full" onClick={addGroup}>إضافة المجموعة</button>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selected && (
            <div className="card">
              <div className="card-title">
                <span>
                  {selected.header.countNo} · {selected.header.warehouseName} · {selected.header.employeeName}
                </span>
                <span className={`badge ${Number(selected.header.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {STATUS[selected.header.status]}
                </span>
              </div>
              <div className="px-4 pb-2 text-xs text-slate-500 flex flex-wrap gap-4">
                <span>المتوقع: {Number(selected.header.totalExpected).toFixed(3)}</span>
                <span>المعتمد: {Number(selected.header.totalCounted).toFixed(3)}</span>
                <span>الفارق: {Number(selected.header.totalDifference).toFixed(3)}</span>
                <span>القيمة: {formatMoney(selected.header.totalValue)}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الصنف</th><th>الكمية الحالية</th><th>الكمية المتوقعة</th>
                      <th>الفارق</th><th>سعر الوحدة</th><th>قيمة الفارق</th><th>تاريخ الصلاحية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line: any) => (
                      <tr key={line.lineId}
                        className={Number(line.differenceQty) > 0 ? 'bg-emerald-50/50' : Number(line.differenceQty) < 0 ? 'bg-rose-50/50' : ''}>
                        <td className="text-xs">
                          <div className="font-semibold">{line.itemName}</div>
                          <div className="text-slate-400 font-mono">{line.itemCode}</div>
                        </td>
                        <td className="text-xs">
                          {Number(selected.header.status) === 1 ? (
                            <input
                              className="input py-0.5 text-xs w-24" type="number" step="0.001"
                              value={line.countedQty}
                              onChange={(e) => updateLine(line.lineId, Number(e.target.value))}
                            />
                          ) : Number(line.countedQty).toFixed(3)}
                        </td>
                        <td className="text-xs">{Number(line.expectedQty).toFixed(3)}</td>
                        <td className={`text-xs font-bold ${Number(line.differenceQty) > 0 ? 'text-emerald-700' : Number(line.differenceQty) < 0 ? 'text-rose-600' : ''}`}>
                          {Number(line.differenceQty).toFixed(3)}
                        </td>
                        <td className="text-xs">{formatMoney(line.unitCost)}</td>
                        <td className="text-xs">{formatMoney(line.differenceValue)}</td>
                        <td className="text-xs">{line.expiryDate ?? '—'}</td>
                      </tr>
                    ))}
                    {selected.lines.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-slate-400 py-8">لم تُضف أصناف بعد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {canManage && (
                <div className="flex gap-2 p-3">
                  {Number(selected.header.status) === 1 && (
                    <>
                      <button className="btn-primary" onClick={approve}>اعتماد وتطبيق الفروقات</button>
                      <button className="btn-soft" onClick={remove}>حذف السند</button>
                    </>
                  )}
                  {Number(selected.header.status) === 2 && (
                    <span className="text-xs text-slate-500">
                      السند المعتمد لا يمكن تعديله — اعتمد سندًا جديدًا لتصحيح أي فرق.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>سندات الجرد ({rows.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>الرقم</th><th>التاريخ</th><th>المخزن</th><th>الموظف</th><th>الأصناف</th><th>الفارق</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.stockCountId} className="cursor-pointer hover:bg-brand-50/40"
                      onClick={() => open(row.stockCountId)}>
                      <td className="font-mono text-xs">{row.countNo}</td>
                      <td className="text-xs">{formatDate(row.countDate)}</td>
                      <td className="text-xs">{row.warehouseName}</td>
                      <td className="text-xs">{row.employeeName}</td>
                      <td className="text-xs">{row.lineCount}</td>
                      <td className="text-xs font-bold">{Number(row.totalDifference).toFixed(3)}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {STATUS[row.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد سندات جرد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
