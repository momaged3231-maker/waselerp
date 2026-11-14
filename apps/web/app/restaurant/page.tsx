'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { agentHealth, printKitchenTicket } from '@/lib/print';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'tables' | 'orders' | 'kitchen' | 'setup';

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
  const [halls, setHalls] = useState<any[]>([]);
  const [noteTemplates, setNoteTemplates] = useState<any[]>([]);
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [hallForm, setHallForm] = useState({ name: '', code: '', tableCount: 8 });
  const [noteForm, setNoteForm] = useState('');
  const [modifierForm, setModifierForm] = useState({ itemId: 0, name: '', price: 0, maxQuantity: 1 });
  const [kitchenColumn, setKitchenColumn] = useState(0);
  const [splitState, setSplitState] = useState<{ tableId: number; lineIds: number[] } | null>(null);

  const [tableForm, setTableForm] = useState({ name: '', tableType: 1, capacity: 4 });
  const [newOrder, setNewOrder] = useState<{ tableId: number; guestCount: number; lines: any[] }>({
    tableId: 0, guestCount: 1, lines: [],
  });

  const canManage = can('pos.operate');

  async function load() {
    const [t, o, k, hallRows, noteRows, modifierRows, settingRow, itemRows, wh, cash] = await Promise.all([
      apiFetch<any[]>('/pos/tables'),
      apiFetch<any[]>('/pos/table-orders?limit=100'),
      apiFetch<any[]>(`/pos/kitchen${kitchenColumn ? `?categoryId=${kitchenColumn}` : ''}`),
      apiFetch<any[]>('/pos/halls'),
      apiFetch<any[]>('/pos/note-templates'),
      apiFetch<any[]>('/pos/modifiers'),
      apiFetch<any>('/pos/settings'),
      apiFetch<any>('/items?pageSize=200'),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any[]>('/treasury/accounts'),
    ]);
    setTables(t);
    setOrders(o);
    setKitchen(k);
    setHalls(hallRows);
    setNoteTemplates(noteRows);
    setModifiers(modifierRows);
    setSettings(settingRow ?? {});
    setItems(itemRows.items ?? itemRows);
    setWarehouses(wh);
    setCashAccounts(cash);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    apiFetch<any[]>(`/pos/kitchen${kitchenColumn ? `?categoryId=${kitchenColumn}` : ''}`)
      .then(setKitchen).catch(() => {});
  }, [kitchenColumn]);

  async function addHall() {
    setError(''); setMessage('');
    try {
      await apiFetch('/pos/halls', { method: 'POST', body: hallForm });
      setHallForm({ name: '', code: '', tableCount: 8 });
      await load();
      setMessage('تم إنشاء القاعة');
    } catch (e: any) { setError(e.message); }
  }

  async function addNote() {
    setError(''); setMessage('');
    try {
      await apiFetch('/pos/note-templates', { method: 'POST', body: { name: noteForm } });
      setNoteForm('');
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addModifier() {
    setError(''); setMessage('');
    try {
      await apiFetch('/pos/modifiers', { method: 'POST', body: modifierForm });
      setModifierForm({ itemId: 0, name: '', price: 0, maxQuantity: 1 });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function saveSettings(body: any) {
    setError(''); setMessage('');
    try {
      await apiFetch('/pos/settings', { method: 'PUT', body: { ...settings, ...body } });
      await load();
      setMessage('تم حفظ إعدادات المطعم');
    } catch (e: any) { setError(e.message); }
  }

  async function splitOrder(orderId: number, tableId: number, lineIds: number[]) {
    setError(''); setMessage('');
    try {
      await apiFetch(`/pos/table-orders/${orderId}/split`, { method: 'POST', body: { tableId, lineIds } });
      setSplitState(null);
      setSelected(null);
      await load();
      setMessage('تم فصل المائدة');
    } catch (e: any) { setError(e.message); }
  }

  async function moveOrder(orderId: number, tableId: number) {
    setError(''); setMessage('');
    try {
      await apiFetch(`/pos/table-orders/${orderId}/move`, { method: 'POST', body: { tableId } });
      setSelected(null);
      await load();
      setMessage('تم نقل الطلب');
    } catch (e: any) { setError(e.message); }
  }

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
      if (status === 2) {
        // Opt-in kitchen ticket (settings: KitchenTicketEnabled / KitchenTicketCopies)
        try {
          const ctx = await apiFetch<any>('/sales/print-context');
          if (ctx?.kitchenTicketEnabled) {
            const agentReady = await agentHealth();
            if (agentReady?.ok) {
              const order = await apiFetch<any>(`/pos/table-orders/${id}`);
              const printerName = String(ctx.kitchenPrinterName ?? '').trim();
              await printKitchenTicket({
                branch: ctx.companyName || undefined,
                table: order?.header?.tableName,
                orderId: order?.header?.orderNo ?? order?.header?.tableOrderId,
                guests: order?.header?.guestCount,
                note: order?.header?.notes ?? undefined,
                lines: (order?.lines ?? []).map((line: any) => ({
                  quantity: Number(line.quantity),
                  name: line.itemName,
                  note: line.notes ?? undefined,
                })),
              }, {
                copies: Number(ctx.kitchenTicketCopies ?? 1),
                printer: printerName ? { type: 'windows', name: printerName } : undefined,
              });
            } else {
              setMessage('تم الإرسال للمطبخ — وكيل الطباعة غير متصل (تذكرة المطبخ لم تُطبع)');
            }
          }
        } catch {
          setMessage('تم الإرسال للمطبخ — تعذرت طباعة تذكرة المطبخ (تحقق من الوكيل)');
        }
      }
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
        <button className={tab === 'setup' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('setup')}>إعداد المطعم</button>
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

      {tab === 'setup' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-title"><span>القاعات والموائد</span></div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">
                كود القاعة هو بادئة أرقام الموائد: كود A مع 8 موائد ينشئ A1 حتى A8.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" placeholder="اسم القاعة" value={hallForm.name}
                  onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} />
                <input className="input" placeholder="الكود" value={hallForm.code} dir="ltr"
                  onChange={(e) => setHallForm({ ...hallForm, code: e.target.value.toUpperCase() })} />
                <input className="input" type="number" placeholder="عدد الموائد" value={hallForm.tableCount}
                  onChange={(e) => setHallForm({ ...hallForm, tableCount: Number(e.target.value) })} />
              </div>
              <button className="btn-primary w-full" disabled={!hallForm.name || !hallForm.code} onClick={addHall}>
                إنشاء القاعة
              </button>

              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>القاعة</th><th>الكود</th><th>الموائد</th><th>مسموح لهم</th></tr></thead>
                  <tbody>
                    {halls.map((hall) => (
                      <tr key={hall.hallId}>
                        <td className="text-xs font-semibold">{hall.name}</td>
                        <td className="font-mono text-xs">{hall.code}</td>
                        <td className="text-xs">{hall.activeTables}</td>
                        <td className="text-xs">{hall.canWork ? 'كل المستخدمين' : 'محدود'}</td>
                      </tr>
                    ))}
                    {halls.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد قاعات</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <div className="card-title"><span>رسوم الخدمة</span></div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="label">سعر رسوم الخدمة</label>
                    <input className="input" type="number" step="0.01"
                      value={settings.serviceChargePerGuest ?? 0}
                      onChange={(e) => setSettings({ ...settings, serviceChargePerGuest: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label">الحد الأدنى</label>
                    <input className="input" type="number" step="0.01"
                      value={settings.serviceChargeMinimum ?? 0}
                      onChange={(e) => setSettings({ ...settings, serviceChargeMinimum: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label">طريقة الحساب</label>
                    <select className="input" value={settings.serviceChargeMode ?? 1}
                      onChange={(e) => setSettings({ ...settings, serviceChargeMode: Number(e.target.value) })}>
                      <option value={1}>مبلغ لكل شخص</option>
                      <option value={2}>حد أدنى لكل شخص</option>
                    </select>
                  </div>
                </div>
                <button className="btn-primary w-full" onClick={() => saveSettings({})}>حفظ رسوم الخدمة</button>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span>الملاحظات الجاهزة للمطبخ</span></div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input className="input" placeholder="بدون بصل" value={noteForm}
                    onChange={(e) => setNoteForm(e.target.value)} />
                  <button className="btn-soft" disabled={!noteForm} onClick={addNote}>إضافة</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {noteTemplates.map((note) => (
                    <span key={note.noteId} className="badge bg-slate-100 text-slate-700">
                      {note.name}
                    </span>
                  ))}
                  {noteTemplates.length === 0 && (
                    <span className="text-xs text-slate-400">لا توجد ملاحظات جاهزة</span>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span>الأصناف الإضافية</span></div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <select className="input" value={modifierForm.itemId}
                    onChange={(e) => setModifierForm({ ...modifierForm, itemId: Number(e.target.value) })}>
                    <option value={0}>— الصنف —</option>
                    {items.map((item) => (
                      <option key={item.itemId} value={item.itemId}>{item.code} — {item.name}</option>
                    ))}
                  </select>
                  <input className="input" placeholder="اسم الإضافة" value={modifierForm.name}
                    onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })} />
                  <input className="input" type="number" step="0.01" placeholder="السعر" value={modifierForm.price}
                    onChange={(e) => setModifierForm({ ...modifierForm, price: Number(e.target.value) })} />
                  <input className="input" type="number" step="1" placeholder="أقصى كمية" value={modifierForm.maxQuantity}
                    onChange={(e) => setModifierForm({ ...modifierForm, maxQuantity: Number(e.target.value) })} />
                </div>
                <button className="btn-primary w-full"
                  disabled={!modifierForm.itemId || !modifierForm.name}
                  onClick={addModifier}>
                  إضافة الإضافة
                </button>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>الصنف</th><th>الإضافة</th><th>السعر</th><th>أقصى كمية</th></tr></thead>
                    <tbody>
                      {modifiers.map((row) => (
                        <tr key={row.modifierId}>
                          <td className="text-xs">{row.itemName}</td>
                          <td className="text-xs">{row.name}</td>
                          <td className="text-xs">{formatMoney(row.price)}</td>
                          <td className="text-xs">{Number(row.maxQuantity) || '—'}</td>
                        </tr>
                      ))}
                      {modifiers.length === 0 && (
                        <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد إضافات</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-title"><span>القاعات والموائد</span></div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">
                كود القاعة هو بادئة أرقام الموائد: كود A مع 8 موائد ينشئ A1 حتى A8.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" placeholder="اسم القاعة" value={hallForm.name}
                  onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} />
                <input className="input" placeholder="الكود" value={hallForm.code} dir="ltr"
                  onChange={(e) => setHallForm({ ...hallForm, code: e.target.value.toUpperCase() })} />
                <input className="input" type="number" placeholder="عدد الموائد" value={hallForm.tableCount}
                  onChange={(e) => setHallForm({ ...hallForm, tableCount: Number(e.target.value) })} />
              </div>
              <button className="btn-primary w-full" disabled={!hallForm.name || !hallForm.code} onClick={addHall}>
                إنشاء القاعة
              </button>

              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>القاعة</th><th>الكود</th><th>الموائد</th><th>مسموح لهم</th></tr></thead>
                  <tbody>
                    {halls.map((hall) => (
                      <tr key={hall.hallId}>
                        <td className="text-xs font-semibold">{hall.name}</td>
                        <td className="font-mono text-xs">{hall.code}</td>
                        <td className="text-xs">{hall.activeTables}</td>
                        <td className="text-xs">{hall.canWork ? 'كل المستخدمين' : 'محدود'}</td>
                      </tr>
                    ))}
                    {halls.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد قاعات</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <div className="card-title"><span>رسوم الخدمة</span></div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="label">سعر رسوم الخدمة</label>
                    <input className="input" type="number" step="0.01"
                      value={settings.serviceChargePerGuest ?? 0}
                      onChange={(e) => setSettings({ ...settings, serviceChargePerGuest: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label">الحد الأدنى</label>
                    <input className="input" type="number" step="0.01"
                      value={settings.serviceChargeMinimum ?? 0}
                      onChange={(e) => setSettings({ ...settings, serviceChargeMinimum: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="label">طريقة الحساب</label>
                    <select className="input" value={settings.serviceChargeMode ?? 1}
                      onChange={(e) => setSettings({ ...settings, serviceChargeMode: Number(e.target.value) })}>
                      <option value={1}>مبلغ لكل شخص</option>
                      <option value={2}>حد أدنى لكل شخص</option>
                    </select>
                  </div>
                </div>
                <button className="btn-primary w-full" onClick={() => saveSettings({})}>حفظ رسوم الخدمة</button>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span>الملاحظات الجاهزة للمطبخ</span></div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input className="input" placeholder="بدون بصل" value={noteForm}
                    onChange={(e) => setNoteForm(e.target.value)} />
                  <button className="btn-soft" disabled={!noteForm} onClick={addNote}>إضافة</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {noteTemplates.map((note) => (
                    <span key={note.noteId} className="badge bg-slate-100 text-slate-700">
                      {note.name}
                    </span>
                  ))}
                  {noteTemplates.length === 0 && (
                    <span className="text-xs text-slate-400">لا توجد ملاحظات جاهزة</span>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title"><span>الأصناف الإضافية</span></div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <select className="input" value={modifierForm.itemId}
                    onChange={(e) => setModifierForm({ ...modifierForm, itemId: Number(e.target.value) })}>
                    <option value={0}>— الصنف —</option>
                    {items.map((item) => (
                      <option key={item.itemId} value={item.itemId}>{item.code} — {item.name}</option>
                    ))}
                  </select>
                  <input className="input" placeholder="اسم الإضافة" value={modifierForm.name}
                    onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })} />
                  <input className="input" type="number" step="0.01" placeholder="السعر" value={modifierForm.price}
                    onChange={(e) => setModifierForm({ ...modifierForm, price: Number(e.target.value) })} />
                  <input className="input" type="number" step="1" placeholder="أقصى كمية" value={modifierForm.maxQuantity}
                    onChange={(e) => setModifierForm({ ...modifierForm, maxQuantity: Number(e.target.value) })} />
                </div>
                <button className="btn-primary w-full"
                  disabled={!modifierForm.itemId || !modifierForm.name}
                  onClick={addModifier}>
                  إضافة الإضافة
                </button>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>الصنف</th><th>الإضافة</th><th>السعر</th><th>أقصى كمية</th></tr></thead>
                    <tbody>
                      {modifiers.map((row) => (
                        <tr key={row.modifierId}>
                          <td className="text-xs">{row.itemName}</td>
                          <td className="text-xs">{row.name}</td>
                          <td className="text-xs">{formatMoney(row.price)}</td>
                          <td className="text-xs">{Number(row.maxQuantity) || '—'}</td>
                        </tr>
                      ))}
                      {modifiers.length === 0 && (
                        <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد إضافات</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'kitchen' && (
        <div className="card">
          <div className="card-title">
            <span>شاشة المطبخ ({kitchen.length})</span>
            <select className="input w-44 py-1 text-xs" value={kitchenColumn}
              onChange={(e) => setKitchenColumn(Number(e.target.value))}>
              <option value={0}>كل التصنيفات</option>
              {items.map((item) => (
                <option key={item.categoryId ?? item.itemId} value={item.categoryId ?? 0}>
                  {item.categoryName ?? 'بدون تصنيف'}
                </option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الطلب</th><th>الطاولة</th><th>الصنف</th><th>التصنيف</th><th>الكمية</th><th>ملاحظات</th><th>الحالة</th></tr></thead>
              <tbody>
                {kitchen.map((row) => (
                  <tr key={row.lineId}>
                    <td className="font-mono text-xs">{row.orderNo}</td>
                    <td className="text-xs">{row.tableName ?? '—'}</td>
                    <td className="text-xs font-semibold">{row.itemName}</td>
                    <td className="text-xs">{row.categoryName ?? '—'}</td>
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
                  <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد طلبات في المطبخ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
