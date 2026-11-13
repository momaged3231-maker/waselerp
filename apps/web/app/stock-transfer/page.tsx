'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'أذن صادر تم إنشاؤه', 3: 'أذن وارد تم إنشاؤه', 4: 'مكتمل', 5: 'ملغي',
};

export default function StockTransferPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState(0);

  const [headerForm, setHeaderForm] = useState({
    fromWarehouseId: 0, toWarehouseId: 0, transferDate: '', notes: '',
  });
  const [lineForm, setLineForm] = useState({
    itemId: 0, unitId: 0, quantity: 0, unitCost: 0, serialNo: '', expiryDate: '', notes: '',
  });
  const [itemSearch, setItemSearch] = useState('');

  const canManage = can('stock.manage');

  async function load() {
    const [list, wh, itemRows] = await Promise.all([
      apiFetch<any[]>(`/stock-transfers?status=${statusFilter}&limit=100`),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any>('/items?pageSize=200'),
    ]);
    setRows(list);
    setWarehouses(wh);
    setItems(itemRows.items ?? itemRows);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [statusFilter]);

  async function open(id: number) {
    setError(''); setMessage('');
    try {
      const detail = await apiFetch(`/stock-transfers/${id}`);
      setSelected(detail);
      setHeaderForm({
        fromWarehouseId: detail.header.fromWarehouseId,
        toWarehouseId: detail.header.toWarehouseId,
        transferDate: String(detail.header.transferDate ?? '').slice(0, 10),
        notes: detail.header.notes ?? '',
      });
    } catch (e: any) { setError(e.message); }
  }

  async function createTransfer() {
    setError(''); setMessage('');
    try {
      const result = await apiFetch('/stock-transfers', {
        method: 'POST', body: headerForm,
      });
      setMessage(`تم إنشاء التحويل ${result.transferNo}`);
      await open(result.stockTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addLine() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/stock-transfers/${selected.header.stockTransferId}/lines`, {
        method: 'POST', body: lineForm,
      });
      setLineForm({
        itemId: 0, unitId: 0, quantity: 0, unitCost: 0, serialNo: '', expiryDate: '', notes: '',
      });
      await open(selected.header.stockTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function updateLine(lineId: number, field: string, value: any) {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/stock-transfers/${selected.header.stockTransferId}/lines/${lineId}`, {
        method: 'PUT', body: { [field]: value },
      });
      await open(selected.header.stockTransferId);
    } catch (e: any) { setError(e.message); }
  }

  async function removeLine(lineId: number) {
    if (!selected || !confirm('تأكيد حذف السطر؟')) return;
    setError('');
    try {
      await apiFetch(`/stock-transfers/${selected.header.stockTransferId}/lines/${lineId}`, {
        method: 'DELETE',
      });
      await open(selected.header.stockTransferId);
    } catch (e: any) { setError(e.message); }
  }

  async function approve() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const result = await apiFetch(`/stock-transfers/${selected.header.stockTransferId}/approve`, {
        method: 'POST',
      });
      setMessage(`تم اعتماد التحويل — أذن صادر رقم ${result.outboundVoucherId}`);
      await open(selected.header.stockTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function receive() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const result = await apiFetch(`/stock-transfers/${selected.header.stockTransferId}/receive`, {
        method: 'POST',
      });
      setMessage(`تم استلام التحويل — أذن وارد رقم ${result.inboundVoucherId}`);
      await open(selected.header.stockTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove() {
    if (!selected || !confirm('تأكيد حذف التحويل؟')) return;
    setError('');
    try {
      await apiFetch(`/stock-transfers/${selected.header.stockTransferId}`, { method: 'DELETE' });
      setSelected(null);
      setMessage('تم حذف التحويل');
      await load();
    } catch (e: any) { setError(e.message); }
  }

  const filteredItems = itemSearch
    ? items.filter((item) => item.code.includes(itemSearch) || item.name.includes(itemSearch))
    : items;

  const canApprove = selected && Number(selected.header.status) === 1;
  const canReceive = selected && Number(selected.header.status) === 2;

  return (
    <AppShell title="تحويل غير مباشر بين المخازن">
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className="input w-40 py-1.5" value={statusFilter}
          onChange={(e) => setStatusFilter(Number(e.target.value))}>
          <option value={0}>كل الحالات</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={Number(k)}>{v}</option>
          ))}
        </select>
        <div className="flex-1" />
        {canManage && !selected && (
          <button className="btn-primary" disabled={!headerForm.fromWarehouseId || !headerForm.toWarehouseId}
            onClick={createTransfer}>
            تحويل جديد
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          {canManage && !selected && (
            <div className="card p-4 space-y-3">
              <div className="font-bold">بيانات التحويل</div>
              <div>
                <label className="label">مخزن المصدر ( salida )</label>
                <select className="input" value={headerForm.fromWarehouseId}
                  onChange={(e) => setHeaderForm({ ...headerForm, fromWarehouseId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {warehouses.map((row) => (
                    <option key={row.warehouseId} value={row.warehouseId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">مخزن الوجهة ( entrada )</label>
                <select className="input" value={headerForm.toWarehouseId}
                  onChange={(e) => setHeaderForm({ ...headerForm, toWarehouseId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {warehouses.map((row) => (
                    <option key={row.warehouseId} value={row.warehouseId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={headerForm.transferDate}
                  onChange={(e) => setHeaderForm({ ...headerForm, transferDate: e.target.value })} />
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
                  <input className="input" type="number" step="0.001" placeholder="الكمية"
                    value={lineForm.quantity || ''}
                    onChange={(e) => setLineForm({ ...lineForm, quantity: Number(e.target.value) })} />
                  <input className="input" type="number" step="0.0001" placeholder="سعر الوحدة"
                    value={lineForm.unitCost || ''}
                    onChange={(e) => setLineForm({ ...lineForm, unitCost: Number(e.target.value) })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="الرقم التسلسلي" value={lineForm.serialNo}
                    onChange={(e) => setLineForm({ ...lineForm, serialNo: e.target.value })} />
                  <input className="input" type="date" value={lineForm.expiryDate}
                    onChange={(e) => setLineForm({ ...lineForm, expiryDate: e.target.value })} />
                </div>
                <input className="input" placeholder="ملاحظات السطر" value={lineForm.notes}
                  onChange={(e) => setLineForm({ ...lineForm, notes: e.target.value })} />
                <button className="btn-primary w-full" disabled={!lineForm.itemId || !lineForm.quantity} onClick={addLine}>
                  إضافة للسطر
                </button>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selected && (
            <div className="card">
              <div className="card-title">
                <span>{selected.header.transferNo}</span>
                <span className={`badge ${Number(selected.header.status) === 4 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {STATUS[selected.header.status]}
                </span>
                <span className="text-xs text-slate-500">
                  {selected.header.fromWarehouseName} → {selected.header.toWarehouseName}
                </span>
              </div>
              <div className="px-4 pb-2 text-xs text-slate-500">
                <span>القيمة الإجمالية: {formatMoney(selected.header.totalValue ?? 0)}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>القيمة</th>
                      <th>الرقم التسلسلي</th><th>تاريخ الصلاحية</th>
                      {canManage && Number(selected.header.status) === 1 && <th>إجراءات</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line: any) => (
                      <tr key={line.lineId}>
                        <td className="text-xs">
                          <div className="font-semibold">{line.itemName}</div>
                          <div className="text-slate-400 font-mono">{line.itemCode}</div>
                        </td>
                        <td className="text-xs">{line.unitName}</td>
                        <td className="text-xs">
                          {Number(selected.header.status) === 1 ? (
                            <input
                              className="input py-0.5 text-xs w-20" type="number" step="0.001"
                              value={line.quantity}
                              onChange={(e) => updateLine(line.lineId, 'quantity', Number(e.target.value))}
                            />
                          ) : Number(line.quantity).toFixed(3)}
                        </td>
                        <td className="text-xs">
                          {Number(selected.header.status) === 1 ? (
                            <input
                              className="input py-0.5 text-xs w-20" type="number" step="0.0001"
                              value={line.unitCost}
                              onChange={(e) => updateLine(line.lineId, 'unitCost', Number(e.target.value))}
                            />
                          ) : formatMoney(line.unitCost)}
                        </td>
                        <td className="text-xs">{formatMoney(line.lineValue)}</td>
                        <td className="text-xs">{line.serialNo ?? '—'}</td>
                        <td className="text-xs">{line.expiryDate ?? '—'}</td>
                        {canManage && Number(selected.header.status) === 1 && (
                          <td className="text-xs">
                            <button className="text-rose-600 hover:underline text-xs" onClick={() => removeLine(line.lineId)}>
                              حذف
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {selected.lines.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-slate-400 py-8">لم تُضف أصناف بعد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {canManage && (
                <div className="flex gap-2 p-3">
                  {canApprove && (
                    <button className="btn-primary" onClick={approve}>
                      اعتماد وإصدار أذن صادر
                    </button>
                  )}
                  {canReceive && (
                    <button className="btn-primary" onClick={receive}>
                      استلام وإصدار أذن وارد
                    </button>
                  )}
                  {Number(selected.header.status) === 1 && (
                    <button className="btn-soft" onClick={remove}>حذف التحويل</button>
                  )}
                  {Number(selected.header.status) === 4 && (
                    <span className="text-xs text-slate-500">
                      التحويل مكتمل — الصنف غادر المصدر ووصل للوجهة.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>تحويلات المخزون ({rows.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الرقم</th><th>التاريخ</th><th>المصدر</th><th>الوجهة</th><th>الأصناف</th><th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.stockTransferId} className="cursor-pointer hover:bg-brand-50/40"
                      onClick={() => open(row.stockTransferId)}>
                      <td className="font-mono text-xs">{row.transferNo}</td>
                      <td className="text-xs">{formatDate(row.transferDate)}</td>
                      <td className="text-xs">{row.fromWarehouseName}</td>
                      <td className="text-xs">{row.toWarehouseName}</td>
                      <td className="text-xs">{row.lineCount}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 4 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {STATUS[row.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد تحويلات مخزون</td></tr>
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
