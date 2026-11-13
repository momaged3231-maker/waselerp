'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const TYPE: Record<number, string> = { 1: 'وارد', 2: 'صادر', 3: 'تالف', 4: 'افتتاحي' };
const STATUS: Record<number, string> = { 1: 'مسودة', 2: 'معتمد', 3: 'ملغى' };

export default function StockVoucherPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [typeFilter, setTypeFilter] = useState(0);

  const [headerForm, setHeaderForm] = useState({ warehouseId: 0, voucherType: 1, voucherDate: '', notes: '' });
  const [lineForm, setLineForm] = useState({ itemId: 0, unitId: 0, quantity: 0, unitCost: 0, serialNo: '', expiryDate: '', notes: '' });
  const [itemSearch, setItemSearch] = useState('');

  const canManage = can('stock.manage');

  async function load() {
    const [list, wh, itemRows] = await Promise.all([
      apiFetch<any[]>(`/stock-vouchers?type=${typeFilter}&limit=100`),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any>('/items?pageSize=200'),
    ]);
    setRows(list);
    setWarehouses(wh);
    setItems(itemRows.items ?? itemRows);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [typeFilter]);

  async function open(id: number) {
    setError(''); setMessage('');
    try {
      const detail = await apiFetch(`/stock-vouchers/${id}`);
      setSelected(detail);
      setHeaderForm({
        warehouseId: detail.header.warehouseId,
        voucherType: detail.header.voucherType,
        voucherDate: String(detail.header.voucherDate ?? '').slice(0, 10),
        notes: detail.header.notes ?? '',
      });
    } catch (e: any) { setError(e.message); }
  }

  async function createVoucher() {
    setError(''); setMessage('');
    try {
      const result = await apiFetch('/stock-vouchers', { method: 'POST', body: headerForm });
      setMessage(`تم إنشاء الأذن ${result.voucherNo}`);
      await open(result.stockVoucherId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addLine() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/stock-vouchers/${selected.header.stockVoucherId}/lines`, {
        method: 'POST', body: lineForm,
      });
      setLineForm({ itemId: 0, unitId: 0, quantity: 0, unitCost: 0, serialNo: '', expiryDate: '', notes: '' });
      await open(selected.header.stockVoucherId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function updateLine(lineId: number, field: string, value: any) {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/stock-vouchers/${selected.header.stockVoucherId}/lines/${lineId}`, {
        method: 'PUT', body: { [field]: value },
      });
      await open(selected.header.stockVoucherId);
    } catch (e: any) { setError(e.message); }
  }

  async function removeLine(lineId: number) {
    if (!selected || !confirm('تأكيد حذف السطر؟')) return;
    setError('');
    try {
      await apiFetch(`/stock-vouchers/${selected.header.stockVoucherId}/lines/${lineId}`, { method: 'DELETE' });
      await open(selected.header.stockVoucherId);
    } catch (e: any) { setError(e.message); }
  }

  async function approve() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const result = await apiFetch(`/stock-vouchers/${selected.header.stockVoucherId}/approve`, { method: 'POST' });
      setMessage(`تم اعتماد الأذن — القيمة الإجمالية ${formatMoney(result.totalValue)}`);
      await open(selected.header.stockVoucherId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove() {
    if (!selected || !confirm('تأكيد حذف الأذن؟')) return;
    setError('');
    try {
      await apiFetch(`/stock-vouchers/${selected.header.stockVoucherId}`, { method: 'DELETE' });
      setSelected(null);
      setMessage('تم حذف الأذن');
      await load();
    } catch (e: any) { setError(e.message); }
  }

  const filteredItems = itemSearch
    ? items.filter((item) => item.code.includes(itemSearch) || item.name.includes(itemSearch))
    : items;

  return (
    <AppShell title="أذون المخازن">
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className="input w-40 py-1.5" value={typeFilter}
          onChange={(e) => setTypeFilter(Number(e.target.value))}>
          <option value={0}>كل الأنواع</option>
          {[1, 2, 3, 4].map((key) => (
            <option key={key} value={key}>{TYPE[key]}</option>
          ))}
        </select>
        <div className="flex-1" />
        {canManage && !selected && (
          <button className="btn-primary" disabled={!headerForm.warehouseId}
            onClick={createVoucher}>
            إذن مخزن جديد
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          {canManage && !selected && (
            <div className="card p-4 space-y-3">
              <div className="font-bold">بيانات الأذن</div>
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
                <label className="label">نوع الأذن</label>
                <select className="input" value={headerForm.voucherType}
                  onChange={(e) => setHeaderForm({ ...headerForm, voucherType: Number(e.target.value) })}>
                  {Object.entries(TYPE).map(([k, v]) => (
                    <option key={k} value={Number(k)}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={headerForm.voucherDate}
                  onChange={(e) => setHeaderForm({ ...headerForm, voucherDate: e.target.value })} />
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
                <span>{selected.header.voucherNo} · {selected.header.warehouseName}</span>
                <span className={`badge ${Number(selected.header.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {STATUS[selected.header.status]}
                </span>
                <span className="text-xs text-slate-500">{TYPE[selected.header.voucherType]}</span>
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
                      <tr key={line.lineId}
                        className={Number(line.quantity) > 0 ? 'bg-emerald-50/50' : ''}>
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
                  {Number(selected.header.status) === 1 && (
                    <>
                      <button className="btn-primary" onClick={approve}>اعتماد وتطبيق على المخزون</button>
                      <button className="btn-soft" onClick={remove}>حذف الأذن</button>
                    </>
                  )}
                  {Number(selected.header.status) === 2 && (
                    <span className="text-xs text-slate-500">
                      الأذن المعتمد لا يمكن تعديله — أعد أذنًا جديدًا لتصحيح أي خطأ.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>أذون المخازن ({rows.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>المخزن</th><th>الأصناف</th><th>القيمة</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.stockVoucherId} className="cursor-pointer hover:bg-brand-50/40"
                      onClick={() => open(row.stockVoucherId)}>
                      <td className="font-mono text-xs">{row.voucherNo}</td>
                      <td className="text-xs">{formatDate(row.voucherDate)}</td>
                      <td className="text-xs">{TYPE[row.voucherType]}</td>
                      <td className="text-xs">{row.warehouseName}</td>
                      <td className="text-xs">{row.lineCount}</td>
                      <td className="text-xs">{formatMoney(row.totalValue ?? 0)}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {STATUS[row.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد أذون مخازن</td></tr>
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
