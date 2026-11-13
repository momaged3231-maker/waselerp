'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

const TYPES = [
  { value: 0, label: 'الكل' },
  { value: 1, label: 'مبيعات' },
  { value: 2, label: 'مشتريات' },
  { value: 3, label: 'مرتجع مبيعات' },
  { value: 4, label: 'مرتجع مشتريات' },
];

export default function InvoicesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [type, setType] = useState(1);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState<any[]>([]);
  const [editError, setEditError] = useState('');
  const [zatca, setZatca] = useState<any>(null);
  const [zatcaMessage, setZatcaMessage] = useState('');

  async function load() {
    const query = new URLSearchParams({ type: String(type), pageSize: '100' });
    if (search) query.set('search', search);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const data = await apiFetch<any>(`/sales/invoices?${query.toString()}`);
    setRows(data.items ?? []);
    setTotals(data.totals ?? null);
  }

  useEffect(() => { load(); }, []);

  async function open(id: number) {
    const loaded = await apiFetch(`/sales/invoices/${id}`);
    setDetail(loaded);
    setZatca(null);
    setZatcaMessage('');
    setEditing(false);
    setEditError('');
    setEditLines((loaded.lines ?? []).map((line: any) => ({
      itemId: line.itemId,
      unitId: line.unitId,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      taxPct: Number(line.taxPct),
    })));
  }

  async function saveEdit() {
    if (!detail) return;
    setEditError('');
    try {
      await apiFetch(`/sales/invoices/${detail.header.invoiceId}`, {
        method: 'PUT',
        body: {
          invoiceType: detail.header.invoiceType,
          branchId: detail.header.branchId,
          warehouseId: detail.header.warehouseId,
          partyId: detail.header.partyId ?? undefined,
          paymentType: detail.header.paymentType,
          cashAccountId: detail.header.cashAccountId ?? undefined,
          paidAmount: Number(detail.header.paidAmount),
          payments: (detail.payments ?? []).map((payment: any) => ({
            method: payment.method,
            amount: Number(payment.amount),
            cashAccountId: payment.cashAccountId,
            referenceNo: payment.referenceNo ?? undefined,
          })),
          couponCode: detail.header.couponCode ?? undefined,
          notes: detail.header.notes ?? undefined,
          lines: editLines,
        },
      });
      await open(detail.header.invoiceId);
      await load();
    } catch (error: any) {
      setEditError(error?.message ?? 'تعذر حفظ التعديل');
    }
  }

  async function zatcaGenerate(invoiceType: 1 | 2) {
    if (!detail) return;
    setZatcaMessage('');
    try {
      const result = await apiFetch(`/zatca/invoices/${detail.header.invoiceId}/generate`, {
        method: 'POST',
        body: { invoiceType },
      });
      setZatca(result);
    } catch (error: any) {
      setZatcaMessage(error?.message ?? 'تعذر توليد المستند');
    }
  }

  async function zatcaSubmit() {
    if (!detail) return;
    setZatcaMessage('');
    try {
      const result = await apiFetch(`/zatca/invoices/${detail.header.invoiceId}/submit`, { method: 'POST' });
      setZatcaMessage(result.ok ? 'تم الإرسال والموافقة من ZATCA' : `تم الإرسال — الرد: ${JSON.stringify(result.response)}`);
    } catch (error: any) {
      setZatcaMessage(error?.message ?? 'تعذر الإرسال');
    }
  }

  return (
    <AppShell title="الفواتير">
      <div className="card">
        <div className="card-title flex-wrap gap-2">
          <span>الفواتير ({rows.length})</span>
          <div className="flex flex-wrap gap-2">
            <select className="input w-36 py-1.5" value={type} onChange={(e) => { setType(Number(e.target.value)); setTimeout(load, 0); }}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="input w-40 py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input w-40 py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <input className="input w-40 py-1.5" placeholder="رقم / عميل" value={search}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <button className="btn-soft" onClick={load}>بحث</button>
          </div>
        </div>

        {totals && (
          <div className="px-5 py-3 bg-slate-50 flex gap-6 text-sm font-semibold text-slate-600">
            <span>الإجمالي: {formatMoney(totals.total)}</span>
            <span>المحصّل: {formatMoney(totals.paid)}</span>
            <span>المتبقي: {formatMoney(Number(totals.total) - Number(totals.paid))}</span>
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>رقم الفاتورة</th><th>النوع</th><th>التاريخ</th><th>العميل</th>
                <th>الفرع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.invoiceId}>
                  <td className="font-mono text-xs font-bold">{row.invoiceNo}</td>
                  <td>
                    <span className={`badge ${row.invoiceType === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {TYPES.find((t) => t.value === row.invoiceType)?.label}
                    </span>
                  </td>
                  <td>{formatDate(row.invoiceDate)}</td>
                  <td>{row.partyName ?? 'عميل نقدي'}</td>
                  <td className="text-slate-500">{row.branchName}</td>
                  <td className="font-bold">{formatMoney(row.totalAmount)}</td>
                  <td className="text-emerald-700">{formatMoney(row.paidAmount)}</td>
                  <td className={Number(row.totalAmount) - Number(row.paidAmount) > 0 ? 'text-rose-600 font-bold' : ''}>
                    {formatMoney(Number(row.totalAmount) - Number(row.paidAmount))}
                  </td>
                  <td><button className="text-brand-600 text-xs font-semibold" onClick={() => open(row.invoiceId)}>عرض</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد فواتير</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="card w-full max-w-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-extrabold text-lg">{detail.header.invoiceNo}</div>
                <div className="text-xs text-slate-500">
                  {formatDate(detail.header.invoiceDate)} · {detail.header.partyName ?? 'عميل نقدي'} · {detail.header.branchName}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!editing && (
                  <button className="btn-soft" onClick={() => setEditing(true)}>تعديل</button>
                )}
                <button className="btn-soft" onClick={() => setDetail(null)}>إغلاق</button>
              </div>
            </div>

            {editError && <div className="text-sm text-rose-600 mb-2">{editError}</div>}

            <table className="table">
              <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>خصم</th><th>ضريبة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {detail.lines.map((line: any, index: number) => (
                  <tr key={line.invoiceLineId}>
                    <td className="font-semibold">{line.itemName}<div className="text-[10px] text-slate-400">{line.itemCode}</div></td>
                    <td>
                      {editing ? (
                        <input
                          className="input py-0.5 text-xs w-20" type="number" step="0.001"
                          value={editLines[index]?.quantity ?? 0}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === index ? { ...r, quantity: Number(e.target.value) } : r))}
                        />
                      ) : (
                        <>{Number(line.quantity).toFixed(2)} {line.unitName}</>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="input py-0.5 text-xs w-24" type="number" step="0.01"
                          value={editLines[index]?.unitPrice ?? 0}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === index ? { ...r, unitPrice: Number(e.target.value) } : r))}
                        />
                      ) : (
                        formatMoney(line.unitPrice)
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="input py-0.5 text-xs w-16" type="number" step="0.01"
                          value={editLines[index]?.discountPct ?? 0}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === index ? { ...r, discountPct: Number(e.target.value) } : r))}
                        />
                      ) : (
                        <>{Number(line.discountPct)}%</>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="input py-0.5 text-xs w-16" type="number" step="0.01"
                          value={editLines[index]?.taxPct ?? 0}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === index ? { ...r, taxPct: Number(e.target.value) } : r))}
                        />
                      ) : (
                        formatMoney(line.taxAmount)
                      )}
                    </td>
                    <td className="font-bold">{formatMoney(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {editing && (
              <div className="flex items-center gap-2 mt-3">
                <button className="btn-primary" onClick={saveEdit}>حفظ التعديل</button>
                <button className="btn-soft" onClick={() => setEditing(false)}>إلغاء</button>
                <span className="text-xs text-slate-500">
                  حفظ التعديل يعكس السطر القديم ويعيد ترحيل المخزون والقيد المحاسبي.
                </span>
              </div>
            )}

            <div className="mt-3 space-y-1 text-sm border-t border-dashed border-slate-300 pt-3">
              <div className="flex justify-between"><span>الإجمالي</span><span>{formatMoney(detail.header.subTotal)}</span></div>
              <div className="flex justify-between"><span>الخصم</span><span>{formatMoney(detail.header.discountAmount)}</span></div>
              <div className="flex justify-between"><span>الضريبة</span><span>{formatMoney(detail.header.taxAmount)}</span></div>
              <div className="flex justify-between font-extrabold text-base"><span>الصافي</span><span>{formatMoney(detail.header.totalAmount)}</span></div>
              <div className="flex justify-between"><span>المدفوع</span><span>{formatMoney(detail.header.paidAmount)}</span></div>
              {Number(detail.header.profitAmount) !== 0 && (
                <div className="flex justify-between"><span>الربح</span><span className="text-emerald-700 font-bold">{formatMoney(detail.header.profitAmount)}</span></div>
              )}
            </div>

            <div className="mt-4 border-t border-dashed border-slate-300 pt-3">
              <div className="text-sm font-bold mb-2">الفاتورة الإلكترونية (ZATCA)</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-soft" onClick={() => zatcaGenerate(1)}>توليد فاتورة مبسطة</button>
                <button className="btn-soft" onClick={() => zatcaGenerate(2)}>توليد فاتورة ضريبية</button>
                <button className="btn-primary" onClick={zatcaSubmit}>إرسال / تخليص</button>
              </div>
              {zatcaMessage && <div className="text-xs text-slate-600 mt-2">{zatcaMessage}</div>}
              {zatca && (
                <div className="mt-3 flex gap-4 items-start">
                  <img src={zatca.qrPngBase64} alt="QR" className="w-40 h-40 rounded-lg border border-slate-200" />
                  <div className="text-[11px] text-slate-500 space-y-1 break-all">
                    <div>UUID: {zatca.uuid}</div>
                    <div>Hash: {zatca.invoiceHash?.slice(0, 48)}…</div>
                    <div>موقّع: {zatca.signed ? 'نعم (ECDSA + RSA)' : 'لا (بدون مفاتيح)'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
