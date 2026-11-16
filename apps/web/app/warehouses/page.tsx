'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import StockVoucherScreen from '@/components/screens/StockVoucherScreen';
import StockTransferScreen from '@/components/screens/StockTransferScreen';
import BranchTransferScreen from '@/components/screens/BranchTransferScreen';
import StockCountScreen from '@/components/screens/StockCountScreen';
import LabelsScreen from '@/components/screens/LabelsScreen';
import AssemblyScreen from '@/components/screens/AssemblyScreen';
import AssemblyReportScreen from '@/components/screens/AssemblyReportScreen';
import SerialSearchScreen from '@/components/screens/SerialSearchScreen';
import ItemReportScreen from '@/components/screens/ItemReportScreen';
import ItemBalancesScreen from '@/components/screens/ItemBalancesScreen';
import ReorderReportScreen from '@/components/screens/ReorderReportScreen';
import ExpiryReportScreen from '@/components/screens/ExpiryReportScreen';
import VouchersReportScreen from '@/components/screens/VouchersReportScreen';
import StockReportScreen from '@/components/screens/StockReportScreen';

type WarehouseTab =
  | 'stock-voucher'
  | 'stock-transfer'
  | 'branch-transfers'
  | 'stock-count'
  | 'labels'
  | 'assembly'
  | 'assembly-report'
  | 'serial-search'
  | 'item-report'
  | 'item-balances'
  | 'reorder'
  | 'expiry'
  | 'vouchers-report'
  | 'stock-report';

const TABS: { key: WarehouseTab; label: string }[] = [
  { key: 'stock-voucher', label: 'أذن مخزن' },
  { key: 'stock-transfer', label: 'أذن تحويل مخزن' },
  { key: 'branch-transfers', label: 'تحويل بين فروع' },
  { key: 'stock-count', label: 'أذن تسوية الجرد' },
  { key: 'labels', label: 'طباعة الباركود' },
  { key: 'assembly', label: 'كارت التصنيع' },
  { key: 'assembly-report', label: 'تقرير كارت التصنيع' },
  { key: 'serial-search', label: 'بحث الأرقام المسلسلة للقطع' },
  { key: 'item-report', label: 'تقرير الأصناف' },
  { key: 'item-balances', label: 'استعلام أرصدة صنف' },
  { key: 'reorder', label: 'تقرير الأصناف تحت حد الطلب' },
  { key: 'expiry', label: 'تقرير الأصناف منتهية الصلاحية' },
  { key: 'vouchers-report', label: 'تقرير أذونات المخازن' },
  { key: 'stock-report', label: 'تقرير أرصدة المخازن وحركة الأصناف' },
];

export default function WarehousesPage() {
  const [key, setKey] = useState<WarehouseTab>('stock-voucher');

  const renderTab = () => {
    switch (key) {
      case 'stock-voucher':
        return <StockVoucherScreen />;
      case 'stock-transfer':
        return <StockTransferScreen />;
      case 'branch-transfers':
        return <BranchTransferScreen />;
      case 'stock-count':
        return <StockCountScreen />;
      case 'labels':
        return <LabelsScreen />;
      case 'assembly':
        return <AssemblyScreen />;
      case 'assembly-report':
        return <AssemblyReportScreen />;
      case 'serial-search':
        return <SerialSearchScreen />;
      case 'item-report':
        return <ItemReportScreen />;
      case 'item-balances':
        return <ItemBalancesScreen />;
      case 'reorder':
        return <ReorderReportScreen />;
      case 'expiry':
        return <ExpiryReportScreen />;
      case 'vouchers-report':
        return <VouchersReportScreen />;
      case 'stock-report':
        return <StockReportScreen />;
      default:
        return null;
    }
  };

  return (
    <AppShell title="المخازن">
      <div className="flex gap-2 mb-4 flex-wrap no-print">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setKey(tab.key)}
            className={key === tab.key ? 'btn-primary' : 'btn-soft'}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {renderTab()}
    </AppShell>
  );
}
