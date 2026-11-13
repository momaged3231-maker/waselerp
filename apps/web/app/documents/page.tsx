'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'quotations' | 'orders' | 'shipments';

const QUOTATION_STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'مُرسل', 3: 'مقبول', 4: 'مرفوض', 5: 'مُحوَّل', 6: 'منتهي',
};
const ORDER_STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'مؤكد', 3: 'جزئي', 4: 'تم التسليم', 5: 'ملغى',
};
const SHIPMENT_STATUS: Record<number, string> = {
  1: 'قيد الانتظار', 2: 'تم الشحن', 3: 'تم التسليم', 4: 'ملغى',
};

export default function DocumentsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('quotations');
  const [rows, setRows] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState(0);

  const canManage = can('sales.manage');

  async function load() {
    if (tab === 'shipments') {
      const query = new URLSearchParams({ status: String(statusFilter), limit: '100' });
      setRows(await apiFetch<any[]>(`/shipments?${query.toString()}`));
      return;
    }
    const query = new URLSearchParams({ search, status: String(statusFilter), limit: '100' });
    setRows(await apiFetch<any[]>(`/${tab}?${query.toString()}`));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [tab, search, statusFilter]);
  useEffect(() => {
    apiFetch<any>('/parties?type=0&pageSize=200').then((d: any) => setParties(d.items ?? d)).catch(() => {});
    apiFetch<any[]>('/catalog/warehouses').then(setWarehouses).catch(() => {});
  }, []);

  async function open(id: number) {
    setError('');
    try {
      setSelected(await apiFetch(`/${tab}/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function changeStatus(id: number, status: number) {
    setError('');
    setMessage('');
    try {
      await apiFetch(`/${tab}/${id}/status`, { method: 'POST', body: { status } });
      setMessage('تم تحديث الحالة');
      await load();
      await open(id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function convert(id: number) {
    setError('');
    setMessage('');
    try {
      const result = await apiFetch(`/${tab}/${id}/convert`, { method: 'POST', body: { paymentType: 2 } });
      setMessage(`تم إنشاء الفاتورة ${result.invoiceNo}`);
      await load();
      await open(id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function changeShipment(id: number, status: number) {
    setError('');
    setMessage('');
    try {
      await apiFetch(`/shipments/${id}`, { method: 'PUT', body: { status } });
      setMessage('تم تحديث حالة الشحنة');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const isQuotation = tab === 'quotations';

  return (
    <AppShell title={isQuotation ? 'عروض الأسعار' : 'أوامر البيع والشراء'}>
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button className={isQuotation ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('quotations')}>
          عروض الأسعار
        </button>
        <button className={!isQuotation ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('orders')}>
          أوامر البيع والشراء
        </button>
        <button className={tab === 'shipments' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('shipments')}>
          الشحن والتوصيل
        </button>
        <div className="flex-1" />
        <input className="input w-52 py-1.5" placeholder="بحث…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-36 py-1.5" value={statusFilter}
          onChange={(e) => setStatusFilter(Number(e.target.value))}>
          <option value={0}>كل الحالات</option>
          {tab === 'shipments'
            ? Object.entries(SHIPMENT_STATUS).map(([key, label]) => (
              <option key={key} value={Number(key)}>{label}</option>
            ))
            : Object.entries(isQuotation ? QUOTATION_STATUS : ORDER_STATUS).map(([key, label]) => (
              <option key={key} value={Number(key)}>{label}</option>
            ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-title"><span>السجل ({rows.length})</span></div>
          <div className="table-wrap">
            {tab === 'shipments' ? (
              <table className="table">
                <thead>
                  <tr><th>رقم الشحنة</th><th>الفاتورة</th><th>العميل</th><th>الطريقة</th><th>المستلم</th><th>الحالة</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.shipmentId}>
                      <td className="font-mono text-xs">{row.shipmentNo}</td>
                      <td className="text-xs font-mono">{row.invoiceNo ?? '—'}</td>
                      <td className="text-xs">{row.partyName ?? '—'}</td>
                      <td className="text-xs">
                        {row.deliveryMethod === 2 ? `توصيل — ${row.deliveryAddress ?? ''}` : 'استلام من الفرع'}
                      </td>
                      <td className="text-xs">
                        {row.recipientName ?? '—'}
                        <div className="text-slate-400">{row.recipientPhone ?? ''}</div>
                      </td>
                      <td>
                        <span className={`badge ${row.status === 3 ? 'bg-emerald-50 text-emerald-700'
                          : row.status === 4 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {SHIPMENT_STATUS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>
                        {canManage && row.status !== 3 && (
                          <button className="btn-soft text-xs" onClick={() => changeShipment(row.shipmentId, 3)}>
                            تم التسليم
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد شحنات</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th><th>التاريخ</th><th>الطرف</th><th>الإجمالي</th><th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderId ?? row.quotationId}
                    className="cursor-pointer hover:bg-brand-50/40"
                    onClick={() => open(row.orderId ?? row.quotationId)}>
                    <td className="font-mono text-xs">{row.orderNo ?? row.quotationNo}</td>
                    <td className="text-xs">{formatDate(row.orderDate ?? row.quotationDate)}</td>
                    <td className="text-xs">{row.partyName ?? '—'}</td>
                    <td className="font-bold">{formatMoney(row.totalAmount)}</td>
                    <td>
                      <span className={`badge ${row.status === 1 ? 'bg-slate-100 text-slate-600'
                        : row.status === 4 || row.status === 5 ? 'bg-rose-50 text-rose-700'
                        : 'bg-emerald-50 text-emerald-700'}`}>
                        {(isQuotation ? QUOTATION_STATUS : ORDER_STATUS)[row.status] ?? row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد مستندات</td></tr>
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        <div className="card h-fit">
          <div className="card-title"><span>تفاصيل المستند</span></div>
          {!selected && <div className="p-6 text-center text-slate-400 text-sm">اختر مستندًا لعرضه</div>}
          {selected && (
            <div>
              <div className="p-4 border-b border-slate-100 space-y-1 text-sm">
                <div className="font-bold">{selected.header.orderNo ?? selected.header.quotationNo}</div>
                <div className="text-slate-500">{selected.header.partyName ?? '—'}</div>
                <div className="text-xs text-slate-400">
                  {formatDate(selected.header.orderDate ?? selected.header.quotationDate)}
                </div>
                <div className="font-extrabold text-lg mt-2">{formatMoney(selected.header.totalAmount)}</div>

                {canManage && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {isQuotation ? (
                      <>
                        <button className="btn-soft text-xs" onClick={() => changeStatus(selected.header.quotationId, 2)}>إرسال</button>
                        <button className="btn-soft text-xs" onClick={() => changeStatus(selected.header.quotationId, 3)}>قبول</button>
                        <button className="btn-soft text-xs" onClick={() => changeStatus(selected.header.quotationId, 4)}>رفض</button>
                        {[2, 3].includes(Number(selected.header.status)) && !selected.header.convertedInvoiceId && (
                          <button className="btn-primary text-xs" onClick={() => convert(selected.header.quotationId)}>
                            تحويل لفاتورة
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button className="btn-soft text-xs" onClick={() => changeStatus(selected.header.orderId, 2)}>تأكيد</button>
                        <button className="btn-soft text-xs" onClick={() => changeStatus(selected.header.orderId, 5)}>إلغاء</button>
                        {[2, 3].includes(Number(selected.header.status)) && !selected.header.convertedInvoiceId && (
                          <button className="btn-primary text-xs" onClick={() => convert(selected.header.orderId)}>
                            تحويل لفاتورة
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {selected.header.convertedInvoiceNo && (
                  <div className="text-xs text-emerald-700 mt-2">
                    الفاتورة: {selected.header.convertedInvoiceNo}
                  </div>
                )}
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                  <tbody>
                    {(selected.lines ?? []).map((line: any) => (
                      <tr key={line.lineId}>
                        <td className="text-xs">
                          <div className="font-semibold">{line.itemName}</div>
                          <div className="text-slate-400 font-mono">{line.itemCode}</div>
                          {line.deliveredQty !== undefined && (
                            <div className="text-slate-500">مُسلَّم: {Number(line.deliveredQty)}</div>
                          )}
                        </td>
                        <td className="text-xs">{Number(line.quantity)}</td>
                        <td className="text-xs">{formatMoney(line.unitPrice)}</td>
                        <td className="text-xs font-bold">{formatMoney(line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
