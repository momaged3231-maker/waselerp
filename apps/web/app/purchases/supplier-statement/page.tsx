'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { formatCalendarDate, formatDocumentDateTime, useDisplayTimezone } from '@/lib/time';

type Supplier = { partyId: number; code?: string; name: string; taxNumber?: string };
type Aging = { current: number; days_1_30: number; days_31_60: number; days_61_90: number; days_90_plus: number; total: number };
type ApItem = { invoice_no: string; date: string; date_has_time?: boolean; due_date: string | null; amount: number; paid: number; remaining: number; days_past_due: number };
type GrniItem = { receipt_no: string; date: string; date_has_time?: boolean; amount: number; days_open: number };
type AdvItem = { advance_no: string; date: string; date_has_time?: boolean; amount: number; still_open: number };
type Statement = {
  supplier: { party_id: number; code?: string; name: string; tax_id?: string };
  period: { from: string; to: string };
  ap_aging: Aging;
  ap_items: ApItem[];
  grni_memo: { total: number; items: GrniItem[] };
  advances: { available: number; applied: number; total: number; items: AdvItem[] };
  net_position: number;
};

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

export default function SupplierStatementPage() {
  const timeZone = useDisplayTimezone();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /** Statement rows: invoices/advances carry a clock, GRNI dates are DATE-only. */
  const docDate = (item: { date: string; date_has_time?: boolean }) => (
    item.date_has_time
      ? formatDocumentDateTime(item.date, undefined, timeZone)
      : formatCalendarDate(item.date, timeZone)
  );

  useEffect(() => {
    apiFetch<Supplier[] | { items: Supplier[] }>('/parties?type=2&pageSize=500')
      .then((res) => setSuppliers(Array.isArray(res) ? res : (res?.items ?? [])))
      .catch((e) => setError(e?.message ?? 'تعذّر تحميل الموردين'));
  }, []);

  const load = useCallback(async () => {
    if (!supplierId) { setError('اختر المورد أولًا'); return; }
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams({ from, to });
      const res = await apiFetch<Statement>(`/purchases/suppliers/${supplierId}/statement?${q}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'تعذّر تحميل الكشف');
      setData(null);
    } finally { setLoading(false); }
  }, [supplierId, from, to]);

  const exportCsv = async () => {
    if (!supplierId) return;
    const q = new URLSearchParams({ from, to, format: 'csv' });
    const res = await apiFetch<{ fileName: string; mimeType: string; base64: string }>(
      `/purchases/suppliers/${supplierId}/statement?${q}`,
    );
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
    const a = document.createElement('a');
    a.href = url; a.download = res.fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = suppliers.filter((s) =>
    !search || s.name.includes(search) || (s.code ?? '').toLowerCase().includes(search.toLowerCase()));

  const hasRows = data && (data.ap_items.length || data.grni_memo.items.length || data.advances.items.length);

  return (
    <AppShell title="كشف حساب مورد">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          .supplier-statement .no-print, .supplier-statement aside,
          .supplier-statement header, .supplier-statement nav { display: none !important; }
          .supplier-statement .print-header, .supplier-statement .print-footer {
            display: block !important;
          }
          .supplier-statement .card { break-inside: avoid; page-break-inside: avoid; }
          .supplier-statement table thead { display: table-header-group; }
          .supplier-statement .print-header { border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 12px; }
          .supplier-statement .print-footer { border-top: 1px solid #cbd5e1; margin-top: 16px; padding-top: 8px; }
        }
      `}</style>
      <div className="supplier-statement">
      <div className="no-print space-y-4">
        <div className="card p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block">
              <span className="text-sm">المورد</span>
              <select className="input w-full" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>
                <option value={0}>— اختر المورد —</option>
                {filtered.map((s) => <option key={s.partyId} value={s.partyId}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">بحث المورد</span>
              <input className="input w-full" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="الاسم أو الكود" />
            </label>
            <label className="block"><span className="text-sm">من</span><input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="block"><span className="text-sm">إلى</span><input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={load} disabled={loading}>{loading ? 'جارٍ التحميل…' : 'عرض الكشف'}</button>
            <button className="btn" onClick={() => window.print()} disabled={!data}>طباعة A4</button>
            <button className="btn" onClick={exportCsv} disabled={!data}>تصدير CSV</button>
          </div>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      </div>

      {data && (
        <div className="mt-4 space-y-4">
          <div className="print-header hidden">
            <h1>كشف حساب مورد</h1>
            <p>{data.supplier.name} — من {data.period.from} إلى {data.period.to}</p>
          </div>

          <div className="card p-4 grid gap-3 grid-cols-2 md:grid-cols-4">
            <div><div className="text-sm opacity-70">إجمالي الذمم (AP)</div><div className="font-num text-lg">{formatMoney(data.ap_aging.total)}</div></div>
            <div><div className="text-sm opacity-70">مذكرة GRNI</div><div className="font-num text-lg">{formatMoney(data.grni_memo.total)}</div></div>
            <div><div className="text-sm opacity-70">سلف متاحة</div><div className="font-num text-lg">{formatMoney(data.advances.available)}</div></div>
            <div><div className="text-sm opacity-70">المركز الصافي</div><div className="font-num text-lg">{formatMoney(data.net_position)}</div></div>
          </div>

          {!hasRows && (
            <div className="card p-6 text-center">لا توجد حركة لهذا المورد في الفترة المحددة</div>
          )}

          <section className="card p-4">
            <h2 className="mb-2 font-bold">أعمار الذمم والفواتير المفتوحة</h2>
            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              <span>الحالي: <b className="font-num">{formatMoney(data.ap_aging.current)}</b></span>
              <span>1–30: <b className="font-num">{formatMoney(data.ap_aging.days_1_30)}</b></span>
              <span>31–60: <b className="font-num">{formatMoney(data.ap_aging.days_31_60)}</b></span>
              <span>61–90: <b className="font-num">{formatMoney(data.ap_aging.days_61_90)}</b></span>
              <span>+90: <b className="font-num">{formatMoney(data.ap_aging.days_90_plus)}</b></span>
            </div>
            <table className="table w-full"><thead><tr>
              <th>رقم الفاتورة</th><th>التاريخ</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>أيام التأخير</th>
            </tr></thead><tbody>
              {data.ap_items.map((it) => <tr key={it.invoice_no}>
                <td>{it.invoice_no}</td><td className="whitespace-nowrap">{docDate(it)}</td><td>{it.due_date ? formatDate(it.due_date) : '—'}</td>
                <td className="font-num">{formatMoney(it.amount)}</td><td className="font-num">{formatMoney(it.paid)}</td>
                <td className="font-num">{formatMoney(it.remaining)}</td><td className="font-num">{it.days_past_due}</td>
              </tr>)}
            </tbody></table>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-bold">مذكرة GRNI — بضاعة مستلمة غير مفوترة</h2>
            <table className="table w-full"><thead><tr><th>رقم المحضر</th><th>التاريخ</th><th>المبلغ</th><th>أيام الفتح</th></tr></thead><tbody>
              {data.grni_memo.items.map((it) => <tr key={it.receipt_no}>
                <td>{it.receipt_no}</td><td className="whitespace-nowrap">{docDate(it)}</td><td className="font-num">{formatMoney(it.amount)}</td><td className="font-num">{it.days_open}</td>
              </tr>)}
            </tbody></table>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-bold">السلف المقدمة</h2>
            <table className="table w-full"><thead><tr><th>رقم السلفة</th><th>التاريخ</th><th>المبلغ</th><th>المتبقي</th></tr></thead><tbody>
              {data.advances.items.map((it) => <tr key={it.advance_no}>
                <td>{it.advance_no}</td><td className="whitespace-nowrap">{docDate(it)}</td><td className="font-num">{formatMoney(it.amount)}</td><td className="font-num">{formatMoney(it.still_open)}</td>
              </tr>)}
            </tbody></table>
          </section>

          <div className="print-footer hidden">
            <p>تاريخ الطبع: {today()} — التوقيع: ________________</p>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
