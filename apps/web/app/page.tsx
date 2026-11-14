'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  IconCart, IconReceipt, IconWarehouse, IconTrendUp, IconInboxDown, IconWallet, IconBox,
} from '@/components/icons';

export default function DashboardPage() {
  const { session, can } = useSession();
  const [stats, setStats] = useState<any>(null);
  const [topItems, setTopItems] = useState<any[]>([]);
  const [hours, setHours] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);

  useEffect(() => {
    if (!session) return;
    apiFetch('/reports/dashboard').then(setStats).catch(() => {});
    apiFetch('/reports/top-items').then(setTopItems).catch(() => {});
    apiFetch('/reports/sales-by-hour').then(setHours).catch(() => {});
    apiFetch('/inventory/balances?lowStock=true').then((rows: any[]) => setLowStock(rows.slice(0, 8))).catch(() => {});
  }, [session?.activeBranchId]);

  const maxHour = Math.max(1, ...hours.map((h) => Number(h.total ?? 0)));

  const cards = [
    { label: 'مبيعات اليوم', value: formatMoney(stats?.todaySales), icon: IconCart, tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
    { label: 'ربح اليوم', value: formatMoney(stats?.todayProfit), icon: IconTrendUp, tone: 'bg-sky-50 text-sky-600 ring-sky-100' },
    { label: 'مشتريات اليوم', value: formatMoney(stats?.todayPurchases), icon: IconInboxDown, tone: 'bg-amber-50 text-amber-600 ring-amber-100' },
    { label: 'رصيد الخزينة', value: formatMoney(stats?.cashBalance), icon: IconWallet, tone: 'bg-violet-50 text-violet-600 ring-violet-100' },
    { label: 'مديونية العملاء', value: formatMoney(stats?.receivables), icon: IconReceipt, tone: 'bg-rose-50 text-rose-600 ring-rose-100' },
    { label: 'قيمة المخزون', value: formatMoney(stats?.inventoryValue), icon: IconBox, tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
  ];

  return (
    <AppShell title="لوحة المعلومات">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">
          {can('pos.operate') && (
            <Link href="/pos" className="btn-primary"><IconCart className="w-4 h-4" /> فتح نقطة البيع</Link>
          )}
          {can('sales.manage') && (
            <Link href="/invoices" className="btn-soft"><IconReceipt className="w-4 h-4" /> فواتير المبيعات</Link>
          )}
          {can('stock.manage') && (
            <Link href="/inventory" className="btn-soft"><IconWarehouse className="w-4 h-4" /> حركة المخزون</Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {cards.map((card) => {
            const IconCmp = card.icon;
            return (
              <div key={card.label} className="card p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${card.tone}`}>
                  <IconCmp className="w-5 h-5" />
                </div>
                <div className="mt-3 text-[11px] text-slate-500 font-semibold">{card.label}</div>
                <div className="text-[15px] font-extrabold text-slate-800 mt-0.5 tabular-nums">{card.value}</div>
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title">
              <span>المبيعات حسب الساعة</span>
              <span className="text-xs font-normal text-slate-400">اليوم</span>
            </div>
            <div className="p-5 flex items-end gap-1 h-44">
              {hours.length === 0 && <div className="text-sm text-slate-400">لا توجد بيانات اليوم</div>}
              {hours.map((hour) => (
                <div key={hour.hour} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-slate-500">{Number(hour.total).toFixed(0)}</div>
                  <div
                    className="w-full rounded-t-md bg-brand-500"
                    style={{ height: `${(Number(hour.total) / maxHour) * 120}px` }}
                  />
                  <div className="text-[10px] text-slate-400">{hour.hour}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><span>أصناف تحت حد الطلب</span></div>
            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
              {lowStock.length === 0 && <div className="text-sm text-slate-400 p-3">كل الأصناف فوق الحد</div>}
              {lowStock.map((row) => (
                <div key={`${row.itemId}-${row.warehouseId}`} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 bg-slate-50">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{row.name}</div>
                    <div className="text-[11px] text-slate-500">{row.warehouseName}</div>
                  </div>
                  <span className="badge bg-rose-100 text-rose-700 shrink-0">
                    {Number(row.onHandQty).toFixed(0)} / {Number(row.reorderPoint).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title"><span>أكثر الأصناف مبيعاً</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((row) => (
                  <tr key={row.itemId}>
                    <td className="font-semibold">{row.itemName}</td>
                    <td>{Number(row.quantity).toFixed(2)}</td>
                    <td>{formatMoney(row.total)}</td>
                    <td>{formatMoney(row.cost)}</td>
                    <td className="font-bold text-emerald-700">{formatMoney(row.profit)}</td>
                  </tr>
                ))}
                {topItems.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد مبيعات بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
