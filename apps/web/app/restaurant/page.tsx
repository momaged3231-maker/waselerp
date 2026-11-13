'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'tables' | 'orders' | 'kitchen';

const KITCHEN_STATUS: Record<number, string> = {
  1: 'جديد', 2: 'في المطبخ', 3: 'جاهز', 4: 'تم التقديم',
};
const ORDER_STATUS: Record<number, string> = {
  1: 'مفتوح', 2: 'في المطبخ', 3: 'تم التقديم', 4: 'مغلق',
};

export default function RestaurantPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('tables');
  const [tables, setTables] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [kitchen, setKitchen] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [tableForm, setTableForm] = useState({ name: '', tableType: 1, capacity: 4 });
  const [newOrder, setNewOrder] = useState<{ tableId: number; guestCount: number; lines: any[] }>({
    tableId: 0, guestCount: 1, lines: [],
  });

  const canManage = can('pos.operate');

  async function load() {
    const [t, o, k, itemRows, wh, cash] = await Promise.all([
      apiFetch<any[]>('/pos/tables'),
      apiFetch<any[]>('/pos/table-orders?limit=100'),
      apiFetch<any[]>('/pos/kitchen'),
      apiFetch<any>('/items?pageSize=200'),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any[]>('/treasury/accounts'),
    ]);
    setTables(t);
    setOrders(o);
    setKitchen(k);
    setItems(itemRows.items ?? itemRows);
    setWarehouses(wh);
    setCashAccounts(cash);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function addTable() {
    setError('');
    try {
      await apiFetch('/pos/tables', { method: 'POST', body: tableForm });
      setTableForm({ name: '', tableType: 1, capacity: 4 });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeTable(id: number) {
    setError('');
    try {
      await apiFetch(`/pos/tables/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function openOrder(id: number) {
    setError('');
    try {
      setSelected(await apiFetch(`/pos/table-orders/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveOrder() {
    setError('');
    setMessage('');
    try {
      await apiFetch('/pos/table-orders', {
        method: 'POST',
        body: {
          tableOrderId: selected?.header?.tableOrderId,
          tableId: newOrder.tableId || undefined,
          guestCount: newOrder.guestCount,
          lines: newOrder.lines,
        },
      });
      setMessage('تم حفظ الطلب');
      setNewOrder({ tableId: 0, guestCount: 1, lines: [] });
      setSelected(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function setStatus(id: number, status: number) {
    setError('');
    try {
      await apiFetch(`/pos/table-orders/${id}/kitchen`, { method: 'POST', body: { status } });
      await load();
      if (selected) await openOrder(selected.header.tableOrderId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function setLineStatus(lineId: number, status: number) {
    setError('');
    try {
      await apiFetch(`/pos/table-orders/${selected?.header?.tableOrderId ?? 0}/kitchen`, {
        method: 'POST', body: { lineId, status },
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function closeOrder(id: number) {
    setError('');
    setMessage('');
    try {
      const warehouseId = warehouses[0]?.warehouseId;
      const cashAccountId = cashAccounts[0]?.cashAccountId;
      const result = await apiFetch(`/pos/table-orders/${id}/close`, {
        method: 'POST',
        body: {
          warehouseId,
          cashAccountId,
          paymentType: 1,
          paidAmount: selected?.header?.totalAmount ?? 0,
        },
      });
      setMessage(`تم إنشاء الفاتورة ${result.invoiceNo}`);
      setSelected(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function addLine(item: any) {
    setNewOrder((current) => {
      const existing = current.lines.find((line) => line.itemId === item.itemId);
      if (existing) {
        return {
          ...current,
          lines: current.lines.map((line) => line.itemId === item.itemId
            ? { ...line, quantity: line.quantity + 1 }
            : line),
        };
      }
      return {
        ...current,
        lines: [...current.lines, {
          itemId: item.itemId,
          unitId: item.baseUnitId,
          quantity: 1,
          unitPrice: Number(item.sellPrice ?? 0),
          taxPct: Number(item.vatPct ?? 0),
        }],
      };
    });
  }

  return (
    <AppShell title="المطاعم والصالات">
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex gap-2 mb-4">
        <button className={tab === 'tables' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('tables')}>الطاولات</button>
        <button className={tab === 'orders' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('orders')}>طلبات الطاولات</button>
        <button className={tab === 'kitchen' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('kitchen')}>شاشة المطبخ</button>
      </div>

      {tab === 'tables' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card h-fit">
            <div className="card-title"><span>طاولة جديدة</span></div>
            <div className="p-4 space-y-2">
              <input className="input" placeholder="اسم الطاولة" value={tableForm.name}
                onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })} />
              <select className="input" value={tableForm.tableType}
                onChange={(e) => setTableForm({ ...tableForm, tableType: Number(e.target.value) })}>
                <option value={1}>صالة</option>
                <option value={2}>غرفة خاصة</option>
                <option value={3}>خارجي</option>
              </select>
              <input className="input" type="number" placeholder="السعة" value={tableForm.capacity}
                onChange={(e) => setTableForm({ ...tableForm, capacity: Number(e.target.value) })} />
              <button className="btn-primary w-full" disabled={!tableForm.name} onClick={addTable}>حفظ</button>
            </div>
          </div>

          <div className="lg:col-span-2 card">
            <div className="card-title"><span>الطاولات ({tables.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الاسم</th><th>النوع</th><th>السعة</th><th>طلبات مفتوحة</th><th></th></tr></thead>
                <tbody>
                  {tables.map((row) => (
                    <tr key={row.tableId}>
                      <td className="text-xs font-semibold">{row.name}</td>
                      <td className="text-xs">{row.tableType === 1 ? 'صالة' : row.tableType === 2 ? 'غرفة خاصة' : 'خارجي'}</td>
                      <td className="text-xs">{row.capacity}</td>
                      <td className="text-xs">
                        {row.openOrders > 0
                          ? <span className="badge bg-amber-50 text-amber-700">{row.openOrders}</span>
                          : '—'}
                      </td>
                      <td>
                        {canManage && (
                          <button className="text-rose-500 text-xs" onClick={() => removeTable(row.tableId)}>حذف</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tables.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد طاولات</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-title"><span>طلب جديد</span></div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select className="input" value={newOrder.tableId}
                  onChange={(e) => setNewOrder({ ...newOrder, tableId: Number(e.target.value) })}>
                  <option value={0}>— بدون طاولة —</option>
                  {tables.map((row) => (
                    <option key={row.tableId} value={row.tableId}>{row.name}</option>
                  ))}
                </select>
                <input className="input" type="number" placeholder="عدد الأفراد" value={newOrder.guestCount}
                  onChange={(e) => setNewOrder({ ...newOrder, guestCount: Number(e.target.value) })} />
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                {items.map((item: any) => (
                  <button key={item.itemId}
                    className="w-full text-right px-3 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100"
                    onClick={() => addLine(item)}>
                    {item.code} — {item.name}
                    <span className="text-slate-400"> {formatMoney(item.sellPrice)}</span>
                  </button>
                ))}
              </div>

              {newOrder.lines.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th></th></tr></thead>
                    <tbody>
                      {newOrder.lines.map((line, index) => (
                        <tr key={line.itemId}>
                          <td className="text-xs">{items.find((i: any) => i.itemId === line.itemId)?.name ?? line.itemId}</td>
                          <td>
                            <input className="input py-0.5 text-xs w-16" type="number" step="0.001"
                              value={line.quantity}
                              onChange={(e) => setNewOrder((c) => ({
                                ...c,
                                lines: c.lines.map((l, i) => i === index ? { ...l, quantity: Number(e.target.value) } : l),
                              }))}
                            />
                          </td>
                          <td className="text-xs">{formatMoney(line.unitPrice)}</td>
                          <td>
                            <button className="text-rose-500 text-xs"
                              onClick={() => setNewOrder((c) => ({
                                ...c, lines: c.lines.filter((_, i) => i !== index),
                              }))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button className="btn-primary w-full" disabled={!newOrder.lines.length} onClick={saveOrder}>
                حفظ الطلب
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <div className="card-title"><span>الطلبات المفتوحة</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الرقم</th><th>الطاولة</th><th>الأفراد</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
                  <tbody>
                    {orders.filter((row) => row.status !== 4).map((row) => (
                      <tr key={row.tableOrderId} className="cursor-pointer hover:bg-brand-50/40"
                        onClick={() => openOrder(row.tableOrderId)}>
                        <td className="font-mono text-xs">{row.orderNo}</td>
                        <td className="text-xs">{row.tableName ?? '—'}</td>
                        <td className="text-xs">{row.guestCount}</td>
                        <td className="font-bold text-xs">{formatMoney(row.totalAmount)}</td>
                        <td>
                          <span className="badge bg-amber-50 text-amber-700">{ORDER_STATUS[row.status] ?? row.status}</span>
                        </td>
                      </tr>
                    ))}
                    {orders.filter((row) => row.status !== 4).length === 0 && (
                      <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد طلبات مفتوحة</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selected && (
              <div className="card">
                <div className="card-title"><span>طلب {selected.header.orderNo}</span></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th>المطبخ</th></tr></thead>
                    <tbody>
                      {selected.lines.map((line: any) => (
                        <tr key={line.lineId}>
                          <td className="text-xs">{line.itemName}</td>
                          <td className="text-xs">{Number(line.quantity)}</td>
                          <td className="text-xs font-bold">{formatMoney(line.lineTotal)}</td>
                          <td>
                            <select className="input py-0.5 text-xs" value={line.kitchenStatus}
                              onChange={(e) => setLineStatus(line.lineId, Number(e.target.value))}>
                              {[1, 2, 3, 4].map((key) => (
                                <option key={key} value={key}>{KITCHEN_STATUS[key]}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 p-3">
                  <button className="btn-soft text-xs" onClick={() => setStatus(selected.header.tableOrderId, 2)}>إلى المطبخ</button>
                  <button className="btn-soft text-xs" onClick={() => setStatus(selected.header.tableOrderId, 3)}>تم التقديم</button>
                  <button className="btn-primary text-xs" onClick={() => closeOrder(selected.header.tableOrderId)}>
                    إغلاق وإصدار فاتورة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'kitchen' && (
        <div className="card">
          <div className="card-title"><span>شاشة المطبخ ({kitchen.length})</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الطلب</th><th>الطاولة</th><th>الصنف</th><th>الكمية</th><th>ملاحظات</th><th>الحالة</th></tr></thead>
              <tbody>
                {kitchen.map((row) => (
                  <tr key={row.lineId}>
                    <td className="font-mono text-xs">{row.orderNo}</td>
                    <td className="text-xs">{row.tableName ?? '—'}</td>
                    <td className="text-xs font-semibold">{row.itemName}</td>
                    <td className="text-xs">{Number(row.quantity)} {row.unitName}</td>
                    <td className="text-xs">{row.notes ?? '—'}</td>
                    <td>
                      <span className={`badge ${row.kitchenStatus === 3 ? 'bg-emerald-50 text-emerald-700'
                        : row.kitchenStatus === 2 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {KITCHEN_STATUS[row.kitchenStatus] ?? row.kitchenStatus}
                      </span>
                    </td>
                  </tr>
                ))}
                {kitchen.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد طلبات في المطبخ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
