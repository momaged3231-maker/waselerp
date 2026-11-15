'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import PricingScreen from '@/components/screens/PricingScreen';
import PriceBulkEditScreen from '@/components/screens/PriceBulkEditScreen';
import ItemImportScreen from '@/components/screens/ItemImportScreen';
import PartiesImportScreen from '@/components/screens/PartiesImportScreen';
import OpeningBalancesScreen from '@/components/screens/OpeningBalancesScreen';
import AuditScreen from '@/components/screens/AuditScreen';
import SupportScreen from '@/components/screens/SupportScreen';

type ToolKey =
  | 'pricing'
  | 'price-bulk'
  | 'items-import'
  | 'parties-import'
  | 'opening-balances'
  | 'audit'
  | 'support';

const TOOLS: { key: ToolKey; label: string }[] = [
  { key: 'pricing', label: 'إدارة قوائم الأسعار' },
  { key: 'price-bulk', label: 'إدارة أسعار الأصناف' },
  { key: 'items-import', label: 'استيراد أصناف' },
  { key: 'parties-import', label: 'استيراد عملاء وموردين' },
  { key: 'opening-balances', label: 'تعيين أرصدة البداية' },
  { key: 'audit', label: 'سجل عمليات المستخدمين' },
  { key: 'support', label: 'بيانات الدعم الفنى' },
];

export default function ToolsPage() {
  const [key, setKey] = useState<ToolKey>('pricing');

  const renderTool = () => {
    switch (key) {
      case 'pricing':
        return <PricingScreen />;
      case 'price-bulk':
        return <PriceBulkEditScreen />;
      case 'items-import':
        return <ItemImportScreen />;
      case 'parties-import':
        return <PartiesImportScreen />;
      case 'opening-balances':
        return <OpeningBalancesScreen />;
      case 'audit':
        return <AuditScreen />;
      case 'support':
        return <SupportScreen />;
      default:
        return null;
    }
  };

  return (
    <AppShell title="الأدوات">
      <div className="flex gap-2 mb-4 flex-wrap">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            onClick={() => setKey(tool.key)}
            className={key === tool.key ? 'btn-primary' : 'btn-soft'}
          >
            {tool.label}
          </button>
        ))}
      </div>
      {renderTool()}
    </AppShell>
  );
}
