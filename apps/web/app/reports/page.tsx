'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadBase64File, downloadCsv, printPage } from '@/lib/export';

const XLSX_TABS = ['sales', 'items', 'stock', 'parties', 'cash', 'reorder', 'aging', 'commissions'];

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'items' | 'stock' | 'parties' | 'cash' | 'reorder' | 'aging' | 'commissions' | 'pivot'>('sales');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  async function load() {
    const query = new URLSearchParams({ from, to });
    if (tab === 'sales') query.set('groupBy', groupBy);
    if (tab === 'pivot') {
      const [salesPivot, stockPivot] = await Promise.all([
        apiFetch(`/reports/pivot/sales?${query.toString()}`),
        apiFetch('/reports/pivot/stock'),
      ]);
      setData({ salesPivot, stockPivot });
      return;
    }
    const endpoint: Record<string, string> = {
      sales: '/reports/sales-summary',
      items: '/reports/top-items',
      stock: '/reports/stock-value',
      parties: '/reports/party-balances',
      cash: '/reports/cash-summary',
      reorder: '/reports/reorder',
      aging: '/reports/debt-aging',
      commissions: '/reports/commissions',
    };
    setData(await apiFetch(`${endpoint[tab]}?${query.toString()}`));
  }

  useEffect(() => { load(); }, [tab, from, to, groupBy]);

  async function exportXlsx() {
    if (!XLSX_TABS.includes(tab)) return;
    setExporting(true);
    try {
      const query = new URLSearchParams({ report: tab, from, to });
      if (tab === 'sales') query.set('groupBy', groupBy);
      const file = await apiFetch<{ fileName: string; mimeType: string; base64: string }>(
        `/reports/xlsx?${query.toString()}`,
      );
      downloadBase64File(file.fileName, file.mimeType, file.base64);
    } catch (error: any) {
      alert(error?.message ?? 'تعذر تصدير ملف Excel');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell title="التقارير">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {([
          ['sales', 'ملخص المبيعات'], ['items', 'أكثر الأصناف'], ['stock', 'قيمة المخزون'],
          ['parties', 'أرصدة العملاء والموردين'], ['cash', 'حركة الخزينة'],
          ['reorder', 'حد الطلب'], ['aging', 'أعمار الديون'], ['commissions', 'عمولات المندوبين'],
          ['pivot', 'جدول محوري'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
        <div className="flex-1" />
        <button
          className="btn-primary no-print"
          disabled={exporting || !XLSX_TABS.includes(tab)}
          onClick={exportXlsx}
        >
          {exporting ? 'جاري التصدير…' : 'تصدير Excel (.xlsx)'}
        </button>
        <button className="btn-soft no-print" onClick={() => downloadCsv(`report-${tab}.csv`, Array.isArray(data) ? data : [])}>
          تصدير CSV
        </button>
        <button className="btn-soft no-print" onClick={printPage}>
          طباعة (PDF)
        </button>
        <input className="input w-40 py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input w-40 py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {tab === 'sales' && (
          <select className="input w-36 py-1.5" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="day">حسب اليوم</option>
            <option value="branch">حسب الفرع</option>
            <option value="user">حسب الموظف</option>
          </select>
        )}
      </div>

      <div className="card">
        {tab === 'sales' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الفترة</th><th>عدد الفواتير</th><th>الإجمالي</th><th>الخصم</th><th>الضريبة</th><th>المحصّل</th><th>الربح</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any, index: number) => (
                  <tr key={index}>
                    <td className="font-semibold">{String(row.label).slice(0, 10)}</td>
                    <td>{row.invoiceCount}</td>
                    <td className="font-bold">{formatMoney(row.total)}</td>
                    <td>{formatMoney(row.discount)}</td>
                    <td>{formatMoney(row.tax)}</td>
                    <td className="text-emerald-700">{formatMoney(row.paid)}</td>
                    <td className="font-bold text-emerald-700">{formatMoney(row.profit)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'items' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => (
                  <tr key={row.itemId}>
                    <td className="font-semibold">{row.itemName}<div className="text-[10px] text-slate-400">{row.itemCode}</div></td>
                    <td>{Number(row.quantity).toFixed(2)}</td>
                    <td className="font-bold">{formatMoney(row.total)}</td>
                    <td>{formatMoney(row.cost)}</td>
                    <td className="font-bold text-emerald-700">{formatMoney(row.profit)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'stock' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الفئة</th><th>عدد الأصناف</th><th>الكمية</th><th>قيمة التكلفة</th><th>قيمة البيع</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any, index: number) => (
                  <tr key={index}>
                    <td className="font-semibold">{row.categoryName}</td>
                    <td>{row.itemCount}</td>
                    <td>{Number(row.quantity).toFixed(2)}</td>
                    <td className="font-bold">{formatMoney(row.costValue)}</td>
                    <td>{formatMoney(row.sellValue)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'parties' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الاسم</th><th>التليفون</th><th>الرصيد</th><th>حد الائتمان</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => (
                  <tr key={row.partyId}>
                    <td className="font-semibold">{row.name}</td>
                    <td dir="ltr" className="text-right">{row.phone ?? '—'}</td>
                    <td className="font-bold text-rose-600">{formatMoney(row.balance)}</td>
                    <td>{formatMoney(row.creditLimit)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد أرصدة</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'cash' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الحساب</th><th>وارد</th><th>منصرف</th><th>الرصيد</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => (
                  <tr key={row.cashAccountId}>
                    <td className="font-semibold">{row.cashAccountName}</td>
                    <td className="text-emerald-700">{formatMoney(row.totalIn)}</td>
                    <td className="text-rose-600">{formatMoney(row.totalOut)}</td>
                    <td className="font-bold">{formatMoney(row.balance)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'reorder' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الصنف</th><th>الكمية المتاحة</th><th>حد الطلب</th><th>العجز</th><th>تكلفة تقديرية</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => {
                  const shortage = Math.max(0, Number(row.reorderPoint) - Number(row.onHand));
                  return (
                    <tr key={row.itemId}>
                      <td className="font-semibold">{row.itemName}<div className="text-[10px] text-slate-400">{row.itemCode}</div></td>
                      <td className="font-bold text-rose-600">{Number(row.onHand).toFixed(2)}</td>
                      <td>{Number(row.reorderPoint).toFixed(2)}</td>
                      <td>{shortage.toFixed(2)}</td>
                      <td>{formatMoney(Number(row.estCost ?? 0) * shortage)}</td>
                    </tr>
                  );
                })}
                {(!data || data.length === 0) && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد أصناف تحت حد الطلب</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'aging' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>العميل</th><th>التليفون</th><th>الإجمالي</th><th>0-30</th><th>31-60</th><th>61-90</th><th>90+</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => (
                  <tr key={row.partyId}>
                    <td className="font-semibold">{row.name}</td>
                    <td dir="ltr" className="text-right">{row.phone ?? '—'}</td>
                    <td className="font-bold text-rose-600">{formatMoney(row.balance)}</td>
                    <td>{formatMoney(row.bucket0_30)}</td>
                    <td>{formatMoney(row.bucket31_60)}</td>
                    <td>{formatMoney(row.bucket61_90)}</td>
                    <td className="font-semibold text-rose-700">{formatMoney(row.bucket90plus)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد مديونيات</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'commissions' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>المندوب</th><th>عدد الفواتير</th><th>إجمالي المبيعات</th><th>إجمالي الربح</th><th>نسبة العمولة</th><th>قيمة العمولة</th></tr></thead>
              <tbody>
                {(data ?? []).map((row: any) => (
                  <tr key={row.repId}>
                    <td className="font-semibold">{row.repName}</td>
                    <td>{row.invoiceCount}</td>
                    <td className="font-bold">{formatMoney(row.totalSales)}</td>
                    <td className="text-emerald-700">{formatMoney(row.totalProfit)}</td>
                    <td>{Number(row.commissionPct).toFixed(2)}%</td>
                    <td className="font-bold text-emerald-700">{formatMoney(row.commissionAmount)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد بيانات عمولات</td></tr>}
              </tbody>
            </table>
          </div>
        )}
         {tab === 'pivot' && (
           <div className="space-y-6">
             <div className="table-wrap">
               <div className="font-bold mb-2">مبيعات: صنف × شهر</div>
               <table className="table">
                 <thead>
                   <tr>
                     <th>الصنف</th>
                     {(data?.salesPivot?.months ?? []).map((m: string) => <th key={m}>{m}</th>)}
                     <th>المجموع</th>
                   </tr>
                 </thead>
                 <tbody>
                   {(data?.salesPivot?.items ?? []).map((row: any) => {
                     const total = (data?.salesPivot?.months ?? []).reduce((sum: number, m: string) => sum + Number(row.months?.[m] ?? 0), 0);
                     return (
                       <tr key={row.itemId}>
                         <td className="font-semibold">{row.itemName}</td>
                         {(data?.salesPivot?.months ?? []).map((m: string) => (
                           <td key={m}>{formatMoney(row.months?.[m] ?? 0)}</td>
                         ))}
                         <td className="font-bold">{formatMoney(total)}</td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>

             <div className="table-wrap">
               <div className="font-bold mb-2">قيمة المخزون: فئة × مخزن</div>
               <table className="table">
                 <thead>
                   <tr>
                     <th>الفئة</th>
                     {(data?.stockPivot?.warehouses ?? []).map((w: string) => <th key={w}>{w}</th>)}
                     <th>المجموع</th>
                   </tr>
                 </thead>
                 <tbody>
                   {(data?.stockPivot?.categories ?? []).map((row: any) => {
                     const total = (data?.stockPivot?.warehouses ?? []).reduce((sum: number, w: string) => sum + Number(row.values?.[w] ?? 0), 0);
                     return (
                       <tr key={row.categoryName}>
                         <td className="font-semibold">{row.categoryName}</td>
                         {(data?.stockPivot?.warehouses ?? []).map((w: string) => (
                           <td key={w}>{formatMoney(row.values?.[w] ?? 0)}</td>
                         ))}
                         <td className="font-bold">{formatMoney(total)}</td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
           </div>
         )}

      </div>
    </AppShell>
  );
}
