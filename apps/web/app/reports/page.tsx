'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'items' | 'stock' | 'parties' | 'cash'>('sales');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<any>(null);

  async function load() {
    const query = new URLSearchParams({ from, to });
    if (tab === 'sales') query.set('groupBy', groupBy);
    const endpoint = {
      sales: '/reports/sales-summary',
      items: '/reports/top-items',
      stock: '/reports/stock-value',
      parties: '/reports/party-balances',
      cash: '/reports/cash-summary',
    }[tab];
    setData(await apiFetch(`${endpoint}?${query.toString()}`));
  }

  useEffect(() => { load(); }, [tab, from, to, groupBy]);

  return (
    <AppShell title="التقارير">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {([['sales', 'ملخص المبيعات'], ['items', 'أكثر الأصناف'], ['stock', 'قيمة المخزون'], ['parties', 'أرصدة العملاء والموردين'], ['cash', 'حركة الخزينة']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
        <div className="flex-1" />
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
      </div>
    </AppShell>
  );
}
